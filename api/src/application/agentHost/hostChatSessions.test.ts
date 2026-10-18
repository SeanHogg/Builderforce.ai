import { describe, expect, it } from 'vitest';
import {
  listChatMessagesBySessionKey,
  listChatSessionMessages,
  persistHostChatMessages,
} from './hostChatSessions';
import { fakeDb } from '../../../test/fakeDb';
import type { Db } from '../../infrastructure/database/connection';

const host = { id: 3, tenantId: 9 };
const msgs = [
  { role: 'user', content: 'hi', seq: 1 },
  { role: 'assistant', content: 'hello', metadata: '{}', seq: 2 },
];

describe('persistHostChatMessages', () => {
  it('creates the session when none exists and counts only inserted rows', async () => {
    // select session (none) → insert session → insert messages (1 of 2 new) → update stats
    const db = fakeDb([[], [{ id: 50 }], [{ id: 1 }], []]);
    const out = await persistHostChatMessages(db as unknown as Db, host, { sessionKey: 'main', projectId: 4, messages: msgs });
    expect(out).toEqual({ inserted: 1, sessionId: 50 });
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'insert', 'insert', 'update']);
    expect(db.calls[1]!.payload).toEqual({ tenantId: 9, agentHostId: 3, sessionKey: 'main', projectId: 4 });
    expect(db.calls[2]!.payload).toEqual([
      { tenantId: 9, agentHostId: 3, sessionId: 50, role: 'user', content: 'hi', metadata: null, seq: 1 },
      { tenantId: 9, agentHostId: 3, sessionId: 50, role: 'assistant', content: 'hello', metadata: '{}', seq: 2 },
    ]);
    expect(db.calls[3]!.payload).toMatchObject({ msgCount: 1 });
  });

  it('reuses an existing session and adds to its running count', async () => {
    const db = fakeDb([[{ id: 7, msgCount: 10 }], [{ id: 1 }, { id: 2 }], []]);
    const out = await persistHostChatMessages(db as unknown as Db, host, { sessionKey: 'main', messages: msgs });
    expect(out).toEqual({ inserted: 2, sessionId: 7 });
    expect(db.calls.map((c) => c.kind)).toEqual(['select', 'insert', 'update']);
    expect(db.calls[2]!.payload).toMatchObject({ msgCount: 12 });
  });
});

describe('chat history reads', () => {
  it('a session outside the tenant reads as null (route 404s)', async () => {
    const db = fakeDb([[]]);
    expect(await listChatSessionMessages(db as unknown as Db, 9, 5, 100)).toBeNull();
    expect(db.calls).toHaveLength(1);
  });

  it('returns the session messages when the session is the tenant\'s', async () => {
    const rows = [{ id: 1, role: 'user', content: 'hi', metadata: null, seq: 1, createdAt: null }];
    const db = fakeDb([[{ id: 5 }], rows]);
    expect(await listChatSessionMessages(db as unknown as Db, 9, 5, 100)).toEqual(rows);
  });

  it('an unknown session key reads as an empty list', async () => {
    const db = fakeDb([[]]);
    expect(await listChatMessagesBySessionKey(db as unknown as Db, 9, 3, 'nope', 50)).toEqual([]);
  });
});
