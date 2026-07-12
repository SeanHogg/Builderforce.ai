import { describe, expect, it, vi } from 'vitest';
import { learnFromPersistedTurns } from './brainEvermindLearning';
import type { Env } from '../../env';

// No AUTH_CACHE_KV → getProjectEvermindHead's read-through cache falls through to the loader.
const env = {} as Env;

/** db mock whose `.select().from().where().limit()` returns queued result sets in order:
 *  evaluateBrainLearnGate reads brainChats.projectId first, then getProjectEvermindHead
 *  reads the projectEvermind row. */
function gateDb(queue: Array<Array<Record<string, unknown>>>) {
  let i = 0;
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => queue[i++] ?? [],
          orderBy: () => ({ limit: async () => queue[i++] ?? [] }),
        }),
      }),
    }),
  } as never;
}

const head = (over: Record<string, unknown> = {}) => ({
  version: 3,
  inferenceEnabled: false,
  name: 'Project Evermind',
  mode: 'connected',
  contributions: 0,
  teacherModel: null,
  lastLearnedAt: null,
  ...over,
});

const teachable = 'This is a substantive assistant answer, well over the forty character teach threshold.';

describe('learnFromPersistedTurns (consolidated learn-on-persist path)', () => {
  it('reports learned + version and schedules a background dispatch for a seeded connected project chat', async () => {
    const scheduled: Promise<unknown>[] = [];
    const db = gateDb([[{ projectId: 42 }], [head({ version: 5 })]]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'user', content: 'How does auth work?' },
      { role: 'assistant', content: teachable },
    ], (p) => scheduled.push(p));
    expect(outcome).toEqual({ learned: true, version: 5, reason: null });
    expect(scheduled).toHaveLength(1); // dispatch scheduled in the background
    await Promise.allSettled(scheduled); // dispatch is best-effort; must not reject the caller
  });

  it('reports not-attached (and still schedules a no-op dispatch) when the chat has no project', async () => {
    const scheduled: Promise<unknown>[] = [];
    const db = gateDb([[{ projectId: null }]]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'assistant', content: teachable },
    ], (p) => scheduled.push(p));
    expect(outcome.reason).toBe('not-attached');
    expect(outcome.learned).toBe(false);
    expect(scheduled).toHaveLength(1);
  });

  it('reports not-seeded when the project Evermind is version 0', async () => {
    const db = gateDb([[{ projectId: 42 }], [head({ version: 0 })]]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'assistant', content: teachable },
    ], () => {});
    expect(outcome).toMatchObject({ learned: false, reason: 'not-seeded' });
  });

  it('reports too-short when no assistant turn meets the teach threshold', async () => {
    const db = gateDb([]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'assistant', content: 'ok' },
    ], () => {});
    expect(outcome).toMatchObject({ learned: false, reason: 'too-short' });
  });
});
