/**
 * Brain chat ARCHIVE STATE — the filter `listChats` runs, and the write that un-archives.
 *
 * Two failures are pinned here, both of which read as "archive is covered" while nothing
 * could restore — or even see — an archived chat:
 *
 *  1. `listChats` hardcoded `is_archived = false`, so the archive state never reached ANY
 *     client: the list projection had no `isArchived`, and the UI's "don't offer Archive
 *     on an archived row" guard had no state to test. Widening the list must widen the
 *     ARCHIVE state only — never the AUDIENCE. `archived: 'only'` is an "Archived" tab,
 *     not a way to read a colleague's chat, so tenant, owner-or-member-or-shared and
 *     origin have to be identical across all three modes.
 *
 *  2. Archive was ONE-WAY. `updateChat` accepted title/project/visibility/capability/
 *     mode/memoryEnabled and never `isArchived`, so no caller — route or host — could
 *     restore a chat, and archiving was indistinguishable from deleting one.
 *
 * The database is a spy, so these assertions are about the SQL the reader builds (which
 * is exactly what was wrong) and the values the writer was handed.
 */
import { describe, expect, it } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { listChats, updateChat } from './brainChats';

const dialect = new PgDialect();

/** The archive clause as drizzle renders it into a captured list statement. */
const ARCHIVE_PREDICATE = '"brain_chats"."is_archived" = $';

/** A chat the guard accepts: `brainstorm` origin, and an owner or member may write it. */
const chat = { id: 5, origin: 'brainstorm', mode: 'conversation' };

interface Captured {
  /** The list SELECT's statement: sql + bound params (read at `offset`, the list's own verb). */
  sql?: string;
  params?: unknown[];
  /** The projection the list SELECT asked for. */
  projection?: Record<string, unknown>;
  /** Every `set()` payload the UPDATE was handed. */
  applied: Array<Record<string, unknown>>;
}

/**
 * One `Db` spy covering every statement `listChats` / `updateChat` make, recording
 * both the statement each read builds and every value each UPDATE was handed.
 *
 * Both readers chain `.from().where()` and then differ at the verb: `listChats` ends in
 * `.offset()` (the LIST), `verifyChatOwnership` ends in `.limit()` (the OWNERSHIP GATE),
 * and `attachParticipants` adds `.leftJoin()` (its two roster reads). Keying the spy on
 * that final verb — rather than on call order — is what keeps it honest: the list
 * statement is captured at the moment the list itself is read, so no later roster read
 * can overwrite it.
 */
function chatDb(opts: { rows?: Array<Record<string, unknown>>; owner?: Record<string, unknown> } = {}) {
  const rows = opts.rows ?? [];
  const seen: Captured = { applied: [] };

  const chain = () => {
    const c: Record<string, unknown> = {};
    let sql: string | undefined;
    let params: unknown[] | undefined;
    c.from = () => c;
    c.leftJoin = () => c;
    c.orderBy = () => c;
    c.where = (predicate: SQL) => {
      const query = dialect.sqlToQuery(predicate);
      sql = query.sql;
      params = query.params;
      return c;
    };
    // Awaiting the chain yields the OWNERSHIP-GATE row: `verifyChatOwnership` ends at
    // `.limit(1)`, while the list goes on to `.offset(...)` — so the chain is a thenable
    // and `offset` is what actually answers the list.
    c.then = (resolve: (value: unknown) => void) => resolve(opts.owner ? [opts.owner] : []);
    c.limit = () => c;
    // The LIST verb: capture the statement the list read is about to execute.
    c.offset = () => {
      seen.sql = sql;
      seen.params = params;
      return Promise.resolve(rows);
    };
    return c;
  };

  const db = {
    // syncPendingMemberships: an UPDATE ... RETURNING.
    update: () => ({
      set: (values: Record<string, unknown>) => {
        seen.applied.push(values);
        return {
          where: () => ({
            // The returning row is what the client receives, so it must reflect the write.
            returning: async () => [{ ...opts.owner, ...rows[0], ...values }],
          }),
        };
      },
    }),
    select: (columns?: Record<string, unknown>) => {
      if (columns) seen.projection = columns;
      return chain();
    },
  } as never;
  return { db, seen };
}

/**
 * The boolean the `is_archived` predicate is bound with, read off the CAPTURED PARAMS —
 * not the column name. A predicate comparing against `true` renders identically in the
 * SQL text, so asserting on the string alone would pass on both modes.
 */
