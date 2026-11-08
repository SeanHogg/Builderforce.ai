/**
 * `recordApplication`'s board paths: the board-id arbiter, the fallback when the SAME
 * PERSON collides on the candidate index instead, and the source fold on write.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Env } from '../../env';

const enterPipeline = vi.fn();
const readPostingBoardCatalog = vi.fn();

vi.mock('./pipeline', () => ({
  enterPipeline: (...args: unknown[]) => enterPipeline(...args),
  moveCandidate: vi.fn(),
}));
vi.mock('./postingDistributionStore', () => ({
  readPostingBoardCatalog: (...args: unknown[]) => readPostingBoardCatalog(...args),
}));

import { BUILTIN_BOARD_SOURCES } from './applicantSource';
import { recordApplication } from './applications';

const ENV = {} as Env;

interface Attempt { values: Record<string, unknown>; config: { target: Array<{ name: string }>; targetWhere?: unknown } }

/** Each `returning()` answers from the queue: a row, or an Error to throw. */
function fakeDb(outcomes: Array<{ id: number } | Error> = []) {
  const attempts: Attempt[] = [];
  const queue = [...outcomes];
  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (config: Attempt['config']) => ({
          returning: async () => {
            attempts.push({ values, config });
            const next = queue.shift() ?? { id: 1 };
            if (next instanceof Error) throw next;
            return [{ id: next.id, appliedAt: new Date('2026-10-01T00:00:00Z') }];
          },
        }),
      }),
    }),
  };
  return { db: db as never, attempts };
}

const unique = (constraint: string) => Object.assign(
  new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: '23505', constraint },
);
const names = (attempt: Attempt) => attempt.config.target.map((column) => column.name);

const base = { tenantId: 1, jobPostingId: 'p1', candidateRef: 'person-1' };

beforeEach(() => {
  enterPipeline.mockReset().mockResolvedValue({ created: true });
  readPostingBoardCatalog.mockReset().mockResolvedValue([]);
});

describe('the board-id arbiter', () => {
  it('a board import carrying an external id upserts on the (posting, source, board id) partial index', async () => {
    const { db, attempts } = fakeDb();
    await recordApplication(db, ENV, { ...base, source: 'workable', externalId: 'ext-1', boards: BUILTIN_BOARD_SOURCES });
    expect(attempts).toHaveLength(1);
    expect(names(attempts[0]!)).toEqual(['tenant_id', 'job_posting_id', 'source', 'external_id']);
    expect(attempts[0]!.config.targetWhere).toBeDefined(); // the index is PARTIAL: the predicate is part of the target
    expect(attempts[0]!.values).toMatchObject({ source: 'workable', externalId: 'ext-1' });
  });

  it('the same PERSON colliding on the candidate index falls back to refreshing that row', async () => {
    const { db, attempts } = fakeDb([unique('uq_job_applications_candidate'), { id: 42 }]);
    const result = await recordApplication(db, ENV, { ...base, source: 'workable', externalId: 'ext-2', boards: BUILTIN_BOARD_SOURCES });
    expect(attempts).toHaveLength(2);
    expect(names(attempts[1]!)).toEqual(['tenant_id', 'job_posting_id', 'candidate_ref']);
    expect(result.applicationId).toBe(42);
  });

  it('a unique violation on ANY OTHER index is a real error, not a fallback', async () => {
    const { db, attempts } = fakeDb([unique('uq_something_else')]);
    await expect(recordApplication(db, ENV, { ...base, source: 'workable', externalId: 'ext-3', boards: BUILTIN_BOARD_SOURCES }))
      .rejects.toThrow(/uq_something_else/);
    expect(attempts).toHaveLength(1);
  });

  it('an application with no board id (the platform’s own) uses the candidate arbiter alone', async () => {
    const { db, attempts } = fakeDb();
    await recordApplication(db, ENV, { ...base, source: 'direct' });
    expect(attempts).toHaveLength(1);
    expect(names(attempts[0]!)).toEqual(['tenant_id', 'job_posting_id', 'candidate_ref']);
    expect(attempts[0]!.values.externalId).toBeNull();
  });

  it('reports whether the pipeline entry was created, and enters the pipeline under the stored source', async () => {
    enterPipeline.mockResolvedValue({ created: false });
    const { db } = fakeDb();
    const result = await recordApplication(db, ENV, { ...base, source: 'LinkedIn', boards: BUILTIN_BOARD_SOURCES });
    expect(result.created).toBe(false);
    expect(enterPipeline.mock.calls[0]![2]).toMatchObject({ source: 'linkedin-jobs' });
  });
});

describe('regression: a re-read applicant does not look freshly edited', () => {
  it('moves updated_at only when a refreshed field actually changes', async () => {
    const { db, attempts } = fakeDb();
    await recordApplication(db, ENV, { ...base, source: 'workable', externalId: 'ext-9', boards: BUILTIN_BOARD_SOURCES });
    const set = (attempts[0]!.config as unknown as { set: { updatedAt: SQL } }).set;
    const { sql: text } = new PgDialect().sqlToQuery(set.updatedAt);
    expect(text).toMatch(/case when/i);
    expect(text).toMatch(/is distinct from/i);
    expect(text).toMatch(/else "job_applications"\."updated_at" end/);
    expect(text).not.toBe('now()'); // the old unconditional bump
  });
});

describe('the source is folded onto the board key on write', () => {
  it('a built-in spelling stores the key, without reading the catalog when one is supplied', async () => {
    const { db, attempts } = fakeDb();
    await recordApplication(db, ENV, { ...base, source: 'https://www.linkedin.com/jobs/view/1', boards: BUILTIN_BOARD_SOURCES });
    expect(attempts[0]!.values.source).toBe('linkedin-jobs');
    expect(readPostingBoardCatalog).not.toHaveBeenCalled();
  });

  it('reads the posting’s boards when none is supplied, so a TENANT board’s alias folds too', async () => {
    readPostingBoardCatalog.mockResolvedValue([{ key: 'acme-careers', aliases: ['acme'] }]);
    const { db, attempts } = fakeDb();
    await recordApplication(db, ENV, { ...base, source: 'Acme' });
    expect(readPostingBoardCatalog).toHaveBeenCalledTimes(1);
    expect(attempts[0]!.values.source).toBe('acme-careers');
  });

  it('a reserved source (direct, marketplace, referral…) needs no catalog read at all', async () => {
    const { db } = fakeDb();
    for (const source of ['direct', 'marketplace', 'Referral', undefined]) {
      await recordApplication(db, ENV, { ...base, source });
    }
    expect(readPostingBoardCatalog).not.toHaveBeenCalled();
  });

  it('a spelling nobody declares is stored as it came', async () => {
    const { db, attempts } = fakeDb();
    await recordApplication(db, ENV, { ...base, source: 'Glassdoor', boards: BUILTIN_BOARD_SOURCES });
    expect(attempts[0]!.values.source).toBe('Glassdoor');
  });
});
