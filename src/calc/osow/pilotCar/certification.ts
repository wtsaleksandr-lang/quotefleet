/**
 * PILOT-CAR OPERATOR CERTIFICATION, AS A PER-STATE FACT — never a global flag.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * `escortRules.ts` already answers "how many escorts does this load need in
 * this state". It cannot answer the question that decides whether a particular
 * operator may take the job: *does this state require the escort driver to hold
 * a certificate, and will it accept the one this operator already has?*
 *
 * Both existing public escort directories model that as free text. That is the
 * whole reason they cannot be filtered, and it is the reason a dispatcher who
 * books off one of them can end up with a legally certified operator who is
 * still illegal on the leg they were booked for. Every fact below is therefore
 * an ENUM or a LIST OF STATE CODES, not a sentence.
 *
 * ── THE DISAGREEMENT IS THE DATA ───────────────────────────────────────────
 * Whether a state requires certification at all is genuinely disputed between
 * published aggregators, and in at least one case between two pages of the same
 * DMV. Virginia is the worked example and it is recorded as such: the DMV's
 * escort-certification landing page lists SEVEN reciprocal states citing
 * §46.2-2907, and the DMV's own escort-driver FAQ says "Currently, we have an
 * agreement with North Carolina." Neither page carries a revision date, so
 * neither can be shown to supersede the other.
 *
 * So `requirement` has FIVE values and one of them is `'disputed'`. There is no
 * boolean here, and there is deliberately no default: a state we hold no source
 * for is `'unknown'`, which renders as "we hold no source", never as "no
 * certification needed". The failure mode of getting this wrong is a truck
 * escorted by someone who may not lawfully escort it, and it is reached by
 * presenting an absence of data as a permission.
 *
 * ── RECIPROCITY IS TWO LISTS, NOT ONE ──────────────────────────────────────
 * `acceptsCertificationFrom` and `certificationAcceptedBy` are separate fields
 * because the states publish them separately and they DISAGREE. Georgia accepts
 * Arizona, Colorado, Utah, Virginia and Washington; Georgia's own certificate
 * is reciprocated by North Carolina, Florida, Oklahoma and Washington. Only
 * Washington is on both lists. North Carolina accepts Colorado while Colorado
 * does not accept North Carolina — NCDOT says so in terms. Folding these into
 * one symmetric "reciprocal states" array, which is what a naive schema does,
 * would manufacture a permission that no state granted.
 *
 * An EMPTY list is not "nobody". `outboundPublished: false` records that the
 * state publishes no outbound list at all — Colorado, Oklahoma and Washington
 * are all in that position — and the surfaces render that as "not published",
 * never as "no state accepts it".
 *
 * ── PROVENANCE ─────────────────────────────────────────────────────────────
 * Every entry that is not `'unknown'` cites a document that ALREADY EXISTS in
 * `src/calc/osow/jurisdictions/`, and `certification.test.ts` asserts exactly
 * that: each `sourceUrl` here must appear in the compiled jurisdiction corpus.
 * That is what stops this file becoming a second, quietly drifting copy of
 * facts the permit engine already sources. Nothing here was researched from a
 * competitor directory and nothing here is our own opinion.
 *
 * NO I/O. Compiled data and pure functions, so every consumer answers with the
 * database down.
 */

/** What a state does about certifying escort-vehicle operators. */
export type CertificationRequirement =
  /** The state certifies operators and requires a certificate to escort. */
  | 'required'
  /** The state publishes that no certification exists or is required. */
  | 'not-required'
  /**
   * The state's own published sources contradict each other, or the rule points
   * at a programme whose current status the state does not publish. Recorded as
   * a fact about the sources, not resolved by us.
   */
  | 'disputed'
  /**
   * The state is silent: it neither imposes a certificate nor states that none
   * is needed. "No rule found" and "a rule saying none is needed" are different
   * answers and this keeps them apart.
   */
  | 'unsettled'
  /** We hold no source for this state. NEVER rendered as "not required". */
  | 'unknown';

