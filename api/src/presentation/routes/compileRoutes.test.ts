import { describe, expect, it, vi } from 'vitest';

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => {
    c.set('userId', 'user-1');
    c.set('tenantId', 5);
    c.set('role', 'developer');
    await next();
  },
}));

// The cloud dispatcher drags the whole runtime surface in at import; nothing here
// deploys to a board task, so it is never called.
vi.mock('./runtimeRoutes', () => ({ dispatchCloudRunForTask: vi.fn() }));

/** The prose adapter's extractor; a test that wants `compile` to fail makes it throw. */
let extractor: (system: string, user: string) => Promise<string> = async () => '';
vi.mock('../../application/llm/gatewayExtractor', () => ({
  gatewayExtractor: () => (system: string, user: string) => extractor(system, user),
}));

/** What the tenant's connected model answers for the first turn; each test sets it. */
let reply: { status: number; content: string | null } | Error = { status: 200, content: '' };
vi.mock('../../application/llm/tenantProxy', () => ({
  completeForTenant: vi.fn(async () => {
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

import { createCompileRoutes } from './compileRoutes';
import { errorHandler } from '../middleware/errorHandler';

function app() {
  const router = createCompileRoutes({} as never, {} as never);
  router.onError(errorHandler as never);
  return router;
}

const post = (path: string, body: unknown) =>
  app().request(path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }, {}, { waitUntil: () => {}, passThroughOnException: () => {} } as never);

/** A persona need lowers without an LLM or a knowledge read — the pure path. */
const PERSONA = { modality: 'persona', directives: ['Be terse.'], execParams: { temperature: 0.3 } };

/**
 * The compile front door after the body-validation pass: the needs, the deploy
 * surface and the ids are admitted by schema (a wrong modality names the field), and
 * the first turn of `/run` is read through the shared choice reader.
 */
describe('POST /api/compile', () => {
  it('400s a body with neither need nor needs[]', async () => {
    const res = await post('/', {});
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string; issues: Array<{ path: string; message: string }> };
    expect(body.error).toMatch(/^Invalid request body/);
    expect(body.issues.some((issue) => issue.message === 'need (or needs[]) is required')).toBe(true);
  });

  it('400s a need with an unknown modality, naming the field', async () => {
    const res = await post('/', { needs: [{ modality: 'telepathy' }] });
    expect(res.status).toBe(400);
    const body = await res.json() as { issues: Array<{ path: string }> };
    expect(body.issues.some((issue) => issue.path === 'needs.0.modality')).toBe(true);
  });

  it('400s an unknown deploy surface', async () => {
    const res = await post('/', { need: PERSONA, deploy: 'mainframe' });
    expect(res.status).toBe(400);
    const body = await res.json() as { issues: Array<{ path: string }> };
    expect(body.issues.some((issue) => issue.path === 'deploy')).toBe(true);
  });

  it('compiles a need into a spec without a deploy plan', async () => {
    const res = await post('/', { need: PERSONA });
    expect(res.status).toBe(200);
    // The lowered directives land in the spec's `persona` SLOT, not at the root —
    // that slot is what `mergeSpecs` accumulates, and it is how a persona threads
    // onto the same spec as a model and its steps.
    const body = await res.json() as { spec: { persona?: { directives?: string[] } }; plan?: unknown };
    expect(body.spec.persona?.directives).toContain('Be terse.');
    expect(body.plan).toBeUndefined();
  });

  it('keeps the need payload the adapter reads (loose object, nothing stripped)', async () => {
    const res = await post('/', { need: { ...PERSONA, execParams: { temperature: 0.9 } } });
    const body = await res.json() as { spec: { persona?: { execParams?: { temperature?: number } } } };
    expect(body.spec.persona?.execParams?.temperature).toBe(0.9);
  });

  it('degrades a failed extraction to a usable spec, never leaking the extractor text', async () => {
    // The prose adapter is documented as NEVER throwing: a gateway that is down
    // must not cost the caller their compile, so extraction failure falls back to a
    // spec built from the prose itself. The invariant under test is therefore what
    // the caller GETS — a usable spec — and that nothing internal rides along.
    extractor = async () => { throw new Error('gateway 503 from 10.0.0.9'); };
    const res = await post('/', { need: { modality: 'prose', text: 'an agent that triages tickets' } });
    expect(res.status).toBe(200);
    const body = await res.json() as { spec: { identity: { name: string; bio?: string } } };
    expect(body.spec.identity.name).toBe('Custom Agent');
    expect(JSON.stringify(body)).not.toContain('10.0.0.9');
    extractor = async () => '';
  });
});

describe('POST /api/compile/run', () => {
  it('runs the first turn and returns the assistant text', async () => {
    reply = { status: 200, content: 'Hello — I keep answers short.' };
    const res = await post('/run', { need: PERSONA, sample: 'Introduce yourself' });
    expect(res.status).toBe(200);
    const body = await res.json() as { spec: unknown; plan: { surface: string }; output: string };
    expect(body.output).toBe('Hello — I keep answers short.');
    expect(body.plan).toBeTruthy();
  });

  it('502s a gateway failure naming the status and keeping spec + plan', async () => {
    reply = { status: 502, content: null };
    const res = await post('/run', { need: PERSONA });
    expect(res.status).toBe(502);
    const body = await res.json() as { error: string; spec: unknown; plan: unknown };
    expect(body.error).toBe('gateway 502');
    expect(body.spec).toBeTruthy();
    expect(body.plan).toBeTruthy();
  });

  it('answers a dispatcher that throws generically, keeping spec + plan', async () => {
    reply = new Error('credential vault unreachable at 10.0.0.3');
    const res = await post('/run', { need: PERSONA });
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string; spec: unknown; plan: unknown };
    expect(body.error).not.toContain('10.0.0.3');
    expect(body.spec).toBeTruthy();
    expect(body.plan).toBeTruthy();
  });
});
