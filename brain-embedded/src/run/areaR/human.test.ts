/**
 * Area R, R10: the confirm card is an approval. A governance gate (`RunPolicy.approvalGates`) asks the human channel and reads
 * its STRUCTURED `approved`, never the words of the answer. Governance gates are unbound on the Brain (its request carries none,
 * as the loop's did), so `startRun` cannot reach this: the test drives `runAgent` over the Brain's real ports and a gate.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { runAgent, teeEvents, type PolicyGate, type RunEvent } from '@builderforce/agent-run';
import { resetBrainRunStore, resolveRunConfirm } from '../../runStore/runControl';
import { resetRunSteering } from '../../runSteering';
import { binding, result, scripted } from '../../test/brainRunHarness';
import { brainRunPolicy, brainRunTask, buildBrainRunPorts } from '../webAdapter';

beforeEach(() => {
  resetBrainRunStore();
  resetRunSteering();
});

const GATE: PolicyGate = { id: 'g-delete', effect: 'require-approval', tool: 'delete_file', reason: 'Deleting needs a sign-off.' };

/** A pinned model: a plan-phase edit would otherwise be re-asked of the coder, and the script would answer the re-ask. */
async function driveGate(runKey: number, answer: boolean): Promise<RunEvent[]> {
  const { stream } = scripted([
    () => result({ toolCalls: [{ id: 'c1', name: 'delete_file', args: JSON.stringify({ path: 'a.ts' }) }], finishReason: 'tool_calls' }),
    () => result({ text: 'Done.' }),
  ]);
  const b = binding(runKey, stream, 'web', { runTool: async () => ({ ok: true }), model: 'pin-1', modelStrict: true });
  b.binding.approvalGates = [GATE];
  const ports = buildBrainRunPorts(b.binding);
  const events: RunEvent[] = [];
  ports.events = teeEvents(ports.events, events);
  const run = runAgent({ task: brainRunTask(b.binding), policy: brainRunPolicy(b.binding), ports, signal: b.cell.abort?.signal });
  let early: unknown;
  void run.then((o) => { early = o; });
  for (let i = 0; i < 200 && !b.cell.pendingConfirm && early === undefined; i += 1) await new Promise((r) => setTimeout(r, 1));
  // A run that ended before it asked says how, instead of timing out.
  expect(early === undefined ? null : JSON.stringify(early) + JSON.stringify(events.map((e) => e.kind))).toBeNull();
  expect(b.cell.pendingConfirm).not.toBeNull();
  resolveRunConfirm(runKey, answer);
  await run;
  return events;
}

describe('R10: the Brain confirm card answers a governance gate', () => {
  it('an accepted card is an approval: the call proceeds and the gate blocks nothing', async () => {
    const events = await driveGate(9401, true);
    expect(events.filter((e) => e.kind === 'policy.blocked')).toEqual([]);
    const dispatched = events.filter((e) => e.kind === 'tool.dispatched' && e.tool === 'delete_file');
    expect(dispatched).toHaveLength(1);
    // The gate did not answer the call: whatever it got came from the registry, not from the gate.
    expect(JSON.stringify(dispatched[0])).not.toContain('g-delete');
  });

  it('a declined card refuses the call, and the gate says so', async () => {
    const events = await driveGate(9402, false);
    expect(events.filter((e) => e.kind === 'policy.blocked')).toHaveLength(1);
    // The call's row is the gate's refusal: the tool itself never ran.
    const dispatched = events.filter((e) => e.kind === 'tool.dispatched' && e.tool === 'delete_file');
    expect(dispatched).toHaveLength(1);
    expect(JSON.stringify(dispatched[0])).toContain('g-delete');
  });
});