function archivedBoundValue(seen: Captured): boolean | undefined {
  const match = new RegExp(`${ARCHIVE_PREDICATE.replace('$', '\\$(\\d+)')}`).exec(seen.sql ?? '');
  if (!match) return undefined;
  return seen.params?.[Number(match[1]) - 1] as boolean | undefined;
}

/** The membership subquery is a bind parameter (drizzle inlines no nested SQL), never a literal. */
function membershipSubqueryIndex(seen: Captured): number {
  const match = /"brain_chats"\."id" in \$(\d+)/.exec(seen.sql ?? '');
  if (!match) throw new Error(`no membership predicate in: ${seen.sql}`);
  return Number(match[1]) - 1;
}

/** The AUDIENCE: who may see a chat. It must not move with the archive mode. */
function expectAudienceScoping(seen: Captured) {
  const sql = seen.sql ?? '';
  expect(sql).toContain('"brain_chats"."tenant_id" = $');
  expect(sql).toContain('"brain_chats"."origin" = $');
  // owner OR shared OR an active membership — never owner-or-shared on its own.
  expect(sql).toContain('"brain_chats"."user_id" = $');
  expect(sql).toContain('"brain_chats"."visibility" = $');
  expect(sql).toContain('"brain_chats"."id" in $');
  expect(seen.params).toContain('shared');
  // The membership leg is a SUBQUERY bound as a parameter, so it cannot have been
  // flattened into a list of ids — which is what keeps it tenant-scoped.
  expect(typeof seen.params?.[membershipSubqueryIndex(seen)]).toBe('object');
}

/** Drop the archive clause so the remaining statement is the audience predicate alone. */
const withoutArchive = (sql: string): string => sql.replace(/ and "brain_chats"\."is_archived" = \$\d+/, '');

describe('listChats — the archive filter', () => {
  it('with no `archived` option builds exactly the statement it always built', async () => {
    // THE regression guard. Every chat surface calls this with no options, so the default
    // must compile to the SAME statement — asserted against an explicit `'exclude'`,
    // which is what the old hardcoded `is_archived = false` condition expressed.
    const implicit = chatDb();
    await listChats(implicit.db, 7, 'user-1');
    const explicit = chatDb();
    await listChats(explicit.db, 7, 'user-1', { archived: 'exclude' });

    expect(implicit.seen.sql).toBeDefined();
    expect(implicit.seen.sql).toBe(explicit.seen.sql);
    // ...and that shared statement is the old one: bound to `false`.
    expect(archivedBoundValue(implicit.seen)).toBe(false);
    expect(withoutArchive(implicit.seen.sql!)).toBe(withoutArchive(explicit.seen.sql!));
  });

  it('`only` returns the archived chats, bound to `true`', async () => {
    const { db, seen } = chatDb();
    await listChats(db, 7, 'user-1', { archived: 'only' });
    expect(archivedBoundValue(seen)).toBe(true);
  });

  it('`only` does NOT widen who may see a chat — the audience predicate is unchanged', async () => {
    // An "Archived" tab narrows WHICH chats, never WHO reads them. If `only` dropped or
    // loosened the owner/member/shared legs it would expose a colleague's archived
    // conversation — the one thing this filter must never do.
    const only = chatDb();
    await listChats(only.db, 7, 'user-1', { archived: 'only' });
    const live = chatDb();
    await listChats(live.db, 7, 'user-1', { archived: 'exclude' });

    // Strip the archive clause; what remains must be byte-identical.
    expect(withoutArchive(only.seen.sql!)).toBe(withoutArchive(live.seen.sql!));
    expectAudienceScoping(only.seen);
  });

  it('`all` returns both states by dropping the archive predicate entirely', async () => {
    const { db, seen } = chatDb();
    await listChats(db, 7, 'user-1', { archived: 'all' });
    expect(seen.sql).not.toContain('is_archived');
    expect(archivedBoundValue(seen)).toBeUndefined();
    expectAudienceScoping(seen);
  });

  it('keeps the project filter orthogonal to the archive filter', async () => {
    const scoped = chatDb();
    await listChats(scoped.db, 7, 'user-1', { projectId: '3', archived: 'only' });
    expect(scoped.seen.sql).toContain('"brain_chats"."project_id" = $');
    expect(archivedBoundValue(scoped.seen)).toBe(true);

    const unassigned = chatDb();
    await listChats(unassigned.db, 7, 'user-1', { projectId: 'none' });
    expect(unassigned.seen.sql).toContain('"brain_chats"."project_id" is null');
    expect(archivedBoundValue(unassigned.seen)).toBe(false);
  });

  it('carries `isArchived` in the list projection, so the state can reach a client', async () => {
    // Without it the archived row was indistinguishable from a live one, and the "don't
    // offer Archive on an archived row" guard read as covered while protecting nothing —
    // there was nothing for it to test.
    const { db, seen } = chatDb();
    await listChats(db, 7, 'user-1', { archived: 'only' });
    expect(Object.keys(seen.projection!)).toContain('isArchived');
  });

  it('hands the caller the archive state it just filtered on', async () => {
    const archived = { id: 5, origin: 'brainstorm', mode: 'conversation', isArchived: true };
    const { db } = chatDb({ rows: [archived] });
    const result = await listChats(db, 7, 'user-1', { archived: 'only' });
    expect(result).toMatchObject([{ id: 5, isArchived: true }]);
  });
});

