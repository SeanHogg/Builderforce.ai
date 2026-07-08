import { describe, expect, it } from 'vitest';
import {
  projectEvermindBase,
  projectEvermindRef,
  coordinatorName,
  getProjectEvermindHead,
  resolveProjectEvermindModelPin,
  resolveProjectInferenceModel,
  computeProjectAffect,
  PROJECT_EVERMIND_MODEL_PREFIX,
  type ProjectEvermindRecentEntry,
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

describe('computeProjectAffect (limbic state for the brain map)', () => {
  const entry = (over: Partial<ProjectEvermindRecentEntry>): ProjectEvermindRecentEntry => ({
    kind: 'delta', version: 1, at: 1000, weight: 1, ...over,
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
