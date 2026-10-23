import { describe, expect, it } from 'vitest';
import {
  SESSION_ROLE_RANK, grantReadFor, requireSessionRole, resolveSessionAccess, resolveSessionGrant, tenantRoleForSessionRole,
  type SessionRole,
} from './sessionAccess';
import { sessionMembersChanged } from './sessionMembers';
import { TenantRole, hasMinRole } from '../../domain/shared/types';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

describe('tenantRoleForSessionRole', () => {
  it('gives a board viewer or commenter no more than workspace viewer', () => {
    // Sharing one canvas granted `developer` on the whole workspace — write
    // access to every project, ticket and agent in it — regardless of the board
    // role. The board role is the ceiling.
    expect(tenantRoleForSessionRole('viewer')).toBe(TenantRole.VIEWER);
    expect(tenantRoleForSessionRole('commenter')).toBe(TenantRole.VIEWER);
  });

  it('seats a role that edits or runs the board as a contributor, never a developer', () => {
    // Operator decision 2026-09-12: the edit grant is the BOARD role. The
    // workspace seat only lets the board resolve, so it must not carry the
    // `developer` tier that writes tasks, projects and agents.
    expect(tenantRoleForSessionRole('editor')).toBe(TenantRole.CONTRIBUTOR);
    expect(tenantRoleForSessionRole('runner')).toBe(TenantRole.CONTRIBUTOR);
    expect(tenantRoleForSessionRole('owner')).toBe(TenantRole.CONTRIBUTOR);
  });

  it('answers for every board role there is, and never above contributor', () => {
    for (const role of Object.keys(SESSION_ROLE_RANK) as SessionRole[]) {
      const seated = tenantRoleForSessionRole(role);
      expect([TenantRole.VIEWER, TenantRole.CONTRIBUTOR]).toContain(seated);
      expect(hasMinRole(seated, TenantRole.DEVELOPER)).toBe(false);
    }
  });
});

/**
 * THE board-role gate on KERNEL membership (migration 1264): the role is read from
 * `memberships` on the board's registry object, then the board row is read under the
 * grant. A `Db` double whose Nth awaited select resolves to `results[N]`, recording
 * each projection's keys and how many selects ran.
 */
