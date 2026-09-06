import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-1');
    c.set('tenantId', 5);
    c.set('role', 'developer');
    await next();
  },
}));

/** What the tenant's connected model answers; each test sets it. */
let reply: { status: number; content: string | null } | Error = { status: 200, content: '' };
const requests: Array<Record<string, unknown>> = [];

vi.mock('../../application/llm/tenantProxy', () => ({
  completeForTenant: vi.fn(async (_env: unknown, _tenantId: number, body: Record<string, unknown>) => {
    requests.push(body);
    if (reply instanceof Error) throw reply;
    const payload = reply.content === null ? {} : { choices: [{ message: { role: 'assistant', content: reply.content } }] };
    return {
      response: new Response(JSON.stringify(payload), { status: reply.status, headers: { 'content-type': 'application/json' } }),
      resolvedModel: 'byo/model',
      resolvedVendor: 'openai',
      retries: 0,
      failovers: [],
    };
  }),
}));

import { createPromptAnalyzerRoutes } from './promptAnalyzerRoutes';

const ENTRY = { id: 'p1', tenantId: 5, title: 'Summarise', description: null, category: 'writing', usageCount: 12, starCount: 3, currentVersion: 2 };
const VERSION = { entryId: 'p1', version: 2, body: 'Summarise {{text}} in three bullets.' };

/** A db whose two reads answer in order: the entry, then its current version. */
function fakeDb(rows: unknown[][]) {
  let call = 0;
  return {
    select: () => ({ from: () => ({ where: async () => rows[call++] ?? [] }) }),
  };
}

const analyze = (db: unknown) =>
  createPromptAnalyzerRoutes(db as never).request('/p1/analyze', { method: 'POST' }, {});

/**
 * The analyzer after the structured-output consolidation: a JSON answer (fenced or
 * bare) becomes `{ suggestion, rationale }`; prose that carries no JSON is still
 * shown to the user as the suggestion; a gateway failure is a 502 naming the status.
 */
describe('POST /:id/analyze', () => {
  it('404s an entry the tenant does not have', async () => {
    const res = await analyze(fakeDb([[]]));
    expect(res.status).toBe(404);
  });

  it('400s an entry with no current version body', async () => {
    const res = await analyze(fakeDb([[ENTRY], [{ ...VERSION, body: '   ' }]]));
    expect(res.status).toBe(400);
  });

  it('returns the structured suggestion from a fenced JSON reply', async () => {
    requests.length = 0;
    reply = { status: 200, content: '```json\n{"suggestion": "Summarise {{text}} in exactly three bullets, each under 15 words.", "rationale": "Bounds the output."}\n```' };
    const res = await analyze(fakeDb([[ENTRY], [VERSION]]));
    expect(res.status).toBe(200);
    const body = await res.json() as { suggestion: string; rationale: string | null; basedOnVersion: number; stats: { usageCount: number } };
    expect(body.suggestion).toBe('Summarise {{text}} in exactly three bullets, each under 15 words.');
    expect(body.rationale).toBe('Bounds the output.');
    expect(body.basedOnVersion).toBe(2);
    expect(body.stats.usageCount).toBe(12);
    // A revision is a sample, not the mode.
    expect(requests[0]?.temperature).toBe(0.4);
    // The prompt asks for JSON in prose; no response_format is imposed.
    expect(requests[0]?.response_format).toBeUndefined();
  });

  it('falls back to the raw text when the reply carries no JSON', async () => {
    reply = { status: 200, content: 'Try asking for three bullets and a word limit.' };
    const res = await analyze(fakeDb([[ENTRY], [VERSION]]));
    expect(res.status).toBe(200);
    const body = await res.json() as { suggestion: string; rationale: null };
    expect(body.suggestion).toBe('Try asking for three bullets and a word limit.');
    expect(body.rationale).toBeNull();
  });

  it('falls back to the raw text when the JSON has no suggestion', async () => {
    reply = { status: 200, content: '{"rationale": "nothing to change"}' };
    const res = await analyze(fakeDb([[ENTRY], [VERSION]]));
    expect(res.status).toBe(200);
    const body = await res.json() as { suggestion: string; rationale: null };
    expect(body.suggestion).toBe('{"rationale": "nothing to change"}');
    expect(body.rationale).toBeNull();
  });

  it('502s a gateway failure naming the status', async () => {
    reply = { status: 429, content: null };
    const res = await analyze(fakeDb([[ENTRY], [VERSION]]));
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toBe('gateway 429');
  });

  it('502s a dispatcher that throws, without echoing its message', async () => {
    reply = new Error('ECONNRESET upstream 10.0.0.7');
    const res = await analyze(fakeDb([[ENTRY], [VERSION]]));
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('analysis failed');
    expect(body.error).not.toContain('10.0.0.7');
  });
});
