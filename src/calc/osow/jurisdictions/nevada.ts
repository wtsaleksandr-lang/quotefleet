/**
 * NEVADA — oversize/overweight single-trip permit rules.
 *
 * A $25 FLAT FEE THE STATUTE FORBIDS FROM GROWING, AND AN ESCORT LADDER
 * CONDITIONED THREE WAYS AT ONCE.
 * ═══════════════════════════════════════════════════════════════════════════
 * NAC 484D.635(1)(a): "Single-trip permits are $25." That is the entire Nevada
 * fee model. No weight band, no per-ton rate, no per-mile rate, no dimensional
 * ladder, no oversize-versus-overweight split and no percentage anywhere in
 * NAC 484D.500–695 or NRS 484D. A 12 ft wide load across Las Vegas and a
 * 400,000 lb move from Reno to Elko pay the same $25.
 *
 * AND THE STATUTE SAYS WHY, WHICH IS WORTH MORE THAN THE NUMBER. NRS
 * 484D.625(2): the fees "must be in an amount set so that the aggregate amounts
 * received from the fee or fees do not exceed the estimated costs of
 * administering the permit system." Nevada is legally barred from pricing
 * permits as a road-wear charge. The flat $25 is not a stale schedule nobody
 * has revisited — it is structural, and it will not become a weight ladder.
 * That is the difference between a fee this engine can quote with confidence
 * and one that merely happens to be current.
 *
 * SO THERE IS NO PARTIAL-INCREMENT QUESTION IN NEVADA AT ALL — the one thing
 * this dataset normally has to flag. Nevada is nonetheless demonstrably capable
 * of stating a rounding rule when one is needed: NRS 484D.615(5) says axle
 * spacing "must be measured to the nearest foot. If a fraction is exactly
 * one-half foot, the next largest whole number must be used." A drafter who
 * spells out a tie-break for axle spacing and states none for the fee has no
 * fee increment to round, rather than an unstated rule.
 *
 * THE ONE VARIABLE COST IS UNBOUNDED AND UNTRIGGERED.
 * --------------------------------------------------
 * NAC 484D.635(3): "Applications that require special research or inspection by
 * the engineering staff will include charges to the applicant in an amount of
 * the cost to the Department." No hourly rate, no schedule, no cap — and no
 * published rule for WHEN engineering review is required. Because the base fee
 * is $25, this charge can be the overwhelming majority of what a heavy Nevada
 * permit actually costs, and none of it is quotable. Contrast Arizona, which
 * publishes both the trigger and the rate, and Maryland, which publishes the
 * rate and not the count; Nevada publishes neither half. It is carried as an
 * advisory on every quote rather than as a number, and it is the single most
 * important unknown in this file.
 *
 * ESCORTS TURN ON LANE COUNT — INCLUDING A THREE-LANE CLASS.
 * ---------------------------------------------------------
 * Nevada's road vocabulary is "a highway with two or three lanes" versus "four
 * or more lanes". Not divided versus undivided, not interstate versus
 * secondary — LANE COUNT, with a three-lane category no other jurisdiction in
 * this corpus uses. A three-lane road does not map onto `divided`, `two-lane`
 * or `multilane-undivided`, so the general equivalents below are the closest
 * honest approximation and the published names are what actually govern.
 *
 * AND THE LEAD AND FOLLOW RULES ARE DELIBERATELY ASYMMETRIC. Over 12 ft wide:
 *
 *   LEAD car   — NAC 484D.670(3)(a)(3): required if travel is "(I) On a
 *                highway with two or three lanes; or (II) During holiday hours
 *                or hours of darkness".
 *   FOLLOW car — NAC 484D.670(3)(b)(4): required only "during holiday hours or
 *                hours of darkness".
 *
 * So a 13 ft load on a two-lane road in daylight needs a LEAD car and NO
 * follow car. A model that treats escort requirements as symmetric gets that
 * wrong in both directions — it either invents a follow car nobody owes or
 * drops a lead car that is genuinely required. The two rules are encoded
 * separately, from their own subsections.
 *
 * NEVADA PUBLISHES NO FLAT GROSS-WEIGHT CAP.
 * ------------------------------------------
 * NRS 484D.635 sets a single axle at 20,000 lb, a tandem at 34,000 lb, a
 * per-inch-of-tire-width limit, a tire-count rule and the federal bridge
 * formula — and contains no "80,000 pounds" sentence anywhere. `grossWeightLbs`
 * is therefore ABSENT rather than empty-and-unexplained: the ceiling is
 * whatever the bridge formula yields for the axle configuration. Writing
 * 80,000 in would be importing the federal number into a statute that declines
 * to state it. See `nv-no-flat-gross-cap`.
 *
 * THE PER-TIRE LIMIT IS REAL AND BINDING, AND WE CANNOT APPLY IT.
 * NRS 484D.635(1)(c) caps a steering axle at 600 lb per inch of tire width and
 * every other axle at 500 lb/in, and NAC 484D.640(8)(a) repeats it AS A PERMIT
 * CONDITION — meaning it survives the permit unless the permit expressly
 * exceeds it. On a heavy move this binds before the axle limits do. A quote
 * states no tire widths, so it is recorded and not evaluated.
 *
 * WHAT IS DELIBERATELY ABSENT
 * ---------------------------
 *   - `transactionFee` IS AN EMPTY LIST, NOT A SOURCED ZERO, and the
 *     distinction is deliberate. NAC 484D.635(4)–(5) contemplate payment only
 *     by money order or cheque at the Department's permit section, its district
 *     offices and the authorised stations — while NAC 484D.610 separately
 *     provides for online issuance. A card surcharge is neither authorised nor
 *     ruled out; the regulation simply does not address the payment method it
 *     also allows. That is an open question, not an affirmative "none", and a
 *     sourced zero would assert the latter.
 *   - `superload` — no superload class could be located in NAC 484D or NRS
 *     484D. The nearest thing is NAC 484D.640(12), a DISCRETIONARY power to
 *     require extra pilot cars and utility escorts over 17 ft wide on two or
 *     three lanes, over 19 ft on four or more, or over 16 ft high. Discretion
 *     is not a threshold and it carries no fee.
 *   - POLICE ESCORTS. No provision in NAC 484D or NRS 484D mandates a Nevada
 *     Highway Patrol escort at any dimension or any weight. NAC 484D.640(12) is
 *     the only law-enforcement hook and it says the Department may "coordinate
 *     ... traffic control with the appropriate law enforcement agencies" — a
 *     coordination power, not an escort requirement. Claims that "every
 *     superload requires an NHP escort" appear only on commercial permit-service
 *     sites and are NOT adopted here.
 *   - the 108 in tire-to-tire allowance in NRS 484D.685(4). Nevada measures
 *     width twice in one subsection — 108 in from outer tire to outer tire, 102
 *     in across the body or load — and `widthIn` carries one figure. The 102 in
 *     body-and-load measurement is the one a shipper's dimensions describe.
 *
 * SOURCE-QUALITY WARNING, STATED PLAINLY. dot.nv.gov and leg.state.nv.us were
 * both unreachable from the researching network, so every NRS row below is
 * cited to nevada.public.law, a SECONDARY reproduction, and every NAC row to
 * Cornell LII, likewise secondary. The NAC rows carry the regulation's own
 * amendment history and are dated from it; the NRS rows carry no revision line
 * at all and are recorded with `revisedOn: null` rather than a guess. Where the
 * two bodies overlap they corroborate each other exactly, which is the best
 * available check in the absence of the primary hosts.
 */
