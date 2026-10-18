import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __clearL1CacheForTests } from '../../infrastructure/cache/readThroughCache';
import {
  projectEvermindBase,
  projectEvermindRef,
  coordinatorName,
  getProjectEvermindHead,
  resolveProjectEvermindModelPin,
  resolveProjectInferenceModel,
  resolveEffectiveEvermindProjectId,
  buildEvermindLessonsBlock,
  setProjectEvermindInference,
  recordEvermindServeOutcome,
  computeProjectAffect,
  extractMemoriesToEvermind,
  QUARANTINE_FAILURE_STREAK,
  reseedProjectEvermind,
  dispatchProjectEvermindLearnText,
  PROJECT_EVERMIND_MODEL_PREFIX,
  type ProjectEvermindRecentEntry,
  type EvermindServeReadiness,
} from './projectEvermind';
import type { Env } from '../../env';

// The read-through L1 is module-global. setupFiles clears one module instance;
// this file's graph can hold another, so clear the instance these tests use.
beforeEach(() => __clearL1CacheForTests());

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

/** db mock whose every `.select().from().where().limit()` returns the NEXT queued result set. */
function queueDb(queue: Array<Array<Record<string, unknown>>>) {
  let i = 0;
  return {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => queue[i++] ?? [] }) }) }),
  } as never;
}

describe('resolveEffectiveEvermindProjectId (the ONE "which Evermind is this project’s")', () => {
  const head = (version: number, over: Record<string, unknown> = {}) =>
    ({ name: 'PM', version, mode: 'connected', contributions: 0, inferenceEnabled: true, ...over });

  it('prefers the newest seeded Evermind build under a container over the container’s own head', async () => {
    const db = queueDb([
      [{ sid: 30, createdAt: '2026-09-01' }, { sid: 31, createdAt: '2026-09-10' }], // builds under 11
      [head(10217)],                                                                // newest (31) — seeded
    ]);
    expect(await resolveEffectiveEvermindProjectId(env, db, 7, 11)).toBe(31);
  });

  it('skips an unseeded build and falls back to the project’s own seeded head', async () => {
    const db = queueDb([[{ sid: 31, createdAt: '2026-09-10' }], [head(0)], [head(115)]]);
    expect(await resolveEffectiveEvermindProjectId(env, db, 7, 11)).toBe(11);
  });

  it('inherits the container’s Evermind for a build with none of its own', async () => {
    const db = queueDb([[], [head(0)], [{ cid: 9 }]]);
    expect(await resolveEffectiveEvermindProjectId(env, db, 7, 42)).toBe(9);
  });

  it('expands a container’s pin to its Evermind BUILD’s head', async () => {
    const db = queueDb([[{ sid: 30, createdAt: '2026-09-01' }], [head(4)], [head(4)]]);
    expect(await resolveProjectInferenceModel(env, db, 7, 11)).toBe('evermind/evermind/project/7/30/v4');
  });
});

/** Walk a drizzle `where` clause for bound numbers (tenant id, project id). */
function boundNumbers(node: unknown): number[] {
  const out: number[] = [];
  const seen = new Set<unknown>();
  const walk = (n: unknown, depth: number) => {
    if (typeof n === 'number' && Number.isFinite(n)) { out.push(n); return; }
    if (n == null || depth > 24 || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { for (const x of n) walk(x, depth + 1); return; }
    for (const v of Object.values(n as Record<string, unknown>)) walk(v, depth + 1);
  };
  walk(node, 0);
  return out;
}

/**
 * The container has no head of its own; its newest Evermind build (`buildId`) is
 * seeded at v10217. Head reads branch on the project id in the WHERE clause, so a
 * recall that forgets to resolve comes back unseeded.
 */
function containerWithSeededBuildDb(buildId: number) {
  return {
    select: (shape?: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: unknown) => {
          const run = async () => {
            if (shape && 'sid' in shape) return [{ sid: buildId, createdAt: '2026-09-10' }];
            if (shape && 'cid' in shape) return [];
            if (shape && 'psychometric' in shape) return [];
            const ids = boundNumbers(cond);
            if (ids.includes(buildId)) return [{ name: 'Build', version: 10217, mode: 'connected', contributions: 1, inferenceEnabled: true }];
            return [];
          };
          const thenable = run() as Promise<unknown[]> & { limit: () => Promise<unknown[]> };
          thenable.limit = () => run();
          return thenable;
        },
      }),
    }),
  } as never;
}

