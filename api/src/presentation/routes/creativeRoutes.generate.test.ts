import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-1');
    c.set('tenantId', 5);
    c.set('role', 'developer');
    await next();
  },
}));

/** What the free pool answers; each test sets it. `null` content = an empty choice. */
let reply: { status: number; content: string | null } = { status: 200, content: '' };
const completions: Array<Record<string, unknown>> = [];

vi.mock('../../application/llm/LlmProxyService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/llm/LlmProxyService')>()),
  ideProxy: () => ({
    complete: vi.fn(async (request: Record<string, unknown>) => {
      completions.push(request);
      const body = reply.content === null ? {} : { choices: [{ message: { role: 'assistant', content: reply.content } }] };
      return {
        response: new Response(JSON.stringify(body), { status: reply.status, headers: { 'content-type': 'application/json' } }),
        resolvedModel: 'pool/model',
        resolvedVendor: 'openrouter',
        retries: 0,
        failovers: [],
      };
    }),
  }),
}));

import { Hono } from 'hono';
import { createCreativeRoutes } from './creativeRoutes';
import { errorHandler } from '../middleware/errorHandler';

function app() {
  const root = new Hono();
  root.onError(errorHandler as never);
  root.route('/', createCreativeRoutes());
  return root;
}

const generate = (body: unknown) =>
  app().request('/generate', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, {});

const TEMPLATE = { id: 'weekly-report', name: 'Weekly report', description: 'A status template', fields: [{ key: 'summary', label: 'Summary', type: 'textarea' }] };

/**
 * `/generate` after the structured-output consolidation: a JSON deliverable is read
 * by `completeJson` (fence-tolerant, object-only) and a text deliverable stays a plain
 * completion. The body is admitted by schema, so an unknown kind is a 400 with the
 * field named rather than a hand-rolled sentence.
 */
describe('POST /generate', () => {
  it('400s an unknown kind with the field named', async () => {
    const res = await generate({ kind: 'sculpture', brief: 'a thing' });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: Array<{ path: string }> };
    expect(body.error).toMatch(/^Invalid request body/);
    expect(body.issues.some((issue) => issue.path === 'kind')).toBe(true);
  });

  it('400s a missing brief', async () => {
    const res = await generate({ kind: 'podcast', title: 'Ep 1' });
    expect(res.status).toBe(400);
    const body = await res.json() as { issues: Array<{ path: string }> };
    expect(body.issues.some((issue) => issue.path === 'brief')).toBe(true);
  });

  it('reads a fenced template reply as JSON and hands back the validated object', async () => {
    completions.length = 0;
    reply = { status: 200, content: '```json\n' + JSON.stringify(TEMPLATE) + '\n```' };
    const res = await generate({ kind: 'template', title: 'Weekly', brief: 'A weekly status report' });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; model: string; artifactKind: string; fileName: string };
    expect(JSON.parse(body.content)).toEqual(TEMPLATE);
    expect(body.model).toBe('pool/model');
    expect(body.artifactKind).toBe('template');
    expect(body.fileName).toBe('weekly.json');
    // The loose object format rides on the request so the gateway asks for JSON.
    expect(completions[0]?.response_format).toEqual({ type: 'json_object' });
    expect(completions[0]?.useCase).toBe('creative_template');
  });

  it('502s a template reply that is not JSON, with the template sentence', async () => {
    reply = { status: 200, content: 'Sorry, I cannot design that.' };
    const res = await generate({ kind: 'template', brief: 'A weekly status report' });
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toBe('The generated template was not valid JSON');
  });

  it('502s a template reply that is a JSON array (an object was asked for)', async () => {
    reply = { status: 200, content: '[1, 2, 3]' };
    const res = await generate({ kind: 'template', brief: 'A weekly status report' });
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toBe('The generated template was not valid JSON');
  });

  it('502s a gateway failure for a JSON deliverable without leaking anything', async () => {
    reply = { status: 503, content: null };
    const res = await generate({ kind: 'cad', brief: 'A mounting plate' });
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toBe('Creative generation is unavailable');
  });

  it('sends the strict geometry schema for a geometry kind', async () => {
    completions.length = 0;
    reply = { status: 200, content: '{}' };
    await generate({ kind: 'model3d', brief: 'A bracket' });
    expect((completions[0]?.response_format as { type: string }).type).toBe('json_schema');
    expect(completions[0]?.temperature).toBe(0.2);
  });

  it('keeps a text deliverable as a plain completion, fence stripped', async () => {
    completions.length = 0;
    const script = '# Episode 1\n\n**Host:** Welcome to the show, today we talk about compilers and why they matter.';
    reply = { status: 200, content: '```markdown\n' + script + '\n```' };
    const res = await generate({ kind: 'podcast', title: 'Episode 1', brief: 'Compilers' });
    expect(res.status).toBe(200);
    const body = await res.json() as { content: string; fileName: string; model: string };
    expect(body.content).toBe(script);
    expect(body.fileName).toBe('episode-1-script.md');
    expect(body.model).toBe('pool/model');
    expect(completions[0]?.response_format).toBeUndefined();
  });

  it('502s an empty text reply', async () => {
    reply = { status: 200, content: '' };
    const res = await generate({ kind: 'resume', brief: 'A backend engineer' });
    expect(res.status).toBe(502);
    expect((await res.json() as { error: string }).error).toBe('The generator returned nothing');
  });
});
