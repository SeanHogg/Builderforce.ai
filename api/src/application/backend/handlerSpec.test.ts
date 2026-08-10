/**
 * Handler-spec parser tests.
 *
 * A handler spec is untrusted JSON from the canvas that becomes a live public
 * endpoint. The properties pinned here are the ones whose absence produces a
 * silent failure rather than a visible one — a route that quietly claims `/`, a
 * webhook that accepts unsigned traffic because nobody wrote `verify`, or a step
 * whose typo means it simply never runs.
 */
import { describe, it, expect } from 'vitest';
import {
  allowedCorsOrigin,
  handlerNameFromPath,
  matchHandler,
  normalizeRoute,
  parseHandlerSpec,
  type HandlerSpec,
} from './handlerSpec';

const minimal = (over: Record<string, unknown> = {}) => ({
  route: '/sms',
  method: 'POST',
  verify: 'twilio',
  steps: [],
  respond: { kind: 'empty' },
  ...over,
});

describe('normalizeRoute', () => {
  it('adds a leading slash, lowercases, and strips a trailing slash', () => {
    expect(normalizeRoute('SMS/')).toBe('/sms');
    expect(normalizeRoute('/Voice')).toBe('/voice');
    expect(normalizeRoute('/')).toBe('/');
  });

  it('refuses anything that cannot be a route rather than defaulting to /', () => {
    // Silently collapsing a bad route to `/` would make a broken handler claim
    // the project's root endpoint.
    expect(normalizeRoute('/a/../b')).toBeNull();
    expect(normalizeRoute('/a//b')).toBeNull();
    expect(normalizeRoute('/a b')).toBeNull();
    expect(normalizeRoute('/a?x=1')).toBeNull();
    expect(normalizeRoute(42)).toBeNull();
  });
});