import type { SourceDoc, Sourced } from '../provenance.js';
import { ftIn, type EscortRule } from '../escortRules.js';
import type { ContextCondition, RouteVocabulary } from '../routeContext.js';
import type {
  CombinedFeeRule,
  FeeDistanceDependence,
  JurisdictionOsowRules,
  PublishedAbsence,
} from '../types.js';

const RETRIEVED = '2026-09-05';

/**
 * NAC 484D.635 and 484D.650 both close their amendment history with "R161-07,
 * 6-17-2008". NAC 484D.670 — the escort section — was amended much more
 * recently, "A by R157-18A, eff. 8/21/2019", so the escort rules and the fee
 * schedule are dated separately below rather than sharing one constant.
 */
const NAC_2008 = '2008-06-17';
const NAC_ESCORTS_2019 = '2019-08-21';
/**
 * The NRS sections carry no revision line on the only host that served them.
 * Nevada's size-and-weight statutes are long-standing; rather than invent an
 * enactment date, these rows use the retrieval date as the effective-from and
 * say so, which understates the window's age and never overstates its currency.
 */
const NRS_FROM = RETRIEVED;

// ── Source documents ──────────────────────────────────────────────────────

const NRS_484D_685: SourceDoc = {
  id: 'nv-nrs-484d-685',
  title: 'NRS 484D.685 — Width of vehicles',
  url: 'https://nevada.public.law/statutes/nrs_484d.685',
  publisher: 'Nevada Revised Statutes (via nevada.public.law)',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'SECONDARY. leg.state.nv.us was unreachable from the researching network. The reproduction carries no revision line; its own stamp reads "accessed May 26, 2025". Corroborated by NAC 484D.650(1)(b), which states the same 102 in threshold.',
};

