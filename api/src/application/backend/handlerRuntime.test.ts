/**
 * Handler-runtime tests — the executor every declarative project backend runs on.
 *
 * The behaviours pinned here are the ones that decide whether a live Twilio call
 * survives: step ordering (so a reply can reference a classification), the
 * failure posture (a broken step must not drop the call), and the template scope
 * (an unset field must not surface to a customer as the word "undefined").
 */
import { describe, it, expect, vi } from 'vitest';
import type { ConnectorCallResult } from '../connectors/connectorRuntime';
import {
  evaluateWhen,
  executeHandler,
  MAX_EXECUTED_STEPS,
  renderTemplate,
  renderValue,
  resolvePath,
  type HandlerRuntimeDeps,
} from './handlerRuntime';
import type { HandlerSpec } from './handlerSpec';

const ctx = (body: Record<string, unknown> = {}) => ({
  body,
  query: {},
  headers: {},
  project: { id: 7, name: 'Acme', ingressUrl: 'https://api.test/hooks/tok' },
});

const ok = (data: unknown): ConnectorCallResult => ({ ok: true, status: 200, data, durationMs: 1 });

function deps(over: Partial<HandlerRuntimeDeps> = {}): HandlerRuntimeDeps {
  return {
    llm: vi.fn(async () => 'model reply'),
    callConnector: vi.fn(async () => ok({ sid: 'SM1' })),
    readCollection: vi.fn(async () => ({ collection: 'signups', count: 0, records: [] })),
    ...over,
  };
}

const handler = (over: Partial<HandlerSpec> = {}): HandlerSpec => ({
  name: 'h',
  route: '/sms',
  method: 'POST',
  verify: 'twilio',
  steps: [],
  respond: { kind: 'empty' },
  ...over,
});

describe('templates', () => {
  it('renders a missing value as empty, never the word "undefined"', () => {
    // This string can go out over SMS to a customer.
    expect(renderTemplate('You pressed {{body.Digits}}.', { body: {} })).toBe('You pressed .');
  });

  it('resolves dotted and bracketed paths', () => {
    const scope = { a: { b: [{ c: 'x' }] } };
    expect(resolvePath(scope, 'a.b[0].c')).toBe('x');
    expect(resolvePath(scope, 'a.b.0.c')).toBe('x');
    expect(resolvePath(scope, 'a.missing.c')).toBeUndefined();
  });

  it('preserves the type when a string is exactly one template', () => {
    const scope = { steps: { urls: ['https://x.test/a.png'] } };
    expect(renderValue('{{steps.urls}}', scope)).toEqual(['https://x.test/a.png']);
    // …but stringifies when embedded.
    expect(renderValue('see {{steps.urls}}', scope)).toBe('see ["https://x.test/a.png"]');
  });

  it('renders nested objects and arrays', () => {
    expect(renderValue({ To: '{{body.From}}', tags: ['{{body.X}}'] }, { body: { From: '+1', X: 'a' } }))
      .toEqual({ To: '+1', tags: ['a'] });
  });
});

describe('evaluateWhen', () => {
  it('is true with no condition and for any non-empty value', () => {
    expect(evaluateWhen(undefined, {})).toBe(true);
    expect(evaluateWhen('{{body.Digits}}', { body: { Digits: '3' } })).toBe(true);
  });

  it('is false for empty and for the explicit falsey words', () => {
    expect(evaluateWhen('{{body.Digits}}', { body: {} })).toBe(false);
    for (const word of ['false', '0', 'no', 'off', 'null', 'undefined']) {
      expect(evaluateWhen('{{body.X}}', { body: { X: word } })).toBe(false);
    }
  });
});

