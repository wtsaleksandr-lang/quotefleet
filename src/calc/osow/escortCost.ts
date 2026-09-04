/**
 * ESCORT COST — the one number in this engine that cannot be a `Sourced<T>`,
 * beside the one that can.
 *
 * `escortRules.ts` answers how many escorts a state REQUIRES. That is law, and
 * it is cited. What they COST splits cleanly in two, and the whole point of this
 * module is that the two halves never touch:
 *
 *   1. LAW-ENFORCEMENT ESCORTS ARE SOMETIMES PUBLISHED. Six of the twenty-one
 *      jurisdictions print a trooper rate — Alabama, Illinois, Indiana,
 *      Louisiana, New York and Tennessee. Those are official figures with a URL
 *      and a date, so they are `Sourced<PoliceEscortRate>` rows and they go
 *      through `resolveSourced` like any permit fee: two schedules that disagree
 *      resolve to nothing and force review, exactly as Illinois's do.
 *   2. CIVILIAN PILOT CARS ARE A MARKET RATE. No state publishes one — the
 *      research prompt behind all twenty-one datasets explicitly told
 *      researchers not to report them, because there is nothing official to
 *      report.
 *
 * ── WHY THE CIVILIAN SIDE ASKS INSTEAD OF GUESSING ────────────────────────
 * The obvious move is to synthesise a market range. It is the wrong one, for two
 * reasons that survive any amount of research effort:
 *
 *   - THE DISPATCHER ALREADY KNOWS. A pilot-car rate is something a carrier
 *     negotiates and re-negotiates. Their own number is more accurate than any
 *     band this module could construct, and asking for it costs one input.
 *   - THE CITATION IS THE PRODUCT. Every other figure in this engine traces to a
 *     statute section with a revision date. Competing calculators print an escort
 *     line — oversize.io shows "Escort: Rear $653.05" in Georgia — with no
 *     citation of any kind, because there is none to give. Spending our one
 *     differentiator to fill that column with a number of the same provenance
 *     would be a bad trade.
 *
 * So the primary path is a USER-SUPPLIED rate: the caller passes $/mile and/or
 * $/day, and the escort line is computed from it and labelled as theirs. With no
 * rate supplied the honest answer stands unchanged — we hold no pilot-car rates,
 * and saying so is a correct and useful answer rather than a failure.
 *
 * `QUOTEFLEET_INTERNAL_PILOT_CAR_BAND` exists as an OPT-IN, OFF-BY-DEFAULT
 * fallback for a caller with no rate at all. It is a band, never a point, never a
 * `Sourced<T>`, and it restates a figure this product already carries rather than
 * asserting a market rate of its own. See its own comment for exactly what it is
 * and what it deliberately does not model.
 *
 * ── WHY THIS FILE WAS REPLACED RATHER THAN EXTENDED ────────────────────────
 * The previous version of this module was written in Phase 2, wired to nothing,
 * tested by nothing and carrying zero data rows. Its two types could not hold
 * what the corpus actually turned out to contain:
 *
 *   - `EscortRateBenchmark` had no user-rate path at all. It could only hold
 *     BENCHMARKS — `Sourced<EscortRateBenchmark>` rows of somebody's survey
 *     figures — which is the design the evidence now says is the wrong one. It
 *     also priced a short leg through a flat dollar minimum, which collapses a
 *     band to a point ("$650–$650") — the exact false precision its own header
 *     forbade three paragraphs earlier.
 *   - `PoliceEscortRate` was `{ usdPerHour, note }`. Not one of the six states
 *     that publishes a rate fits that shape. Every one of them prices a MINIMUM
 *     — three hours in New York, four in Alabama and Tennessee, two in
 *     Louisiana, a flat $500 per vehicle in Illinois — and the minimum is the
 *     only part of a police escort that can be known before the move. A bare
 *     hourly rate throws away the single computable number and keeps the one
 *     (the hours) that nobody can predict.
 *
 * The three hard constraints from the original header survive, because they were
 * right: our own figure is always a range, it is never a `Sourced<T>` in a
 * jurisdiction's fee schedule, and it labels itself.
 *
 * ── WHAT THIS MODULE MAY NEVER DO ─────────────────────────────────────────
 * It is a PURE POST-PROCESSOR over an `OsowQuote`. It does not import the
 * engine's runtime, it is not called from it, and nothing it computes can reach
 * `totalPermitUsd` — the separation is structural rather than a convention a
 * future edit could forget.
 *
 * The three civilian bases and the police floor are also never summed with each
 * other. A user's own rate, our fallback band and a cited statutory minimum are
 * three different kinds of claim, and they live in three different fields for
 * that reason: an addition sign between them would launder the weakest into the
 * strongest. `pilotCarUsd` (the user's arithmetic) and `pilotCarLowUsd` /
 * `pilotCarHighUsd` (our band) are mutually exclusive by construction — at most
 * one side is ever non-null.
 */
import type { IsoDate, Resolution, SourceDoc, Sourced } from './provenance.js';
import { citeOf, isInEffect, resolveSourced, spreadOf } from './provenance.js';
import type { OsowQuote, OsowJurisdictionResult } from './engine.js';
/**
 * Imported from the jurisdiction files themselves, not re-declared here. A
 * `SourceDoc` describes a document, and two copies of one document is how a URL
 * and a revision date drift apart. Each of these is the same object the state's
 * own escort rules cite for the same figures.
 */
import { ALABAMA_POLICE_ESCORT_RATE_SOURCE } from './jurisdictions/alabama.js';
import {
  ILLINOIS_POLICE_ESCORT_RATE_SOURCE,
  ILLINOIS_POLICE_ESCORT_RULE_SOURCE,
} from './jurisdictions/illinois.js';
import {
  INDIANA_POLICE_ESCORT_RATE_SOURCE,
  INDIANA_MILEAGE_RATE_SOURCE,
} from './jurisdictions/indiana.js';
import {
  LOUISIANA_POLICE_ESCORT_RATE_SOURCE,
  LOUISIANA_POLICE_VEHICLE_FEE_SOURCE,
} from './jurisdictions/louisiana.js';
import { NEW_YORK_POLICE_ESCORT_RATE_SOURCE } from './jurisdictions/newYork.js';
import { TENNESSEE_POLICE_ESCORT_RATE_SOURCE } from './jurisdictions/tennessee.js';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 1 — LAW-ENFORCEMENT ESCORT RATES. Sourced, cited, effective-dated.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A published charge that this model deliberately cannot compute, kept as data
 * so a quote can NAME what it left out instead of silently dropping it.
 *
 * `source` is present only when the component is published somewhere OTHER than
 * the rate row's own document — Louisiana's vehicle-use fee scale lives in the
 * Administrative Code while the officer's hourly rate lives in a State Police
 * policy order, and citing the policy order for the vehicle fee would be a false
 * attribution.
 */
export interface UnpricedPoliceComponent {
  description: string;
  source?: SourceDoc;
}

/**
 * One agency's published law-enforcement escort charges.
 *
 * EVERY FIELD IS OPTIONALLY NULL AND NULL MEANS "THE DOCUMENT DOES NOT SAY".
 * It never means zero. Indiana publishes an hourly trooper rate and no minimum
 * at all, so its floor is genuinely unknowable in advance; reading the absent
 * minimum as zero hours would price a required trooper escort at $0.00.
 */
