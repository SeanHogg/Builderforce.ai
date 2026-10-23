/**
 * Project facts is ONE router served through two front doors. The JWT door and the
 * agent-host door reach the same recall core; the host door refuses a missing key
 * and never gates other routers sharing `/api/agent/projects`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const TENANT = 8;
const mocks = vi.hoisted(() => ({
  hostAuth: vi.fn(), recall: vi.fn(), owned: vi.fn(), cacheAnswer: vi.fn(),
  resolveAnswer: vi.fn(), upsert: vi.fn(), chat: vi.fn(), origin: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); c.set('userId', 'u1'); await next(); },
}));
vi.mock('../../infrastructure/auth/agentHostAuth', () => ({ resolveHostAuth: mocks.hostAuth }));
vi.mock('../../infrastructure/auth/segmentResolver', () => ({ resolveSegment: async () => 'seg-1' }));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../application/llm/projectFactsStore', () => ({
  hostDirectoryHashReader: () => async () => null,
  parseFactFileAnchors: (value: unknown) => (Array.isArray(value) ? value : undefined),
}));
vi.mock('../../application/llm/projectFactsRecall', () => ({ recallProjectFacts: mocks.recall }));
vi.mock('../../application/llm/projectFactsWrite', () => ({ upsertProjectFact: mocks.upsert, deleteProjectFact: vi.fn() }));
vi.mock('../../application/llm/projectMemory', () => ({
  cacheProjectAnswer: mocks.cacheAnswer,
  resolveMemoryAnswer: mocks.resolveAnswer,
}));
vi.mock('../../application/llm/memoryAnswerChat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/llm/memoryAnswerChat')>()),
  resolveAnswerChat: mocks.chat,
  chatAnswerOrigin: mocks.origin,
}));
vi.mock('../../application/llm/memoryAnswerSavings', () => ({ recordMemoryAnswerSavings: vi.fn(async () => {}) }));
vi.mock('../../application/llm/savingsLedger', () => ({ normalizeUsageSurface: () => 'web' }));
vi.mock('../../application/llm/evermindRuntime', () => ({}));

import { createProjectFactsRoutes } from './projectFactsRoutes';
import { agentHostDoor } from '../middleware/frontDoor';

const db = {} as never;
const facts = [{ key: 'k', content: 'c' }];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue(true);
  mocks.recall.mockResolvedValue(facts);
  mocks.hostAuth.mockResolvedValue({ id: 3, tenantId: TENANT });
  mocks.chat.mockResolvedValue({ chatId: 7, memoryEnabled: true });
  mocks.origin.mockResolvedValue(null);
});

/** A context whose `executionCtx.waitUntil` the savings write can ride. */
const ctxEnv = {};
const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as never;

describe('project facts front doors', () => {
  it('JWT door recalls through the shared core', async () => {
    const res = await createProjectFactsRoutes(db).request('/42/facts', {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ facts });
    expect(mocks.recall.mock.calls[0]![2]).toBe(TENANT);
  });

  it('agent-host door recalls through the same core with the host tenant', async () => {
    const res = await createProjectFactsRoutes(db, agentHostDoor(db)).request('/42/facts', {}, {});
    expect(res.status).toBe(200);
    expect(mocks.recall.mock.calls[0]![2]).toBe(TENANT);
  });

  it('agent-host door refuses a request without a host key', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await createProjectFactsRoutes(db, agentHostDoor(db)).request('/42/facts', {}, {});
    expect(res.status).toBe(401);
    expect(mocks.recall).not.toHaveBeenCalled();
  });

  it('cache-answer stamps the declared execution id instead of calling the header reader as (env, c)', async () => {
    mocks.cacheAnswer.mockResolvedValue(undefined);
    const res = await createProjectFactsRoutes(db).request('/42/answer', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-builderforce-execution-id': '91',
      },
      body: JSON.stringify({
        question: 'How does auth work?',
        answer: 'Auth uses PKCE.',
        fileAnchors: [{ path: 'src/auth.ts', contentHash: 'abc' }],
        // A client-asserted cost basis is NEVER trusted: it is stripped by the schema.
        origin: { model: 'gpt-test', promptTokens: 3, completionTokens: 4 },
      }),
    }, {});
    expect(res.status).toBe(200);
    expect(mocks.cacheAnswer).toHaveBeenCalledWith(
      expect.anything(),
      db,
      TENANT,
      42,
      'How does auth work?',
      'Auth uses PKCE.',
      null,
      [{ path: 'src/auth.ts', contentHash: 'abc' }],
      91,
      // The row is scoped to who produced it (defect 10).
      { userId: 'u1', role: null },
    );
  });

  it('memory-first lookup is scoped to the caller, the same scope the write used', async () => {
    mocks.resolveAnswer.mockResolvedValue(null);
    const res = await createProjectFactsRoutes(db).request('/42/answer?query=q%3F', {}, ctxEnv, execCtx);
    expect(res.status).toBe(200);
    expect(mocks.resolveAnswer.mock.calls[0]![5]).toMatchObject({ principal: { userId: 'u1', role: null } });
  });

  it('agent-host door leaves other paths on the shared mount ungated', async () => {
    mocks.hostAuth.mockResolvedValue(null);
    const res = await createProjectFactsRoutes(db, agentHostDoor(db)).request('/42/run-context', {}, {});
    expect(res.status).toBe(404);
  });
});

