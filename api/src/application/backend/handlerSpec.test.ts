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