export interface PoliceEscortRate {
  /** USPS state code. */
  jurisdiction: string;
  agency: string;
  /**
   * The hourly charge per officer AT THE RATE THE MINIMUM IS BILLED AT.
   *
   * New York is why that qualifier exists: the New York State Police publish
   * $101.89 regular and $144.66 overtime, and the three-hour minimum is charged
   * at the OVERTIME rate. Recording the regular rate would under-state the floor
   * by $128.31 per officer and would not reproduce the figure New York's own
   * dataset states ("a single officer costs at least $433.98 before mileage").
   *
   * `null` when the source imposes a charge but does not state a rate — the
   * Illinois administrative rule is the live case.
   */
  usdPerHourPerOfficer: number | null;
  /** Which published rate `usdPerHourPerOfficer` is. */
  hourlyRateKind: 'regular' | 'overtime' | 'flat' | 'unstated';
  /** Minimum billable hours per officer; `null` = none published. */
  minimumHoursPerOfficer: number | null;
  /**
   * A published per-officer (or per-vehicle) MONEY floor, where the source
   * states one directly instead of stating hours.
   *
   * OPTIONAL in the Colorado-`perAxleUsd` sense: absent everywhere but Illinois,
   * whose 625 ILCS 5/15-312 reads "$125 per hour per vehicle, minimum $500 per
   * vehicle". Deriving four hours from $500 ÷ $125 would put a number in the
   * dataset that the statute does not contain, and it would be wrong the moment
   * the two figures are amended apart from each other.
   */
  minimumChargeUsdPerOfficer: number | null;
  /** Minimum officers the agency assigns; `null` = none published. */
  minimumOfficers: number | null;
  /** Flat per-application administrative charge; `null` = none published. */
  administrativeUsd: number | null;
  /**
   * Per-mile vehicle charge — recorded ONLY when the row's own cited document
   * states the figure. It is deliberately NOT part of the floor: every state
   * that publishes one measures it from the officer's station, home or troop
   * area, and this engine holds no such distance. See `policeEscortFloorUsd`.
   */
  perMileUsd: number | null;
  /** Published charges the floor cannot include, each named. */
  unpriced: UnpricedPoliceComponent[];
  /**
   * The escort rules in this jurisdiction's own dataset whose firing means a
   * law-enforcement escort is required.
   *
   * THIS EXISTS BECAUSE A REQUIRED POLICE ESCORT OFTEN HAS NO PUBLISHED COUNT.
   * `EscortEvaluation.policeFront`/`policeRear` carry a number only where the
   * state assigns positions — Alabama over 150 ft, Louisiana, Florida. New York,
   * Tennessee and Illinois all REQUIRE a trooper and none of the three publishes
   * how many, so their rules fire with a `manualReview` reason and no count at
   * all. Reading zero there would report "no police escort on this move" for the
   * exact loads that need one most.
   */
  triggeringEscortRuleIds: string[];
}

/** Two schedules describing the same charges. Prose is not part of the claim. */
export function policeEscortRatesEqual(a: PoliceEscortRate, b: PoliceEscortRate): boolean {
  return (
    a.usdPerHourPerOfficer === b.usdPerHourPerOfficer &&
    a.hourlyRateKind === b.hourlyRateKind &&
    a.minimumHoursPerOfficer === b.minimumHoursPerOfficer &&
    a.minimumChargeUsdPerOfficer === b.minimumChargeUsdPerOfficer &&
    a.minimumOfficers === b.minimumOfficers &&
    a.administrativeUsd === b.administrativeUsd &&
    a.perMileUsd === b.perMileUsd
  );
}

