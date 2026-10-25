import { beforeEach, describe, expect, it } from 'vitest';
import { priceBookFromPrices } from '@builderforce/model-catalog';
import { getRunTrace, resetBrainRunStore, startRun } from '../brainRunStore';
import { MODEL_PREFLIGHT_LABEL, modelPreflightEvent, planModelWarning } from './modelPreflight';

/**
 * PRD 35 E7 (§6.10): the preflight also says when the PLAN phase would land on a
 * Flash-class (non-agentic tier) model — answerable only for a model the run names
 * (a pin); an auto-routed run gets the BYO check alone.
 */
const TS = '2026-10-25T00:00:00.000Z';
const BOOK = priceBookFromPrices([
  ['acme/flash', { input: 1e-7, output: 4e-7 }],
  ['acme/sonnet', { input: 3e-6, output: 1.5e-5 }],
]);

describe('planModelWarning', () => {
  it('flags a pinned Flash-class model by its catalog tier', () => {
    expect(planModelWarning('acme/flash', BOOK)).toEqual({ model: 'acme/flash', tier: 'STANDARD' });
  });

  it('says nothing for an agentic tier, an auto-routed run, or an unpriced model', () => {
    expect(planModelWarning('acme/sonnet', BOOK)).toBeNull();
    expect(planModelWarning(undefined, BOOK)).toBeNull();
    expect(planModelWarning('default', BOOK)).toBeNull();
    expect(planModelWarning('local/qwen-7b', BOOK)).toBeNull();
  });

  it('is its own reason on the preflight step, with or without a BYO problem', () => {
    const alone = modelPreflightEvent({ byoUnresolved: [] }, TS, { model: 'acme/flash', tier: 'STANDARD' })!;
    expect(alone.label).toBe(MODEL_PREFLIGHT_LABEL);
    expect(alone.args).toEqual({ planModel: 'acme/flash', planTier: 'STANDARD' });
    expect(String(alone.result)).toContain('Flash-class');
    const both = modelPreflightEvent({ byoUnresolved: ['anthropic:expired'] }, TS, { model: 'acme/flash', tier: 'STANDARD' })!;
    expect(both.args).toMatchObject({ byoUnresolved: 'anthropic:expired', planModel: 'acme/flash' });
  });
});

describe('a run pinned to a Flash-class model', () => {
  beforeEach(resetBrainRunStore);
  const persistence = {
    sendMessages: async (chatId: number, msgs: Array<{ role: string; content: string }>) => msgs.map((m, i) => ({ id: 7800 + i, chatId, createdAt: '', ...m })),
  } as never;

  it('hears it before the first turn', async () => {
    let said = false;
    await startRun(4711, {
      resolvedSystemPrompt: 'sys',
      persistence,
      model: '~google/gemini-flash-latest',
      userTurn: 'plan the PRD update',
      modelPreflight: async () => ({ byoUnresolved: [] }),
      stream: async () => {
        said = getRunTrace(4711).some((e) => e.label === MODEL_PREFLIGHT_LABEL && (e.args as Record<string, unknown>).planModel === '~google/gemini-flash-latest');
        return { text: 'ok', toolCalls: [], finishReason: 'stop' };
      },
    });
    expect(said).toBe(true);
  });
});