function gateDb(results: unknown[][]) {
  const columns: string[][] = [];
  const db = {
    select: (cols?: Record<string, unknown>) => {
      columns.push(Object.keys(cols ?? {}));
      const rows = results.shift() ?? [];
      const chain: Record<string, unknown> = {
        from: () => chain, innerJoin: () => chain, leftJoin: () => chain, where: () => chain, limit: () => chain,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as Db;
  return { db, columns };
}

const BOARD = { id: 'sess-1', tenantId: 9, title: 'Board' };

describe('resolveSessionAccess — on kernel membership', () => {
  it('reads the role from the membership grant, then the board under it', async () => {
    const { db, columns } = gateDb([[{ role: 'editor', sessionTenantId: 9 }], [BOARD]]);
    const access = await resolveSessionAccess(db, 'sess-1', 9, 'u1');
    expect(access).toEqual({ session: BOARD, role: 'editor' });
    expect(columns[0]).toEqual(['role', 'sessionTenantId']);
    expect(columns).toHaveLength(2);
  });

  it('grants nothing for a kernel role the board gate does not know (the generic `member` default)', async () => {
    const { db } = gateDb([[{ role: 'member', sessionTenantId: 9 }], []]);
    expect(await resolveSessionAccess(db, 'sess-1', 9, 'u1')).toBeNull();
  });

  it('falls through to the superadmin read, and resolves a board in ANOTHER tenant under it', async () => {
    const foreign = { ...BOARD, tenantId: 42 };
    const { db, columns } = gateDb([[], [{ role: 'editor', sessionTenantId: 42 }], [foreign]]);
    const access = await resolveSessionAccess(db, 'sess-1', 9, 'u1');
    expect(access?.session.tenantId).toBe(42);
    expect(columns).toHaveLength(3);
  });

  it('refuses when neither the tenant read nor the superadmin read finds a membership', async () => {
    const { db, columns } = gateDb([[], []]);
    expect(await resolveSessionAccess(db, 'sess-1', 9, 'u1')).toBeNull();
    // No board read is attempted without a grant.
    expect(columns).toHaveLength(2);
  });

  it('requireSessionRole applies the minimum on top of the grant', async () => {
    const viewer = gateDb([[{ role: 'viewer', sessionTenantId: 9 }], [BOARD]]);
    expect(await requireSessionRole(viewer.db, 'sess-1', 9, 'u1', 'editor')).toBeNull();
    const owner = gateDb([[{ role: 'owner', sessionTenantId: 9 }], [BOARD]]);
    expect((await requireSessionRole(owner.db, 'sess-1', 9, 'u1', 'editor'))?.role).toBe('owner');
  });
});

describe('resolveSessionGrant — cached under the board member version token', () => {
  // No KV bound: the read-through cache runs on its L1 alone, which `test/setup.ts`
  // clears before every test.
  const env = {} as Env;

  it('serves a repeat check from cache, and re-reads after a membership write bumps the token', async () => {
    const { db, columns } = gateDb([
      [{ role: 'editor', sessionTenantId: 9 }],
      [{ role: 'viewer', sessionTenantId: 9 }],
    ]);
    expect((await resolveSessionGrant(db, 'sess-1', 9, 'u1', env))?.role).toBe('editor');
    expect((await resolveSessionGrant(db, 'sess-1', 9, 'u1', env))?.role).toBe('editor');
    expect(columns).toHaveLength(1);

    // A role change / removal / seat ends in `sessionMembersChanged`.
    await sessionMembersChanged(env, { id: 'sess-1', tenantId: 9 });
    expect((await resolveSessionGrant(db, 'sess-1', 9, 'u1', env))?.role).toBe('viewer');
    expect(columns).toHaveLength(2);
  });

  it('keys the cache per person and per tenant — one member\'s grant never answers for another', async () => {
    const { db, columns } = gateDb([
      [{ role: 'owner', sessionTenantId: 9 }],
      [],
      [],
    ]);
    expect((await resolveSessionGrant(db, 'sess-1', 9, 'u1', env))?.role).toBe('owner');
    expect(await resolveSessionGrant(db, 'sess-1', 9, 'u2', env)).toBeNull();
    // u2: the cached-miss tenant read, then the uncached superadmin read.
    expect(columns).toHaveLength(3);
  });

  it('a WRITE reads the grant fresh — a demotion can never be outlived by a cached grant on a write', async () => {
    const { db, columns } = gateDb([
      [{ role: 'owner', sessionTenantId: 9 }], // cached by the read
      [{ role: 'viewer', sessionTenantId: 9 }], // the write's fresh read sees the demotion
    ]);
    expect((await resolveSessionGrant(db, 'sess-1', 9, 'u1', env))?.role).toBe('owner');
    expect((await resolveSessionGrant(db, 'sess-1', 9, 'u1', env, grantReadFor('editor')))?.role).toBe('viewer');
    expect(columns).toHaveLength(2);
  });

  it('only editor-and-above gates read fresh', () => {
    expect(grantReadFor('viewer')).toEqual({ fresh: false });
    expect(grantReadFor('commenter')).toEqual({ fresh: false });
    expect(grantReadFor('editor')).toEqual({ fresh: true });
    expect(grantReadFor('owner')).toEqual({ fresh: true });
  });

  it('never caches the superadmin branch — a revoked flag stops working on the next request', async () => {
    const { db, columns } = gateDb([
      [], [{ role: 'editor', sessionTenantId: 42 }],
      [], // second call: the tenant miss is cached, so only the superadmin read runs
    ]);
    expect((await resolveSessionGrant(db, 'sess-1', 9, 'u1', env))?.sessionTenantId).toBe(42);
    expect(await resolveSessionGrant(db, 'sess-1', 9, 'u1', env)).toBeNull();
    expect(columns).toHaveLength(3);
  });
});
