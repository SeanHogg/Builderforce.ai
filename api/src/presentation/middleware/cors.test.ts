import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { ALLOWED_REQUEST_HEADERS, corsMiddleware, EXPOSED_HEADERS, resolveAllowedOrigin } from './cors';
import type { HonoEnv } from '../../env';

/**
 * `Access-Control-Expose-Headers` has to be on the ACTUAL response. Setting it
 * only on the OPTIONS preflight — which is what this API did — has NO effect, and
 * every `x-builderforce-*` header was silently unreadable from the web app: the
 * Brain logged its resolved model as the literal string "default" and could not
 * say which model or account served a turn.
 */
function appWithHeader() {
  const app = new Hono<HonoEnv>();
  app.use('*', corsMiddleware);
  app.get('/thing', (c) => {
    c.header('x-builderforce-model', 'x-ai/grok-4');
    c.header('x-builderforce-account', 'own');
    return c.json({ ok: true });
  });
  return app;
}

const ENV = { CORS_ORIGINS: 'https://builderforce.ai' } as unknown as HonoEnv['Bindings'];
const ORIGIN = { Origin: 'https://builderforce.ai' };

describe('corsMiddleware', () => {
  it('exposes the builderforce headers on the ACTUAL response', async () => {
    const res = await appWithHeader().request('/thing', { headers: ORIGIN }, ENV);
    const exposed = res.headers.get('Access-Control-Expose-Headers') ?? '';
    expect(exposed).toContain('x-builderforce-model');
    expect(exposed).toContain('x-builderforce-account');
    // The header itself must survive too — exposing a header that isn't set is useless.
    expect(res.headers.get('x-builderforce-model')).toBe('x-ai/grok-4');
  });

  it('advertises the same list on the preflight', async () => {
    const res = await appWithHeader().request('/thing', { method: 'OPTIONS', headers: ORIGIN }, ENV);
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Expose-Headers')).toBe(EXPOSED_HEADERS);
  });

  it('allows creation-session command preflights with If-Match', async () => {
    const res = await appWithHeader().request('/thing', {
      method: 'OPTIONS',
      headers: {
        ...ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key,if-match',
      },
    }, ENV);

    expect(res.status).toBe(204);
    const allowed = (res.headers.get('Access-Control-Allow-Headers') ?? '')
      .toLowerCase()
      .split(',');
    expect(allowed).toContain('if-match');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe(ALLOWED_REQUEST_HEADERS);
  });

  it('covers every header the gateway sets for turn provenance', () => {
    for (const h of [
      'x-builderforce-model',
      'x-builderforce-vendor',
      'x-builderforce-account',
      'x-builderforce-byo-unresolved',
      'x-builderforce-provider-cap',
      'x-builderforce-premium-surcharge',
    ]) {
      expect(EXPOSED_HEADERS, h).toContain(h);
    }
  });

  it('adds nothing for a disallowed origin', async () => {
    const res = await appWithHeader().request('/thing', { headers: { Origin: 'https://evil.example' } }, ENV);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Access-Control-Expose-Headers')).toBeNull();
  });
});

/**
 * The preflight short-circuit in `index.ts` answers OPTIONS before the app (and
 * therefore the database) is built, so it CANNOT call the middleware — it calls
 * `resolveAllowedOrigin` instead. It used to carry a private copy of this rule,
 * and the copy said `*` where the middleware said "refused".
 *
 * That disagreement is not a cosmetic one: the browser is told the preflight
 * passed, sends the real request, and receives a response with no
 * `Access-Control-Allow-Origin` header — which every browser reports as "No
 * 'Access-Control-Allow-Origin' header is present" on EVERY endpoint at once.
 * It is indistinguishable from a Cloudflare-level outage and has nothing to do
 * with one. These tests exist so the two paths can never drift again.
 */
describe('resolveAllowedOrigin — the one decision both paths make', () => {
  const LIST = 'https://builderforce.ai,https://app.builderforce.ai';

  it('echoes an allow-listed origin', () => {
    expect(resolveAllowedOrigin('https://builderforce.ai', LIST, '/api/projects')).toBe('https://builderforce.ai');
  });

  it('REFUSES an unknown origin instead of answering "*"', () => {
    expect(resolveAllowedOrigin('https://evil.example', LIST, '/api/projects')).toBeNull();
  });

  it('refuses a request with no Origin rather than blanket-allowing it', () => {
    expect(resolveAllowedOrigin(null, LIST, '/api/projects')).toBeNull();
  });

  it('allows editor webview origins the preflight copy did not know about', () => {
    expect(resolveAllowedOrigin('vscode-webview://abc-123', LIST, '/api/projects')).toBe('vscode-webview://abc-123');
    expect(resolveAllowedOrigin('vscode-file://x', LIST, '/api/projects')).toBe('vscode-file://x');
  });

  it('allows any origin on the public ingest paths the preflight copy did not know about', () => {
    expect(resolveAllowedOrigin('https://customer.example', LIST, '/api/quality-ingest/events')).toBe('*');
    expect(resolveAllowedOrigin('https://customer.example', LIST, '/api/feedback-ingest')).toBe('*');
    // …and not on a path that merely starts with the same letters.
    expect(resolveAllowedOrigin('https://customer.example', LIST, '/api/quality-ingestion')).toBeNull();
  });

  it('honours the wildcard configuration', () => {
    expect(resolveAllowedOrigin('https://anything.example', '*', '/api/projects')).toBe('*');
  });

  it('agrees with the middleware on every case', async () => {
    const cases = [
      'https://builderforce.ai',
      'https://evil.example',
      'vscode-webview://abc-123',
      'http://localhost:3000',
    ];
    for (const origin of cases) {
      const res = await appWithHeader().request('/thing', { headers: { Origin: origin } }, { CORS_ORIGINS: LIST } as unknown as HonoEnv['Bindings']);
      expect(res.headers.get('Access-Control-Allow-Origin'), origin)
        .toBe(resolveAllowedOrigin(origin, LIST, '/thing'));
    }
  });
});
