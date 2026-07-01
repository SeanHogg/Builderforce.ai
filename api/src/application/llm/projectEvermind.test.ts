import { describe, expect, it } from 'vitest';
import {
  projectEvermindBase,
  projectEvermindRef,
  coordinatorName,
  getProjectEvermindHead,
  resolveProjectEvermindModelPin,
  PROJECT_EVERMIND_MODEL_PREFIX,
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
  it('expands a project pin to the current evermind/<ref>', async () => {
    const out = await resolveProjectEvermindModelPin(
      env,
      makeDb({ name: 'PM', version: 4, mode: 'connected', contributions: 0 }),
      7,
      `${PROJECT_EVERMIND_MODEL_PREFIX}42`,
    );
    expect(out.matched).toBe(true);
    expect(out.model).toBe('evermind/evermind/project/7/42/v4');
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
