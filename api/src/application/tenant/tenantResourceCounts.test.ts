/**
 * The plan-limit counts are cached, and every create/delete bumps a version token
 * so a check right after a write re-counts rather than reading the old number.
 */
import { describe, expect, it } from 'vitest';
import { fakeDb } from '../../../test/fakeDb';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  bumpTenantAgentHostCount,
  bumpTenantProjectCount,
  countTenantAgentHosts,
  countTenantProjects,
} from './tenantResourceCounts';

const env = { AUTH_CACHE_KV: undefined } as unknown as Env;
const asDb = (db: ReturnType<typeof fakeDb>) => db as unknown as Db;
const selects = (db: ReturnType<typeof fakeDb>) => db.calls.filter((c) => c.kind === 'select').length;

describe('countTenantProjects', () => {
  it('counts once and serves repeats from the cache', async () => {
    const db = fakeDb([[{ total: 2 }]]);
    expect(await countTenantProjects(env, asDb(db), 1)).toBe(2);
    expect(await countTenantProjects(env, asDb(db), 1)).toBe(2);
    expect(selects(db)).toBe(1);
  });

  it('re-counts after a create bumps the version', async () => {
    const db = fakeDb([[{ total: 2 }], [{ total: 3 }]]);
    expect(await countTenantProjects(env, asDb(db), 2)).toBe(2);
    await bumpTenantProjectCount(env, 2);
    expect(await countTenantProjects(env, asDb(db), 2)).toBe(3);
  });

  it('keeps tenants and resources apart', async () => {
    const db = fakeDb([[{ total: 1 }], [{ total: 5 }]]);
    expect(await countTenantProjects(env, asDb(db), 3)).toBe(1);
    expect(await countTenantAgentHosts(env, asDb(db), 3)).toBe(5);
    // A host bump leaves the project count cached.
    await bumpTenantAgentHostCount(env, 3);
    expect(await countTenantProjects(env, asDb(db), 3)).toBe(1);
    expect(selects(db)).toBe(2);
  });

  it('a bump without an env still drops this isolate\'s copy', async () => {
    const db = fakeDb([[{ total: 1 }], [{ total: 2 }]]);
    expect(await countTenantAgentHosts(env, asDb(db), 4)).toBe(1);
    await bumpTenantAgentHostCount(undefined, 4);
    expect(await countTenantAgentHosts(env, asDb(db), 4)).toBe(2);
  });
});
