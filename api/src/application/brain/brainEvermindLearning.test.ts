import { describe, expect, it, vi } from 'vitest';
import { learnFromPersistedTurns } from './brainEvermindLearning';
import type { Env } from '../../env';

// No AUTH_CACHE_KV → getProjectEvermindHead's read-through cache falls through to the loader.
const env = {} as Env;

/** db mock whose `.select().from().where()[.limit()]` returns queued result sets in
 *  order. For a seeded single-project chat the sequence is:
 *   1) brainChats.projectId (limit)
 *   2) resolveEvermindTargets → ide_projects children (NO limit — plain where())
 *   3) getProjectEvermindHead → projectEvermind row (limit)
 *  `where()` is awaitable (for the children query) AND chainable to limit/orderBy. */
function gateDb(queue: Array<Array<Record<string, unknown>>>) {
  let i = 0;
  const next = () => queue[i++] ?? [];
  return {
    select: () => ({
      from: () => ({
        where: () => {
          const rows = next();
          const thenable = Promise.resolve(rows) as Promise<unknown> & {
            limit: () => Promise<unknown>;
            orderBy: () => { limit: () => Promise<unknown> };
          };
          thenable.limit = async () => rows;
          thenable.orderBy = () => ({ limit: async () => next() });
          return thenable;
        },
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
  it('reports learned + names the target Evermind BY ID for a seeded connected project chat', async () => {
    const scheduled: Promise<unknown>[] = [];
    // brainChats.projectId, then ide_projects children (none), then the head for proj 42.
    const db = gateDb([[{ projectId: 42 }], [], [head({ version: 5 })]]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'user', content: 'How does auth work?' },
      { role: 'assistant', content: teachable },
    ], (p) => scheduled.push(p));
    expect(outcome.learned).toBe(true);
    expect(outcome.version).toBe(5);
    // The triage detail: WHICH Evermind learned, by id + version.
    expect(outcome.targets).toEqual([
      { projectId: 42, ref: expect.stringContaining('/42/v5'), version: 5, name: 'Project Evermind', learned: true, reason: null },
    ]);
    expect(scheduled).toHaveLength(1);
    await Promise.allSettled(scheduled);
  });

  it('fans out to MANY Everminds — the project head + its IDE builds — and reports each by id', async () => {
    // proj 42 chat → children storage projects 100 & 200. Heads: 42 seeded v5,
    // 100 seeded v2, 200 unseeded (v0). Contribute to 42 + 100; report 200 as not-seeded.
    const db = gateDb([
      [{ projectId: 42 }],                 // brainChats.projectId
      [{ sid: 100 }, { sid: 200 }],        // ide_projects children
      [head({ version: 5 })],              // head(42)
      [head({ version: 2 })],              // head(100)
      [head({ version: 0 })],              // head(200)
    ]);
    const scheduled: Promise<unknown>[] = [];
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'assistant', content: teachable },
    ], (p) => scheduled.push(p));
    expect(outcome.learned).toBe(true);
    expect(outcome.targets?.map((t) => ({ projectId: t.projectId, learned: t.learned, reason: t.reason }))).toEqual([
      { projectId: 42, learned: true, reason: null },
      { projectId: 100, learned: true, reason: null },
      { projectId: 200, learned: false, reason: 'not-seeded' },
    ]);
    await Promise.allSettled(scheduled);
  });

  it('reports not-attached when the chat has no project', async () => {
    const scheduled: Promise<unknown>[] = [];
    const db = gateDb([[{ projectId: null }]]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'assistant', content: teachable },
    ], (p) => scheduled.push(p));
    expect(outcome.reason).toBe('not-attached');
    expect(outcome.learned).toBe(false);
    expect(scheduled).toHaveLength(1);
  });

  it('reports not-seeded (no live Evermind) when the only target is version 0', async () => {
    const db = gateDb([[{ projectId: 42 }], [], [head({ version: 0 })]]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'assistant', content: teachable },
    ], () => {});
    expect(outcome).toMatchObject({ learned: false, reason: 'not-seeded' });
    expect(outcome.targets).toEqual([
      { projectId: 42, ref: null, version: 0, name: 'Project Evermind', learned: false, reason: 'not-seeded' },
    ]);
  });

  it('reports too-short when no assistant turn meets the teach threshold', async () => {
    const db = gateDb([]);
    const outcome = await learnFromPersistedTurns(env, db, 55, 7, [
      { role: 'assistant', content: 'ok' },
    ], () => {});
    expect(outcome).toMatchObject({ learned: false, reason: 'too-short' });
  });
});
