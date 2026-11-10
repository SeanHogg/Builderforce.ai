/**
 * PRD 45 §4.7 B8 / PRD 46 F8 — the "Tools advertised" number, driven through its PRODUCER.
 *
 * `toolExposure.test.ts` feeds synthetic `llm` events, so it never proved that the loop's own
 * turn recorder writes what each turn was really offered. Chat #70776 reported "Tools advertised: 1"
 * — real, but only for the forced `hand_off` turn, which advertises that one tool. Here the real
 * `recordTurn` records three turns (analysis on the full selection, the forced hand-off, the coder
 * on the full selection) from the turns' own tool specs, and the report's reader
 * (`toolExposureInTrace`) reads the run's trace back.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { recordTurn } from './turnRecorder';
import { getCell, runTrace } from './runCells';
import { resetBrainRunStore } from './runControl';
import { toolExposureInTrace } from '../toolExposure';
import type { BrainRunContext } from './brainRunContext';
import type { BrainToolSpec, StreamChatResult } from '../streamChatCompletion';

beforeEach(resetBrainRunStore);

const spec = (name: string): BrainToolSpec => ({ type: 'function', function: { name, description: name, parameters: {} } });

/** The whole registered catalog, and the per-turn selection a normal turn is handed. */
const CATALOG = Array.from({ length: 120 }, (_, i) => spec(`tool_${i}`));
const SELECTION = CATALOG.slice(0, 40);
const FORCED = [spec('hand_off')];

function fakeRun(chatId: number): BrainRunContext {
  return {
    c: getCell(chatId),
    chatId,
    allTools: CATALOG,
    windowFit: {},
    lastTurnInterruption: null,
  } as unknown as BrainRunContext;
}

async function turn(run: BrainRunContext, iter: number, advertised: readonly BrainToolSpec[], call: string): Promise<void> {
  const result: StreamChatResult = {
    text: '',
    toolCalls: [{ id: `c${iter}`, name: call, args: '{}' }],
    finishReason: 'tool_calls',
    resolvedModel: 'model-a',
  } as StreamChatResult;
  await recordTurn(run, {
    result,
    iter,
    llmStart: Date.now(),
    live: { firstTokenAt: () => undefined },
    role: iter === 3 ? 'code' : 'analysis',
    resolved: 'model-a',
    requested: 'model-a',
    advertised,
    advertisedNames: new Set(advertised.map((t) => t.function.name)),
  });
}

describe('turnRecorder → toolExposureInTrace (B8 producer)', () => {
  it('regression: the forced hand_off turn reads as the minimum, not the run (chat #70776 "Tools advertised: 1")', async () => {
    const run = fakeRun(70776);
    await turn(run, 1, SELECTION, 'tool_0');
    await turn(run, 2, FORCED, 'hand_off');
    await turn(run, 3, SELECTION, 'tool_1');

    const exposure = toolExposureInTrace(runTrace(run.c));
    // Each turn recorded what IT was offered, from its own specs.
    expect(exposure.min).toBe(1);
    expect(exposure.lastTurn).toBe(SELECTION.length);
    // The catalog is the run's whole registry, not a turn's selection.
    expect(exposure.catalog).toBe(CATALOG.length);
  });

  it('records one llm.complete step per turn carrying the advertised count', async () => {
    const run = fakeRun(70777);
    await turn(run, 1, FORCED, 'hand_off');
    const steps = runTrace(run.c).filter((e) => e.label === 'llm.complete');
    expect(steps).toHaveLength(1);
    expect((steps[0]!.args as { advertisedTools?: number }).advertisedTools).toBe(1);
  });
});