describe('executeHandler', () => {
  it('binds each step before the next renders', async () => {
    const d = deps();
    const spec = handler({
      steps: [
        { kind: 'llm', id: 'reply', prompt: 'answer {{body.Body}}' },
        { kind: 'connector', id: 'sent', connector: 'twilio', actionKey: 'send_sms', input: { Body: '{{steps.reply}}' } },
      ],
      respond: { kind: 'twiml', nodes: [{ message: '{{steps.reply}}' }] },
    });

    const result = await executeHandler(spec, ctx({ Body: 'help' }), d);

    expect(d.llm).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'answer help' }));
    expect(d.callConnector).toHaveBeenCalledWith(expect.objectContaining({ input: { Body: 'model reply' } }));
    expect(result.body).toContain('<Message>model reply</Message>');
    expect(result.headers['Content-Type']).toBe('text/xml; charset=utf-8');
  });

  it('still returns a well-formed reply when a step throws', async () => {
    // A 500 to Twilio drops the call; a degraded answer does not.
    const d = deps({ llm: vi.fn(async () => { throw new Error('gateway down'); }) });
    const spec = handler({
      steps: [{ kind: 'llm', id: 'reply', prompt: 'x' }],
      respond: { kind: 'twiml', nodes: [{ say: 'Sorry: {{steps.reply}}' }] },
    });

    const result = await executeHandler(spec, ctx(), d);

    expect(result.status).toBe(200);
    expect(result.body).toContain('<Say>Sorry: </Say>');
    expect(result.steps[0]).toMatchObject({ id: 'reply', ok: false, error: 'gateway down' });
  });

  it('reports a failed connector call without aborting the handler', async () => {
    const d = deps({
      callConnector: vi.fn(async () => ({ ok: false, status: 401, data: null, error: 'unauthorized', durationMs: 1 })),
    });
    const spec = handler({
      steps: [{ kind: 'connector', id: 'sent', connector: 'twilio', actionKey: 'send_sms' }],
      respond: { kind: 'json', body: { done: true } },
    });

    const result = await executeHandler(spec, ctx(), d);

    expect(result.status).toBe(200);
    expect(result.steps[0]).toMatchObject({ ok: false, error: 'unauthorized' });
  });

  it('skips a step whose `when` is falsey and marks it skipped, not failed', async () => {
    const d = deps();
    const spec = handler({
      steps: [{ kind: 'connector', id: 'sms', connector: 'twilio', actionKey: 'send_sms', when: '{{body.Digits}}' }],
    });

    const result = await executeHandler(spec, ctx({}), d);

    expect(d.callConnector).not.toHaveBeenCalled();
    expect(result.steps[0]).toMatchObject({ ok: true, skipped: true });
  });

  it('enforces the step budget instead of running an unbounded spec', async () => {
    const d = deps();
    const steps = Array.from({ length: MAX_EXECUTED_STEPS + 2 }, (_, i) => ({
      kind: 'set' as const, id: `s${i}`, value: 'x',
    }));

    const result = await executeHandler(handler({ steps }), ctx(), d);

    expect(result.steps.filter((s) => s.skipped && !s.ok)).toHaveLength(2);
  });

  it('exposes the ingress URL so a Gather action can be absolute', async () => {
    const spec = handler({
      respond: { kind: 'twiml', nodes: [{ gather: { action: '{{project.ingressUrl}}/ivr', prompts: [{ say: 'hi' }] } }] },
    });
    const result = await executeHandler(spec, ctx(), deps());
    expect(result.body).toContain('action="https://api.test/hooks/tok/ivr"');
  });

  it('returns 204 with an empty body for a status callback', async () => {
    const result = await executeHandler(handler({ respond: { kind: 'empty', status: 204 } }), ctx(), deps());
    expect(result.status).toBe(204);
    expect(result.body).toBe('');
  });

  it('escapes model output on its way into TwiML', async () => {
    const d = deps({ llm: vi.fn(async () => 'Tom & Jerry') });
    const spec = handler({
      steps: [{ kind: 'llm', id: 'r', prompt: 'x' }],
      respond: { kind: 'twiml', nodes: [{ message: '{{steps.r}}' }] },
    });
    const result = await executeHandler(spec, ctx(), d);
    expect(result.body).toContain('Tom &amp; Jerry');
  });

  it('has no `secrets` in the template scope', async () => {
    // A one-line edit to a handler must not be able to exfiltrate credentials to
    // anyone who can call the public URL.
    const spec = handler({ respond: { kind: 'text', text: '[{{secrets.TWILIO_AUTH_TOKEN}}]' } });
    const result = await executeHandler(spec, ctx(), deps());
    expect(result.body).toBe('[]');
  });
});

describe('data step', () => {
  const dataSpec = (over: Record<string, unknown> = {}): HandlerSpec => handler({
    steps: [{ kind: 'data', id: 'rows', collection: 'signups', ...over } as never],
    respond: { kind: 'json', body: { count: '{{steps.rows.count}}', first: '{{steps.rows.records[0].name}}' } },
  });

  it('binds the read so a later template can render the collected data', async () => {
    const d = deps({
      readCollection: vi.fn(async () => ({
        collection: 'signups',
        count: 2,
        records: [
          { id: 2, email: 'a@b.c', createdAt: '2026-08-01T00:00:00.000Z', name: 'Ada' },
          { id: 1, email: 'd@e.f', createdAt: '2026-07-01T00:00:00.000Z', name: 'Bo' },
        ],
      })),
    });
    const out = await executeHandler(dataSpec(), ctx(), d);
    // `count` survives as a NUMBER: a whole-string template keeps the underlying
    // type, so a page can compare it rather than parse it back.
    expect(JSON.parse(out.body)).toEqual({ count: 2, first: 'Ada' });
  });

  it('renders the filter before reading, so matchValue can come from the request', async () => {
    const readCollection = vi.fn(async () => ({ collection: 'signups', count: 0, records: [] }));
    await executeHandler(
      dataSpec({ matchField: 'plan', matchValue: '{{body.plan}}' }),
      ctx({ plan: 'pro' }),
      deps({ readCollection }),
    );
    expect(readCollection).toHaveBeenCalledWith(
      expect.objectContaining({ match: { field: 'plan', value: 'pro' } }),
    );
  });

  it('omits the filter entirely when the spec declares none', async () => {
    const readCollection = vi.fn(async () => ({ collection: 'signups', count: 0, records: [] }));
    await executeHandler(dataSpec(), ctx(), deps({ readCollection }));
    expect(readCollection).toHaveBeenCalledWith(expect.objectContaining({ match: undefined }));
  });

  it('renders the empty state rather than failing when the collection is unknown', async () => {
    // A page that 500s because a collection was renamed is worse than a page
    // that shows nothing and logs why.
    const out = await executeHandler(
      dataSpec(),
      ctx(),
      deps({ readCollection: vi.fn(async () => ({ collection: 'gone', count: 0, records: [], error: 'No collection named "gone".' })) }),
    );
    expect(out.status).toBe(200);
    expect(JSON.parse(out.body)).toEqual({ count: 0, first: '' });
    expect(out.steps[0]).toMatchObject({ id: 'rows', ok: false, error: 'No collection named "gone".' });
  });
});
