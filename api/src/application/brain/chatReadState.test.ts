import { describe, it, expect, beforeEach } from 'vitest';
import { markChatRead, unreadCountsForUser } from './chatReadState';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Chat read-state — the unread rule behind the web's unread badge (parity with the
 * VSIX attention icons). Two behaviours:
 *   • markChatRead: advance a user's high-water mark to a seq (or to the chat's max
 *     when omitted), via an upsert whose SET uses GREATEST so it only moves forward.
 *   • unreadCountsForUser: one grouped read of messages past each read chat's mark →
 *     a {chatId: count} map, dropping non-positive counts.
 *
 * Driven against an operation-typed fake of the Drizzle chains the helper actually
 * calls — no live database (same approach as chatRunMilestones.test.ts).
 */

interface Captured {
  maxSeqQueried: boolean;
  insertValues: Record<string, unknown> | null;
  conflictSet: Record<string, unknown> | null;
}
let captured: Captured;
let maxSeqRow: Array<{ maxSeq: number }>;
let unreadRows: Array<{ chatId: number; unread: number }>;

/** Thenable select builder that resolves to `result` after any chain of methods. */
function selectBuilder(result: unknown[]) {
  const b: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where', 'groupBy', 'orderBy', 'limit']) b[m] = () => b;
  (b as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(result);
  return b;
}

function makeDb(): Db {
  return {
    // The only two selects the helper issues: max(seq) (markChatRead) and the
    // grouped unread read (unreadCountsForUser). Disambiguate by the projection.
    select: (proj?: Record<string, unknown>) => {
      if (proj && 'maxSeq' in proj) { captured.maxSeqQueried = true; return selectBuilder(maxSeqRow); }
      return selectBuilder(unreadRows);
    },
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.insertValues = v;
        return {
          onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
            captured.conflictSet = cfg.set;
            return Promise.resolve([]);
          },
        };
      },
    }),
  } as unknown as Db;
}

beforeEach(() => {
  captured = { maxSeqQueried: false, insertValues: null, conflictSet: null };
  maxSeqRow = [{ maxSeq: 0 }];
  unreadRows = [];
});

describe('markChatRead', () => {
  it('marks to an explicit seq WITHOUT querying the max', async () => {
    const stored = await markChatRead(makeDb(), 1, 'user-1', 42, 99);
    expect(stored).toBe(99);
    expect(captured.maxSeqQueried).toBe(false);
    expect(captured.insertValues).toMatchObject({ chatId: 42, userId: 'user-1', tenantId: 1, lastReadSeq: 99 });
  });

  it('snaps to the chat max seq when seq is omitted (mark everything read)', async () => {
    maxSeqRow = [{ maxSeq: 137 }];
    const stored = await markChatRead(makeDb(), 1, 'user-1', 42);
    expect(captured.maxSeqQueried).toBe(true);
    expect(stored).toBe(137);
    expect(captured.insertValues).toMatchObject({ lastReadSeq: 137 });
  });

  it('upserts with a GREATEST set so the mark only moves FORWARD (never rewinds)', async () => {
    await markChatRead(makeDb(), 1, 'user-1', 42, 5);
    // last_read_seq is a drizzle SQL EXPRESSION (not a plain literal), and its raw
    // chunks carry `greatest(` — the guard that a stale lower mark can't rewind it.
    const setSeq = captured.conflictSet?.lastReadSeq as { queryChunks?: unknown[] } | undefined;
    expect(typeof setSeq).toBe('object');
    // The raw SQL string chunks carry `greatest(` (a Column chunk sits between them,
    // so pull only the literal {value:[...]} chunks to avoid its circular ref).
    const literals = (setSeq?.queryChunks ?? [])
      .map((ch) => (ch as { value?: string[] })?.value?.join('') ?? '')
      .join(' ')
      .toLowerCase();
    expect(literals).toContain('greatest');
  });

  it('treats an empty chat as seq 0', async () => {
    maxSeqRow = [{ maxSeq: 0 }];
    const stored = await markChatRead(makeDb(), 1, 'user-1', 7);
    expect(stored).toBe(0);
  });
});

describe('unreadCountsForUser', () => {
  it('maps grouped rows to a {chatId: count} record', async () => {
    unreadRows = [{ chatId: 11, unread: 3 }, { chatId: 12, unread: 1 }];
    const out = await unreadCountsForUser(makeDb(), 1, 'user-1');
    expect(out).toEqual({ 11: 3, 12: 1 });
  });

  it('drops non-positive counts (only chats with real unread appear)', async () => {
    unreadRows = [{ chatId: 11, unread: 2 }, { chatId: 12, unread: 0 }];
    const out = await unreadCountsForUser(makeDb(), 1, 'user-1');
    expect(out).toEqual({ 11: 2 });
    expect(13 in out).toBe(false);
  });

  it('coerces string counts (postgres count() returns text over some drivers)', async () => {
    unreadRows = [{ chatId: 11, unread: '4' as unknown as number }];
    const out = await unreadCountsForUser(makeDb(), 1, 'user-1');
    expect(out).toEqual({ 11: 4 });
  });

  it('returns an empty map when the user has no unread chats', async () => {
    unreadRows = [];
    expect(await unreadCountsForUser(makeDb(), 1, 'user-1')).toEqual({});
  });
});
