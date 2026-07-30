import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware, EXPOSED_HEADERS } from './cors';
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
