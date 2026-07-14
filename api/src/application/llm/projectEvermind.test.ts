import { describe, expect, it, vi } from 'vitest';
import {
  projectEvermindBase,
  projectEvermindRef,
  coordinatorName,
  getProjectEvermindHead,
  resolveProjectEvermindModelPin,
  resolveProjectInferenceModel,
  setProjectEvermindInference,
  recordEvermindServeOutcome,
  computeProjectAffect,
  extractMemoriesToEvermind,
  QUARANTINE_FAILURE_STREAK,
  PROJECT_EVERMIND_MODEL_PREFIX,
  type ProjectEvermindRecentEntry,
  type EvermindServeReadiness,
} from './projectEvermind';
import type { Env } from '../../env';

/** db mock: `.select().from().where().limit()` resolves to the configured row. */
function makeDb(row: Record<string, unknown> | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
  } as never;
}

/** db mock that also supports the update chain (`.set().where()[.returning()]`),
 *  recording each `.set()` payload and returning queued `.returning()` result sets
 *  in order. `where()` is awaitable AND exposes `.returning()`. */
function updatableDb(row: Record<string, unknown> | null, returningQueue: Array<Array<Record<string, unknown>>> = []) {
  const setCalls: Array<Record<string, unknown>> = [];
  let ri = 0;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (row ? [row] : []) }) }) }),
    update: () => {
      const chain = {
        set: (values: Record<string, unknown>) => { setCalls.push(values); return chain; },
        where: () => {
          const rows = returningQueue[ri++] ?? [];
          const thenable = Promise.resolve(rows) as Promise<unknown> & { returning: () => Promise<unknown> };
          thenable.returning = async () => rows;
          return thenable;
        },
      };
      return chain;
    },
  } as never;
  return { db, setCalls };
}

// No AUTH_CACHE_KV → getCacheVersion/getOrSetCached fall through to the loader.
const env = {} as Env;

describe('project Evermind R2 layout helpers', () => {
  it('builds a stable base path and immutable per-version ref', () => {
    expect(projectEvermindBase(7, 42)).toBe('evermind/project/7/42');
    expect(projectEvermindRef(7, 42, 3)).toBe('evermind/project/7/42/v3');
  });
  it('names the coordinator DO deterministically per project', () => {
    expect(coordinatorName(7, 42)).toBe('proj:7:42');
  });
});

describe('extractMemoriesToEvermind', () => {
  const entries = [
    { key: 'a', text: 'too short' },
    { key: 'b', text: 'This is a durable fact long enough to be learnable by the model.' },
  ];

  it('rejects an unseeded Evermind (nothing to learn into)', async () => {
    const out = await extractMemoriesToEvermind(env, makeDb(null), 7, 42, entries);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
  });

  it('rejects a frozen Evermind', async () => {
    const db = makeDb({ name: 'PM', version: 2, mode: 'offline-frozen', contributions: 1 });
    const out = await extractMemoriesToEvermind(env, db, 7, 42, entries);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(400);
  });

  it('skips too-short entries and reports per-key outcomes (no coordinator bound → no absorb)', async () => {
    const db = makeDb({ name: 'PM', version: 1, mode: 'connected', contributions: 0 });
    const out = await extractMemoriesToEvermind(env, db, 7, 42, entries);
    expect(out.ok).toBe(true);
    if (out.ok) {
      // 'a' is below the 20-char floor; 'b' attempts dispatch but no DO binding exists in
      // the test env, so it is reported skipped rather than silently absorbed.
      expect(out.result.absorbed).toEqual([]);
      expect(out.result.skipped.map((s) => s.key).sort()).toEqual(['a', 'b']);
      expect(out.result.skipped.find((s) => s.key === 'a')?.reason).toMatch(/short/i);
      expect(out.result.merged).toBe(0);
      expect(out.result.version).toBe(1);
    }
  });
});

describe('getProjectEvermindHead', () => {
  it('returns an unseeded head when no row exists', async () => {
    const head = await getProjectEvermindHead(env, makeDb(null), 7, 42);
    expect(head.version).toBe(0);
    expect(head.ref).toBeNull();
    expect(head.mode).toBe('connected');
    expect(head.version > 0).toBe(false);
  });

  it('resolves the current version to an immutable ref when seeded', async () => {
    const head = await getProjectEvermindHead(
      env,
      makeDb({ name: 'PM', version: 3, mode: 'connected', contributions: 5 }),
      7,
      42,
    );
    expect(head.version).toBe(3);
    expect(head.ref).toBe('evermind/project/7/42/v3');
    expect(head.contributions).toBe(5);
  });

  it('treats a version-0 row as unseeded (ref null)', async () => {
    const head = await getProjectEvermindHead(env, makeDb({ name: 'PM', version: 0, mode: 'connected', contributions: 0 }), 7, 42);
    expect(head.version).toBe(0);
    expect(head.ref).toBeNull();
  });
});

