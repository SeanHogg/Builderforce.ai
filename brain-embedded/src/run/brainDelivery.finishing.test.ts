import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIP_POLICY, shipPolicyOf } from '@builderforce/run-guards';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { makeCell } from '../runStore/runCell';
import { PendingCalls } from '../runStore/pendingCalls';
import { RunProgressGuard } from '../runStore/progressGuard';
import { brainDeliveryLedger } from './brainDelivery';
import { FINISH_SKIPS_GATES_LABEL } from './finishSkipsGates';
import type { LastTurn } from './brainTurn';

// VS Code chat #128305: the run was FINISHING (its final turn offered no tools) and wrote a complete report, but the ship gate sent it
// back "verify, self-review, then git_commit" with zero tools on offer — the model repeated itself into a provider doom-loop.

const IDE = ['edit_file', 'run_command', 'git_status', 'git_diff', 'git_commit', 'git_push'];
const REPORT = 'Final report: src/a.ts changed; the commit is still open.';

/** A run that changed code and has not shipped it: the ship gate holds for any prose answer. */
function changedRun(): BrainRunContext {
  const c = makeCell();
  c.codeChanged = true;
  c.touchedFiles = ['src/a.ts'];
  c.trace = [{ ts: '', category: 'tool', label: 'edit_file', args: { path: 'src/a.ts' } }];
  return {
    c,
    req: { runTool: async () => ({ data: null }) },
    canAskUser: false,
    catalogToolNames: IDE,
    userRequest: 'fix the deep link',
    priorReply: null,
    publishHold: null,
    shipPolicy: DEFAULT_SHIP_POLICY,
    shipRecoveryUsed: false,
    reviewRecoveryUsed: false,
    delegationRecoveryUsed: false,
    restateRecoveryUsed: false,
    pendingNarrationRecoveryUsed: false,
    finishSkipNoted: false,
    stopHookRounds: 0,
    pending: new PendingCalls(),
    pipeline: null,
    progress: new RunProgressGuard(true, true),
  } as unknown as BrainRunContext;
}

const skipSteps = (run: BrainRunContext) => run.c.trace.filter((s) => s.label === FINISH_SKIPS_GATES_LABEL);

describe('regression: chat #128305 — a finishing run is never sent back by a delivery gate', () => {
  it('control: a run that is not finishing owes the ship gate, and re-stating it marks the answer as sent back', async () => {
    const run = changedRun();
    const last: LastTurn = { step: 21 };
    const rungs = await brainDeliveryLedger(run, last).rungs({ content: REPORT });
    const ship = rungs.find((r) => r.id === 'brain.ship');
    expect(ship?.applies).toBe(true);
    ship?.onRestate?.(1);
    expect(last.sentBackAnswer).toEqual({ step: 21 });
    expect(skipSteps(run)).toEqual([]);
  });

  it('regression: a finishing run is asked no gate, and leaves ONE trace step naming the gates it skipped', async () => {
    const run = changedRun();
    run.progress.enterFinish();
    const last: LastTurn = { step: 21 };
    const ledger = brainDeliveryLedger(run, last);
    expect(await ledger.rungs({ content: REPORT })).toEqual([]);
    expect(await ledger.rungs({ content: REPORT })).toEqual([]);
    const steps = skipSteps(run);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.args).toMatchObject({ step: 21, gates: ['brain.ship'], files: ['src/a.ts'] });
    expect(last.sentBackAnswer).toBeUndefined();
  });

  it('regression: the FINAL no-tools turn (which the ladder never judges) leaves the step through `finalAccepted`', async () => {
    const run = changedRun();
    run.progress.enterFinish();
    const ledger = brainDeliveryLedger(run, { step: 21 });
    await ledger.finalAccepted?.({ step: 21, content: REPORT });
    expect(skipSteps(run)).toHaveLength(1);
    expect(skipSteps(run)[0]!.args).toMatchObject({ step: 21, gates: ['brain.ship'] });
  });

  it('`finalAccepted` on a run that is not finishing leaves no step', async () => {
    const run = changedRun();
    await brainDeliveryLedger(run, { step: 21 }).finalAccepted?.({ step: 21, content: REPORT });
    expect(skipSteps(run)).toEqual([]);
  });

  it('a workspace stop hook that would have held the run is named among the skipped gates', async () => {
    const run = changedRun();
    (run.req as { onStop?: unknown }).onStop = async () => 'Update the README.';
    run.progress.enterFinish();
    await brainDeliveryLedger(run, { step: 21 }).finalAccepted?.({ step: 21, content: REPORT });
    expect(skipSteps(run)[0]!.args).toMatchObject({ gates: ['brain.stop_hook', 'brain.ship'] });
  });

  it('a finishing run whose answer no gate would hold leaves no step', async () => {
    const run = changedRun();
    run.shipPolicy = shipPolicyOf('leave_uncommitted', 'project_settings');
    run.progress.enterFinish();
    expect(await brainDeliveryLedger(run, { step: 3 }).rungs({ content: REPORT })).toEqual([]);
    expect(skipSteps(run)).toEqual([]);
  });
});
