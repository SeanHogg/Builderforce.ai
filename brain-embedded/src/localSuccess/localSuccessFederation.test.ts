import { describe, expect, it, vi } from 'vitest';
import type { LocalSuccessOutcome } from '@seanhogg/builderforce-memory-engine';
import { createLocalSuccessRouter, type LocalSuccessRouter, type LocalSuccessSnapshot, type LocalSuccessStore } from './localSuccessRouter';
import {
  LOCAL_SUCCESS_PARAMS,
  createLocalSuccessFederation,
  localSuccessScope,
  type LocalSuccessContribution,
  type LocalSuccessFederation,
  type LocalSuccessFleetHead,
  type LocalSuccessScope,
} from './localSuccessFederation';
import type { TurnFeaturesBase } from './turnFeatures';

/**
 * The `run.local-success` head federates. Load-bearing:
 *  - only a turn lent a scope (signed-in Hybrid with a project) ever pulls or pushes;
 *  - a push follows an improving refit and is throttled (new outcomes AND an hour);
 *  - the contribution is the engine's head delta (`ml:run.local-success`) against the
 *    pulled base, plus held-out rows the coordinator's merge gate scores on;
 *  - a cold device adopts the fleet head and acts on it; a better local head keeps serving;
 *  - a refused push re-pulls the base on the next federated turn.
 */

const REF = 'local/ollama/gemma:2b';
const PROJECT = 7;
const small: TurnFeaturesBase = { promptTokens: 40, contextTokens: 200, servedContextTokens: 8192, tools: 0, turnIndex: 0, attachments: 0, codeHeavy: false };
const huge: TurnFeaturesBase = { promptTokens: 6000, contextTokens: 30_000, servedContextTokens: 8192, tools: 12, turnIndex: 9, attachments: 0, codeHeavy: true };
/** A trusted fleet head that says every turn FAILS locally (biases 3 / -3). */
const failsFleet: LocalSuccessFleetHead = { version: 3, params: [...Array<number>(LOCAL_SUCCESS_PARAMS - 2).fill(0), 3, -3], evalLoss: 0.1 };

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

function fakeFederation(pulled: LocalSuccessFleetHead | null = null, push: (c: LocalSuccessContribution) => Promise<void> = async () => undefined) {
  const pushes: LocalSuccessContribution[] = [];
  const federation: LocalSuccessFederation = {
    push: vi.fn(async (_projectId: number, c: LocalSuccessContribution) => {
      pushes.push(c);
      await push(c);
    }),
    pull: vi.fn(async () => pulled),
  };
  return { federation, pushes, scope: { federation, projectId: PROJECT } satisfies LocalSuccessScope };
}

async function teach(router: LocalSuccessRouter, rounds: number, scope?: LocalSuccessScope): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    const ok = await router.assess(REF, small, scope);
    await router.record(REF, { turn: ok.turn, local: 'succeeded' }, scope);
    const bad = await router.assess(REF, huge, scope);
    const outcome: LocalSuccessOutcome = { turn: bad.turn, local: 'failed', fellBack: true, cloud: 'succeeded' };
    await router.record(REF, outcome, scope);
  }
}