const NRS_484D_605: SourceDoc = {
  id: 'nv-nrs-484d-605',
  title: 'NRS 484D.605 — Height of vehicles',
  url: 'https://nevada.public.law/statutes/nrs_484d.605',
  publisher: 'Nevada Revised Statutes (via nevada.public.law)',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'SECONDARY, as above. Corroborated by NAC 484D.650(1)(f).',
};

const NRS_484D_615: SourceDoc = {
  id: 'nv-nrs-484d-615',
  title: 'NRS 484D.615 — Length of vehicles and combinations',
  url: 'https://nevada.public.law/statutes/nrs_484d.615',
  publisher: 'Nevada Revised Statutes (via nevada.public.law)',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite: 'SECONDARY, as above. Corroborated by NAC 484D.650(1)(c)–(e).',
};

const NRS_484D_635: SourceDoc = {
  id: 'nv-nrs-484d-635',
  title: 'NRS 484D.635 — Weight of vehicles; bridge formula',
  url: 'https://nevada.public.law/statutes/nrs_484d.635',
  publisher: 'Nevada Revised Statutes (via nevada.public.law)',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'SECONDARY, as above. NOTE THE ABSENCE: this section states axle, tandem, per-tire, tire-count and bridge-formula limits and NO flat gross-weight cap.',
};

const NRS_484D_625: SourceDoc = {
  id: 'nv-nrs-484d-625',
  title: 'NRS 484D.625 — Permits: fee-setting authority and the cost-recovery cap',
  url: 'https://nevada.public.law/statutes/nrs_484d.625',
  publisher: 'Nevada Revised Statutes (via nevada.public.law)',
  revisedOn: null,
  retrievedOn: RETRIEVED,
  cite:
    'SECONDARY, as above. The operative sentence is the cost-recovery cap in subsection 2, which is why Nevada\'s fee is $25 and will stay small.',
};

const NAC_484D_635: SourceDoc = {
  id: 'nv-nac-484d-635',
  title: 'NAC 484D.635 — Fees for permits',
  url: 'https://www.law.cornell.edu/regulations/nevada/NAC-484D-635',
  publisher: 'Nevada Administrative Code (via Cornell LII)',
  revisedOn: NAC_2008,
  retrievedOn: RETRIEVED,
  cite:
    'Amendment history: "NAC A by Dep\'t of Transportation, 2-3-94; R127-98, 7-22-99; R113-02, 10-16-2002; R113-02, 10-16-2002, eff. 1-1-2003; R161-07, 6-17-2008". Last amended 2008 — eighteen years, which for a fee schedule is unusual and is consistent with the cost-recovery cap rather than with neglect.',
};

const NAC_484D_650: SourceDoc = {
  id: 'nv-nac-484d-650',
  title: 'NAC 484D.650 — When a permit is required',
  url: 'https://www.law.cornell.edu/regulations/nevada/NAC-484D-650',
  publisher: 'Nevada Administrative Code (via Cornell LII)',
  revisedOn: NAC_2008,
  retrievedOn: RETRIEVED,
  cite: 'Amendment history closes "R161-07, 6-17-2008".',
};

const NAC_484D_670: SourceDoc = {
  id: 'nv-nac-484d-670',
  title: 'NAC 484D.670 — Pilot cars',
  url: 'https://www.law.cornell.edu/regulations/nevada/NAC-484D-670',
  publisher: 'Nevada Administrative Code (via Cornell LII)',
  revisedOn: NAC_ESCORTS_2019,
  retrievedOn: RETRIEVED,
  cite:
    'Amendment history: "A by R157-18A, eff. 8/21/2019". The freshest Nevada document in this file by eleven years.',
};

const NAC_484D_640: SourceDoc = {
  id: 'nv-nac-484d-640',
  title: 'NAC 484D.640 — Conditions of permits; additional pilot cars and utility escorts',
  url: 'https://www.law.cornell.edu/regulations/nevada/NAC-484D-640',
  publisher: 'Nevada Administrative Code (via Cornell LII)',
  revisedOn: NAC_2008,
  retrievedOn: RETRIEVED,
  cite:
    'Subsection 12 is the only law-enforcement hook anywhere in NAC 484D, and it is a discretionary coordination power rather than an escort requirement.',
};

function fromDated<T>(
  value: T,
  source: SourceDoc,
  effectiveFrom: string,
  note?: string,
): Sourced<T> {
  return {
    value,
    source,
    effectiveFrom,
    effectiveTo: null,
    ...(note === undefined ? {} : { note }),
  };
}

// ── Nevada's road vocabulary: lane count, with a three-lane class ──────────

