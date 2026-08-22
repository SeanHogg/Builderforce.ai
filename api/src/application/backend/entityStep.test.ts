/**
 * The `entity` step — the leg that lets a published app read its owner's business.
 *
 * The properties pinned here are the ones whose absence is a DATA-EXPOSURE bug
 * rather than a broken page: a grant that widens past what the spec declared, a
 * request that can choose its own domain, or a runtime that reads a tenant the
 * site does not belong to. The step is reachable from a public URL by an
 * anonymous visitor, so "it only returns nothing" is not an acceptable failure
 * mode for any of them.
 */
import { describe, it, expect } from 'vitest';
import { parseHandlerSpec } from './handlerSpec';
import { executeHandler, type HandlerRuntimeDeps } from './handlerRuntime';
import type { EntityRead } from './entityRead';

const spec = (steps: unknown[], respond: unknown = { kind: 'json', body: {} }) => ({
  route: '/jobs',
  method: 'GET',
  verify: 'none',
  steps,
  respond,
});

const entityStep = (over: Record<string, unknown> = {}) => ({
  id: 'jobs',
  kind: 'entity',
  domain: 'hiring',
  objectKind: 'job_posting',
  ...over,
});

function parsed(steps: unknown[], respond?: unknown) {
  const result = parseHandlerSpec(spec(steps, respond), 'jobs');
  if (!result.ok) throw new Error(`spec did not parse: ${result.reason}`);
  return result.spec;
}

/** The parse FAILURE, for the cases whose whole point is that they are refused. */
function refused(steps: unknown[]): string {
  const result = parseHandlerSpec(spec(steps), 'jobs');
  if (result.ok) throw new Error('expected the spec to be refused, and it parsed');
  return result.reason;
}

const ctx = {
  body: {},
  query: {} as Record<string, string>,
  headers: {},
  project: { id: 1, name: 'Hired', ingressUrl: 'https://example.test/hooks/t' },
};

function deps(over: Partial<HandlerRuntimeDeps> = {}): HandlerRuntimeDeps {
  return {
    llm: async () => '',
    callConnector: async () => ({ ok: true, status: 200, data: {} }),
    readCollection: async () => ({ collection: '', count: 0, records: [] }),
    ...over,
  } as HandlerRuntimeDeps;
}

describe('parsing an entity step', () => {
  it('accepts a declared domain and object kind', () => {
    const s = parsed([entityStep()]);
    expect(s.steps[0]).toMatchObject({ kind: 'entity', domain: 'hiring', objectKind: 'job_posting' });
  });

  it('rejects a domain the kernel does not know', () => {
    // A spec is stored data that becomes a public endpoint. A domain that does
    // not exist can only ever return nothing, and an author who typed it should
    // be told, not left staring at an empty page in production.
    expect(refused([entityStep({ domain: 'hirring' })])).toMatch(/known domain/);
  });

  it('refuses a domain-wide grant with no object kind', () => {
    // "Everything in `hiring`" is not a sentence an author should be able to
    // write by accident — the (domain, kind) pair IS the grant.
    expect(refused([entityStep({ objectKind: '' })])).toMatch(/objectKind/);
  });

  it('has no wildcard form', () => {
    // A `*` is a plausible thing for an author to try, and it must be a kind
    // NAMED `*` (matching nothing) rather than a match-everything grant.
    const s = parsed([entityStep({ objectKind: '*' })]);
    expect(s.steps[0]).toMatchObject({ objectKind: '*' });
  });
});

describe('executing an entity step', () => {
  it('passes only the declared domain and kind to the reader', async () => {
    const seen: unknown[] = [];
    await executeHandler(
      parsed([entityStep()]),
      { ...ctx, query: { domain: 'finance', objectKind: 'invoice' } },
      deps({
        readEntities: async (args) => {
          seen.push(args);
          return { domain: args.domain, kind: args.objectKind, count: 0, items: [] } satisfies EntityRead;
        },
      }),
    );
    // The request named a different domain and kind. Neither reached the reader:
    // a caller can filter WITHIN what the spec declared and cannot widen it.
    expect(seen).toEqual([{ domain: 'hiring', objectKind: 'job_posting' }]);
  });

  it('templates the title filter from the request', async () => {
    const seen: unknown[] = [];
    await executeHandler(
      parsed([entityStep({ titleContains: '{{query.q}}' })]),
      { ...ctx, query: { q: 'engineer' } },
      deps({
        readEntities: async (args) => {
          seen.push(args);
          return { domain: args.domain, kind: args.objectKind, count: 0, items: [] } satisfies EntityRead;
        },
      }),
    );
    expect(seen).toEqual([{ domain: 'hiring', objectKind: 'job_posting', titleContains: 'engineer' }]);
  });

  it('binds the read so a page can render it', async () => {
    const result = await executeHandler(
      parsed([entityStep()], { kind: 'text', text: 'Open roles: {{steps.jobs.count}}' }),
      ctx,
      deps({
        readEntities: async () => ({
          domain: 'hiring',
          kind: 'job_posting',
          count: 2,
          items: [
            { id: 'a', kind: 'job_posting', title: 'Engineer', updatedAt: null },
            { id: 'b', kind: 'job_posting', title: 'Designer', updatedAt: null },
          ],
        }),
      }),
    );
    expect(result.body).toBe('Open roles: 2');
    expect(result.steps[0]).toMatchObject({ id: 'jobs', kind: 'entity', ok: true });
  });

  it('degrades to an empty read where no kernel is behind the runtime', async () => {
    // The self-hosted adapters compile a spec into the customer's own cloud,
    // where there is no `objects` table. The page must render its empty state
    // rather than 500, and the reason must be visible in the outcome list.
    const result = await executeHandler(
      parsed([entityStep()], { kind: 'text', text: 'Open roles: {{steps.jobs.count}}' }),
      ctx,
      deps(),
    );
    expect(result.body).toBe('Open roles: 0');
    expect(result.steps[0]?.error).toMatch(/no entity reader/);
  });
});