describe('run.local-success federation — the router', () => {
  it('without a scope nothing is pulled or pushed, however much it learns', async () => {
    const { federation, scope } = fakeFederation();
    const router = createLocalSuccessRouter(memoryStore(), { random: () => 0.5 });
    await teach(router, 15);
    expect(federation.pull).not.toHaveBeenCalled();
    expect(federation.push).not.toHaveBeenCalled();
    expect(scope.projectId).toBe(PROJECT);
  });

  it('pushes the head delta after an improving refit, against the pulled base, at most once per throttle window', async () => {
    const { federation, pushes, scope } = fakeFederation(null);
    const t = 1_000_000_000;
    const store = memoryStore();
    const router = createLocalSuccessRouter(store, { random: () => 0.5, now: () => t });
    await teach(router, 20, scope);

    expect(federation.pull).toHaveBeenCalledTimes(1);
    expect(federation.pull).toHaveBeenCalledWith(PROJECT);
    // The coordinator had nothing merged: the base is the all-zero head, version 0.
    expect(store.saved?.fleet).toMatchObject({ projectId: PROJECT, version: 0 });
    // The clock never moved: one push however many refits improved.
    expect(pushes).toHaveLength(1);
    const [c] = pushes;
    expect(c).toMatchObject({ target: 'ml:run.local-success', baseVersion: 0 });
    expect(typeof c!.diff).toBe('string');
    expect(c!.weight).toBeGreaterThanOrEqual(20);
    expect(c!.holdout.length).toBeGreaterThan(0);
    for (const row of c!.holdout) {
      expect(row.x).toHaveLength(9);
      expect([0, 1]).toContain(row.y);
    }
    expect(store.saved?.pushedAt).toBe(t);
  });

  it('a cold device adopts the fleet head as its starting point and acts on it', async () => {
    const { federation, scope } = fakeFederation(failsFleet);
    const store = memoryStore();
    const router = createLocalSuccessRouter(store, { random: () => 0.5 });
    // The pull runs off the turn: the first assessment is still the cold start.
    expect(await router.assess(REF, huge, scope)).toMatchObject({ skip: false, probability: null });
    await vi.waitFor(() => expect(store.saved?.fleet?.version).toBe(3));
    const verdict = await router.assess(REF, huge, scope);
    expect(verdict.probability).not.toBeNull();
    expect(verdict.probability!).toBeLessThan(0.05);
    expect(verdict.skip).toBe(true);
    expect(store.saved?.head?.params).toEqual(failsFleet.params);
    // Fresh for an hour: the next federated turn does not pull again.
    expect(federation.pull).toHaveBeenCalledTimes(1);
  });

  it('a better local head keeps serving; the fleet head still becomes the base', async () => {
    const store = memoryStore();
    const router = createLocalSuccessRouter(store, { random: () => 0.5 });
    await teach(router, 10);
    const local = store.saved!.head!;
    expect(local.holdoutLoss!).toBeLessThan(0.69);

    const { scope } = fakeFederation({ version: 2, params: Array<number>(LOCAL_SUCCESS_PARAMS).fill(0), evalLoss: 0.69 });
    await router.assess(REF, small, scope);
    await vi.waitFor(() => expect(store.saved?.fleet?.version).toBe(2));
    expect(store.saved?.head?.params).toEqual(local.params);
  });

  it('a refused push (a stale base) re-pulls the fleet head on the next federated turn', async () => {
    const { federation, pushes, scope } = fakeFederation(null, async () => {
      throw new Error('stale base — rebase against current head');
    });
    const router = createLocalSuccessRouter(memoryStore(), { random: () => 0.5, now: () => 1_000_000_000 });
    await teach(router, 20, scope);
    expect(pushes).toHaveLength(1);
    await router.assess(REF, small, scope);
    await vi.waitFor(() => expect(federation.pull).toHaveBeenCalledTimes(2));
  });
});

describe('run.local-success federation — scope and transport', () => {
  it('scopes a turn to its own project, else the port default, else not at all', async () => {
    const { federation } = fakeFederation();
    expect(await localSuccessScope(undefined, 4)).toBeUndefined();
    expect(await localSuccessScope(federation, 4)).toEqual({ federation, projectId: 4 });
    expect(await localSuccessScope(federation, undefined)).toBeUndefined();
    const withDefault = { ...federation, project: () => 9 };
    expect(await localSuccessScope(withDefault, null)).toEqual({ federation: withDefault, projectId: 9 });
    const broken = { ...federation, project: () => Promise.reject(new Error('settings unreadable')) };
    expect(await localSuccessScope(broken, null)).toBeUndefined();
  });

  it('speaks the project Evermind routes: the delta door and the head read', async () => {
    const request = vi.fn(async (path: string) => (path.includes('/ml-head') ? { version: 4, params: failsFleet.params, evalLoss: 0.2 } : { ok: true })) as unknown as Parameters<typeof createLocalSuccessFederation>[0];
    const federation = createLocalSuccessFederation(request);
    const contribution: LocalSuccessContribution = { diff: 'AAAA', baseVersion: 0, target: 'ml:run.local-success', holdout: [] };
    await federation.push(12, contribution);
    expect(request).toHaveBeenCalledWith('/api/projects/12/evermind/learn', expect.objectContaining({ method: 'POST', body: JSON.stringify(contribution) }));
    expect(await federation.pull(12)).toEqual({ version: 4, params: failsFleet.params, evalLoss: 0.2 });
    expect(request).toHaveBeenCalledWith('/api/projects/12/evermind/ml-head?target=ml%3Arun.local-success');
  });

  it('reads a never-merged or malformed head as none', async () => {
    for (const answer of [{ version: 0, params: null, evalLoss: null }, { version: 2, params: [1, 2] }, null]) {
      const federation = createLocalSuccessFederation((async () => answer) as unknown as Parameters<typeof createLocalSuccessFederation>[0]);
      expect(await federation.pull(1)).toBeNull();
    }
  });
});