const NEVADA_ROUTE_VOCABULARY: RouteVocabulary = {
  name: 'NAC 484D.670 and 484D.640 lane-count classes',
  explanation:
    'Nevada classifies roads by LANE COUNT and by nothing else. NAC 484D.670(3)(a)(3) says "On a highway with two or three lanes"; NAC 484D.640(12)(a)–(b) says "Loads wider than 17 feet on roads with two or three lanes" and "Loads wider than 19 feet on roads with four or more lanes". Two independent sections, the same split, so lane count is plainly the operative axis rather than a drafting accident in one rule. THE THREE-LANE CATEGORY IS THE PROBLEM: no other jurisdiction in this corpus uses one, and a three-lane road is not a "two-lane" road, is not divided, and is not obviously "multilane-undivided" either. The general equivalents below are an approximation offered for routing convenience; the published names are what govern, and a road whose lane count is unknown leaves the 12 ft lead-car rule UNRESOLVED rather than defaulting either way.',
  classes: [
    {
      id: 'NV:two-or-three-lane',
      publishedName: 'a highway with two or three lanes',
      quote:
        'NAC 484D.670(3)(a)(3): "The width of the load exceeds 12 feet and travel is : (I) On a highway with two or three lanes". NAC 484D.640(12)(a): "Loads wider than 17 feet on roads with two or three lanes." (The stray space in "travel is :" is in the source.)',
      generalEquivalents: ['two-lane', 'multilane-undivided'],
    },
    {
      id: 'NV:four-or-more-lane',
      publishedName: 'roads with four or more lanes',
      quote:
        'NAC 484D.640(12)(b): "Loads wider than 19 feet on roads with four or more lanes." NAC 484D.670(3)(a)(3) reaches the same class by negation — a highway that is not one of two or three lanes.',
      generalEquivalents: ['interstate', 'divided'],
    },
  ],
};

const TWO_OR_THREE_LANE: ContextCondition = {
  kind: 'routeClassIn',
  anyOf: ['NV:two-or-three-lane'],
};
/** NAC 484D.670(3)(a)(3)(II) and (3)(b)(4): "holiday hours or hours of darkness". */
const HOLIDAY_OR_DARKNESS: ContextCondition = {
  kind: 'anyOf',
  of: [{ kind: 'inDarkness' }, { kind: 'onHoliday' }],
};

function escortRule(
  id: string,
  description: string,
  when: EscortRule['when'],
  then: EscortRule['then'],
  source: SourceDoc,
  effectiveFrom: string,
): EscortRule {
  return { id, jurisdiction: 'NV', description, when, then, source, effectiveFrom, effectiveTo: null };
}