export interface StateCertificationFacts {
  /** Two-letter USPS code. */
  code: string;
  requirement: CertificationRequirement;
  /**
   * States whose certificate this state will accept INBOUND. Empty with
   * `inboundPublished: false` means the state publishes no list.
   */
  acceptsCertificationFrom: readonly string[];
  inboundPublished: boolean;
  /**
   * States that accept THIS state's certificate, as published by this state or
   * by the accepting state. Asymmetric with the field above on purpose.
   */
  certificationAcceptedBy: readonly string[];
  outboundPublished: boolean;
  /** Certificate term in years, where the state publishes one. */
  termYears: number | null;
  /** Minimum operator age the state publishes. */
  minimumAge: number | null;
  /**
   * A ceiling on the escort VEHICLE the state will accept, in pounds GVWR.
   * Tennessee is the case this exists for: its rule regulates the vehicle and
   * not the driver, so an operator can be perfectly legal and still turn up in
   * a truck the state does not allow.
   */
  vehicleGvwrMaxLbs: number | null;
  /** A floor on the escort vehicle's weight, where the state publishes one. */
  vehicleWeightMinLbs: number | null;
  /** One sentence, quoting or closely paraphrasing the cited document. */
  note: string;
  /** The document this row came from. Must exist in the jurisdiction corpus. */
  sourceUrl: string | null;
  sourceTitle: string | null;
  sourcePublisher: string | null;
  /** The document's OWN revision date. `null` means it states none. */
  sourceRevisedOn: string | null;
}

function unknownState(code: string, note: string): StateCertificationFacts {
  return {
    code,
    requirement: 'unknown',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note,
    sourceUrl: null,
    sourceTitle: null,
    sourcePublisher: null,
    sourceRevisedOn: null,
  };
}

/**
 * The 24 states the permit engine holds fee data for, plus every other state as
 * an explicit `'unknown'`.
 *
 * The `'unknown'` rows are not filler. Omitting a state would let the directory
 * read "we have no certified operators in Ohio" when the truth is "we do not
 * publish whether Ohio requires one", and those are different sentences with
 * different consequences.
 */
