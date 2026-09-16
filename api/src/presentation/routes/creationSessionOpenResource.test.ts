import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * `POST /resources/:resourceType/:resourceId/open` — opening a Brain chat as a
 * creation session.
 *
 * This file exists because the route had NO tests at all while embedding its own
 * `brain_chat_messages` query, which is how it came to read the transcript the
 * wrong way round: `ORDER BY seq LIMIT 500` seeded a long chat with its OPENING
 * five hundred rows and silently dropped everything recent. The query now lives
 * behind `BrainService.getMessages`, and the assertions below are about that seam —
 * that the route asks the port, honours the port's refusal, and maps what comes
 * back — rather than about SQL it no longer owns.
 */

const TENANT = 91;
const SEGMENT = 'seg-default';
const USER = 'user-1';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('tenantId', TENANT);
    c.set('segmentId', SEGMENT);
    c.set('userId', USER);
    c.set('role', 'manager');
    await next();
  },
  requireRole: () => async (_c: any, next: any) => next(),
}));

const chatAccess = vi.fn();
vi.mock('../../application/brain/chatAccess', () => ({
  resolveChatAccess: (...args: unknown[]) => chatAccess(...args),
}));

const getMessages = vi.fn();
vi.mock('../../application/brain/BrainService', () => ({
  BrainService: class {
    getMessages = (...args: unknown[]) => getMessages(...args);
  },
}));

vi.mock('../../application/creation/creationGraphWriter', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  newCreationSessionStatements: () => [{ statement: { kind: 'session' } }],
}));

import { createCreationSessionRoutes } from './creationSessionRoutes';

const CHAT = { title: 'PRD review', projectId: 11, segmentId: SEGMENT };
const msg = (id: number, role: string, content: string) => ({
  id, role, content, metadata: null, seq: id, createdAt: new Date('2026-09-15T00:00:00Z'),
});

/** Db stub: the duplicate-session lookup resolves to `existing`, batch is captured. */
function makeDb(existing: unknown[] = []) {
  const batched: unknown[][] = [];
  const timelineValues: unknown[] = [];
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'innerJoin', 'where', 'orderBy', 'limit']) chain[m] = () => chain;
  (chain as { then: unknown }).then = (resolve: (v: unknown[]) => void) => resolve(existing);
  const db = {
    select: () => chain,
    insert: () => ({
      values: (v: unknown) => {
        timelineValues.push(v);
        return { onConflictDoNothing: () => ({ kind: 'link' }) };
      },
    }),
    batch: async (s: unknown[]) => { batched.push(s); return []; },
  };
  return { db: db as any, batched, timelineValues };
}

const open = (type: string, id: string, db: any) =>
  createCreationSessionRoutes(db).request(`/resources/${type}/${id}/open`, { method: 'POST' });

beforeEach(() => {
  chatAccess.mockReset();
  getMessages.mockReset();
});

describe('opening a Brain chat as a creation session', () => {
  it('seeds the timeline from the transcript port, not from its own query', async () => {
    chatAccess.mockResolvedValue(CHAT);
    getMessages.mockResolvedValue([msg(1, 'user', 'go'), msg(2, 'assistant', 'the closing summary')]);
    const { db, timelineValues } = makeDb();

    const res = await open('chat', '117', db);
    expect(res.status).toBe(201);

    // The port was asked for THIS chat, scoped to the caller, with the route's cap.
    expect(getMessages).toHaveBeenCalledWith(117, TENANT, USER, 500);
    const seeded = timelineValues.find((v) => Array.isArray(v)) as Array<Record<string, unknown>>;
    expect(seeded.map((r) => r.body)).toEqual(['go', 'the closing summary']);
    expect(seeded.map((r) => r.messageRole)).toEqual(['user', 'assistant']);
    // Attribution: a user's line is theirs, the model's is nobody's.
    expect(seeded.map((r) => r.createdBy)).toEqual([USER, null]);
    expect(seeded[0]!.clientMessageId).toBe('legacy-chat:117:1');
  });

  it('files a tool step as a system line rather than dropping it', async () => {
    chatAccess.mockResolvedValue(CHAT);
    getMessages.mockResolvedValue([msg(1, 'tool', '')]);
    const { db, timelineValues } = makeDb();

    await open('chat', '117', db);
    const seeded = timelineValues.find((v) => Array.isArray(v)) as Array<Record<string, unknown>>;
    expect(seeded[0]!.messageRole).toBe('system');
  });

  it('answers 404 when the port refuses the chat', async () => {
    // The union branch: access passed the route's own check but the port disagreed.
    chatAccess.mockResolvedValue(CHAT);
    getMessages.mockResolvedValue({ error: 'Chat not found' });
    const res = await open('chat', '117', makeDb().db);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Chat not found' });
  });

  it('answers 404 for a chat the caller cannot reach, without asking for messages', async () => {
    chatAccess.mockResolvedValue(null);
    const res = await open('chat', '117', makeDb().db);
    expect(res.status).toBe(404);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('refuses a chat belonging to another segment', async () => {
    chatAccess.mockResolvedValue({ ...CHAT, segmentId: 'other-segment' });
    const res = await open('chat', '117', makeDb().db);
    expect(res.status).toBe(404);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric chat id before any lookup', async () => {
    const res = await open('chat', 'not-a-number', makeDb().db);
    expect(res.status).toBe(400);
    expect(chatAccess).not.toHaveBeenCalled();
  });

  it('returns the existing session instead of opening a second one', async () => {
    chatAccess.mockResolvedValue(CHAT);
    getMessages.mockResolvedValue([msg(1, 'user', 'go')]);
    const { db, batched } = makeDb([{ sessionId: 'sess-1', objectId: 'obj-1' }]);

    const res = await open('chat', '117', db);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sessionId: 'sess-1', objectId: 'obj-1', created: false });
    expect(batched).toHaveLength(0);
  });

  it('writes no timeline statement for an empty chat', async () => {
    chatAccess.mockResolvedValue(CHAT);
    getMessages.mockResolvedValue([]);
    const { db, timelineValues } = makeDb();
    expect((await open('chat', '117', db)).status).toBe(201);
    expect(timelineValues.some((v) => Array.isArray(v))).toBe(false);
  });

  it('refuses a resource type it does not know', async () => {
    const res = await open('teapot', 'abc', makeDb().db);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Unsupported resource type' });
  });
});
