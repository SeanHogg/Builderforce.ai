/**
 * THE canvas member store on kernel `memberships` (migration 1264) — the SQL it
 * builds, pinned against a real drizzle handle (`toSQL()` never touches the network).
 *
 * What matters here is not that drizzle can write an insert; it is the four facts
 * every board-member read must spell identically (object kind, ref ⇄ session id,
 * member kind, active state), the tenant predicate on the membership itself, and the
 * two conflict policies that decide whether a re-join can demote an owner.
 */
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { memberships } from '../../infrastructure/database/schema';
import {
  activeSessionMemberWhere, boardsOfMember, insertSessionMemberStatement, newBoardOwnerStatements, sessionMemberCountSql,
} from './sessionMembers';
import { creationSessions } from '../../infrastructure/database/schema';
import { newCreationSessionStatements } from './creationGraphWriter';

const db = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);
type Built = { toSQL(): { sql: string; params: unknown[] } };
const toSQL = (statement: unknown) => (statement as Built).toSQL();

const SESSION = '11111111-2222-4333-8444-555555555555';
const OBJECT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('activeSessionMemberWhere', () => {
  const q = toSQL(db.select({ role: memberships.role }).from(memberships).where(activeSessionMemberWhere(9, SESSION, 'u1')));

  it('scopes on the membership tenant and addresses the board through its registry row', () => {
    expect(q.sql).toContain('"memberships"."tenant_id" = $');
    expect(q.sql).toMatch(/"memberships"\."object_id" = \(select "objects"\."id" from "objects" where "objects"\."tenant_id" = \$\d+ and "objects"\."kind" = \$\d+ and "objects"\."ref_id" = \$\d+\)/i);
    expect(q.params).toEqual(expect.arrayContaining([9, 'creation_session', SESSION, 'user', 'u1', 'active']));
  });

  it('only ever matches an ACTIVE person-membership — a removed member is not a member', () => {
    expect(q.sql).toContain('"memberships"."member_kind" = $');
    expect(q.sql).toContain('"memberships"."state" = $');
  });
});

