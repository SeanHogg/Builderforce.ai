/**
 * trustedLegacyApprovals - a pre-cutover cursor's gate keys were recorded at ASK time, so each resumes as approved only when the
 * latest governance approval for THAT key's tool on the execution says so.
 */
import { describe, expect, it } from 'vitest';
import type { CloudLoopState } from './cloudRunState';
import { trustedLegacyApprovals } from './cloudLegacyApprovals';

const A = 'g1|run_command|aaaa';
const B = 'g2|delete_file|bbbb';
const legacy = (keys: string[]) => ({ messages: [], policyAskedGates: keys }) as unknown as CloudLoopState;
const ask = (tool: string) => `Approve the agent's use of "${tool}"? needs an approver`;
/** Approvals NEWEST FIRST, as the query returns them. */
const dbWith = (rows: Array<{ status: string; description: string }>) => ({
  select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }),
}) as never;

describe('trustedLegacyApprovals', () => {
  it('trusts a key when the latest approval for its tool was approved', async () => {
    expect(await trustedLegacyApprovals(dbWith([{ status: 'approved', description: ask('run_command') }]), 1, 9, legacy([A]))).toEqual([A]);
  });

  it('a cursor parked on a PENDING approval, and a REJECTED call retried identically, are not approved', async () => {
    expect(await trustedLegacyApprovals(dbWith([{ status: 'pending', description: ask('run_command') }]), 1, 9, legacy([A]))).toEqual([]);
    expect(await trustedLegacyApprovals(dbWith([{ status: 'rejected', description: ask('run_command') }]), 1, 9, legacy([A]))).toEqual([]);
  });

  it('[A rejected, B approved]: A asks again, B is trusted - per key, not per execution', async () => {
    const rows = [{ status: 'approved', description: ask('delete_file') }, { status: 'rejected', description: ask('run_command') }];
    expect(await trustedLegacyApprovals(dbWith(rows), 1, 9, legacy([A, B]))).toEqual([B]);
  });

  it('the LATEST decision for a tool wins (a later rejection withdraws an earlier approval)', async () => {
    const rows = [{ status: 'rejected', description: ask('run_command') }, { status: 'approved', description: ask('run_command') }];
    expect(await trustedLegacyApprovals(dbWith(rows), 1, 9, legacy([A]))).toEqual([]);
  });

  it('no approval on record trusts nothing; a cursor with no keys (or the new shape) needs no lookup', async () => {
    expect(await trustedLegacyApprovals(dbWith([]), 1, 9, legacy([A]))).toEqual([]);
    const noLookup = { select: () => { throw new Error('should not query'); } } as never;
    expect(await trustedLegacyApprovals(noLookup, 1, 9, { messages: [] } as unknown as CloudLoopState)).toEqual([]);
    expect(await trustedLegacyApprovals(noLookup, 1, 9, { run: {}, policyAskedGates: [A] } as unknown as CloudLoopState)).toEqual([]);
    expect(await trustedLegacyApprovals(noLookup, 1, 9, undefined)).toEqual([]);
  });
});
