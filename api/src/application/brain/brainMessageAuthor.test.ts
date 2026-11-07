/**
 * PRD 42 Part E - a human message's author is a column, stamped server-side from the authenticated caller, and
 * the ONE row shape answers the chat owner for a legacy role='user' row with no stamped author.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

vi.mock('./chatCacheVersions', () => ({ bumpChatMessages: vi.fn(async () => undefined), bumpUnreadForChatAudience: vi.fn(async () => undefined) }));
vi.mock('./brainChatGuards', () => ({
  canAccessChat: vi.fn(async () => ({ id: 9, ownerId: 'owner-1' })),
  ensureMembership: vi.fn(async () => undefined),
}));

import { appendMessages } from './brainMessages';
import { messageColumns } from './brainChatShapes';
import { messageAuthorFor } from './messageAuthor';

function capturingDb() {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [{ tenantId: 1, lastSeq: 0 }] }) }) }),
    insert: () => ({
      values: (rows: Array<Record<string, unknown>>) => {
        inserted.push(...rows);
        return { onConflictDoNothing: () => ({ returning: async () => rows.map((r, i) => ({ id: i + 1, seq: i + 1, metadata: null, ...r, eventKey: null })) }) };
      },
    }),
  } as never;
  return { db, inserted };
}

describe('appendMessages - author stamping', () => {
  it('stamps authorUserId from the authenticated user on human turns, never from the body', async () => {
    const { db, inserted } = capturingDb();
    const body = { messages: [
      { role: 'user', content: 'hi', authorUserId: 'spoofed' },
      { role: 'assistant', content: 'hello', authorUserId: 'spoofed' },
    ] } as never;

    await appendMessages(db, 9, 1, 'caller-7', body);

    expect(inserted.map((r) => [r.role, r.authorUserId])).toEqual([['user', 'caller-7'], ['assistant', null]]);
  });
});

describe('messageAuthorFor', () => {
  it('returns the user id for a human turn', () => {
    expect(messageAuthorFor('user', 'u-1')).toBe('u-1');
  });
  it.each(['agentHost:5', 'agentHost:mcp', 'embed:key-9'])('is null for the machine subject %s', (sub) => {
    expect(messageAuthorFor('user', sub)).toBeNull();
  });
  it('is null for non-human roles', () => {
    expect(messageAuthorFor('assistant', 'u-1')).toBeNull();
  });
});

describe('appendMessages - machine callers and unknown authors', () => {
  it('stamps null for a machine subject', async () => {
    const { db, inserted } = capturingDb();
    await appendMessages(db, 9, 1, 'agentHost:5', { messages: [{ role: 'user', content: 'x' }] } as never);
    expect(inserted[0]?.authorUserId).toBeNull();
  });
  it('stamps null when authorUnknown (claimed guest room)', async () => {
    const { db, inserted } = capturingDb();
    await appendMessages(db, 9, 1, 'caller-7', { messages: [{ role: 'user', content: 'x' }] } as never, { authorUnknown: true });
    expect(inserted[0]?.authorUserId).toBeNull();
  });
});

describe('messageColumns.authorUserId', () => {
  it('is the raw column: legacy rows stay NULL (unknown), no owner fallback', () => {
    const { sql } = new PgDialect().sqlToQuery(messageColumns.authorUserId.getSQL());
    expect(sql).not.toMatch(/COALESCE|select/i);
  });

  it('is part of the one message row shape every transcript read returns', () => {
    expect(Object.keys(messageColumns)).toContain('authorUserId');
  });
});