export const NEVADA_ESCORT_RULES: EscortRule[] = [
  // ── NAC 484D.670(3)(a) — the LEAD pilot car ───────────────────────────
  escortRule(
    'nv-lead-front-overhang-25ft',
    'Front overhang over 25 ft — one lead pilot car',
    { kind: 'gt', measure: 'frontOverhangIn', value: ftIn(25) },
    { front: 1, escorts: 1 },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),
  escortRule(
    'nv-lead-height-15ft6-with-pole',
    'Height over 15 ft 6 in — one lead pilot car, which must carry a clearance pole',
    { kind: 'gt', measure: 'heightIn', value: ftIn(15, 6) },
    { front: 1, escorts: 1, heightPole: true },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),
  /**
   * THE THREE-WAY CONDITION. Width AND (lane count OR time of day). A 13 ft
   * load on a four-or-more-lane highway in daylight needs no lead car at all;
   * the same load on a two- or three-lane road, or on any road after dark,
   * needs one.
   */
  escortRule(
    'nv-lead-width-12ft-conditioned',
    'Width over 12 ft, on a two- or three-lane highway or during holiday hours or darkness — one lead pilot car',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        {
          kind: 'any',
          of: [
            { kind: 'context', of: TWO_OR_THREE_LANE },
            { kind: 'context', of: HOLIDAY_OR_DARKNESS },
          ],
        },
      ],
    },
    { front: 1, escorts: 1 },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),
  escortRule(
    'nv-lead-width-16ft',
    'Width over 16 ft — one lead pilot car, on any road at any hour',
    { kind: 'gt', measure: 'widthIn', value: ftIn(16) },
    { front: 1, escorts: 1 },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),

  // ── NAC 484D.670(3)(b) — the FOLLOWING pilot car ──────────────────────
  escortRule(
    'nv-follow-rear-overhang-25ft',
    'Rear overhang over 25 ft — one following pilot car',
    { kind: 'gt', measure: 'rearOverhangIn', value: ftIn(25) },
    { rear: 1, escorts: 1 },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),
  /**
   * THE STEERED-AXLE BONUS IS NOT ENCODED, AND THE LOWER FIGURE IS THE SAFE
   * ONE. The rule reads "exceeds 110 feet or, if the vehicle is equipped with
   * one or more mechanically steered rear axles, 120 feet". A quote does not
   * state whether the trailer has steered axles, so encoding 120 ft would drop
   * a genuinely required escort on every ordinary trailer between 110 and 120
   * ft. 110 ft over-requires only for the minority of moves that carry steered
   * axles, and that error is visible to a dispatcher who knows their equipment,
   * where the other one is not.
   */
  escortRule(
    'nv-follow-length-110ft',
    'Length over 110 ft — one following pilot car (the rule allows 120 ft for a vehicle with mechanically steered rear axles, which a quote does not state)',
    { kind: 'gt', measure: 'overallLengthIn', value: ftIn(110) },
    { rear: 1, escorts: 1 },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),
  escortRule(
    'nv-follow-width-14ft',
    'Width over 14 ft — one following pilot car, on any road at any hour',
    { kind: 'gt', measure: 'widthIn', value: ftIn(14) },
    { rear: 1, escorts: 1 },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),
  /**
   * ASYMMETRIC WITH THE LEAD RULE BY DESIGN — see the module header. Over
   * 12 ft the FOLLOW car is triggered by holiday hours or darkness ONLY, with
   * no lane-count limb, so a 13 ft load on a two-lane road in daylight owes a
   * lead car and no follow car.
   */
  escortRule(
    'nv-follow-width-12ft-darkness-only',
    'Width over 12 ft during holiday hours or darkness — one following pilot car (no lane-count limb, unlike the lead rule)',
    {
      kind: 'all',
      of: [
        { kind: 'gt', measure: 'widthIn', value: ftIn(12) },
        { kind: 'context', of: HOLIDAY_OR_DARKNESS },
      ],
    },
    { rear: 1, escorts: 1 },
    NAC_484D_670,
    NAC_ESCORTS_2019,
  ),

  // ── NAC 484D.640(12) — discretionary, and therefore an advisory ───────
  /**
   * NOT A REQUIREMENT AND NOT PRICED. "The Department MAY require a permittee
   * to furnish a pilot car, in addition to a pilot car required pursuant to
   * NAC 484D.670, and coordinate additional utilities escorts and traffic
   * control with the appropriate law enforcement agencies". Encoding this as a
   * count would turn a discretion into a charge on every wide Nevada move; it
   * surfaces as a warning and the price stands.
   */
  escortRule(
    'nv-discretionary-extra-escorts',
    'Over 17 ft wide on two or three lanes, over 19 ft wide on four or more lanes, or over 16 ft high — NDOT MAY require an additional pilot car, utility escorts and law-enforcement traffic control',
    {
      kind: 'any',
      of: [
        {
          kind: 'all',
          of: [
            { kind: 'gt', measure: 'widthIn', value: ftIn(17) },
            { kind: 'context', of: TWO_OR_THREE_LANE },
          ],
        },
        { kind: 'gt', measure: 'widthIn', value: ftIn(19) },
        { kind: 'gt', measure: 'heightIn', value: ftIn(16) },
      ],
    },
    {
      advisory:
        'NAC 484D.640(12): above these dimensions NDOT MAY require an additional pilot car beyond the NAC 484D.670 escorts, and may coordinate utility escorts and law-enforcement traffic control. It is a discretion with no published trigger for when it is exercised and no published price, so nothing is added to the quote for it. It is also the closest thing Nevada has to a superload rule and to a police-escort rule, and it is neither.',
    },
    NAC_484D_640,
    NAC_2008,
  ),
];

