import { describe, expect, it } from 'vitest';
import type { LocalSuccessOutcome } from '@seanhogg/builderforce-memory-engine';
import { createLocalSuccessRouter, type LocalSuccessSnapshot, type LocalSuccessStore } from './localSuccessRouter';
import type { TurnFeaturesBase } from './turnFeatures';

/**
 * The predictor Hybrid consults before a local attempt. Load-bearing:
 *  - cold start (no history, or too little) NEVER skips — today's behaviour;
 *  - it trains on recorded outcomes with the engine's task and labels, and acts only once
 *    the head beats a coin on its held-out tail;
 *  - the trained head round-trips through the host's store port.
 */

const REF = 'local/ollama/gemma:2b';
const small: TurnFeaturesBase = { promptTokens: 40, contextTokens: 200, servedContextTokens: 8192, tools: 0, turnIndex: 0, attachments: 0, codeHeavy: false };
const huge: TurnFeaturesBase = { promptTokens: 6000, contextTokens: 30_000, servedContextTokens: 8192, tools: 12, turnIndex: 9, attachments: 0, codeHeavy: true };

function memoryStore(initial?: unknown): LocalSuccessStore & { saved: LocalSuccessSnapshot | undefined } {
  const s: LocalSuccessStore & { saved: LocalSuccessSnapshot | undefined } = {
    saved: undefined,
    load: () => initial,
    save: (snapshot) => {
      s.saved = snapshot;
    },
  };
  return s;
}

/** Record a history where small turns succeed locally and huge ones fall back to the cloud. */
async function teach(router: ReturnType<typeof createLocalSuccessRouter>, rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const ok = await router.assess(REF, small);
    await router.record(REF, { turn: ok.turn, local: 'succeeded' });
    const bad = await router.assess(REF, huge);
    const outcome: LocalSuccessOutcome = { turn: bad.turn, local: 'failed', fellBack: true, cloud: 'succeeded' };
    await router.record(REF, outcome);
  }
}

describe('createLocalSuccessRouter', () => {
  it('cold start: never skips, and says it has no prediction', async () => {
    const router = createLocalSuccessRouter(memoryStore());
    expect(await router.assess(REF, huge)).toMatchObject({ skip: false, probability: null });
  });

  it('stays untrained below the task\'s minSamples', async () => {
    const store = memoryStore();
    const router = createLocalSuccessRouter(store, { random: () => 0.5 });
    await teach(router, 3);
    expect(store.saved?.head).toBeUndefined();
    expect((await router.assess(REF, huge)).skip).toBe(false);
  });

  it('learns from local AND cloud outcomes: skips the turn shape that keeps falling back, keeps the one that succeeds', async () => {
    const store = memoryStore();
    const router = createLocalSuccessRouter(store, { random: () => 0.5 });
    await teach(router, 10);

    const bad = await router.assess(REF, huge);
    const ok = await router.assess(REF, small);
    expect(bad.probability).not.toBeNull();
    expect(bad.probability!).toBeLessThan(0.2);
    expect(bad.skip).toBe(true);
    expect(ok.skip).toBe(false);
    // The prior is this model's own observed local success rate.
    expect(ok.turn.priorLocalSuccessRate).toBeCloseTo(0.5);
    expect(store.saved?.outcomes).toHaveLength(20);
    expect(store.saved?.head?.params).toHaveLength(20);
  });

  it('still tries local on the exploration share of the turns it would skip', async () => {
    const router = createLocalSuccessRouter(memoryStore(), { random: () => 0.05 });
    await teach(router, 10);
    expect((await router.assess(REF, huge)).skip).toBe(false);
  });

  it('a host that reloads the stored snapshot answers from the persisted head', async () => {
    const store = memoryStore();
    await teach(createLocalSuccessRouter(store, { random: () => 0.5 }), 10);

    const reloaded = createLocalSuccessRouter(memoryStore(JSON.parse(JSON.stringify(store.saved))), { random: () => 0.5 });
    expect((await reloaded.assess(REF, huge)).skip).toBe(true);
  });

  it('reads a malformed or foreign snapshot as a cold start', async () => {
    for (const raw of [null, 'x', { v: 2 }, { v: 1, outcomes: 'nope', head: { params: [1, 2] } }]) {
      const router = createLocalSuccessRouter(memoryStore(raw));
      expect(await router.assess(REF, huge)).toMatchObject({ skip: false, probability: null });
    }
  });
});
