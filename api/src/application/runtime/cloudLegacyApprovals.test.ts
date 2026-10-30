/**
 * trustedLegacyApprovals - a pre-cutover cursor's gate keys were recorded at ASK time, so they resume as approved only when the
 * execution's latest governance approval says so.
 */
import { describe, expect, it } from 'vitest';
import type { CloudLoopState } from './cloudRunState';
import { trustedLegacyApprovals } from './cloudLegacyApprovals';

const KEYS = ['g1|run_command|deadbeef'];
const legacy = { messages: [], policyAskedGates: KEYS } as unknown as CloudLoopState;
const dbWith = (status: string | undefined) => ({
  select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => (status ? [{ status }] : []) }) }) }) }),
}) as never;

describe('trustedLegacyApprovals', () => {
  it('trusts the keys when the latest governance approval was approved', async () => {
    expect(await trustedLegacyApprovals(dbWith('approved'), 1, 9, legacy)).toEqual(KEYS);
  });

  it('a cursor parked on a PENDING approval resumes with nothing pre-approved', async () => {
    expect(await trustedLegacyApprovals(dbWith('pending'), 1, 9, legacy)).toEqual([]);
  });

  it('a REJECTED call retried identically is not approved', async () => {
    expect(await trustedLegacyApprovals(dbWith('rejected'), 1, 9, legacy)).toEqual([]);
  });

  it('no approval on record trusts nothing; a cursor with no keys (or the new shape) needs no lookup', async () => {
    expect(await trustedLegacyApprovals(dbWith(undefined), 1, 9, legacy)).toEqual([]);
    const noLookup = { select: () => { throw new Error('should not query'); } } as never;
    expect(await trustedLegacyApprovals(noLookup, 1, 9, { messages: [] } as unknown as CloudLoopState)).toEqual([]);
    expect(await trustedLegacyApprovals(noLookup, 1, 9, { run: {}, policyAskedGates: KEYS } as unknown as CloudLoopState)).toEqual([]);
    expect(await trustedLegacyApprovals(noLookup, 1, 9, undefined)).toEqual([]);
  });
});