describe('memory-first answers act only for a chat the caller may act for', () => {
  const answerReq = (query: string) => createProjectFactsRoutes(db).request(`/42/answer?${query}`, {}, ctxEnv, execCtx);

  it('derives the cache write\'s cost basis from the chat\'s own usage row, not the body', async () => {
    mocks.origin.mockResolvedValue({ model: 'served/model', promptTokens: 900, completionTokens: 120 });
    const res = await createProjectFactsRoutes(db).request('/42/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'q?', answer: 'a.', chatId: 7, origin: { model: 'claimed', promptTokens: 999999, completionTokens: 999999 } }),
    }, {});
    expect(res.status).toBe(200);
    expect(mocks.chat).toHaveBeenCalledWith(db, { tenantId: TENANT, userId: 'u1', chatId: 7 });
    expect(mocks.cacheAnswer.mock.calls[0]![6]).toEqual({ model: 'served/model', promptTokens: 900, completionTokens: 120 });
  });

  it('does not cache into a chat whose Memory switch is off', async () => {
    mocks.chat.mockResolvedValue({ chatId: 7, memoryEnabled: false });
    const res = await createProjectFactsRoutes(db).request('/42/answer', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'q?', answer: 'a.', chatId: 7 }),
    }, {});
    expect(await res.json()).toMatchObject({ ok: false, reason: 'memory-off' });
    expect(mocks.cacheAnswer).not.toHaveBeenCalled();
  });

  it('never replays into a chat whose Memory switch is off', async () => {
    mocks.chat.mockResolvedValue({ chatId: 7, memoryEnabled: false });
    const res = await answerReq('query=hello&chatId=7');
    expect(await res.json()).toEqual({ answer: null });
    expect(mocks.resolveAnswer).not.toHaveBeenCalled();
  });

  it('refuses a chat the caller cannot access (404), and a malformed id (400)', async () => {
    mocks.chat.mockResolvedValue(null);
    expect((await answerReq('query=hello&chatId=7')).status).toBe(404);
    expect((await answerReq('query=hello&chatId=abc')).status).toBe(400);
    expect(mocks.resolveAnswer).not.toHaveBeenCalled();
  });

  it('a fact write ignores a client origin and uses the chat-derived one', async () => {
    mocks.upsert.mockResolvedValue(true);
    mocks.origin.mockResolvedValue({ model: 'served/model', promptTokens: 10, completionTokens: 5 });
    await createProjectFactsRoutes(db).request('/42/facts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'k', content: 'c', chatId: 7, origin: { model: 'claimed', promptTokens: 1, completionTokens: 1 } }),
    }, {});
    expect(mocks.upsert.mock.calls[0]![7]).toMatchObject({ origin: { model: 'served/model', promptTokens: 10, completionTokens: 5 } });
  });
});