function rate(
  value: PoliceEscortRate,
  source: SourceDoc,
  effectiveFrom: IsoDate,
  note?: string,
): Sourced<PoliceEscortRate> {
  return {
    value,
    source,
    effectiveFrom,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

/**
 * EVERY PUBLISHED LAW-ENFORCEMENT ESCORT RATE IN THE TWENTY-ONE-STATE CORPUS.
 *
 * Harvested from the jurisdiction datasets rather than re-researched: each row's
 * figures are the ones already quoted verbatim inside that state's escort rules,
 * and each row cites the same `SourceDoc` object the jurisdiction file cites, so
 * a document can never be described two different ways in two places.
 *
 * The list is SIX STATES LONG and that is the finding, not a gap. Fifteen
 * jurisdictions publish nothing, and `NO_PUBLISHED_POLICE_ESCORT_RATE` records
 * each of those as a positive result with the rule that carries its citation.
 */
export const POLICE_ESCORT_RATES: ReadonlyArray<Sourced<PoliceEscortRate>> = [
  // ── Alabama ────────────────────────────────────────────────────────────
  rate(
    {
      jurisdiction: 'AL',
      agency: 'Alabama Law Enforcement Agency',
      usdPerHourPerOfficer: 100,
      hourlyRateKind: 'flat',
      minimumHoursPerOfficer: 4,
      minimumChargeUsdPerOfficer: null,
      minimumOfficers: null,
      administrativeUsd: 200,
      perMileUsd: null,
      unpriced: [
        {
          description:
            'Mileage at the current IRS rate, calculated from each officer\'s residence or office and back. The IRS rate is not a fixed published figure and the officers\' origins are not known before ALEA assigns them.',
        },
        {
          description:
            '$12.00 subsistence for an escort over four hours; $12.75 per diem for 6–12 hours and $34.00 for 12 hours or more. Which applies depends on the hours actually worked.',
        },
        {
          description:
            'Cancellation: $200.00 more than 24 hours out, or $200.00 plus four hours\' pay per assigned officer inside 24 hours.',
        },
        {
          description:
            'Billable time starts 30 minutes before the scheduled start and ends 30 minutes after completion, so the charged hours always exceed the moving hours.',
        },
      ],
      triggeringEscortRuleIds: [
        'al-length-over-150-law-enforcement',
        'al-superload-law-enforcement-minimum',
      ],
    },
    ALABAMA_POLICE_ESCORT_RATE_SOURCE,
    '2023-03-17',
  ),

  // ── Illinois — TWO SCHEDULES, BOTH CURRENT, AND THEY DISAGREE ──────────
  /**
   * This is the case the sourced half of the module exists to handle. The
   * statute charges by the hour with a money floor; the still-published
   * administrative rule charges by the State Police District crossed and will
   * not say its own hourly figure. `resolveSourced` sees two in-effect rows with
   * different values, refuses to pick, and Illinois comes back with no floor and
   * a review flag — the same treatment a disputed permit fee gets.
   */
  rate(
    {
      jurisdiction: 'IL',
      agency: 'Illinois State Police',
      usdPerHourPerOfficer: 125,
      hourlyRateKind: 'flat',
      minimumHoursPerOfficer: null,
      minimumChargeUsdPerOfficer: 500,
      minimumOfficers: null,
      administrativeUsd: null,
      perMileUsd: null,
      unpriced: [
        {
          description:
            'IDOT escorts are charged separately at $40.00 per hour per vehicle with an $80.00 minimum per vehicle. Whether IDOT accompanies a given move is decided when the permit is written.',
        },
        {
          description:
            'Time is counted from pickup to completion including delays, with any fraction of an hour rounded up, so the charged hours are not the moving hours.',
        },
      ],
      triggeringEscortRuleIds: ['il-state-police-triggers'],
    },
    ILLINOIS_POLICE_ESCORT_RATE_SOURCE,
    '2026-06-16',
    'The statutory schedule, effective 16 June 2026. The administrative rule below has not been withdrawn.',
  ),
  rate(
    {
      jurisdiction: 'IL',
      agency: 'Illinois State Police',
      usdPerHourPerOfficer: null,
      hourlyRateKind: 'unstated',
      minimumHoursPerOfficer: null,
      minimumChargeUsdPerOfficer: null,
      minimumOfficers: null,
      administrativeUsd: null,
      perMileUsd: null,
      unpriced: [
        {
          description:
            '$80.00 per Illinois State Police District crossed, $160.00 for the Chicago District, plus an Illinois State Police hourly fee the rule does not state. The number of Districts on a route is not a quantity this engine holds, and the missing hourly figure cannot be supplied from the statute without asserting that one schedule supersedes the other.',
        },
      ],
      triggeringEscortRuleIds: ['il-state-police-triggers'],
    },
    ILLINOIS_POLICE_ESCORT_RULE_SOURCE,
    '2012-08-01',
    'The administrative rule, still published. It charges on a different basis from the statute and states no hourly rate of its own.',
  ),

  // ── Indiana ────────────────────────────────────────────────────────────
  /**
   * The state that publishes a RATE and no MINIMUM. Its floor is genuinely
   * null: with no minimum hours and no minimum charge there is no number the
   * schedule can be made to produce before the move, and $43.00 × 0 hours is not
   * an answer.
   */
  rate(
    {
      jurisdiction: 'IN',
      agency: 'Indiana State Police',
      usdPerHourPerOfficer: 43,
      hourlyRateKind: 'flat',
      minimumHoursPerOfficer: null,
      minimumChargeUsdPerOfficer: null,
      minimumOfficers: null,
      administrativeUsd: null,
      perMileUsd: null,
      unpriced: [
        {
          description:
            'A motor carrier inspector is $34.00 per hour and each escort must include at least one sworn trooper, so the mix of officers — and therefore the blended rate — is set by ISP.',
        },
        {
          description:
            'Hours are computed round trip from the officers\' HOMES, which are not known before ISP assigns them, so no minimum can be derived from the route.',
        },
        {
          description:
            'Vehicle mileage at Indiana\'s approved state rate of $0.64 per mile from 7 August 2026, applied to the same round trip from the officers\' homes.',
          source: INDIANA_MILEAGE_RATE_SOURCE,
        },
      ],
      triggeringEscortRuleIds: ['in-police-over-17-wide', 'in-police-over-200000'],
    },
    INDIANA_POLICE_ESCORT_RATE_SOURCE,
    '2019-03-01',
    'The agreement is more than three years old and remains the document Indiana State Police links.',
  ),

  // ── Louisiana ──────────────────────────────────────────────────────────
  rate(
    {
      jurisdiction: 'LA',
      agency: 'Louisiana State Police',
      usdPerHourPerOfficer: 75,
      hourlyRateKind: 'flat',
      minimumHoursPerOfficer: 2,
      minimumChargeUsdPerOfficer: null,
      minimumOfficers: null,
      administrativeUsd: null,
      perMileUsd: null,
      unpriced: [
        {
          description:
            'A separate fee for the use of the State Police vehicle, banded by the distance the ESCORT VEHICLE travels: 0–49 mi $100; 50–99 mi $125; 100–199 mi $150; 200–299 mi $175; 300 mi and over $200. Paid to Louisiana State Police on top of the officer\'s time. It is banded on the escort vehicle\'s own distance, which includes travel to and from the troop area, and not on the load\'s in-state miles.',
          source: LOUISIANA_POLICE_VEHICLE_FEE_SOURCE,
        },
        {
          description:
            'One hour of travel time is added for a move beginning and ending in the same Troop area; travel across troop boundaries follows the Travel Time Remuneration Chart, which is not a published dollar figure.',
        },
        {
          description:
            'The mover must provide the officer a room when the move runs more than one day. No cancellation charge is published — that is unknown here, not zero.',
        },
      ],
      triggeringEscortRuleIds: [
        'la-police-width-over-16-two-lane',
        'la-police-width-over-16-multi-lane',
        'la-police-length-over-125',
      ],
    },
    LOUISIANA_POLICE_ESCORT_RATE_SOURCE,
    '2024-01-15',
  ),

  // ── New York ───────────────────────────────────────────────────────────
  rate(
    {
      jurisdiction: 'NY',
      agency: 'New York State Police',
      usdPerHourPerOfficer: 144.66,
      hourlyRateKind: 'overtime',
      minimumHoursPerOfficer: 3,
      minimumChargeUsdPerOfficer: null,
      minimumOfficers: null,
      administrativeUsd: null,
      perMileUsd: 0.725,
      unpriced: [
        {
          description:
            'The regular rate is $101.89 per hour and applies to hours beyond the three-hour overtime minimum. Which hours fall where is set by the assignment.',
        },
        {
          description:
            'Mileage at $0.725 per mile runs from the moment a trooper leaves the STATION, so it is not the load\'s in-state mileage and cannot be computed from this lane.',
        },
        {
          description:
            'New York publishes no required NUMBER of police vehicles, so the floor below is for a single officer and the real assignment may be larger.',
        },
      ],
      triggeringEscortRuleIds: ['ny-police-triggers'],
    },
    NEW_YORK_POLICE_ESCORT_RATE_SOURCE,
    '2026-04-01',
    'Rates include fringe benefits and indirect costs at 62.91%.',
  ),

  // ── Tennessee ──────────────────────────────────────────────────────────
  rate(
    {
      jurisdiction: 'TN',
      agency: 'Tennessee Highway Patrol',
      usdPerHourPerOfficer: 65,
      hourlyRateKind: 'flat',
      minimumHoursPerOfficer: 4,
      minimumChargeUsdPerOfficer: null,
      minimumOfficers: 2,
      administrativeUsd: null,
      perMileUsd: 0.13,
      unpriced: [
        {
          description:
            'Tennessee codifies no per-application administrative fee, no officer per diem and no cancellation penalty for an OS/OW escort. Their absence from the floor must not be read as their being nil.',
        },
        {
          description:
            'Rule 1680-07-01-.12(4) separately lets the Permit Office require law-enforcement escorts on a super-heavy movement with no threshold at all.',
        },
      ],
      triggeringEscortRuleIds: ['tn-thp-escort-over-18'],
    },
    TENNESSEE_POLICE_ESCORT_RATE_SOURCE,
    '2026-09-03',
    'The TDOT FAQ states no revision date, so the date we retrieved it is used as the effective-from rather than inventing one.',
  ),
];

/**
 * Why a jurisdiction has no police-escort rate — a POSITIVE finding, recorded so
 * a quote can say "this state requires a trooper and publishes no price" instead
 * of falling silent.
 *
 *   - `noScheduleExists` — there is nothing to publish. Colorado bills the
 *     actual cost through a bond or escrow; Virginia has no state rate at all
 *     because each locality authorises and prices its own escort. These are not
 *     documents we failed to find.
 *   - `notPublished` — an agency does charge, and no schedule is published.
 */
export type NoPoliceRateKind = 'noScheduleExists' | 'notPublished';

export interface NoPublishedPoliceRate {
  jurisdiction: string;
  kind: NoPoliceRateKind;
  /**
   * The escort rule in that jurisdiction's own dataset that carries the finding
   * and its citation. Pointing at the live sourced rule beats copying a
   * `SourceDoc` here, where the copy could drift from the original.
   */
  escortRuleId: string;
  finding: string;
}

/** The fifteen jurisdictions that publish no law-enforcement escort rate. */
export const NO_PUBLISHED_POLICE_ESCORT_RATE: ReadonlyArray<NoPublishedPoliceRate> = [
  {
    jurisdiction: 'AR',
    kind: 'notPublished',
    escortRuleId: 'ar-additional-escorts-discretionary',
    finding:
      'The Permit Section may require one or more law-enforcement vehicles under ARDOT Rules 3.E.7, 4.H.2 and 6.E.6. No dimension triggers it automatically and Arkansas publishes no officer rate.',
  },
  {
    jurisdiction: 'CA',
    kind: 'notPublished',
    escortRuleId: 'ca-chp-escort-required',
    finding:
      'No CHP hourly or per-mile escort rate exists in chp.ca.gov, dot.ca.gov or 21 CCR. The $50 per hour in 21 CCR §1411.3(c)(4) is Caltrans traffic-operations staff — a different agency and a different service — and must not be read as a trooper rate.',
  },
  {
    jurisdiction: 'CO',
    kind: 'noScheduleExists',
    escortRuleId: 'co-police-escort-billed-at-cost',
    finding:
      'Structural, not a gap: 2 CCR 601-4 §606.4 bills the actual cost of Colorado State Patrol time through a bond or escrow. There is no rate card to find — the number is whatever the escort actually costs.',
  },
  {
    jurisdiction: 'FL',
    kind: 'noScheduleExists',
    escortRuleId: 'fl-length-over-250',
    finding:
      'FHP escorts of commercial overdimensional loads are OFF-DUTY POLICE EMPLOYMENT under FHP Policy 5.10, approved troop by troop, so there is no statewide schedule. Nothing in FHP 5.10, FAC 14-26, FS 316.550 or FDOT\'s permit pages states a rate.',
  },
  {
    jurisdiction: 'GA',
    kind: 'notPublished',
    escortRuleId: 'ga-police-and-unkeyed-triggers',
    finding:
      'Georgia requires police escorts for a house move and a minimum of two for a Mega Load, and publishes no hourly, per-mile, minimum-call or administrative rate for either.',
  },
  {
    jurisdiction: 'KY',
    kind: 'notPublished',
    escortRuleId: 'ky-police-escort-no-rate-schedule',
    finding:
      'Neither the Kentucky State Police (502 KAR, KRS Chapter 16) nor the Transportation Cabinet publishes an application fee, hourly officer rate, minimum hours, mileage charge or cancellation charge. The title index was opened and searched.',
  },
  {
    jurisdiction: 'MO',
    kind: 'notPublished',
    escortRuleId: 'mo-width-over-18',
    finding:
      'MoDOT requires a law-enforcement escort over 18 ft wide, over 200 ft long and over 18 ft high, and publishes no hourly, mileage or fixed rate. 7 CSR 10-25 says only that permitting authority may be revoked if escorting agencies are not reimbursed.',
  },
  {
    jurisdiction: 'NJ',
    kind: 'noScheduleExists',
    escortRuleId: 'nj-no-state-police-escort',
    finding:
      'NJDOT assigns only private escorts — "Only private escorts are assigned to permitted loads" — so there is no state police escort trigger and no rate. A Port Authority Police escort through Port Newark is arranged directly with PAPD and is not a state fee.',
  },
  {
    jurisdiction: 'NC',
    kind: 'notPublished',
    escortRuleId: 'nc-width-over-16',
    finding:
      'One of the three escorts over 16 ft wide must be a State Highway Patrol escort. The Highway Patrol publishes no hourly or per-mile rate; G.S. §143B-1729 requires only "a fee covering the full cost to administer, plan, and carry out the escort".',
  },
  {
    jurisdiction: 'OH',
    kind: 'notPublished',
    escortRuleId: 'oh-police-over-16-wide',
    finding:
      'Ohio requires a law-enforcement escort in addition to private escorts over 16 ft wide and publishes no officer count, no position and no hourly or per-mile rate.',
  },
  {
    jurisdiction: 'OK',
    kind: 'notPublished',
    escortRuleId: 'ok-police-escort-triggers-and-rate-unknown',
    finding:
      'The charge is "a fee covering the full cost to administer, plan, and carry out the escort within this state" and, although the statute directs DPS to adopt a schedule of fees, no hourly, mileage or fixed schedule is published.',
  },
  {
    jurisdiction: 'PA',
    kind: 'notPublished',
    escortRuleId: 'pa-superload-police-conflict',
    finding:
      'PennDOT publishes no numeric State Police escort rate — "State escort fees vary based on escort personnel status (e.g., overtime) and will be invoiced separately".',
  },
  {
    jurisdiction: 'TX',
    kind: 'notPublished',
    escortRuleId: 'tx-police-discretionary',
    finding:
      'TxDOT may require law-enforcement traffic control, sets no threshold that would let it be predicted, and publishes no officer rate.',
  },
  {
    jurisdiction: 'VA',
    kind: 'noScheduleExists',
    escortRuleId: 'va-police-escort-per-locality',
    finding:
      'Virginia does not have a state police escort rate. 24VAC20-82-60.B.9 requires written authorisation from LOCAL law-enforcement personnel for each locality on the route, negotiated and priced separately with every one of them. There is no published schedule to quote.',
  },
  {
    jurisdiction: 'WA',
    kind: 'notPublished',
    escortRuleId: 'wa-police-escort-no-published-rate',
    finding:
      'Neither the Washington State Patrol nor WSDOT publishes an application fee, hourly rate, mileage rate, minimum hours, per diem or cancellation charge in the RCW, the WAC or their own FAQs. WSP\'s own answer to "When is an escort car required?" is "Please contact WSDOT".',
  },
];

/**
 * The least a published schedule can charge for `officers`, before mileage.
 *
 * MILEAGE IS DELIBERATELY EXCLUDED. Every state here that publishes a per-mile
 * figure measures it from the officer's station (New York), home (Indiana) or
 * troop area (Louisiana) — distances this engine does not hold and cannot derive
 * from the load's in-state miles. Multiplying the state's per-mile rate by the
 * lane's miles would produce a confident number about the wrong journey.
 *
 * Returns `null` — never `0` — when the schedule states no minimum at all.
 */
export function policeEscortFloorUsd(
  value: PoliceEscortRate,
  officers: number,
): number | null {
  const perOfficer =
    value.minimumChargeUsdPerOfficer ??
    (value.minimumHoursPerOfficer !== null && value.usdPerHourPerOfficer !== null
      ? round2(value.minimumHoursPerOfficer * value.usdPerHourPerOfficer)
      : null);
  if (perOfficer === null) return null;
  return round2(officers * perOfficer + (value.administrativeUsd ?? 0));
}

// ═══════════════════════════════════════════════════════════════════════════
// PART 2 — THE CIVILIAN PILOT-CAR ESTIMATE. A band, and it says so.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WHERE A CIVILIAN PILOT-CAR FIGURE CAME FROM. Carried on every result, because
 * three claims of very different strength can occupy the same column and a
 * reader must never have to guess which one they are looking at.
 *
 *   - `userSupplied`  — the caller's own negotiated rate. The strongest of the
 *                       three and the only one that is anybody's real price.
 *   - `internalBand`  — QuoteFleet's own fallback band, opt-in and off by
 *                       default. Ours, not a source's.
 *   - `none`          — no rate was supplied and the fallback was not asked
 *                       for. The honest default: we hold no pilot-car rates.
 *   - `notApplicable` — the state requires no pilot car on this load.
 */
export type PilotCarCostBasis =
  | 'userSupplied'
  | 'internalBand'
  | 'none'
  | 'notApplicable';

/**
 * The caller's own pilot-car rate — THE PRIMARY PATH.
 *
 * Both components are optional and at least one must be present for the rate to
 * do anything. A carrier that bills purely by the mile supplies `usdPerMile`; one
 * that bills a day rate plus mileage supplies both.
 *
 * `daysPerJurisdiction` IS REQUIRED ALONGSIDE `usdPerDay` AND HAS NO DEFAULT.
 * A day rate without a day count is unpriceable, and defaulting it to one would
 * quietly bill a five-day state crossing as a single day. The corpus's per-state
 * permit validity periods look like they could supply it and cannot — see
 * `QUOTEFLEET_INTERNAL_PILOT_CAR_BAND` for why — so the caller states it or the
 * leg comes back null.
 */
export interface UserPilotCarRate {
  usdPerMile?: number;
  usdPerDay?: number;
  /** Days billed per pilot car per state crossing. Required with `usdPerDay`. */
  daysPerJurisdiction?: number;
  /** The operator's own minimum per pilot car per state crossing, if they have one. */
  minimumUsdPerJurisdiction?: number;
}

function hasUserRate(rate: UserPilotCarRate | undefined): rate is UserPilotCarRate {
  return (
    rate !== undefined &&
    (rate.usdPerMile !== undefined || rate.usdPerDay !== undefined)
  );
}

/**
 * QuoteFleet's own fallback band. Not a market survey and not anybody's
 * published figure.
 *
 * DELIBERATELY NOT A `Sourced<T>`: the absence of `source`, `effectiveFrom` and
 * `revisedOn` is the point. There is no document behind these numbers, and
 * giving the type somewhere to put one would invite a future edit to fill it in
 * with a state fee schedule that contains no pilot-car rate.
 */
export interface InternalPilotCarBand {
  lowUsdPerMile: number;
  highUsdPerMile: number;
  /** Where the band comes from. */
  basis: string;
  /** What it deliberately does NOT model, so a reader is not surprised by it. */
  limitations: string[];
}

/**
 * THE FALLBACK BAND, AND EXACTLY WHAT IT IS.
 *
 * It restates ONE figure this product already carries and adds nothing of its
 * own. `engine.ts` and `materiality.ts` both state — as the reason an escort
 * count disagreement can never be absorbed as immaterial — that "one extra or
 * missing pilot car on a 1,200-mile run is $2,400–3,600". That is $2.00–$3.00 a
 * mile, it is load-bearing (the materiality fence is justified by it), and a
 * different band here would make this module contradict the engine's own safety
 * rule. `accessorialLibrary.ts` corroborates the order of magnitude with a $650
 * flat `pilot_car` accessorial default.
 *
 * IT IS OFF BY DEFAULT AND IT UNDERSTATES SHORT LEGS, ON PURPOSE. A real
 * engagement has a floor — a 46-mile crossing still costs the operator a day —
 * and an earlier draft of this module modelled that with a 250-mile minimum
 * billable distance. That minimum was removed: it was reasoning about typical
 * market behaviour rather than a restatement of anything, which is precisely the
 * kind of invention this module exists to avoid. What is left is a pure
 * mileage band that names its own understatement in a warning on every short leg
 * and defers to the caller's real rate whenever one is supplied.
 *
 * ON DURATION. Pilot cars are billed by the day plus mileage, so a multi-day
 * move costs more than raw mileage implies — which is why `UserPilotCarRate`
 * takes a day rate. The corpus DOES hold per-state permit validity periods
 * (California 7 days, Colorado up to 5, Kentucky 10, Louisiana 5, North Carolina
 * 10, Tennessee 10, Virginia 13) and they are NOT usable as a day count, for
 * three reasons recorded here rather than rediscovered later: a validity period
 * is the window the permit may be USED in, not the time the load spends in the
 * state (a 62-mile Kentucky leg does not take ten days, and pricing it as ten
 * would inflate it by an order of magnitude); the periods are held only as prose
 * inside note strings, never as structured data the engine can read; and they
 * are not internally settled — Indiana's own two sources say 15 days and 5 days
 * for the same permit. So no day count is ever inferred anywhere in this file.
 */
export const QUOTEFLEET_INTERNAL_PILOT_CAR_BAND: InternalPilotCarBand = {
  lowUsdPerMile: 2.0,
  highUsdPerMile: 3.0,
  basis:
    'QuoteFleet\'s own figure, restated: engine.ts and materiality.ts both put one pilot car on a 1,200-mile run at $2,400–$3,600 — $2.00–$3.00 per mile — and use it to justify never absorbing an escort-count disagreement as immaterial. accessorialLibrary.ts corroborates the magnitude with a $650 flat pilot_car accessorial default. No state publishes a pilot-car rate; none of this is a state figure and none of it is cited.',
  limitations: [
    'MILEAGE ONLY. It models no per-engagement floor and no day rate, so it UNDERSTATES a short state crossing, where the operator\'s day dominates and the miles do not.',
    'NATIONAL. There is no per-state band here, because inventing twenty-one regional market rates would be fabricating precision from nothing.',
    'A FALLBACK. Any rate the carrier actually supplies is more accurate than this, and supplying one replaces it entirely.',
  ],
};

/**
 * The sentence a figure computed from OUR band must carry. A constant so tests
 * can assert it is present rather than matching on prose that drifts.
 */
export const ESCORT_ESTIMATE_DISCLAIMER =
  'This pilot-car range is QUOTEFLEET\'S OWN ESTIMATE, not a state fee, not a cited figure and not a market survey. No state publishes a pilot-car rate — the state sets whether an escort is required and independent operators set the price. It is mileage-only, so it understates a short state crossing, and it is never added to the permit total. Supply your own pilot-car rate to replace it, and confirm any figure against a booked operator rate before billing it.';

/**
 * The sentence a figure computed from the CALLER'S rate must carry. Different
 * from the estimate disclaimer because the claim is different: this is their
 * arithmetic, not our guess, and it should not be hedged as though it were.
 */
export const ESCORT_USER_RATE_NOTE =
  'This pilot-car figure is computed from the rate YOU supplied, applied to the escort counts each state\'s own rules require. It is not a state fee, it is not cited, and it is not included in the permit total.';

/** The answer when no rate was supplied and our fallback was not asked for. */
export const ESCORT_NO_RATE_NOTE =
  'We hold no pilot-car rates. States set how many escorts a load needs; what they cost is a market rate negotiated between the carrier and the operator, and no state publishes one. Supply your own $/mile or $/day rate to price the escorts below.';

// ═══════════════════════════════════════════════════════════════════════════
// PART 3 — PRICING A LANE'S ESCORTS, WITHOUT TOUCHING THE PERMIT TOTAL.
// ═══════════════════════════════════════════════════════════════════════════

/** What one jurisdiction's escorts cost, with the halves kept apart. */
export interface JurisdictionEscortEstimate {
  jurisdiction: string;
  jurisdictionName: string;

  // ── Civilian pilot cars ──────────────────────────────────────────────
  /** Certified pilot cars this state requires — the engine's own sourced count. */
  pilotCars: number;
  milesInJurisdiction: number | null;
  /** Which claim the figure below is. See `PilotCarCostBasis`. */
  pilotCarBasis: PilotCarCostBasis;
  /**
   * A POINT, set only when `pilotCarBasis === 'userSupplied'`. The caller's own
   * rate is their real price, so presenting it as a range would add uncertainty
   * that is not there.
   */
  pilotCarUsd: number | null;
  /**
   * A BAND, set only when `pilotCarBasis === 'internalBand'`. Never averaged to
   * a point, and never non-null at the same time as `pilotCarUsd`.
   */
  pilotCarLowUsd: number | null;
  pilotCarHighUsd: number | null;
  /** Days billed per pilot car, when the caller supplied a day rate. */
  billedDaysPerPilotCar: number | null;

  // ── Law enforcement: SOURCED ─────────────────────────────────────────
  /** True when this state's own rules require a law-enforcement escort. */
  policeRequired: boolean;
  /** Officers the floor is computed for. 0 when none is required. */
  policeOfficers: number;
  /** True when the state requires one but publishes no count. */
  policeCountUnpublished: boolean;
  /** The least the published schedule can charge, before mileage. */
  policeFloorUsd: number | null;
  /** Range across candidate schedules when they disagree. */
  policeFloorLowUsd: number | null;
  policeFloorHighUsd: number | null;
  /** Per-mile police charge the state publishes, for the reader to apply. */
  policePerMileUsd: number | null;
  policeUnpriced: UnpricedPoliceComponent[];
  policeSources: SourceDoc[];

  warnings: string[];
  requiresManualReview: boolean;
}

/** The lane's escort picture. Separate figures, never one. */
export interface LaneEscortEstimate {
  /**
   * Literal `false`, not `boolean` — the type forbids a lane result that claims
   * to be a cited figure. It is `false` because the civilian side is either the
   * CALLER's rate or nothing at all unless our fallback band was asked for; see
   * `pilotCarBasis` for which of the three this lane actually used.
   */
  isSourcedFigure: false;
  /** Which claim the civilian figures on this lane are. */
  pilotCarBasis: PilotCarCostBasis;
  /** The sentence that matches `pilotCarBasis`. */
  disclaimer: string;
  /** The caller's rate, echoed back, when one was supplied. */
  userRate: UserPilotCarRate | null;
  /** Our fallback band, present only when it was actually used. */
  internalBand: InternalPilotCarBand | null;
  byJurisdiction: JurisdictionEscortEstimate[];

  /** CIVILIAN — the caller's own arithmetic. A point, and only for `userSupplied`. */
  pilotCarsRequired: number;
  pilotCarUsd: number | null;
  /** CIVILIAN — our band. Only for `internalBand`, and never averaged to a point. */
  pilotCarLowUsd: number | null;
  pilotCarHighUsd: number | null;

  /**
   * LAW ENFORCEMENT — sourced, and NEVER added to the pilot-car band above.
   * One is a guess with a stated basis, the other is a citation.
   */
  policeStatesRequiring: string[];
  policeOfficersRequired: number;
  policeFloorUsd: number | null;
  /** True when some state requires a trooper whose cost cannot be floored. */
  policeFloorIncomplete: boolean;
  policeStatesWithoutFloor: string[];
  policeSources: SourceDoc[];

  warnings: string[];
  requiresManualReview: boolean;
}

/**
 * Resolve one jurisdiction's police-escort schedule as of a date.
 *
 * Goes through `resolveSourced` exactly like a permit fee, so Illinois's two
 * live schedules produce a refusal rather than a pick, and `spreadOf` supplies
 * the honest range across whatever the candidates could be costed at.
 */
function resolvePoliceRate(
  code: string,
  officers: number,
  asOf: IsoDate,
): {
  resolution: Resolution<PoliceEscortRate>;
  floorUsd: number | null;
  lowUsd: number | null;
  highUsd: number | null;
} | null {
  const rows = POLICE_ESCORT_RATES.filter((r) => r.value.jurisdiction === code);
  if (rows.length === 0) return null;

  const resolution = resolveSourced<PoliceEscortRate>(
    `${code} law-enforcement escort rate`,
    [...rows],
    asOf,
    policeEscortRatesEqual,
  );

  // Reuse the range machinery rather than a second min/max written here: the
  // candidates are re-expressed as their computed floors and handed to
  // `spreadOf`, which is the same function a conflicted permit fee uses.
  const costed = resolution.candidates
    .map((c) => ({ ...c, value: policeEscortFloorUsd(c.value, officers) }))
    .filter((c): c is Sourced<number> => c.value !== null);
  const spread = spreadOf({
    ...resolution,
    value: null,
    chosen: null,
    candidates: costed,
  } as unknown as Resolution<number>);

  return {
    resolution,
    floorUsd:
      resolution.value === null
        ? null
        : policeEscortFloorUsd(resolution.value, officers),
    lowUsd: spread.low,
    highUsd: spread.high,
  };
}

/** Does any rule that fired in this state mean a trooper is required? */
function policeTriggered(
  result: OsowJurisdictionResult,
  triggeringRuleIds: readonly string[],
): boolean {
  return result.escorts.applied.some((a) => triggeringRuleIds.includes(a.ruleId));
}

function estimateOne(
  result: OsowJurisdictionResult,
  milesInJurisdiction: number | undefined,
  asOf: IsoDate,
  userRate: UserPilotCarRate | undefined,
  useInternalBand: boolean,
): JurisdictionEscortEstimate {
  const code = result.jurisdiction;
  const warnings: string[] = [];
  let requiresManualReview = false;

  // ── Civilian pilot cars ─────────────────────────────────────────────
  const pilotCars = result.escortsRequired;
  let pilotCarBasis: PilotCarCostBasis = 'notApplicable';
  let pilotCarUsd: number | null = null;
  let pilotCarLowUsd: number | null = null;
  let pilotCarHighUsd: number | null = null;
  let billedDaysPerPilotCar: number | null = null;

  if (pilotCars === 0) {
    // A genuine zero: the state's own escort rules require no pilot car on this
    // load. Distinct from `null`, which is "required and not priced".
    pilotCarBasis = 'notApplicable';
    pilotCarUsd = 0;
  } else if (hasUserRate(userRate)) {
    pilotCarBasis = 'userSupplied';
    const needsMiles = userRate.usdPerMile !== undefined;
    const needsDays = userRate.usdPerDay !== undefined;
    if (needsMiles && milesInJurisdiction === undefined) {
      warnings.push(
        `${result.jurisdictionName} requires ${pilotCars} pilot car${pilotCars === 1 ? '' : 's'} and your rate is priced per mile, but the miles inside ${result.jurisdictionName} were not supplied. The escort cost here is UNKNOWN — it is not zero.`,
      );
      requiresManualReview = true;
    } else if (needsDays && userRate.daysPerJurisdiction === undefined) {
      // A day rate with no day count is unpriceable. Assuming one day would
      // silently bill a five-day crossing as a single day.
      warnings.push(
        `You supplied a pilot-car DAY rate but no number of days per state, so ${result.jurisdictionName}'s ${pilotCars} pilot car${pilotCars === 1 ? '' : 's'} cannot be priced. A day rate without a day count is not a price, and one day is not a safe default.`,
      );
      requiresManualReview = true;
    } else {
      billedDaysPerPilotCar = needsDays ? (userRate.daysPerJurisdiction as number) : null;
      const mileageComponent =
        (userRate.usdPerMile ?? 0) * (milesInJurisdiction ?? 0);
      const dayComponent = (userRate.usdPerDay ?? 0) * (billedDaysPerPilotCar ?? 0);
      const floor = userRate.minimumUsdPerJurisdiction ?? 0;
      const perCar = Math.max(mileageComponent + dayComponent, floor);
      pilotCarUsd = round2(perCar * pilotCars);
      if (floor > 0 && mileageComponent + dayComponent < floor) {
        warnings.push(
          `${result.jurisdictionName} priced at your per-engagement minimum of $${floor.toFixed(2)} per pilot car rather than at the ${milesInJurisdiction ?? 0} mi it actually covers — a short crossing does not buy a short day.`,
        );
      }
    }
  } else if (useInternalBand) {
    pilotCarBasis = 'internalBand';
    if (milesInJurisdiction === undefined) {
      warnings.push(
        `${result.jurisdictionName} requires ${pilotCars} pilot car${pilotCars === 1 ? '' : 's'} and the fallback band is priced per mile, but the miles inside ${result.jurisdictionName} were not supplied. The escort cost here is UNKNOWN — it is not zero.`,
      );
      requiresManualReview = true;
    } else {
      pilotCarLowUsd = round2(
        milesInJurisdiction * QUOTEFLEET_INTERNAL_PILOT_CAR_BAND.lowUsdPerMile * pilotCars,
      );
      pilotCarHighUsd = round2(
        milesInJurisdiction * QUOTEFLEET_INTERNAL_PILOT_CAR_BAND.highUsdPerMile * pilotCars,
      );
      warnings.push(
        `${result.jurisdictionName}'s ${pilotCars} pilot car${pilotCars === 1 ? '' : 's'} are priced from QuoteFleet's own mileage band, which models no per-engagement floor — so a short crossing like this is UNDERSTATED, because the operator still spends a day on it. Supply your own pilot-car rate to replace this figure.`,
      );
      requiresManualReview = true;
    }
  } else {
    // The honest default. A required pilot car with no rate on file is a known
    // unknown, and saying so is the answer rather than a failure to produce one.
    pilotCarBasis = 'none';
    warnings.push(
      `${result.jurisdictionName} requires ${pilotCars} pilot car${pilotCars === 1 ? '' : 's'} on this load and we hold no pilot-car rates. Its cost is UNKNOWN — not zero — and is not in the permit total. Supply your own $/mile or $/day rate to price it.`,
    );
    requiresManualReview = true;
  }

  // ── Law enforcement ─────────────────────────────────────────────────
  const rateRow = POLICE_ESCORT_RATES.find(
    (r) => r.value.jurisdiction === code && isInEffect(r, asOf),
  );
  const triggerIds = rateRow?.value.triggeringEscortRuleIds ?? [];
  const countedPolice = result.escorts.policeFront + result.escorts.policeRear;
  const triggered = triggerIds.length > 0 && policeTriggered(result, triggerIds);
  const policeRequired = countedPolice > 0 || triggered;
  const policeCountUnpublished = policeRequired && countedPolice === 0;
  const minOfficers = rateRow?.value.minimumOfficers ?? 0;
  const policeOfficers = policeRequired
    ? Math.max(countedPolice, minOfficers, 1)
    : 0;

  let policeFloorUsd: number | null = null;
  let policeFloorLowUsd: number | null = null;
  let policeFloorHighUsd: number | null = null;
  let policePerMileUsd: number | null = null;
  let policeUnpriced: UnpricedPoliceComponent[] = [];
  let policeSources: SourceDoc[] = [];

  const resolved = policeRequired ? resolvePoliceRate(code, policeOfficers, asOf) : null;

  if (policeRequired && resolved === null) {
    // No rate row at all. The positive finding says why.
    const finding = NO_PUBLISHED_POLICE_ESCORT_RATE.find((n) => n.jurisdiction === code);
    warnings.push(
      finding === undefined
        ? `${result.jurisdictionName} requires a law-enforcement escort on this move and no rate for one is on file. The cost is unknown and is not included anywhere in this quote.`
        : `${result.jurisdictionName} requires a law-enforcement escort on this move and publishes no rate for one. ${finding.finding} The cost is unknown — not zero — and must be obtained from the agency providing the officers. See escort rule ${finding.escortRuleId}.`,
    );
    requiresManualReview = true;
  } else if (policeRequired && resolved !== null) {
    policeSources = resolved.resolution.candidates.map((c) => c.source);
    policeUnpriced = resolved.resolution.candidates.flatMap((c) => c.value.unpriced);
    policePerMileUsd = resolved.resolution.value?.perMileUsd ?? null;
    policeFloorUsd = resolved.floorUsd;
    policeFloorLowUsd = resolved.lowUsd;
    policeFloorHighUsd = resolved.highUsd;
    warnings.push(...resolved.resolution.warnings);
    if (resolved.resolution.requiresManualReview) requiresManualReview = true;

    if (policeFloorUsd !== null) {
      const chosen = resolved.resolution.chosen;
      warnings.push(
        `${result.jurisdictionName} requires a law-enforcement escort and publishes a rate for it. The FLOOR — the least the published schedule can charge for ${policeOfficers} officer${policeOfficers === 1 ? '' : 's'} — is $${policeFloorUsd.toFixed(2)}, before mileage and before any hours beyond the minimum. The hours are set by the agency on the day, so this is a floor and never a total, and it is not part of the permit total.${chosen === null ? '' : ` Source: ${citeOf(chosen.source)}.`}`,
      );
      requiresManualReview = true;
    } else if (!resolved.resolution.conflict) {
      warnings.push(
        `${result.jurisdictionName} publishes a law-enforcement escort rate but no minimum hours and no minimum charge, so no floor can be computed for it — the bill is the hours the agency actually works. The police-escort cost here is unknown, not zero.`,
      );
      requiresManualReview = true;
    } else {
      requiresManualReview = true;
    }

    if (policeCountUnpublished) {
      warnings.push(
        `${result.jurisdictionName} requires a law-enforcement escort and does not publish HOW MANY units. The floor above is computed for ${policeOfficers} officer${policeOfficers === 1 ? '' : 's'}; the real assignment may be larger.`,
      );
    }
  }

  return {
    jurisdiction: code,
    jurisdictionName: result.jurisdictionName,
    pilotCars,
    milesInJurisdiction: milesInJurisdiction ?? null,
    pilotCarBasis,
    pilotCarUsd,
    pilotCarLowUsd,
    pilotCarHighUsd,
    billedDaysPerPilotCar,
    policeRequired,
    policeOfficers,
    policeCountUnpublished,
    policeFloorUsd,
    policeFloorLowUsd,
    policeFloorHighUsd,
    policePerMileUsd,
    policeUnpriced,
    policeSources,
    warnings,
    requiresManualReview,
  };
}

/**
 * Estimate what a priced lane's escorts cost, from the quote the engine already
 * produced.
 *
 * A POST-PROCESSOR, ON PURPOSE. It reads an `OsowQuote` and returns a separate
 * object; it does not modify one, and there is no path from here into
 * `totalPermitUsd`. That makes "the permit subtotal is unchanged by the escort
 * estimate" a property of the code's shape rather than a promise a test has to
 * keep re-checking — though the test checks it anyway.
 *
 * `milesByJurisdiction` is supplied by the caller because `OsowJurisdictionResult`
 * does not carry the per-state mileage it was priced with, and adding it would
 * change the engine's output shape for a consumer that already has the figures.
 */
export function estimateLaneEscortCost(
  quote: OsowQuote,
  milesByJurisdiction: Readonly<Record<string, number>> = {},
  options: {
    asOf?: IsoDate;
    /** THE PRIMARY PATH. The caller's own negotiated pilot-car rate. */
    pilotCarRate?: UserPilotCarRate;
    /** Opt in to QuoteFleet's fallback band. Ignored when a rate is supplied. */
    useInternalBand?: boolean;
  } = {},
): LaneEscortEstimate {
  const asOf = options.asOf ?? quote.asOf;
  const userRate = hasUserRate(options.pilotCarRate) ? options.pilotCarRate : undefined;
  // A supplied rate always wins. The fallback exists for a caller who has none,
  // not as a second opinion on one who does.
  const useInternalBand = userRate === undefined && options.useInternalBand === true;

  const byJurisdiction = quote.jurisdictions.map((j) =>
    estimateOne(j, milesByJurisdiction[j.jurisdiction], asOf, userRate, useInternalBand),
  );

  const warnings: string[] = [];
  let requiresManualReview = false;

  // ── Civilian roll-up. A single unpriced state makes the lane figure null:
  // summing the states we could price would understate the lane while looking
  // complete, which is the worst of both.
  const pilotCarsRequired = byJurisdiction.reduce((s, e) => s + e.pilotCars, 0);
  const pilotCarBasis: PilotCarCostBasis =
    pilotCarsRequired === 0
      ? 'notApplicable'
      : userRate !== undefined
        ? 'userSupplied'
        : useInternalBand
          ? 'internalBand'
          : 'none';

  const anyPointUnpriced = byJurisdiction.some(
    (e) => e.pilotCars > 0 && e.pilotCarUsd === null,
  );
  const anyBandUnpriced = byJurisdiction.some(
    (e) => e.pilotCars > 0 && e.pilotCarLowUsd === null,
  );
  const usesPoint = pilotCarBasis === 'userSupplied' || pilotCarBasis === 'notApplicable';
  const pilotCarUsd =
    usesPoint && !anyPointUnpriced
      ? round2(byJurisdiction.reduce((s, e) => s + (e.pilotCarUsd ?? 0), 0))
      : null;
  const pilotCarLowUsd =
    pilotCarBasis === 'internalBand' && !anyBandUnpriced
      ? round2(byJurisdiction.reduce((s, e) => s + (e.pilotCarLowUsd ?? 0), 0))
      : null;
  const pilotCarHighUsd =
    pilotCarBasis === 'internalBand' && !anyBandUnpriced
      ? round2(byJurisdiction.reduce((s, e) => s + (e.pilotCarHighUsd ?? 0), 0))
      : null;

  // ── Police roll-up. Sourced, and kept in its own fields.
  const policeStates = byJurisdiction.filter((e) => e.policeRequired);
  const policeStatesRequiring = policeStates.map((e) => e.jurisdiction);
  const policeOfficersRequired = policeStates.reduce((s, e) => s + e.policeOfficers, 0);
  const policeStatesWithoutFloor = policeStates
    .filter((e) => e.policeFloorUsd === null)
    .map((e) => e.jurisdiction);
  const policeFloorIncomplete = policeStatesWithoutFloor.length > 0;
  const withFloor = policeStates.filter((e) => e.policeFloorUsd !== null);
  const policeFloorUsd =
    policeStates.length === 0
      ? null
      : withFloor.length === 0
        ? null
        : round2(withFloor.reduce((s, e) => s + (e.policeFloorUsd ?? 0), 0));

  const policeSources: SourceDoc[] = [];
  for (const e of byJurisdiction) {
    for (const s of e.policeSources) {
      if (!policeSources.some((x) => x.id === s.id)) policeSources.push(s);
    }
  }

  for (const e of byJurisdiction) {
    warnings.push(...e.warnings);
    if (e.requiresManualReview) requiresManualReview = true;
  }

  const disclaimer =
    pilotCarBasis === 'userSupplied'
      ? ESCORT_USER_RATE_NOTE
      : pilotCarBasis === 'internalBand'
        ? ESCORT_ESTIMATE_DISCLAIMER
        : ESCORT_NO_RATE_NOTE;
  if (pilotCarsRequired > 0) warnings.push(disclaimer);
  if (policeStates.length === 0) {
    warnings.push(
      'No state on this lane requires a law-enforcement escort for this load under its published triggers. That is not a guarantee of none: most states in this dataset let the permitting office assign a trooper as a discretionary permit condition, and where they do the cost is unpublished.',
    );
  }
  if (policeFloorIncomplete) {
    warnings.push(
      `A law-enforcement escort is required in ${policeStatesWithoutFloor.join(', ')} and no floor can be computed there, so the police figure on this lane is INCOMPLETE — it is a partial floor, not a total.`,
    );
  }

  return {
    isSourcedFigure: false,
    pilotCarBasis,
    disclaimer,
    userRate: userRate ?? null,
    internalBand: useInternalBand ? QUOTEFLEET_INTERNAL_PILOT_CAR_BAND : null,
    byJurisdiction,
    pilotCarsRequired,
    pilotCarUsd,
    pilotCarLowUsd,
    pilotCarHighUsd,
    policeStatesRequiring,
    policeOfficersRequired,
    policeFloorUsd,
    policeFloorIncomplete,
    policeStatesWithoutFloor,
    policeSources,
    warnings,
    requiresManualReview,
  };
}
