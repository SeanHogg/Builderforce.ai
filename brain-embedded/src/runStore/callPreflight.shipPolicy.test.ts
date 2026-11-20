/**
 * PRD 48: the run's SHIP POLICY is enforced in `callPreflight`, BEFORE the confirm gate —
 * so neither `acceptEdits` nor a sub-agent's inherited context can waive it — and the host's
 * confirm predicate is handed the policy, so a publish it allows needs no approval card.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIP_POLICY, shipPolicyOf, type ShipPolicy } from '@builderforce/run-guards';
import { callPreflight } from './callPreflight';
import { makeCell } from './runCell';
import { PendingCalls } from './pendingCalls';
import { runShipPolicy } from './runShipPolicy';
import type { BrainRunContext } from './brainRunContext';
import type { BrainRunRequest } from './runTypes';

const NEEDS_CONFIRM_REACHED = new Error('needsConfirm reached');

/** Only the fields the preflight reads up to the confirm gate. */
function runWith(shipPolicy: ShipPolicy, seen: Array<{ name: string; shipPolicy?: ShipPolicy }> = []): BrainRunContext {
  const req = {
    // Reaching the confirm gate means the policy let the call through; stop there.
    needsConfirm: (call: { name: string; args: unknown; shipPolicy?: ShipPolicy }) => {
      seen.push({ name: call.name, ...(call.shipPolicy ? { shipPolicy: call.shipPolicy } : {}) });
      throw NEEDS_CONFIRM_REACHED;
    },
  } as Partial<BrainRunRequest>;
  return {
    c: makeCell(),
    chatId: 1,
    runKey: 1,
    serverChatId: null,
    req,
    allTools: [],
    catalogToolNames: [],
    usedTools: new Set<string>(),
    pending: new PendingCalls(),
    shipPolicy,
  } as unknown as BrainRunContext;
}

async function dispatch(run: BrainRunContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  const hook = callPreflight(run);
  const out = await hook({ id: 'c1', name, args, raw: { id: 'c1', name, arguments: JSON.stringify(args) } } as never, { step: 1 } as never);
  return (out as { result?: { data?: unknown } } | undefined)?.result?.data;
}

describe('callPreflight — the ship policy refuses before the confirm gate', () => {
  it('leave_uncommitted refuses git_commit and a raw gh pr create, never reaching the confirm gate', async () => {
    const seen: Array<{ name: string }> = [];
    const run = runWith(shipPolicyOf('leave_uncommitted', 'project_settings'), seen);
    for (const [name, args] of [
      ['git_commit', { paths: ['a.ts'], allowBaseBranch: true }],
      ['run_command', { command: 'gh pr create --fill' }],
    ] as const) {
      const data = await dispatch(run, name, { ...args });
      expect(data, name).toMatchObject({ ok: false });
      expect(String((data as { error: string }).error)).toMatch(/leave_uncommitted/);
    }
    expect(seen).toEqual([]);
    expect(run.c.trace.some((e) => (e.result as { shipPolicy?: string } | null)?.shipPolicy === 'leave_uncommitted')).toBe(true);
  });

  it('a sub-agent (lineage) is refused a commit whatever the project allows', async () => {
    const policy = runShipPolicy({ lineage: { ownerKey: 7 } as never, shipPolicy: shipPolicyOf('commit_push', 'project_settings') }, null);
    expect(policy).toMatchObject({ mode: 'leave_uncommitted', source: 'subagent' });
    const seen: Array<{ name: string }> = [];
    const data = await dispatch(runWith(policy, seen), 'git_commit', { paths: ['a.ts'] });
    expect(data).toMatchObject({ ok: false });
    expect(String((data as { error: string }).error)).toMatch(/sub-agent/);
    expect(seen).toEqual([]);
  });

  it('a hold narrows the project policy and the refusal quotes the turn', async () => {
    const policy = runShipPolicy({ shipPolicy: shipPolicyOf('commit_push', 'project_settings') }, { messageNumber: 2, text: "don't push until I check" });
    const data = await dispatch(runWith(policy), 'git_push', { allowBaseBranch: true });
    expect(String((data as { error: string }).error)).toMatch(/message #2/);
  });

  it('no project policy: the default commits — a commit reaches the confirm gate, a push is refused', async () => {
    expect(runShipPolicy({}, null)).toBe(DEFAULT_SHIP_POLICY);
    const seen: Array<{ name: string; shipPolicy?: ShipPolicy }> = [];
    const run = runWith(DEFAULT_SHIP_POLICY, seen);
    await expect(dispatch(run, 'git_commit', { paths: ['a.ts'], allowBaseBranch: true })).rejects.toBe(NEEDS_CONFIRM_REACHED);
    expect(seen).toEqual([{ name: 'git_commit', shipPolicy: DEFAULT_SHIP_POLICY }]);
    expect(await dispatch(run, 'git_push', { allowBaseBranch: true })).toMatchObject({ ok: false });
  });

  it('an allowed push reaches the host confirm predicate carrying the run policy (chat #157440)', async () => {
    // The run's policy reaches the host's confirm predicate, which is what lets
    // `nativeNeedsConfirm` treat an allowed push as already approved (no card, no question).
    const seen: Array<{ name: string; shipPolicy?: ShipPolicy }> = [];
    const policy = shipPolicyOf('commit_push', 'project_settings');
    await expect(dispatch(runWith(policy, seen), 'git_push', { allowBaseBranch: true })).rejects.toBe(NEEDS_CONFIRM_REACHED);
    expect(seen).toEqual([{ name: 'git_push', shipPolicy: policy }]);
  });
});
