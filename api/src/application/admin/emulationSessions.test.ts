/**
 * The emulation middleware's session reads are cached and its page-visit writes
 * happen once per distinct path — every statement here is a Neon round trip that
 * also keeps the compute awake.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';
import {
  invalidateEmulationSession,
  loadEmulationSession,
  recordEmulationPageVisit,
} from './emulationSessions';

const env = { AUTH_CACHE_KV: undefined };
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;

describe('loadEmulationSession', () => {
  it('reads the session once and serves repeats from the cache', async () => {
    const db = fakeDb([[{ endedAt: null, tokenJti: 'j1' }]]);
    const first = await loadEmulationSession(env, asDb(db), 7, 'sid-1');
    const second = await loadEmulationSession(env, asDb(db), 7, 'sid-1');
    expect(first).toEqual({ ended: false, tokenJti: 'j1' });
    expect(second).toEqual(first);
    expect(db.calls.filter((c) => c.kind === 'select')).toHaveLength(1);
  });

  it('re-reads after invalidation, so an ended session stops working', async () => {
    const db = fakeDb([[{ endedAt: null, tokenJti: 'j1' }], [{ endedAt: new Date(), tokenJti: 'j1' }]]);
    expect(await loadEmulationSession(env, asDb(db), 7, 'sid-2')).toMatchObject({ ended: false });
    await invalidateEmulationSession(env, 'sid-2');
    expect(await loadEmulationSession(env, asDb(db), 7, 'sid-2')).toMatchObject({ ended: true });
  });

  it('returns null for an unknown session', async () => {
    const db = fakeDb([[]]);
    expect(await loadEmulationSession(env, asDb(db), 7, 'missing')).toBeNull();
  });
});

describe('recordEmulationPageVisit', () => {
  it('writes once per distinct path, not once per GET', async () => {
    const db = fakeDb();
    await recordEmulationPageVisit(env, asDb(db), 7, 'sid-3', '/api/projects');
    await recordEmulationPageVisit(env, asDb(db), 7, 'sid-3', '/api/projects');
    await recordEmulationPageVisit(env, asDb(db), 7, 'sid-3', '/api/tasks');
    expect(db.calls.filter((c) => c.kind === 'update')).toHaveLength(2);
  });
});
