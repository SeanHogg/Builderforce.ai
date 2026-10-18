import { describe, expect, it } from 'vitest';
import { findingFingerprint } from './auditRemediation';
import { PRIVACY_AUDIT_ID } from './auditIds';

describe('Privacy remediation deduplication', () => {
  it('keeps the same identity when an obligation changes severity or moves lines', async () => {
    const first = { title: 'Implement erasure', location: 'src/privacy.ts:12', severity: 'high' as const };
    expect(await findingFingerprint(PRIVACY_AUDIT_ID, first)).toBe(await findingFingerprint(PRIVACY_AUDIT_ID, {
      ...first, location: 'src/privacy.ts:30', severity: 'medium', recommendation: 'Repair deletion propagation.',
    }));
  });
  it('keeps independently remediable obligations separate', async () => {
    expect(await findingFingerprint(PRIVACY_AUDIT_ID, { title: 'Implement erasure' }))
      .not.toBe(await findingFingerprint(PRIVACY_AUDIT_ID, { title: 'Implement data export' }));
  });
});