describe('insertSessionMemberStatement', () => {
  const input = { userId: 'u1', role: 'editor', invitedBy: 'u0' };

  it('`keep` never demotes an active member — only a removed one rejoins with the new role', () => {
    const q = toSQL(insertSessionMemberStatement(db, 9, OBJECT, input, 'keep'));
    expect(q.sql).toMatch(/on conflict \(.*"member_ref".*\) do update set/);
    expect(q.sql).toMatch(/"role" = CASE WHEN ("memberships"\.)?"state" = 'active' THEN ("memberships"\.)?"role" ELSE excluded\.role END/);
  });

  it('`keep-higher` compares board-role RANKS, so an accepted invite can promote but never demote', () => {
    const q = toSQL(insertSessionMemberStatement(db, 9, OBJECT, input, 'keep-higher'));
    // Both sides ranked through the one vocabulary (viewer 0 … owner 4); unknown = -1.
    expect(q.sql).toContain("WHEN 'owner' THEN 4");
    expect(q.sql).toContain("WHEN 'viewer' THEN 0");
    expect(q.sql).toContain('ELSE -1 END');
    expect(q.sql).toMatch(/>= \(CASE excluded\.role/);
  });

  it('`set-role` lets the new role win (a deliberate grant, a new board\'s owner)', () => {
    const q = toSQL(insertSessionMemberStatement(db, 9, OBJECT, input, 'set-role'));
    expect(q.sql).toMatch(/"role" = excluded\.role/);
  });

  it('a rejoin resets the inviter and keeps the member\'s own preferences; an active row\'s metadata is untouched', () => {
    const q = toSQL(insertSessionMemberStatement(db, 9, OBJECT, input, 'keep'));
    expect(q.sql).toMatch(/"metadata" = CASE WHEN ("memberships"\.)?"state" = 'active' THEN ("memberships"\.)?"metadata"/);
    expect(q.sql).toContain("- 'invitedBy') || excluded.metadata");
  });

  it('returns the effective role, so a caller can mirror and report what was actually seated', () => {
    const q = toSQL(insertSessionMemberStatement(db, 9, OBJECT, input, 'keep-higher'));
    expect(q.sql).toMatch(/returning "role"$/);
  });

  it('records the inviter on the membership metadata, as a person membership on the board object', () => {
    const q = toSQL(insertSessionMemberStatement(db, 9, OBJECT, input, 'set-role'));
    expect(q.params).toEqual(expect.arrayContaining([9, OBJECT, 'user', 'u1', 'editor', 'active', JSON.stringify({ invitedBy: 'u0' })]));
  });
});

describe('a new board is born with its registry row and its owner', () => {
  const writes = newCreationSessionStatements(db, {
    sessionId: SESSION, tenantId: 9, segmentId: null, title: 'A board', objects: [],
    authorUserId: 'u1', eventType: 'session.created',
  });

  it('writes the registry object, the owner membership and the owner presence row right after the session', () => {
    expect(writes.slice(0, 4).map((write) => write.table))
      .toEqual(['creation_sessions', 'objects', 'memberships', 'creation_session_members']);
  });

  it('points the owner membership at the very object row it inserts in the same batch', () => {
    const object = toSQL(writes[1]!.statement);
    const member = toSQL(writes[2]!.statement);
    const objectId = object.params.find((param) => typeof param === 'string' && /^[0-9a-f-]{36}$/.test(param) && param !== SESSION);
    expect(objectId).toBeTruthy();
    expect(member.params).toContain(objectId);
    expect(member.params).toEqual(expect.arrayContaining(['owner', 'u1']));
    expect(object.params).toEqual(expect.arrayContaining(['creation_session', SESSION, 'canvas']));
  });

  it('keeps the previous Worker able to open it during the 1264 → 1270 window (legacy role = owner)', () => {
    const presence = toSQL(writes[3]!.statement);
    expect(presence.params).toEqual(expect.arrayContaining([SESSION, 'u1', 'owner']));
  });

  it('carries the owner\'s camera onto the presence row when a claim brought one', () => {
    const claimed = newBoardOwnerStatements(db, {
      sessionId: SESSION, tenantId: 9, title: 'A board', ownerUserId: 'u1', ownerViewport: { x: 4, y: 2, zoom: 1 },
    });
    expect(toSQL(claimed[2]!.statement).params).toContain(JSON.stringify({ x: 4, y: 2, zoom: 1 }));
  });

  it('clips the registry title to its column', () => {
    const long = newBoardOwnerStatements(db, { sessionId: SESSION, tenantId: 9, title: 'x'.repeat(400), ownerUserId: 'u1' });
    expect(toSQL(long[0]!.statement).params).toContain('x'.repeat(300));
  });
});

describe('boardsOfMember', () => {
  const mine = boardsOfMember('u1');
  const q = toSQL(db.select({ role: mine.role, pinned: mine.pinned }).from(creationSessions).where(mine.isMember));

  it('reads ONLY the caller\'s active person-membership on the surrounding board', () => {
    expect(q.sql).toContain('bo.ref_id = "creation_sessions"."id"::text');
    expect(q.sql).toContain('bo.tenant_id = "creation_sessions"."tenant_id"');
    expect(q.sql).toContain("bm.state = 'active'");
    expect(q.sql).toMatch(/where EXISTS \(/i);
    expect(q.params).toEqual(expect.arrayContaining(['creation_session', 'user', 'u1']));
  });

  it('narrows to board roles when asked (the IDE write gate: editor and above)', () => {
    const editors = toSQL(db.select({ id: creationSessions.id }).from(creationSessions)
      .where(boardsOfMember('u1', { roles: ['editor', 'runner', 'owner'] }).isMember));
    expect(editors.sql).toMatch(/bm\.role IN \(\$\d+, \$\d+, \$\d+\)/);
    expect(editors.params).toEqual(expect.arrayContaining(['editor', 'runner', 'owner']));
  });
});

describe('sessionMemberCountSql', () => {
  it('counts active person-memberships of the aliased board in raw SQL', () => {
    const q = toSQL(db.select({ n: sessionMemberCountSql(sql.raw('s.id'), sql.raw('s.tenant_id')) }).from(memberships));
    expect(q.sql).toContain('bo.ref_id = s.id::text');
    expect(q.sql).toContain('bo.tenant_id = s.tenant_id');
    expect(q.sql).toContain("bm.state = 'active'");
    expect(q.sql).toContain('COUNT(*)::int');
  });
});