const FACTS: StateCertificationFacts[] = [
  {
    code: 'AL',
    requirement: 'disputed',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: 18,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Ala. Admin. Code ch. 450-3-1 requires an escort driver to have completed a flagging course "which equals or exceeds Alabama\'s course within 12 months of Alabama\'s course availability" — a deadline that runs from the availability of a course whose current status Alabama does not publish. The rule points to a list of approved states at a URL that no longer resolves, and Alabama does not say whether it issues a certificate of its own. A card earned elsewhere may or may not satisfy Alabama.',
    sourceUrl: 'https://admincode.legislature.state.al.us/api/chapter/450-3-1',
    sourceTitle: 'Ala. Admin. Code ch. 450-3-1 — Escort vehicle operator requirements',
    sourcePublisher: 'Alabama Legislature, Administrative Code',
    sourceRevisedOn: null,
  },
  {
    code: 'CA',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'California runs no pilot-car operator certification programme. CVC §§28100–28103 regulate escort EQUIPMENT only, so no certificate arises and any pilot-car price is the operator\'s market rate rather than a state fee. Note that California conditions escort COUNTS on the Caltrans pilot-car map colour of the segment, which is a property of the route and not of the operator.',
    sourceUrl: 'https://dot.ca.gov/programs/traffic-operations/transportation-permits/faq',
    sourceTitle: 'Caltrans — Transportation Permits FAQ',
    sourcePublisher: 'California Department of Transportation',
    sourceRevisedOn: null,
  },
  {
    code: 'CO',
    requirement: 'required',
    acceptsCertificationFrom: ['CO', 'AZ', 'FL', 'MN', 'OK', 'UT', 'WA'],
    inboundPublished: true,
    certificationAcceptedBy: ['GA', 'NC', 'WA'],
    outboundPublished: false,
    termYears: 4,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'A pilot escort operating in Colorado must carry certification, and CDOT names exactly whose it will take: "Valid certification from Colorado, Arizona, Florida, Minnesota, Oklahoma, Utah, Washington or the Specialized Carriers and Rigging Association". 2 CCR 601-4 ch. 5 adds $1,000,000 of commercial liability insurance (§500.4.3) and an acceptable five-year motor-vehicle record (§500.5); the certificate runs four years. Colorado publishes NO outbound list — the states named here as accepting a Colorado card say so themselves.',
    sourceUrl: 'https://www.law.cornell.edu/regulations/colorado/title-2/agency-601/division-4/chapter-5',
    sourceTitle: '2 CCR 601-4 Chapter 5 — Pilot escort vehicle and operator requirements',
    sourcePublisher: 'Cornell Legal Information Institute, reproducing 2 CCR 601-4',
    sourceRevisedOn: '2018-04-16',
  },
  {
    code: 'GA',
    requirement: 'required',
    acceptsCertificationFrom: ['AZ', 'CO', 'UT', 'VA', 'WA'],
    inboundPublished: true,
    certificationAcceptedBy: ['NC', 'FL', 'OK', 'WA'],
    outboundPublished: true,
    termYears: 4,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Georgia requires its pilot/escort operators to be certified, with a course passed at 80% or better and a certificate valid four years. The two reciprocity lists are NOT the same list — Georgia ACCEPTS Arizona, Colorado, Utah, Virginia and Washington, while Georgia\'s own certificate is RECIPROCATED by North Carolina, Florida, Oklahoma and Washington. Only Washington appears on both, so an Arizona-certified operator may work Georgia while a Georgia-certified operator may not work Arizona.',
    sourceUrl: 'https://gamccd.net/ospermit/CertifiedEscortVehicle.aspx',
    sourceTitle: 'Georgia DPS/MCCD — Certified Escort Vehicle programme (undated)',
    sourcePublisher: 'Georgia Department of Public Safety, Motor Carrier Compliance Division',
    sourceRevisedOn: null,
  },
  {
    code: 'IL',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: 18,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Illinois imposes no pilot-car operator certification: an escort driver need only be 18 and licensed, so there is no state certification to hold and none to reciprocate. 92 Ill. Adm. Code Part 554 sets the escort counts, the State Police triggers and the spacing.',
    sourceUrl: 'https://www.ilga.gov/agencies/JCAR/EntirePart?titlepart=09200554',
    sourceTitle: '92 Ill. Adm. Code Part 554 — Permits for excess size and weight (2012 amendments)',
    sourcePublisher: 'Illinois Joint Committee on Administrative Rules',
    sourceRevisedOn: '2012-08-01',
  },
  {
    code: 'IN',
    requirement: 'unsettled',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Indiana states no pilot-car operator certification requirement AND publishes no affirmative statement that none exists. That is not the same as "no certification needed" and it is not recorded as such. A permit carrying weight restrictions separately requires "a minimum of two escorts, one in the front and one in the rear", which is set on the permit rather than by any published number.',
    sourceUrl: 'https://www.in.gov/dor/files/M-204.pdf',
    sourceTitle: 'Indiana DOR Form M-204 — Oversize/Overweight permit provisions (PDF)',
    sourcePublisher: 'Indiana Department of Revenue',
    sourceRevisedOn: null,
  },
  {
    code: 'KY',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Kentucky neither licenses nor certifies escort-vehicle operators and publishes no reciprocity list in either direction. An operator needs a valid licence and the equipment 601 KAR 1:018 §13 requires: radio contact with the load, amber strobe or flashing lights, headlamps lit in transit, a height pole where the load calls for one, and a 6–8 ft "OVERSIZE LOAD" sign on the lead escort above 12 ft of width. A certificate earned elsewhere buys nothing here.',
    sourceUrl: 'https://drive.ky.gov/Motor-Carriers/Overweight-Over-Dimensional/Pages/OWOD-Escort-Requirements.aspx',
    sourceTitle: 'KYTC drive.ky.gov — OWOD Escort Requirements (undated)',
    sourcePublisher: 'Kentucky Transportation Cabinet, Division of Motor Carriers',
    sourceRevisedOn: null,
  },
  {
    code: 'MO',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: 18,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Missouri has no pilot-car certificate. 7 CSR 10-25 requires only that "Operators of escort vehicles shall be properly licensed, obey all traffic laws, and be at least eighteen (18) years of age", so there is no certification cost, validity period or reciprocity provision to apply.',
    sourceUrl: 'https://www.modot.org/media/16315',
    sourceTitle: '7 CSR 10-25 — MoDOT oversize/overweight permit rule',
    sourcePublisher: 'Missouri Department of Transportation',
    sourceRevisedOn: '2025-03-30',
  },
  {
    code: 'NJ',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'NJDOT says in terms that "there currently is no certification requirement or certification process in place". Only private escorts are assigned to permitted loads, and escort spacing is regulated — 200 to 500 ft ahead for a front escort, 100 to 250 ft behind for a rear one.',
    sourceUrl: 'https://nj.gotpermits.com/njpass/Content/state/NJ/PublicMaterials/Final%20CVG%202024-01-05.pdf',
    sourceTitle: 'NJDOT — Commercial Vehicle Size and Weight Guidebook, January 2024 (PDF)',
    sourcePublisher: 'New Jersey Department of Transportation',
    sourceRevisedOn: '2024-01-05',
  },
  {
    code: 'NY',
    requirement: 'required',
    acceptsCertificationFrom: [],
    inboundPublished: true,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'New York does not recognise escort certifications from any other state — an operator needs a New York Certified Vehicle Escort Card, $40 to test and $40 to renew. `inboundPublished` is TRUE with an EMPTY list on purpose: New York has published its answer and the answer is nobody, which is a different fact from a state that simply prints no list.',
    sourceUrl: 'https://dmv.ny.gov/business/escort-driver-endorsement',
    sourceTitle: 'NY DMV — Escort Driver Endorsement',
    sourcePublisher: 'New York State Department of Motor Vehicles',
    sourceRevisedOn: null,
  },
  {
    code: 'NC',
    requirement: 'required',
    acceptsCertificationFrom: ['AZ', 'CO', 'FL', 'GA', 'MN', 'OK', 'PA', 'UT', 'VA', 'WA'],
    inboundPublished: true,
    certificationAcceptedBy: ['GA', 'VA', 'WA'],
    outboundPublished: false,
    termYears: 4,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'North Carolina requires escort/pilot vehicle drivers to be certified under 19A NCAC 02D — an 8-hour course (a valid Class A CDL holder may sit the examination without attending), valid four years. It accepts Arizona, Colorado, Florida, Georgia, Minnesota, Oklahoma, Pennsylvania, Utah, Virginia and Washington. The Colorado recognition is ONE-WAY: "North Carolina certifications are not recognized in Colorado at this time."',
    sourceUrl: 'https://connect.ncdot.gov/business/trucking/Documents/2024%20EVO%20Handbook.pdf',
    sourceTitle: 'NCDOT — 2024 EVO Handbook (PDF)',
    sourcePublisher: 'North Carolina Department of Transportation',
    sourceRevisedOn: '2024-01-01',
  },
  {
    code: 'OK',
    requirement: 'required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: ['CO', 'GA', 'NC', 'VA', 'WA'],
    outboundPublished: false,
    termYears: 5,
    minimumAge: 18,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'OAC 730:50-5: "Every person who drives an escort vehicle for hire to escort a permitted over-dimensional load or vehicle in this state must be certified by the Department of Transportation." The operator must be 18, licensed, and pass ODOT\'s course and examination at 75% or better; the certificate expires five years after issue. A non-resident may use a current certification from a state with a reciprocal agreement — and Oklahoma publishes NO list of which states those are. An Oklahoma resident must hold an Oklahoma certificate "under all circumstances".',
    sourceUrl:
      'https://oklahoma.gov/content/dam/ok/en/odot/about-us/laws-rules/size-and-weight-permits/Size%20and%20Weight%20Permit%20Load.pdf',
    sourceTitle: 'OAC 730:50-5 — ODOT size and weight permit rules (Size and Weight Permit Load, PDF)',
    sourcePublisher: 'Oklahoma Department of Transportation',
    sourceRevisedOn: '2023-09-11',
  },
  {
    code: 'PA',
    requirement: 'required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: ['NC'],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'PennDOT runs a Certified Escort Vehicle programme and its policy names the out-of-state classes it accepts, but the policy PDF is UNDATED so the accepted list cannot be shown to be current. A certified escort may cover loads up to 18 ft wide or 260 ft long on highways with at least two lanes in one direction; 67 Pa. Code §179.10 (1993) and 75 Pa.C.S. §4962(f.6) (2015) disagree about whether a super load needs a police escort instead, and the two cannot be reconciled from the published sources.',
    sourceUrl:
      'https://www.pa.gov/content/dam/copapwp-pagov/en/penndot/documents/programs-and-doing-business/permits/haulinginformation/certifiedescortprograminformation.pdf',
    sourceTitle: 'PennDOT — Certified Escort Program Information (PDF)',
    sourcePublisher: 'Pennsylvania Department of Transportation',
    sourceRevisedOn: null,
  },
  {
    code: 'TN',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    // THE REASON `vehicleGvwrMaxLbs` EXISTS. Tennessee regulates the escort
    // VEHICLE and not the driver, so "is this operator certified" is the wrong
    // question here and "what does he drive" is the right one.
    vehicleGvwrMaxLbs: 18_000,
    vehicleWeightMinLbs: 2_000,
    note:
      'Tennessee mandates no driver certification, no examination and no reciprocity in either direction. What it DOES regulate is the vehicle: "The escort vehicle must be a vehicle weighing more than 2,000 pounds with a manufacturer\'s gross vehicle weight rating less than 18,000 pounds and must be properly licensed", plus placard, lighting and safety equipment. A certificate earned elsewhere buys nothing here; a vehicle over 18,000 lb GVWR is refused here whatever the driver holds.',
    sourceUrl: 'https://www.law.cornell.edu/regulations/tennessee/Tenn-Comp-R-Regs-1680-07-01-.21',
    sourceTitle: 'Tenn. Comp. R. & Regs. 1680-07-01-.21 — Escort vehicle requirements (via Cornell LII)',
    sourcePublisher: 'Cornell Legal Information Institute, reproducing the Tennessee Compilation Rules & Regulations',
    sourceRevisedOn: null,
  },
  {
    code: 'MI',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Michigan is not on FHWA’s list of certifying states, and independently MDOT’s own escort text specifies VEHICLE, LIGHTING AND SIGNAGE ONLY — a passenger vehicle, at least one roof-mounted flashing or rotating light visible 500 ft, and a 5 ft by 12 in OVERSIZE LOAD sign with 8-inch black letters on yellow — and imposes no operator qualification of any kind. Both directions follow from the one fact: INBOUND there is no Michigan certification to require, so an out-of-state card is neither demanded nor refused; OUTBOUND Michigan issues no card, so a Michigan escort must obtain the certification of any certifying state it enters. There is no reciprocity list because there is nothing to reciprocate.',
    sourceUrl: 'https://ops.fhwa.dot.gov/publications/fhwahop16054/pevo_study_gde.htm',
    sourceTitle: 'FHWA — Pilot/Escort Vehicle Operator (P/EVO) Best Practices Guide',
    sourcePublisher: 'Federal Highway Administration',
    sourceRevisedOn: null,
  },
  {
    code: 'MS',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Mississippi is not on FHWA’s list, and MDOT’s own "Escort Vehicle" definition — identical in the 2024 Manual and the 2020 Commission Rule — specifies EQUIPMENT, SIGNAGE, LIGHTING AND RADIO ONLY: "a flashing or revolving amber light, two warning flags mounted on the vehicle, an Oversize Load or Wide Load sign mounted on top of the vehicle ... Two-way communication is required between escort/escorts and towing vehicle." No operator qualification, training or certification appears anywhere in either document. INBOUND no Mississippi certification exists to require; OUTBOUND Mississippi issues no card, so its escorts must obtain the certification of any certifying state they enter.',
    sourceUrl: 'https://ops.fhwa.dot.gov/publications/fhwahop16054/pevo_study_gde.htm',
    sourceTitle: 'FHWA — Pilot/Escort Vehicle Operator (P/EVO) Best Practices Guide',
    sourcePublisher: 'Federal Highway Administration',
    sourceRevisedOn: null,
  },
  {
    code: 'SC',
    requirement: 'not-required',
    acceptsCertificationFrom: [],
    inboundPublished: false,
    certificationAcceptedBy: [],
    outboundPublished: false,
    termYears: null,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'South Carolina is not on FHWA’s list, and SCDOT’s escort section specifies VEHICLE, LIGHTING, SIGNAGE, SPACING AND RADIO ONLY — one roof-mounted amber light visible 500 ft at 360 degrees, a 12 in by 7 ft OVERSIZE LOAD or WIDE LOAD banner front and rear, a rear escort 3-4 seconds back, a front escort no more than half a mile ahead, and two-way radio — with no operator qualification. THE OUTBOUND HALF MATTERS MORE HERE THAN ANYWHERE ELSE IN THE CORPUS: both of South Carolina’s I-95 neighbours, North Carolina and Georgia, DO certify, so a South Carolina pilot car cannot lawfully cross either state line without first obtaining that state’s certification. INBOUND, no South Carolina certification exists to require.',
    sourceUrl: 'https://ops.fhwa.dot.gov/publications/fhwahop16054/pevo_study_gde.htm',
    sourceTitle: 'FHWA — Pilot/Escort Vehicle Operator (P/EVO) Best Practices Guide',
    sourcePublisher: 'Federal Highway Administration',
    sourceRevisedOn: null,
  },
  {
    code: 'VA',
    requirement: 'disputed',
    acceptsCertificationFrom: ['FL', 'GA', 'MN', 'NC', 'OK', 'UT', 'WA'],
    inboundPublished: true,
    certificationAcceptedBy: ['GA', 'NC', 'WA'],
    outboundPublished: false,
    termYears: 5,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'Certification itself is required — an eight-hour course and a DMV examination, $25 to obtain or renew, valid five years, $15 to reissue (24VAC20-82-140). RECIPROCITY IS WHAT IS DISPUTED, and by two undated DMV pages: the escort-driver certification page lists seven reciprocal states citing §46.2-2907, while the escort-driver FAQ says only "Currently, we have an agreement with North Carolina." Neither carries a revision date, so neither supersedes the other. The seven-state list is recorded here because it is the more specific and cites the statute — confirm portability with DMV before relying on it.',
    sourceUrl: 'https://www.dmv.virginia.gov/businesses/motor-carriers/escort-dr-cert',
    sourceTitle: 'Virginia DMV — Escort Vehicle Driver Certification (undated)',
    sourcePublisher: 'Virginia Department of Motor Vehicles',
    sourceRevisedOn: null,
  },
  {
    code: 'WA',
    requirement: 'required',
    acceptsCertificationFrom: ['AZ', 'CO', 'GA', 'MN', 'NC', 'OK', 'UT', 'VA'],
    inboundPublished: true,
    certificationAcceptedBy: ['GA', 'NC', 'VA'],
    outboundPublished: false,
    termYears: 3,
    minimumAge: null,
    vehicleGvwrMaxLbs: null,
    vehicleWeightMinLbs: null,
    note:
      'WAC 468-38-100(4)(d) requires an eight-hour initial course or a four-hour recertification, a written test at 80% or better, and renewal every three years; for-hire operators must carry $100,000 per person, $300,000 per accident and $50,000 property-damage insurance under (16). Washington recognises Arizona, Colorado, Georgia, Minnesota, North Carolina, Oklahoma, Utah and Virginia. It publishes NO list of the states that accept a Washington card in return.',
    sourceUrl: 'https://app.leg.wa.gov/wac/default.aspx?cite=468-38-100',
    sourceTitle: 'WAC 468-38-100 — Pilot/escort vehicle requirements',
    sourcePublisher: 'Washington State Department of Transportation',
    sourceRevisedOn: '2023-03-25',
  },
];

