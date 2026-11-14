import { describe, expect, it } from 'vitest';
import type { BrainRunContext } from './brainRunContext';
import { deliveryGates } from './deliveryGates';
import { PendingCalls } from './pendingCalls';

/**
 * Regression (ticket #6704): a run that ends on a NARRATION turn — "let me wait for the test
 * run to finish", "both type-checks pass, now self-reviewing" — while a tool call it started
 * is still in flight must be sent back to keep working. The narration is not the answer; the
 * run is mid-task. `brain.pending_narration` is that gate: it holds while any call's tool is
 * still running, spends its one recovery, and stays quiet once nothing is pending.
 */

/** A minimal run context: only the fields the gates read. */
function runCtx(over: Partial<BrainRunContext> = {}): BrainRunContext {
  return {
    c: { codeChanged: false, touchedFiles: [] },
    catalogToolNames: [],
    userRequest: 'do it',
    priorReply: null,
    publishHold: null,
    shipRecoveryUsed: false,
    reviewRecoveryUsed: false,
    delegationRecoveryUsed: false,
    restateRecoveryUsed: false,
    pendingNarrationRecoveryUsed: false,
    pending: new PendingCalls(),
  } as unknown as BrainRunContext;
}

/** The pending-narration gate from a run's gate list, by id. */
function pendingGate(run: BrainRunContext) {
  const gate = deliveryGates(run).find((g) => g.id === 'brain.pending_narration');
  if (!gate) throw new Error('brain.pending_narration gate missing');
  return gate;
}

describe('brain.pending_narration (ticket #6704)', () => {
  it('holds when a tool call the run started is still running', () => {
    const run = runCtx();
    run.pending.begin('call-1', { label: 'run_command' } as never);
    expect(pendingGate(run).applies('let me wait for the test run to finish')).toBe(true);
  });

  it('spends its one recovery: a second narration turn after the send-back is not held', () => {
    const run = runCtx();
    run.pending.begin('call-1', { label: 'run_command' } as never);
    const gate = pendingGate(run);
    expect(gate.applies('still going')).toBe(true);
    gate.spend(); // the run was sent back once
    expect(run.pendingNarrationRecoveryUsed).toBe(true);
    expect(gate.applies('still going')).toBe(false);
  });

  it('stays quiet once nothing is pending', () => {
    const run = runCtx();
    run.pending.begin('call-1', { label: 'run_command' } as never);
    run.pending.end('call-1');
    expect(pendingGate(run).applies('all checks pass, here is the result')).toBe(false);
  });

  it('nudges the run to continue until the pending step resolves', () => {
    const run = runCtx();
    expect(pendingGate(run).nudge()).toMatch(/still running/);
    expect(pendingGate(run).trace.label).toBe('loop.recover_pending_narration');
  });
});
