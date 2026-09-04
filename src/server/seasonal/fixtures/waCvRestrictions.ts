/**
 * FIXTURE - WSDOT Traveler Information API, CVRestrictions.
 *
 * HONEST PROVENANCE, because it matters here more than for the other three:
 * this is the ONE fixture in this directory that was NOT captured live. The
 * endpoint requires a free Traveler Information API access code, which we have
 * not provisioned (see `freeApiKey` on the Washington row in `sources.ts`), so
 * this document is hand-built to WSDOT's own published `CVRestrictionData`
 * field list and to the .NET JSON date encoding the API is documented to emit.
 *
 * It therefore proves the PARSER, not the FEED. The distinction is recorded
 * here rather than left for someone to discover: until a code is provisioned
 * and the first live response is compared against this shape, Washington is
 * ingested on a contract we have read, not on one we have seen. The ingest
 * treats a missing key as `skipped`, never as a failure, for exactly that
 * reason - an unprovisioned key must not look like a broken source.
 *
 * Rows, in order:
 *   1. seasonal, in force, with both an effective and an expiry date
 *   2. seasonal, in force, open-ended (no expiry stated)
 *   3. PERMANENT bridge posting - must be excluded, it is not a frost law
 *   4. no effective date at all - must be excluded, an undated restriction is
 *      not evidence of a season
 */
export const WA_CVRESTRICTIONS_FIXTURE = JSON.stringify(
  [
    {
      BridgeName: null,
      BridgeNumber: null,
      DateEffective: '/Date(1772265600000-0800)/',
      DateExpires: '/Date(1778914800000-0700)/',
      DatePosted: '/Date(1771920000000-0800)/',
      IsDetourAvailable: false,
      IsExceptionsAllowed: true,
      IsPermanentRestriction: false,
      IsWarning: false,
      LocationDescription: 'SR 20 MP 104.0 to MP 131.5, Okanogan County',
      LocationName: 'SR 20 Okanogan',
      MaximumGrossVehicleWeightInPounds: null,
      RestrictionComment:
        'Spring thaw load restriction: axle weights reduced to 80 percent of legal maximum.',
      RestrictionType: 0,
      RestrictionWeightInPounds: 16000,
      StateRouteID: '020',
    },
    {
      BridgeName: null,
      BridgeNumber: null,
      DateEffective: '/Date(1772524800000-0800)/',
      DateExpires: null,
      DatePosted: '/Date(1772352000000-0800)/',
      IsDetourAvailable: false,
      IsExceptionsAllowed: true,
      IsPermanentRestriction: false,
      IsWarning: false,
      LocationDescription: 'SR 21 MP 149.0 to MP 190.0, Ferry County',
      LocationName: 'SR 21 Ferry',
      MaximumGrossVehicleWeightInPounds: null,
      RestrictionComment: 'Spring thaw load restriction in effect until further notice.',
      RestrictionType: 0,
      RestrictionWeightInPounds: 14000,
      StateRouteID: '021',
    },
    {
      BridgeName: 'Example Creek Bridge',
      BridgeNumber: '005/123',
      DateEffective: '/Date(1104537600000-0800)/',
      DateExpires: null,
      DatePosted: '/Date(1104537600000-0800)/',
      IsDetourAvailable: true,
      IsExceptionsAllowed: false,
      IsPermanentRestriction: true,
      IsWarning: false,
      LocationDescription: 'I-5 MP 12.3',
      LocationName: 'Example Creek',
      MaximumGrossVehicleWeightInPounds: 80000,
      RestrictionComment: 'Permanent structural posting.',
      RestrictionType: 1,
      RestrictionWeightInPounds: 80000,
      StateRouteID: '005',
    },
    {
      BridgeName: null,
      BridgeNumber: null,
      DateEffective: null,
      DateExpires: null,
      DatePosted: null,
      IsDetourAvailable: false,
      IsExceptionsAllowed: false,
      IsPermanentRestriction: false,
      IsWarning: true,
      LocationDescription: 'SR 999 MP 0.0',
      LocationName: 'Undated advisory',
      MaximumGrossVehicleWeightInPounds: null,
      RestrictionComment: 'Advisory with no stated effective date.',
      RestrictionType: 0,
      RestrictionWeightInPounds: null,
      StateRouteID: '999',
    },
  ],
  null,
  1,
);
