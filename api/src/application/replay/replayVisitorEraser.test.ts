/**
 * Erasing a visitor is ALWAYS scoped (D17): a member's erase reaches one site of one
 * workspace, the operator's erase only the listed (Builderforce) workspaces — never
 * every tenant. Bytes go first, then summaries, then the rows read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { fakeDb } from '../../../test/fakeDb';

const mocks = vi.hoisted(() => ({
  deleteRecording: vi.fn(async () => 1),
  bumpSiteVersion: vi.fn(async () => undefined),
}));
vi.mock('./replayChunkStore', () => ({ deleteRecording: mocks.deleteRecording }));
vi.mock('./replayCacheKeys', () => ({ bumpSiteVersion: mocks.bumpSiteVersion }));

import { eraseReplayVisitor } from './replayVisitorEraser';

const SITE = '11111111-2222-4333-8444-555555555555';
const REC = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const dialect = new PgDialect();
const env = {} as never;
const params = (where: unknown) => dialect.sqlToQuery(where as SQL).params;

beforeEach(() => {
  mocks.deleteRecording.mockClear();
  mocks.bumpSiteVersion.mockClear();
});

describe('eraseReplayVisitor', () => {
  it('reaches only the given site of the given workspace', async () => {
    const db = fakeDb([[{ id: REC, tenantId: 7, siteId: SITE, startedAt: new Date('2026-10-01T00:00:00Z') }], [], []]);
    const erased = await eraseReplayVisitor(env, db as never, 'visitor_0001', { tenantId: 7, siteId: SITE });
    expect(erased).toBe(1);
    const [read, , rows] = db.calls;
    expect(params(read!.where)).toEqual(expect.arrayContaining([7, SITE, 'visitor_0001']));
    expect(rows!.kind).toBe('delete');
    expect(params(rows!.where)).toEqual(expect.arrayContaining([7, SITE, 'visitor_0001', REC]));
    expect(mocks.deleteRecording).toHaveBeenCalledWith(env, expect.objectContaining({ tenantId: 7, siteId: SITE, recordingId: REC }));
    expect(mocks.bumpSiteVersion).toHaveBeenCalledWith(env, SITE);
  });

  it('with a workspace list (the operator erase), reaches only those workspaces', async () => {
    const db = fakeDb([[]]);
    expect(await eraseReplayVisitor(env, db as never, 'visitor_0001', { tenantIds: [1, 4] })).toBe(0);
    expect(params(db.calls[0]!.where)).toEqual(expect.arrayContaining([1, 4, 'visitor_0001']));
    expect(db.calls).toHaveLength(1);
  });

  it('touches nothing when the operator is a member of no workspace', async () => {
    const db = fakeDb([]);
    expect(await eraseReplayVisitor(env, db as never, 'visitor_0001', { tenantIds: [] })).toBe(0);
    expect(db.calls).toHaveLength(0);
    expect(mocks.deleteRecording).not.toHaveBeenCalled();
  });
});