/**
 * Every state we hold NO certification source for, named rather than omitted.
 *
 * Arkansas, Florida, Louisiana, Ohio and Texas are in the permit engine's
 * covered set and still land here: the engine holds their FEE schedules and
 * says nothing about operator certification, and inventing the missing half
 * from a neighbouring state is the exact failure this whole corpus is built to
 * avoid. Florida is the sharpest case — Colorado, Georgia and North Carolina
 * all name Florida as a state whose certificate they accept, which strongly
 * implies Florida issues one, and "strongly implies" is not a source.
 */
const UNKNOWN_NOTE =
  'We hold no source on whether this state certifies pilot-car operators. That is not the same as "no certification required" — check the state before you dispatch.';

const KNOWN_CODES = new Set(FACTS.map((f) => f.code));

/**
 * All 50 states plus DC. Territories are excluded for the same reason the OS/OW
 * calculator excludes them: none is reachable by road from the mainland, so an
 * escort lane through one is not a move this directory describes.
 */
export const PILOT_CAR_STATE_CODES: readonly string[] = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM',
  'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA',
  'WV', 'WI', 'WY',
];

/** Keyed by USPS code. Every code in `PILOT_CAR_STATE_CODES` is present. */
export const PILOT_CAR_CERTIFICATION: Readonly<Record<string, StateCertificationFacts>> =
  Object.freeze(
    Object.fromEntries([
      ...FACTS.map((f) => [f.code, Object.freeze(f)] as const),
      ...PILOT_CAR_STATE_CODES.filter((c) => !KNOWN_CODES.has(c)).map(
        (c) => [c, Object.freeze(unknownState(c, UNKNOWN_NOTE))] as const,
      ),
    ]),
  );