export const NEVADA_OSOW_RULES: JurisdictionOsowRules = {
  code: 'NV',
  name: 'Nevada',
  country: 'US',

  routeVocabulary: [fromDated<RouteVocabulary>(NEVADA_ROUTE_VOCABULARY, NAC_484D_670, NAC_ESCORTS_2019)],

  legalLimits: {
    widthIn: [
      fromDated(
        102,
        NRS_484D_685,
        NRS_FROM,
        'NRS 484D.685(3): "the legal maximum width of any vehicle, combination of vehicles, special mobile equipment or load thereon is 102 inches." The statement is of the maximum ITSELF, so 102 in is legal and 102.1 in is not — EXCLUSIVE. Subsection (4) separately allows 108 in from outer tire to outer tire while holding the body or load to 102 in; a shipper states the load width, so the 102 in figure is the operative one. Subsection (5) allows lamps and devices a further 10 in per side to an absolute 126 in, and (6) allows door handles, hinges, cable cinchers and chain binders 3 in per side to 108 in — neither is cargo.',
      ),
      fromDated(
        102,
        NAC_484D_650,
        NAC_2008,
        'NAC 484D.650(1)(b): a permit is required when "The maximum width of the vehicle exceeds 102 inches." The regulation and the statute agree exactly — corroboration across two bodies, which matters here because both are being read through secondary hosts.',
      ),
    ],
    heightIn: [
      fromDated(
        ftIn(14),
        NRS_484D_605,
        NRS_FROM,
        'NRS 484D.605(1): "a vehicle must not be operated ... if its height, including any load, exceeds 14 feet measured from the surface on which the vehicle stands." EXCLUSIVE. NEVADA IS A 14 FT STATE, six inches more generous than most of this corpus — a 13 ft 9 in load needs no Nevada permit at all, and treating it as a 13 ft 6 in state would invent one. Subsection (2) raises baled hay to 15 ft, which is commodity-conditioned and not applied. Subsection (4) makes it unlawful to pass under any structure with less clearance than the actual height, so Nevada posts no blanket clearance guarantee and the duty is absolute on the operator.',
      ),
      fromDated(
        ftIn(14),
        NAC_484D_650,
        NAC_2008,
        'NAC 484D.650(1)(f): "The height of the vehicle exceeds 14 feet, except that baled hay loads may be up to 15 feet high."',
      ),
    ],
    /**
     * ABSENT. Nevada regulates length as a COMBINATION figure — 70 ft overall,
     * carried below — and separately caps a motortruck at 40 ft and a bus at
     * 45 ft. NRS 484D.615 states no semitrailer length at all, so there is no
     * trailer figure to record and inventing 53 ft would import a neighbour's
     * rule into a statute that omits it.
     */
    trailerLengthIn: [],
    overallLengthIn: [
      fromDated(
        ftIn(70),
        NRS_484D_615,
        NRS_FROM,
        'NRS 484D.615(3): "no combination of vehicles, including any attachments thereto coupled together, may exceed a length of 70 feet." EXCLUSIVE. 70 FT IS RESTRICTIVE for a combination — a 53 ft trailer behind a modern tractor is close to it — so Nevada permits a good deal of ordinary freight on length that its neighbours do not. Corroborated by NAC 484D.650(1)(c). NOTE that NRS 484D.615(7) sets a SECOND and higher length trigger at 75 ft "including overhang", and NAC 484D.650(1)(d) repeats it; the 70 ft figure is the one that governs the combination itself.',
      ),
    ],
    /**
     * NEVADA CAPS OVERHANG THREE WAYS IN ONE SENTENCE and the third is the
     * binding one. NRS 484D.615(7): the load "must not extend beyond the front
     * or the rear ... for a distance of more than 10 feet, OR A TOTAL OF 10
     * FEET BOTH TO THE FRONT OR THE REAR". So 10 ft at either end individually,
     * but also 10 ft summed across both — a load with 6 ft front and 6 ft rear
     * is legal on each end and illegal on the total. `frontOverhangIn` and
     * `rearOverhangIn` carry the per-end figure; the combined cap has no field
     * and is recorded here and in `publishedAbsences`.
     */
    frontOverhangIn: [
      fromDated(
        ftIn(10),
        NRS_484D_615,
        NRS_FROM,
        'NRS 484D.615(7), per-end figure. EXCLUSIVE. The same subsection also caps the SUM of front and rear overhang at 10 ft, which this field cannot express — see the comment above. Corroborated by NAC 484D.650(1)(e): "The overhang of the vehicle exceeds 10 feet, regardless of length." The subsection exempts the booms and masts of shovels, cranes and water-well drilling equipment.',
      ),
    ],
    rearOverhangIn: [
      fromDated(
        ftIn(10),
        NRS_484D_615,
        NRS_FROM,
        'NRS 484D.615(7), per-end figure, identical to the front. EXCLUSIVE.',
      ),
    ],
    /**
     * `grossWeightLbs` IS ABSENT ON A CHECKED NEGATIVE, not on a gap. NRS
     * 484D.635 sets axle, tandem, per-tire and tire-count limits and the bridge
     * formula, and states no flat gross cap anywhere — there is no "80,000
     * pounds" sentence in it. The ceiling is whatever the formula yields.
     * Recording 80,000 would import the federal number into a statute that
     * declines to state one. See `nv-no-flat-gross-cap`.
     */
    grossWeightLbs: [],
    singleAxleLbs: [
      fromDated(
        20_000,
        NRS_484D_635,
        NRS_FROM,
        'NRS 484D.635(1)(a): "The maximum weight on any single axle does not exceed 20,000 pounds." AND THE PER-TIRE LIMIT BINDS FIRST ON A HEAVY MOVE: (1)(c) caps a steering axle at 600 lb per inch of tire width and every other axle at 500 lb/in, and NAC 484D.640(8)(a) repeats it as a PERMIT CONDITION, so it survives the permit unless the permit expressly exceeds it. A quote states no tire widths, so it is recorded and not evaluated. (1)(d) separately requires at least four tires on any axle over 10,000 lb whose tires are 14 in or narrower.',
      ),
    ],
    tandemAxleLbs: [
      fromDated(
        34_000,
        NRS_484D_635,
        NRS_FROM,
        'NRS 484D.635(1)(b): "The maximum weight on any tandem axle does not exceed 34,000 pounds." (1)(e) states the federal bridge formula W = 500[LN/(N−1) + 12N + 36] with W "computed to the nearest 500 pounds", and (2) adds the twin-tandem 34,000 lb proviso at 36 ft or more. Subsection (3) allows an electric or natural-gas vehicle 2,000 lb over and an idle-reduction-equipped vehicle 550 lb over — stated as flat allowances rather than Arizona\'s "lesser of" formula. Powertrain is not collected on a quote, so neither is applied.',
      ),
    ],
  },

  /**
   * THE ENTIRE NEVADA FEE. Flat, dimension-blind, weight-blind, distance-blind,
   * and capped by statute at cost recovery.
   */
  permitBaseFeeUsd: [
    fromDated(
      25,
      NAC_484D_635,
      NAC_2008,
      'NAC 484D.635(1)(a): "Single-trip permits are $25." An annual multiple-trip permit is $60, which pays for itself on the third move and is by a wide margin the cheapest annual OS/OW permit in this corpus; a replacement for a lost or destroyed ANNUAL permit is $10, and no replacement price is published for a single-trip permit. NAC 484D.635(2) lets the Department WAIVE the fee for a governmental entity, and — more interestingly — for an otherwise legal load over a route whose weight limit the Department has itself reduced under NRS 484D.660. Both are discretionary ("may waive") and neither is applied. A SCOPE CONFLICT IS RECORDED RATHER THAN RESOLVED SILENTLY: subsection (1)\'s preamble prices permits "for oversized vehicles" while NAC 484D.625(1) describes the same instrument as being "for the movement of an oversized OR overweight vehicle", so read literally Nevada publishes no price for an overweight-only permit. The reading that $25 covers both is OURS; it is the only sensible one, and it is flagged as ours in `nv-fee-scope-conflict`.',
    ),
  ],

  /** No dimension band exists: $25 is the same at 8 ft 7 in wide and at 16 ft. */
  oversizeFeeBands: [],

  combinedFeeRule: [
    fromDated<CombinedFeeRule>(
      {
        kind: 'cumulative',
        explanation:
          'Nominally cumulative and practically moot — Nevada publishes ONE fee covering oversize, overweight or both, with no second bucket to combine it with. NRS 484D.625(2) is the reason there will not be one: the aggregate fees may not exceed the cost of administering the permit system, so Nevada cannot price by road wear even if it wanted to.',
      },
      NAC_484D_635,
      NAC_2008,
    ),
  ],

  overweightPricing: [],
  overweightBands: [],
  overweightPerMile: [],
  conditionalFees: [],

  /**
   * AN EMPTY LIST, NOT A SOURCED ZERO — see the module header. NAC
   * 484D.635(4)–(5) contemplate money orders and cheques at named offices while
   * NAC 484D.610 provides for online issuance, so the regulation does not
   * address the payment method it also permits. Whether a card surcharge exists
   * is an open question rather than an affirmative "none", and a sourced zero
   * would claim the latter.
   */
  transactionFee: [],

  /**
   * EMPTY, AND NOT BECAUSE NEVADA CHARGES NOTHING. NAC 484D.635(3) charges "an
   * amount of the cost to the Department" for applications needing special
   * research or inspection by engineering staff — no rate, no schedule, no cap,
   * and no published trigger. There is no number to put here, and putting zero
   * would assert the charge does not exist. It is carried as a published
   * absence instead, so the quote says the charge is real and unquotable rather
   * than silently omitting it.
   */
  routeAnalysisFeeUsd: [],
  noBridgeRouteFeeUsd: [],

  superload: {
    shortSpacing: [],
  },

  routeInspection: {
    widthIn: [],
    heightIn: [],
    lengthIn: [],
  },

  escortRules: NEVADA_ESCORT_RULES,
  escortCountCombination: [],

  feeDistanceDependence: [
    fromDated<FeeDistanceDependence>(
      {
        component: 'overweight',
        dependsOnDistance: false,
        quote:
          'NAC 484D.635(1)(a): "Single-trip permits are $25." No mileage term appears in NAC 484D.635 or anywhere in NAC 484D.500–695.',
      },
      NAC_484D_635,
      NAC_2008,
    ),
  ],

  publishedAbsences: [
    fromDated<PublishedAbsence>(
      {
        subject: 'partialIncrementRule',
        statement:
          'Nevada has no fee increment to round. The fee is a flat $25 with no weight band, per-ton rate, per-mile rate or dimensional ladder anywhere in NAC 484D.500–695. The drafter was plainly capable of stating a rounding rule where one was needed: NRS 484D.615(5) says axle spacing "must be measured to the nearest foot. If a fraction is exactly one-half foot, the next largest whole number must be used."',
        consequence:
          'No rounding rule is held for Nevada, and the absence is a consequence of the fee model rather than a gap in the research.',
      },
      NAC_484D_635,
      NAC_2008,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortTrigger',
        statement:
          'No provision in NAC 484D or NRS 484D mandates a Nevada Highway Patrol escort at any dimension or any weight. NAC 484D.640(12) is the only law-enforcement hook in the chapter and it says the Department "may require a permittee to furnish a pilot car ... and coordinate additional utilities escorts and traffic control with the appropriate law enforcement agencies" — a discretionary coordination power, not an escort requirement. NAC 484D.640(2) separately lets a law-enforcement agency suspend or restrict a permit in hazardous conditions, which is an override rather than a trigger.',
        consequence:
          'No Nevada quote carries a mandatory police escort. Claims that every superload requires an NHP escort appear only on commercial permit-service sites and are not adopted.',
      },
      NAC_484D_640,
      NAC_2008,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'policeEscortRate',
        statement:
          'No rate, minimum-hours rule, officer-count minimum or mileage charge appears anywhere in NAC 484D.500–695 or in the NRS 484D sections that could be opened. NAC 484D.670(5)(c) confirms the Highway Patrol has its own permitting role — amber lights under NRS 484D.185, a second permit on the escort rather than the load — and publishes no price for that either. dot.nv.gov and leg.state.nv.us were both unreachable from the researching network.',
        consequence:
          'No police escort cost is quoted for Nevada, which follows anyway from there being no mandatory trigger to price.',
      },
      NAC_484D_670,
      NAC_ESCORTS_2019,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'superloadDefinition',
        statement:
          'No superload class could be located in NAC 484D or NRS 484D. The nearest provision is NAC 484D.640(12), a discretionary power to require extra pilot cars and utility escorts over 17 ft wide on two or three lanes, over 19 ft on four or more lanes, or over 16 ft high.',
        consequence:
          'No Nevada load is flagged as a superload and no superload ceiling is mirrored to the public calculator. The heaviest imaginable Nevada move still pays $25 plus whatever the engineering charge turns out to be.',
      },
      NAC_484D_640,
      NAC_2008,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'permitDimensionalEnvelope',
        statement:
          'NRS 484D.635 states axle, tandem, per-tire and tire-count limits and the federal bridge formula, and contains NO flat gross-weight cap — there is no "80,000 pounds" sentence in the section. Whether Nevada sets a flat statutory gross elsewhere in NRS could not be determined, because leg.state.nv.us was unreachable and NRS 484D.655 and 484D.660 were identified by title only.',
        consequence:
          'No `grossWeightLbs` legal limit is held for Nevada. A load is over Nevada\'s legal weight when it exceeds the bridge formula for its axle configuration, not when it exceeds 80,000 lb, and the engine must not substitute the federal figure for a limit the state declines to publish.',
      },
      NRS_484D_635,
      NRS_FROM,
    ),
    fromDated<PublishedAbsence>(
      {
        subject: 'roadClassification',
        statement:
          'Nevada classifies roads by LANE COUNT — "a highway with two or three lanes" against "roads with four or more lanes" — in NAC 484D.670(3)(a)(3) and again in NAC 484D.640(12)(a)–(b). Neither term is defined in NAC 484D, and the three-lane category has no equivalent anywhere else in this corpus.',
        consequence:
          'A Nevada quote whose road lane count is unknown cannot resolve the 12 ft lead-pilot-car rule, because the rule turns on lane count OR darkness and only one of the two can be answered. That leaves the requirement unknown rather than false — the load may still need a lead car for a reason the quote cannot see.',
      },
      NAC_484D_670,
      NAC_ESCORTS_2019,
    ),
  ],

  feesDependOnDistance: false,
};