describe('resolveProjectEvermindModelPin (pull-on-boundary)', () => {
  it('expands a project pin to the current evermind/<ref> when inference is opted in', async () => {
    const out = await resolveProjectEvermindModelPin(
      env,
      makeDb({ name: 'PM', version: 4, mode: 'connected', contributions: 0, inferenceEnabled: true }),
      7,
      `${PROJECT_EVERMIND_MODEL_PREFIX}42`,
    );
    expect(out.matched).toBe(true);
    expect(out.model).toBe('evermind/evermind/project/7/42/v4');
  });

  it('returns undefined for a seeded project with inference DISABLED (opt-in enforced server-side)', async () => {
    const out = await resolveProjectEvermindModelPin(
      env,
      makeDb({ name: 'PM', version: 4, mode: 'connected', contributions: 0, inferenceEnabled: false }),
      7,
      `${PROJECT_EVERMIND_MODEL_PREFIX}42`,
    );
    expect(out.matched).toBe(true);
    expect(out.model).toBeUndefined();
  });

  it('passes through a non-project model unchanged', async () => {
    const out = await resolveProjectEvermindModelPin(env, makeDb(null), 7, 'claude-opus-4-8');
    expect(out.matched).toBe(false);
    expect(out.model).toBe('claude-opus-4-8');
  });

  it('returns undefined for an unseeded project (falls back to plan default)', async () => {
    const out = await resolveProjectEvermindModelPin(env, makeDb(null), 7, `${PROJECT_EVERMIND_MODEL_PREFIX}42`);
    expect(out.matched).toBe(true);
    expect(out.model).toBeUndefined();
  });

  it('returns undefined for a malformed project id', async () => {
    const out = await resolveProjectEvermindModelPin(env, makeDb(null), 7, `${PROJECT_EVERMIND_MODEL_PREFIX}abc`);
    expect(out.matched).toBe(true);
    expect(out.model).toBeUndefined();
  });
});

describe('resolveProjectInferenceModel (opt-in consumer emitter)', () => {
  it('emits the current evermind/<ref> when inference is enabled AND seeded', async () => {
    const out = await resolveProjectInferenceModel(
      env,
      makeDb({ name: 'PM', version: 4, mode: 'connected', contributions: 0, inferenceEnabled: true }),
      7,
      42,
    );
    expect(out).toBe('evermind/evermind/project/7/42/v4');
  });

  it('stays undefined when inference is enabled but the model is not seeded', async () => {
    const out = await resolveProjectInferenceModel(
      env,
      makeDb({ name: 'PM', version: 0, mode: 'connected', contributions: 0, inferenceEnabled: true }),
      7,
      42,
    );
    expect(out).toBeUndefined();
  });

  it('stays undefined when a seeded model has inference disabled (default behaviour)', async () => {
    const out = await resolveProjectInferenceModel(
      env,
      makeDb({ name: 'PM', version: 4, mode: 'connected', contributions: 0, inferenceEnabled: false }),
      7,
      42,
    );
    expect(out).toBeUndefined();
  });

  it('stays undefined for a malformed project id', async () => {
    const out = await resolveProjectInferenceModel(env, makeDb(null), 7, 0);
    expect(out).toBeUndefined();
  });
});

describe('setProjectEvermindInference (benchmark-gated promotion)', () => {
  const ready: EvermindServeReadiness = { ready: true, passRate: 1, samples: [] };
  const notReady: EvermindServeReadiness = {
    ready: false, passRate: 0,
    samples: [{ prompt: 'Summarize the status.', text: 'commit commit commit the the in the in the', coherent: false }],
  };

  it('REFUSES to enable a head that fails the coherence probe (no DB write)', async () => {
    const { db, setCalls } = updatableDb({ name: 'PM', version: 100, mode: 'connected', contributions: 1, inferenceEnabled: false });
    const assessReadiness = vi.fn(async () => notReady);
    const res = await setProjectEvermindInference(env, db, 7, 30, true, { assessReadiness });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('not_ready');
      expect(res.readiness.passRate).toBe(0);
    }
    expect(assessReadiness).toHaveBeenCalledWith('evermind/project/7/30/v100');
    expect(setCalls).toHaveLength(0); // never promoted
  });

  it('enables a head that PASSES the probe and clears the quarantine slate', async () => {
    const { db, setCalls } = updatableDb({ name: 'PM', version: 5, mode: 'connected', contributions: 1, inferenceEnabled: false });
    const res = await setProjectEvermindInference(env, db, 7, 42, true, { assessReadiness: async () => ready });
    expect(res.ok).toBe(true);
    expect(setCalls[0]).toMatchObject({ inferenceEnabled: true, serveFailureStreak: 0, quarantinedAt: null, quarantineReason: null });
  });

  it('disabling is never gated and needs no probe', async () => {
    const { db, setCalls } = updatableDb({ name: 'PM', version: 5, mode: 'connected', contributions: 1, inferenceEnabled: true });
    const assessReadiness = vi.fn(async () => notReady);
    const res = await setProjectEvermindInference(env, db, 7, 42, false, { assessReadiness });
    expect(res.ok).toBe(true);
    expect(assessReadiness).not.toHaveBeenCalled();
    expect(setCalls[0]).toMatchObject({ inferenceEnabled: false });
  });
});