describe('buildEvermindLessonsBlock', () => {
  // Ids no other test in this file uses. getOrSetCached keeps an in-process map for
  // the process lifetime, so sharing tenant 7 / project 11 would poison those tests.
  const TENANT = 907;
  const CONTAINER = 9011;
  const BUILD = 9031;
  const LESSON = 'Cloud runs must recall the resolved Evermind build, not the container head.';

  it('recalls against the resolved Evermind build, not the raw container project id', async () => {
    const names: string[] = [];
    const envWithDo = {
      PROJECT_EVERMIND: {
        idFromName: (name: string) => { names.push(name); return name; },
        get: () => ({
          fetch: async (input: string) => {
            const url = String(input);
            if (url.includes('/recall')) {
              return { ok: true, json: async () => ({ method: 'embedding', matches: [{ id: 9, score: 0.99 }] }) };
            }
            if (url.includes('/recent')) {
              return {
                ok: true,
                json: async () => ({
                  recent: [{ id: 9, kind: 'text', version: 10217, at: 1, weight: 1, text: LESSON }],
                }),
              };
            }
            return { ok: false, json: async () => ({}) };
          },
        }),
      },
    } as unknown as Env;

    const block = await buildEvermindLessonsBlock(
      envWithDo,
      containerWithSeededBuildDb(BUILD),
      TENANT,
      CONTAINER,
      'resolved Evermind build',
    );
    expect(block).toContain(LESSON);
    expect(block).toContain('Prior lessons for this work');
    // The coordinator is named proj:<tenant>:<project>. Resolution must address the
    // build, never the container the cloud run was dispatched against.
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => n === `proj:${TENANT}:${BUILD}`)).toBe(true);
  });

  it('returns "" rather than throwing when the project has no resolvable head', async () => {
    await expect(buildEvermindLessonsBlock(env, queueDb([]), TENANT, 9042, 'anything learned')).resolves.toBe('');
  });

  it('returns "" rather than throwing when resolution fails', async () => {
    const db = { select: () => { throw new Error('db down'); } } as never;
    await expect(buildEvermindLessonsBlock(env, db, TENANT, 9043, 'anything learned')).resolves.toBe('');
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
    samples: [{
      prompt: 'Summarize the status.',
      text: 'commit commit commit the the in the in the',
      coherent: false,
      failure: 'repetition',
      detail: 'the decoder is stuck repeating the same word or phrase',
    }],
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
    // No project personality → neutral setpoints (mirrors limbicSetpoints(undefined)).
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

describe('reseedProjectEvermind (the repair door for a head trained into gibberish)', () => {
  /** A store that records what was written, so the version the bytes land under is checkable. */
  function writeStore() {
    const puts: string[] = [];
    return { store: { put: async (key: string) => { puts.push(key); } }, puts };
  }

  it('writes the new base at version+1 and clears quarantine, leaving inference OFF', async () => {
    // A quarantined v100 — the exact situation that previously had no remedy: seeding
    // refuses to clobber a seeded head, so the bad artifact was stuck there forever.
    const { db, setCalls } = updatableDb({
      name: 'PM', version: 100, mode: 'connected', contributions: 12,
      inferenceEnabled: false, quarantinedAt: new Date(), quarantineReason: 'gibberish',
    });
    const { store, puts } = writeStore();
    await reseedProjectEvermind(env, db, store, {
      tenantId: 7, projectId: 30,
      modelBlob: new ArrayBuffer(8),
      tokenizer: { vocab: { a: 0 }, merges: [] },
    });

    // NEW version, never an overwrite of v100 — refs are immutable and memoised per
    // isolate, so reusing a version would keep serving the old weights from cache.
    expect(puts).toEqual([
      'evermind/project/7/30/v101/model.evermind',
      'evermind/project/7/30/v101/tokenizer.json',
    ]);
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]).toMatchObject({
      version: 101,
      inferenceEnabled: false,   // must re-earn the right to serve
      serveFailureStreak: 0,
      quarantinedAt: null,
      quarantineReason: null,
    });
  });

  it('falls back to an ordinary seed when the project was never seeded', async () => {
    // version 0 → this is a first seed, not a replacement: it must land at v1 via the
    // one seeding implementation rather than a second, divergent code path.
    const { db } = updatableDb({ name: 'PM', version: 0, mode: 'connected', contributions: 0, inferenceEnabled: false }, [[{ id: 'x' }]]);
    const { store, puts } = writeStore();
    await reseedProjectEvermind(env, db, store, {
      tenantId: 7, projectId: 31,
      modelBlob: new ArrayBuffer(8),
      tokenizer: { vocab: { a: 0 }, merges: [] },
    });
    expect(puts[0]).toBe('evermind/project/7/31/v1/model.evermind');
  });
});

/**
 * The unified text producer is the ONE place every contribution passes through, so it
 * is where the "teach the answer, not the working-out" rule has to hold — the brain
 * chat, the incident learner and the analyzer's re-teach all inherit it from here.
 */
describe('dispatchProjectEvermindLearnText — what actually reaches the coordinator', () => {
  /** Captures the body posted to the coordinator DO. */
  function captureEnv() {
    const posted: Array<Record<string, unknown>> = [];
    const env = {
      PROJECT_EVERMIND: {
        idFromName: (n: string) => n,
        get: () => ({
          fetch: async (_url: string, init: { body: string }) => {
            posted.push(JSON.parse(init.body) as Record<string, unknown>);
            return { ok: true, status: 200, json: async () => ({ queued: true }) };
          },
        }),
      },
    } as unknown as Env;
    return { env, posted };
  }

  it('teaches the answer with the reasoning block removed', async () => {
    const { env, posted } = captureEnv();
    const res = await dispatchProjectEvermindLearnText(
      env, 7, 42,
      '<think>Let me check the git log before answering.</think> Both the API and the frontend are on main, and the fixes are deployed.',
    );
    expect(res.ok).toBe(true);
    expect(posted[0]?.['text']).toBe('Both the API and the frontend are on main, and the fixes are deployed.');
  });

  it('refuses a turn that was only scratchpad, and says so', async () => {
    // Long enough to clear the old length check, so before the strip this was learned
    // verbatim — deliberation taught as if it were the answer.
    const { env, posted } = captureEnv();
    const res = await dispatchProjectEvermindLearnText(
      env, 7, 42,
      '<think>The user is right - I should have deleted the branch and updated the ticket. Let me do both now.',
    );
    expect(res.ok).toBe(false);
    expect(res.status).toBe(400);
    expect(String(res.body['error'])).toMatch(/scratchpad/i);
    expect(posted).toEqual([]);
  });
});
