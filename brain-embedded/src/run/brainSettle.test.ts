import { describe, expect, it } from 'vitest';
import type { RunOutcome, RunState } from '@builderforce/agent-run';
import { StreamInterruptedError } from '../streamChatCompletion';
import type { BrainRunContext } from '../runStore/brainRunContext';
import { makeCell } from '../runStore/runCell';
import { settleBrainRun } from './brainSettle';
import type { LastTurn } from './brainTurn';

// VS Code chat #128305: the ship gate sent a complete final report back, the re-prompt (no tools on offer) ended in an xAI
// doom-loop StreamInterruptedError, and the run settled as an ERROR although its answer already existed.

const KEPT = 'loop.reprompt_failed_answer_kept';
const failed: RunOutcome = { kind: 'failed', reason: 'stream interrupted', state: {} as RunState };

function runCtx(activity: unknown[] = []): BrainRunContext {
  return { c: makeCell(), chatId: 'chat', req: { onActivity: (id: unknown) => activity.push(id) }, policy: { model: 'xai-oauth/grok-4.7' } } as unknown as BrainRunContext;
}

const doomLoop = () => new StreamInterruptedError('stream ended (xAI doom-loop check: tail_repetition:64@response)', 'xai-oauth/grok-4.7');

describe('regression: chat #128305 — a failed re-prompt never destroys the answer it was sent back from', () => {
  it('regression: a gate re-prompt that fails with StreamInterruptedError settles quietly on the sent-back answer, with a trace step', async () => {
    const activity: unknown[] = [];
    const run = runCtx(activity);
    const last: LastTurn = { step: 22, error: doomLoop(), sentBackAnswer: { step: 21 } };
    await expect(settleBrainRun(run, failed, last)).resolves.toBeUndefined();
    // It settles as a reply does: the host is told the chat had activity.
    expect(activity).toEqual(['chat']);
    const step = run.c.trace.find((s) => s.label === KEPT);
    expect(step?.args).toMatchObject({ model: 'xai-oauth/grok-4.7', step: 22 });
    expect(step?.result).toMatch(/failed on xai-oauth\/grok-4\.7 \(stream ended/);
    // The answer was saved when it was sent back: settling never writes it a second time.
    expect(run.c.transcript).toEqual([]);
  });

  it('a provider failure with no answer sent back still fails the run with the error as thrown', async () => {
    const error = doomLoop();
    await expect(settleBrainRun(runCtx(), failed, { step: 22, error })).rejects.toBe(error);
  });

  it('a non-provider failure after a sent-back answer still throws', async () => {
    const run = runCtx();
    const error = new Error('a bug');
    await expect(settleBrainRun(run, failed, { step: 22, error, sentBackAnswer: { step: 21 } })).rejects.toBe(error);
    expect(run.c.trace.some((s) => s.label === KEPT)).toBe(false);
  });
});