/** Facts for one state. Never null for a code in `PILOT_CAR_STATE_CODES`. */
export function certificationFor(code: string): StateCertificationFacts | null {
  return PILOT_CAR_CERTIFICATION[String(code ?? '').trim().toUpperCase()] ?? null;
}

/**
 * The states where holding a certificate demonstrably changes whether an
 * operator may take the job.
 *
 * `'disputed'` is INCLUDED. Virginia's requirement is not in doubt — only its
 * reciprocity is — and Alabama points at a course it may no longer run, which
 * is a reason to prefer a certified operator rather than a reason to ignore the
 * question. `'unsettled'` and `'unknown'` are excluded because neither is
 * evidence that a certificate is needed.
 */
export function statesRequiringCertification(): readonly string[] {
  return PILOT_CAR_STATE_CODES.filter((c) => {
    const r = PILOT_CAR_CERTIFICATION[c]?.requirement;
    return r === 'required' || r === 'disputed';
  });
}

/**
 * Whether `holderState`'s certificate is published as accepted in `workState`.
 *
 * THREE-VALUED, and the third value is the useful one. `'accepted'` and
 * `'not-accepted'` are only returned where the working state actually publishes
 * an inbound list; everywhere else the answer is `'not-published'`, which the
 * surfaces must render as "confirm with the state", never as a yes and never as
 * a no. A state working from its own certificate is always `'accepted'` — a
 * Washington operator does not need Washington to reciprocate with itself.
 */
export function reciprocityStatus(
  holderState: string,
  workState: string,
): 'accepted' | 'not-accepted' | 'not-published' | 'not-applicable' {
  const holder = String(holderState ?? '').trim().toUpperCase();
  const work = certificationFor(workState);
  if (work === null) return 'not-published';
  if (work.requirement === 'not-required') return 'not-applicable';
  if (holder === work.code) return 'accepted';
  if (!work.inboundPublished) return 'not-published';
  return work.acceptsCertificationFrom.includes(holder) ? 'accepted' : 'not-accepted';
}

/** Human label for a requirement value. One place, so surfaces cannot drift. */
export const CERTIFICATION_LABEL: Readonly<Record<CertificationRequirement, string>> = Object.freeze({
  required: 'Certification required',
  'not-required': 'No state certification',
  disputed: 'Sources disagree',
  unsettled: 'State is silent',
  unknown: 'We hold no source',
});