describe('updateChat — un-archive', () => {
  /** `updateChat` over a spy: `owner` is the chat the ownership gate returns. */
  const writer = (owner: Record<string, unknown> = chat) => chatDb({ owner });

  it('restores an archived chat with `{ isArchived: false }`', async () => {
    const spy = writer({ ...chat, isArchived: true });
    await updateChat(spy.db, 5, 7, 'user-1', { isArchived: false });
    expect(spy.seen.applied[0]).toMatchObject({ isArchived: false });
  });

  it('never touches the column when `isArchived` is absent', async () => {
    // Every rename, mode switch and project assignment omits it. Writing anything here
    // would silently flip the archive state of every chat a user ever touched — the
    // failure mode that made `memoryEnabled` conditional in the first place.
    const archived = { ...chat, isArchived: true };
    for (const dto of [
      { title: 'Roadmap' },
      { mode: 'conversation' as const },
      { projectId: null },
      { memoryEnabled: true },
    ]) {
      const spy = writer(archived);
      await updateChat(spy.db, 5, 7, 'user-1', dto);
      expect(spy.seen.applied[0], JSON.stringify(dto)).not.toHaveProperty('isArchived');
    }
  });

  it('still writes the field it WAS given, alongside leaving the archive alone', async () => {
    const spy = writer();
    await updateChat(spy.db, 5, 7, 'user-1', { memoryEnabled: true });
    expect(spy.seen.applied[0]).toMatchObject({ memoryEnabled: true });
  });

  it('ignores a non-boolean `isArchived` rather than coercing it', async () => {
    // The string 'false' is truthy: coercing it would ARCHIVE the chat the caller meant
    // to restore. Only an actual boolean may move the column.
    const spy = writer();
    await updateChat(spy.db, 5, 7, 'user-1', { isArchived: 'false' as unknown as boolean });
    expect(spy.seen.applied[0]).not.toHaveProperty('isArchived');
  });

  it('returns the updated row carrying the new archive state', async () => {
    const spy = writer({ ...chat, isArchived: true });
    const result = await updateChat(spy.db, 5, 7, 'user-1', { isArchived: false });
    expect(result).toMatchObject({ id: 5, isArchived: false });
  });

  it('a restored chat is visible in the DEFAULT list again — that list asks for `false`', async () => {
    // The two halves of un-archiving, in the order a client performs them: write the
    // restore, then re-read the list it reloads afterwards. The read is the DEFAULT one —
    // no `archived` option, because a restored chat is an ordinary live chat again — and
    // the default being bound to `false` is what makes it come back.
    const restored = { ...chat, isArchived: false };
    const spy = chatDb({ owner: { ...chat, isArchived: true }, rows: [restored] });

    const updated = await updateChat(spy.db, 5, 7, 'user-1', { isArchived: false });
    expect(spy.seen.applied[0]).toMatchObject({ isArchived: false });

    const rows = await listChats(spy.db, 7, 'user-1');
    expect(archivedBoundValue(spy.seen)).toBe(false);
    expect(rows).toMatchObject([{ id: 5, isArchived: false }]);
    expect(rows[0]).toMatchObject({ isArchived: updated.isArchived });
  });
});