describe('recordEvermindServeOutcome (auto-quarantine)', () => {
  it('force-disables inference after the failure streak reaches the threshold', async () => {
    // The incoherent increment returns the NEW streak = threshold → triggers quarantine.
    const { db, setCalls } = updatableDb(null, [[{ streak: QUARANTINE_FAILURE_STREAK }]]);
    await recordEvermindServeOutcome(env, db, 7, 30, false);
    // 1st set = increment; 2nd set = the quarantine disable.
    expect(setCalls).toHaveLength(2);
    expect(setCalls[1]).toMatchObject({ inferenceEnabled: false });
    expect(setCalls[1]?.quarantineReason).toMatch(/quarantine/i);
    expect(setCalls[1]?.quarantinedAt).toBeInstanceOf(Date);
  });

  it('increments but does NOT quarantine below the threshold', async () => {
    const { db, setCalls } = updatableDb(null, [[{ streak: QUARANTINE_FAILURE_STREAK - 1 }]]);
    await recordEvermindServeOutcome(env, db, 7, 30, false);
    expect(setCalls).toHaveLength(1); // only the increment, no disable
  });

  it('a coherent serve resets the streak (single conditional write)', async () => {
    const { db, setCalls } = updatableDb(null, [[{ id: 'x' }]]); // where(streak<>0) matched a row
    await recordEvermindServeOutcome(env, db, 7, 30, true);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toMatchObject({ serveFailureStreak: 0 });
  });

  it('ignores a malformed project id', async () => {
    const { db, setCalls } = updatableDb(null, []);
    await recordEvermindServeOutcome(env, db, 7, 0, false);
    expect(setCalls).toHaveLength(0);
  });
});

describe('computeProjectAffect (limbic state for the brain map)', () => {
  const entry = (over: Partial<ProjectEvermindRecentEntry>): ProjectEvermindRecentEntry => ({
    id: 1, kind: 'delta', version: 1, at: 1000, weight: 1, ...over,
  });

  it('returns the neutral resting setpoints when there is no activity', () => {
    const a = computeProjectAffect([]);
    // No project personality → neutral setpoints (mirrors deriveLimbicSetpoints(undefined)).
    expect(a.setpoints.driveEffort).toBeCloseTo(0.8, 5);
    expect(a.setpoints.attention).toBeCloseTo(0.7, 5);
    // With no events the current state equals the setpoints.
    expect(a.state.valence).toBeCloseTo(a.setpoints.valence, 5);
    expect(a.attentionGain).toBeGreaterThan(0);
    expect(a.exploreBias).toBeGreaterThanOrEqual(0);
    expect(a.exploreBias).toBeLessThanOrEqual(1);
  });

  it('raises caution/arousal when recent tasks read as risky', () => {
    const base = computeProjectAffect([entry({ at: 1, prompt: 'summarize the config' })]);
    const risky = computeProjectAffect([entry({ at: 1, prompt: 'delete all production data and drop the table' })]);
    // The shared amygdala/thalamus appraisal lifts caution + arousal for a risky prompt.
    expect(risky.state.driveCaution).toBeGreaterThan(base.state.driveCaution);
    expect(risky.state.arousal).toBeGreaterThan(base.state.arousal);
  });

  it('shifts the resting setpoints when a project resting profile is supplied', () => {
    const neutral = computeProjectAffect([]);
    // A high-openness aggregate temperament must lift the curiosity/exploration
    // setpoints above the neutral baseline (P4: per-project resting temperament).
    const curious = computeProjectAffect([], { vector: { 'hexaco.openness': 100 } });
    expect(curious.setpoints.driveCuriosity).toBeGreaterThan(neutral.setpoints.driveCuriosity);
    expect(curious.setpoints.exploration).toBeGreaterThan(neutral.setpoints.exploration);
    // With no activity the state rests AT those non-neutral setpoints.
    expect(curious.state.driveCuriosity).toBeCloseTo(curious.setpoints.driveCuriosity, 5);
  });

  it('keeps every affective dim within its bounds', () => {
    const a = computeProjectAffect([
      entry({ at: 1, weight: 3, prompt: 'risky migration with rm -rf' }),
      entry({ at: 2, kind: 'text', weight: 2, prompt: 'a hard, complex refactor' }),
      entry({ at: 3, weight: 1 }),
    ]);
    expect(a.state.valence).toBeGreaterThanOrEqual(-1);
    expect(a.state.valence).toBeLessThanOrEqual(1);
    for (const k of ['arousal', 'driveCuriosity', 'driveCaution', 'driveEffort', 'driveSocial', 'attention', 'exploration'] as const) {
      expect(a.state[k]).toBeGreaterThanOrEqual(0);
      expect(a.state[k]).toBeLessThanOrEqual(1);
    }
  });
});
