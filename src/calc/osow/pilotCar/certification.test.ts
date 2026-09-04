/**
 * The certification registry's invariants.
 *
 * The most important test in this file is the PROVENANCE one. Every non-unknown
 * row here restates a fact the permit engine already sources, and the way that
 * goes wrong is not a typo — it is this file quietly becoming a second corpus
 * with its own opinions. Asserting that each `sourceUrl` still appears in the
 * jurisdiction files is what makes a drifting citation a build failure instead
 * of a discovery six months later.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CERTIFICATION_LABEL,
  PILOT_CAR_CERTIFICATION,
  PILOT_CAR_STATE_CODES,
  certificationFor,
  reciprocityStatus,
  statesRequiringCertification,
} from './certification.js';

const JURISDICTION_DIR = resolve(process.cwd(), 'src/calc/osow/jurisdictions');
const CORPUS = readdirSync(JURISDICTION_DIR)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => readFileSync(resolve(JURISDICTION_DIR, f), 'utf8'))
  .join('\n');

describe('provenance — every sourced row traces to the permit engine\'s own corpus', () => {
  const sourced = PILOT_CAR_STATE_CODES.map((c) => PILOT_CAR_CERTIFICATION[c]!).filter(
    (f) => f.requirement !== 'unknown',
  );

  it('has at least the states the permit engine covers a certification fact for', () => {
    expect(sourced.length).toBeGreaterThanOrEqual(16);
  });

  it.each(sourced.map((f) => [f.code, f.sourceUrl] as const))(
    '%s cites a URL that exists in src/calc/osow/jurisdictions',
    (_code, url) => {
      expect(url).toBeTruthy();
      expect(CORPUS).toContain(url as string);
    },
  );

  it('never cites a competitor directory', () => {
    for (const f of sourced) {
      expect(f.sourceUrl ?? '').not.toMatch(/truckinfo|heavyhaulers|oversize\.io/i);
    }
  });

  it('records an UNDATED document as undated rather than as today', () => {
    // Several of these pages carry no revision date at all. `null` is the
    // recorded fact; substituting a retrieval date would make an undated DMV
    // page look freshly revised.
    const undated = sourced.filter((f) => f.sourceRevisedOn === null);
    expect(undated.length).toBeGreaterThan(0);
    for (const f of sourced) {
      if (f.sourceRevisedOn !== null) expect(f.sourceRevisedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});

describe('the requirement is never a boolean, and absence is never permission', () => {
  it('covers all 50 states plus DC, with no state omitted', () => {
    expect(PILOT_CAR_STATE_CODES).toHaveLength(51);
    for (const c of PILOT_CAR_STATE_CODES) {
      expect(certificationFor(c), c).not.toBeNull();
    }
  });

  it('a state we hold no source for is "unknown", NOT "not-required"', () => {
    // Ohio and Texas are both inside the permit engine's covered set and both
    // silent on certification. Reading that silence as "no certificate needed"
    // is the failure this value exists to prevent.
    for (const code of ['OH', 'TX', 'AR', 'FL', 'LA']) {
      const f = certificationFor(code)!;
      expect(f.requirement, code).toBe('unknown');
      expect(f.sourceUrl, code).toBeNull();
      expect(f.note, code).toContain('not the same as');
    }
  });

  it('distinguishes a state that says "none needed" from one that is merely silent', () => {
    // Kentucky publishes that it certifies nobody. Indiana publishes nothing in
    // either direction. Different values, because they are different facts.
    expect(certificationFor('KY')!.requirement).toBe('not-required');
    expect(certificationFor('IN')!.requirement).toBe('unsettled');
  });

  it('labels every requirement value without ever saying "verified" or "approved"', () => {
    for (const [, label] of Object.entries(CERTIFICATION_LABEL)) {
      expect(label.toLowerCase()).not.toMatch(/verified|approved/);
    }
  });
});

describe('reciprocity is TWO lists, and they are allowed to disagree', () => {
  it('Georgia accepts a set that is not the set that accepts Georgia', () => {
    const ga = certificationFor('GA')!;
    expect([...ga.acceptsCertificationFrom].sort()).toEqual(['AZ', 'CO', 'UT', 'VA', 'WA']);
    expect([...ga.certificationAcceptedBy].sort()).toEqual(['FL', 'NC', 'OK', 'WA']);
    // Only Washington is on both. If a refactor ever symmetrises these, this is
    // the assertion that catches it.
    const both = ga.acceptsCertificationFrom.filter((s) => ga.certificationAcceptedBy.includes(s));
    expect(both).toEqual(['WA']);
  });

  it('North Carolina accepts Colorado while Colorado does not accept North Carolina', () => {
    expect(certificationFor('NC')!.acceptsCertificationFrom).toContain('CO');
    expect(certificationFor('CO')!.acceptsCertificationFrom).not.toContain('NC');
  });

  it('an empty inbound list with inboundPublished TRUE means "nobody", and that is New York', () => {
    const ny = certificationFor('NY')!;
    expect(ny.requirement).toBe('required');
    expect(ny.inboundPublished).toBe(true);
    expect(ny.acceptsCertificationFrom).toHaveLength(0);
  });

  it('an unpublished outbound list is not an empty one — Colorado, Oklahoma, Washington', () => {
    for (const code of ['CO', 'OK', 'WA']) {
      expect(certificationFor(code)!.outboundPublished, code).toBe(false);
    }
  });

  it('reciprocityStatus answers "not-published" rather than yes or no where a state prints no list', () => {
    // Oklahoma requires certification and publishes no reciprocal list, so the
    // only honest answer for an out-of-state holder is "confirm with the state".
    expect(reciprocityStatus('GA', 'OK')).toBe('not-published');
    // New York publishes its answer and the answer is no.
    expect(reciprocityStatus('WA', 'NY')).toBe('not-accepted');
    // Washington names Colorado inbound.
    expect(reciprocityStatus('CO', 'WA')).toBe('accepted');
    // A state never has to reciprocate with itself.
    expect(reciprocityStatus('WA', 'WA')).toBe('accepted');
    // Kentucky certifies nobody, so the question does not arise.
    expect(reciprocityStatus('CO', 'KY')).toBe('not-applicable');
  });
});

describe('statesRequiringCertification is what the deep links filter on', () => {
  const required = statesRequiringCertification();

  it('includes the states that certify, and the disputed ones', () => {
    for (const code of ['CO', 'GA', 'NC', 'NY', 'OK', 'PA', 'WA', 'VA', 'AL']) {
      expect(required, code).toContain(code);
    }
  });

  it('EXCLUDES a state that certifies nobody — filtering on one returns nothing forever', () => {
    for (const code of ['KY', 'TN', 'CA', 'IL', 'MO', 'NJ']) {
      expect(required, code).not.toContain(code);
    }
  });

  it('excludes the states we hold no source for — an unknown is not a requirement', () => {
    for (const code of ['OH', 'TX', 'FL']) {
      expect(required, code).not.toContain(code);
    }
  });
});

describe('the escort VEHICLE is modelled separately from the driver', () => {
  it('records Tennessee\'s GVWR ceiling, which no certification field could hold', () => {
    const tn = certificationFor('TN')!;
    // TN certifies nobody AND refuses a vehicle at 18,000 lb GVWR or above. An
    // operator can be perfectly certified and still illegal here.
    expect(tn.requirement).toBe('not-required');
    expect(tn.vehicleGvwrMaxLbs).toBe(18_000);
    expect(tn.vehicleWeightMinLbs).toBe(2_000);
  });
});
