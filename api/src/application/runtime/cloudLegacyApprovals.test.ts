/**
 * trustedLegacyApprovals - a pre-cutover cursor's gate keys were recorded at ASK time, so each resumes as approved only when the
 * latest governance approval for THAT EXACT CALL (gate + tool + arguments, recomputed with `policyGateCallKey`) says so.
 */
import { describe, expect, it } from 'vitest';
import { policyGateCallKey } from '@builderforce/agent-tools';
import type { CloudLoopState } from './cloudRunState';
import { trustedLegacyApprovals } from './cloudLegacyApprovals';

const LS = { command: 'ls' };
const RM = { command: 'rm -rf /' };
const A = policyGateCallKey('g1', 'run_command', LS);
const B = policyGateCallKey('g2', 'delete_file', { path: 'a.txt' });
const legacy = (keys: string[]) => ({ messages: [], policyAskedGates: keys }) as unknown as CloudLoopState;
/** The description `durableHuman.approve` writes: the question, then the gate context carrying the call's JSON arguments. */
const ask = (tool: string, gateId: string, args: unknown, cut?: number) =>
  `Approve the agent's use of "${tool}"? needs an approver\n\nContext: Governance gate "${gateId}" requires human approval before this tool may run with these arguments: ${JSON.stringify(args).slice(0, cut ?? 500)}`;
/** Approvals NEWEST FIRST, as the query returns them. */
const dbWith = (rows: Array<{ status: string; description: string }>) => ({
  select: () => ({ from: () => ({ where: () => ({ orderBy: async () => rows }) }) }),
}) as never;

describe('trustedLegacyApprovals', () => {
  it('trusts a key when the latest approval for exactly that call was approved', async () => {
    expect(await trustedLegacyApprovals(dbWith([{ status: 'approved', description: ask('run_command', 'g1', LS) }]), 1, 9, legacy([A]))).toEqual([A]);
  });

  it('a cursor parked on a PENDING approval, and a REJECTED call retried identically, are not approved', async () => {
    expect(await trustedLegacyApprovals(dbWith([{ status: 'pending', description: ask('run_command', 'g1', LS) }]), 1, 9, legacy([A]))).toEqual([]);
    expect(await trustedLegacyApprovals(dbWith([{ status: 'rejected', description: ask('run_command', 'g1', LS) }]), 1, 9, legacy([A]))).toEqual([]);
  });

  it('[A rejected, B approved]: A asks again, B is trusted - per key, not per execution', async () => {
    const rows = [{ status: 'approved', description: ask('delete_file', 'g2', { path: 'a.txt' }) }, { status: 'rejected', description: ask('run_command', 'g1', LS) }];
    expect(await trustedLegacyApprovals(dbWith(rows), 1, 9, legacy([A, B]))).toEqual([B]);
  });

  it('two keys on the SAME tool: the approved call is trusted, the rejected one asks again', async () => {
    const approvedLs = policyGateCallKey('g1', 'run_command', LS);
    const rejectedRm = policyGateCallKey('g1', 'run_command', RM);
    const rows = [{ status: 'rejected', description: ask('run_command', 'g1', RM) }, { status: 'approved', description: ask('run_command', 'g1', LS) }];
    expect(await trustedLegacyApprovals(dbWith(rows), 1, 9, legacy([approvedLs, rejectedRm]))).toEqual([approvedLs]);
  });

  it('the LATEST decision for a call wins (a later rejection withdraws an earlier approval)', async () => {
    const rows = [{ status: 'rejected', description: ask('run_command', 'g1', LS) }, { status: 'approved', description: ask('run_command', 'g1', LS) }];
    expect(await trustedLegacyApprovals(dbWith(rows), 1, 9, legacy([A]))).toEqual([]);
  });

  it('an approval whose arguments were truncated or are unparseable vouches for nothing: the gate asks again', async () => {
    const long = { command: `echo ${'x'.repeat(600)}` };
    const key = policyGateCallKey('g1', 'run_command', long);
    expect(await trustedLegacyApprovals(dbWith([{ status: 'approved', description: ask('run_command', 'g1', long) }]), 1, 9, legacy([key]))).toEqual([]);
    expect(await trustedLegacyApprovals(dbWith([{ status: 'approved', description: 'Approve the agent\'s use of "run_command"?' }]), 1, 9, legacy([A]))).toEqual([]);
  });

  it('no approval on record trusts nothing; a cursor with no keys (or the new shape) needs no lookup', async () => {
    expect(await trustedLegacyApprovals(dbWith([]), 1, 9, legacy([A]))).toEqual([]);
    const noLookup = { select: () => { throw new Error('should not query'); } } as never;
    expect(await trustedLegacyApprovals(noLookup, 1, 9, { messages: [] } as unknown as CloudLoopState)).toEqual([]);
    expect(await trustedLegacyApprovals(noLookup, 1, 9, { run: {}, policyAskedGates: [A] } as unknown as CloudLoopState)).toEqual([]);
    expect(await trustedLegacyApprovals(noLookup, 1, 9, undefined)).toEqual([]);
  });
});
