import { describe, expect, it } from 'vitest';
import { listComplianceJurisdictions } from './complianceJurisdictions';

describe('Compliance Audit Agent jurisdiction matrix', () => {
  it('covers the requested state and country surfaces without claiming universal applicability', () => {
    const profiles = listComplianceJurisdictions();
    const regions = profiles.map((profile) => profile.region).join(' ');
    const authorities = profiles.flatMap((profile) => profile.authorities).join(' ');

    expect(regions).toMatch(/United States/);
    expect(regions).toMatch(/European Union/);
    expect(regions).toMatch(/United Kingdom/);
    expect(regions).toMatch(/Canada/);
    expect(regions).toMatch(/Brazil/);
    expect(regions).toMatch(/Australia/);
    expect(authorities).toMatch(/CCPA/);
    expect(authorities).toMatch(/GDPR/);
    expect(authorities).toMatch(/EU AI Act/);
    expect(profiles.every((profile) => profile.applicabilityNotes.length > 20)).toBe(true);
  });

  it('returns defensive copies', () => {
    const first = listComplianceJurisdictions();
    first[0]!.authorities.push('mutated');
    expect(listComplianceJurisdictions()[0]!.authorities).not.toContain('mutated');
  });
});