describe('parseHandlerSpec', () => {
  it('requires `verify` to be stated explicitly', () => {
    // The whole point: forgetting the field must not yield an open endpoint.
    const result = parseHandlerSpec({ ...minimal(), verify: undefined }, 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('verify must be one of');
  });

  it('rejects an unknown verify kind', () => {
    expect(parseHandlerSpec({ ...minimal(), verify: 'trust-me' }, 'x').ok).toBe(false);
  });

  it('defaults the route to the file name and the method to POST', () => {
    const result = parseHandlerSpec({ verify: 'none', respond: { kind: 'empty' } }, 'inbound-sms');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.route).toBe('/inbound-sms');
      expect(result.spec.method).toBe('POST');
      expect(result.spec.name).toBe('inbound-sms');
    }
  });

  it('rejects a malformed step rather than dropping it', () => {
    // A dropped step is work the author believes is happening and is not.
    const result = parseHandlerSpec({ ...minimal(), steps: [{ kind: 'llm', id: 'a' }] }, 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('requires a non-empty prompt');
  });

  it('rejects duplicate step ids — the second would shadow the first binding', () => {
    const result = parseHandlerSpec(
      { ...minimal(), steps: [{ kind: 'set', id: 'a', value: '1' }, { kind: 'set', id: 'a', value: '2' }] },
      'x',
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('Duplicate step id');
  });

  it('rejects a step id that is not a template identifier', () => {
    expect(parseHandlerSpec({ ...minimal(), steps: [{ kind: 'set', id: 'a-b', value: '1' }] }, 'x').ok).toBe(false);
  });

  it('accepts `action` or `actionKey` on a connector step', () => {
    for (const field of ['action', 'actionKey']) {
      const result = parseHandlerSpec(
        { ...minimal(), steps: [{ kind: 'connector', id: 's', connector: 'twilio', [field]: 'send_sms' }] },
        'x',
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect((result.spec.steps[0] as { actionKey: string }).actionKey).toBe('send_sms');
    }
  });

  it('rejects an unknown respond kind', () => {
    expect(parseHandlerSpec({ ...minimal(), respond: { kind: 'html' } }, 'x').ok).toBe(false);
  });

  it('drops a malformed TwiML node but keeps the handler', () => {
    // Here the failure IS visible in the reply, so dropping beats rejecting.
    const result = parseHandlerSpec(
      { ...minimal(), respond: { kind: 'twiml', twiml: [{ message: 'hi' }, { bogus: 1 }] } },
      'x',
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.spec.respond.kind === 'twiml') {
      expect(result.spec.respond.nodes).toHaveLength(1);
    }
  });

  it('rejects a non-object document', () => {
    expect(parseHandlerSpec('nope', 'x').ok).toBe(false);
    expect(parseHandlerSpec([1, 2], 'x').ok).toBe(false);
  });

  it('leaves cross-origin access OFF when `cors` is absent', () => {
    // The property that makes the allow-list an allow-list: forgetting the field
    // must not produce an endpoint any website can call from a visitor's browser.
    const result = parseHandlerSpec(minimal(), 'x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.cors).toBeUndefined();
  });

  it('normalises and de-duplicates the cors allow-list', () => {
    const result = parseHandlerSpec(
      { ...minimal(), cors: ['https://Example.com', ' https://example.com ', 'http://localhost:5173'] },
      'x',
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.cors).toEqual(['https://example.com', 'http://localhost:5173']);
  });

  it('rejects an empty cors list rather than reading it as "none"', () => {
    // `"cors": []` reads as "CORS is configured here" and behaves as the opposite.
    const result = parseHandlerSpec({ ...minimal(), cors: [] }, 'x');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('at least one origin');
  });

  it('rejects an entry that is not an origin', () => {
    for (const bad of ['example.com', 'https://example.com/app', 'ftp://example.com', 42, '']) {
      expect(parseHandlerSpec({ ...minimal(), cors: [bad] }, 'x').ok).toBe(false);
    }
    expect(parseHandlerSpec({ ...minimal(), cors: 'https://example.com' }, 'x').ok).toBe(false);
  });

  it('accepts the two un-attributable origins only when they are typed', () => {
    const result = parseHandlerSpec({ ...minimal(), cors: ['*', 'NULL'] }, 'x');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.spec.cors).toEqual(['*', 'null']);
  });
});

describe('allowedCorsOrigin', () => {
  const withCors = (cors?: string[]): HandlerSpec => ({
    name: 'q', route: '/q', method: 'POST', verify: 'none', steps: [], respond: { kind: 'empty' },
    ...(cors ? { cors } : {}),
  });

  it('admits nobody when the handler declared nothing', () => {
    expect(allowedCorsOrigin(withCors(), 'https://example.com')).toBeNull();
  });

  it('echoes the caller rather than widening a list into a blanket permission', () => {
    const handler = withCors(['https://example.com', 'https://other.test']);
    expect(allowedCorsOrigin(handler, 'https://example.com')).toBe('https://example.com');
    expect(allowedCorsOrigin(handler, 'https://evil.test')).toBeNull();
    // Browsers send a lowercase origin, but a proxy in between may not.
    expect(allowedCorsOrigin(handler, 'https://Example.com')).toBe('https://Example.com');
  });

  it('returns * only when the spec literally says *', () => {
    expect(allowedCorsOrigin(withCors(['*']), 'https://anything.test')).toBe('*');
  });

  it('has nothing to allow when the caller sent no Origin at all', () => {
    // A server-to-server webhook — the caller this endpoint was built for.
    expect(allowedCorsOrigin(withCors(['*']), null)).toBeNull();
  });
});

describe('matchHandler', () => {
  const spec = (route: string, method: HandlerSpec['method'], name = route): HandlerSpec => ({
    name, route, method, verify: 'none', steps: [], respond: { kind: 'empty' },
  });

  it('prefers an exact method over ANY on the same route', () => {
    const specs = [spec('/status', 'ANY', 'any'), spec('/status', 'GET', 'get')];
    expect(matchHandler(specs, '/status', 'GET')?.name).toBe('get');
    // …and order must not decide it.
    expect(matchHandler([...specs].reverse(), '/status', 'GET')?.name).toBe('get');
  });

  it('falls back to ANY when no method-specific handler exists', () => {
    expect(matchHandler([spec('/status', 'ANY', 'any')], '/status', 'POST')?.name).toBe('any');
  });

  it('returns null for an unknown route', () => {
    expect(matchHandler([spec('/sms', 'POST')], '/voice', 'POST')).toBeNull();
  });
});

describe('handlerNameFromPath', () => {
  it('strips the directory and the .json extension', () => {
    expect(handlerNameFromPath('handlers/inbound-sms.json')).toBe('inbound-sms');
    expect(handlerNameFromPath('voice.json')).toBe('voice');
  });
});

describe('data steps', () => {
  const withStep = (step: unknown) =>
    parseHandlerSpec({ route: '/x', method: 'GET', verify: 'none', steps: [step] }, 'x');

  it('accepts a bare collection read', () => {
    const result = withStep({ kind: 'data', id: 'rows', collection: 'signups' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.steps[0]).toMatchObject({ kind: 'data', collection: 'signups' });
  });

  it('carries a templated filter through both halves', () => {
    const result = withStep({
      kind: 'data', id: 'rows', collection: 'signups', limit: 5,
      matchField: 'plan', matchValue: '{{query.plan}}',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.steps[0]).toMatchObject({ limit: 5, matchField: 'plan', matchValue: '{{query.plan}}' });
  });

  it('refuses half a filter — one side alone would silently return everything', () => {
    const result = withStep({ kind: 'data', id: 'rows', collection: 'signups', matchField: 'plan' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('matchField and matchValue together');
  });

  it('requires a collection name', () => {
    expect(withStep({ kind: 'data', id: 'rows' }).ok).toBe(false);
  });

  it('names data in the unknown-kind error, so the vocabulary is discoverable', () => {
    const result = withStep({ kind: 'nope', id: 'rows' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('data');
  });
});

describe('verifySecret', () => {
  const base = { route: '/stripe/a', method: 'POST', verify: 'stripe', steps: [], respond: { kind: 'empty' } };

  it('carries a per-handler secret name, so one provider can have several endpoints', () => {
    // Stripe issues a DIFFERENT whsec_ per endpoint; a single shared name could
    // only ever verify one of them and would fail the rest closed forever.
    const parsed = parseHandlerSpec({ ...base, verifySecret: 'STRIPE_WEBHOOK_SECRET_A' }, 'a');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.spec.verifySecret).toBe('STRIPE_WEBHOOK_SECRET_A');
  });

  it('defaults to no override, which the resolver reads as the kind default', () => {
    const parsed = parseHandlerSpec(base, 'a');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.spec.verifySecret).toBeUndefined();
  });

  it('REJECTS a malformed name instead of ignoring it', () => {
    // Ignoring it would silently fall back to the default secret and pass review
    // looking correct — the worst possible outcome for a verification setting.
    expect(parseHandlerSpec({ ...base, verifySecret: 'lower_case' }, 'a').ok).toBe(false);
    expect(parseHandlerSpec({ ...base, verifySecret: '9_LEADING_DIGIT' }, 'a').ok).toBe(false);
    expect(parseHandlerSpec({ ...base, verifySecret: 42 }, 'a').ok).toBe(false);
  });

  it('refuses a secret on an unverified handler rather than pretending it does something', () => {
    const parsed = parseHandlerSpec({ ...base, verify: 'none', verifySecret: 'SOMETHING' }, 'a');
    expect(parsed.ok).toBe(false);
  });
});
