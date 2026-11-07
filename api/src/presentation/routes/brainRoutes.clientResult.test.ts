/**
 * PRD 42 Part D on the Brain summarize routes: a valid `clientResult` reaches the use case
 * (and lifts the "LLM not configured" gate, since no server model is needed); an invalid
 * one is a 400 `invalid_client_result`; an absent one leaves the call byte-for-byte as it was.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import type { BrainService } from '../../application/brain/BrainService';
import { errorHandler } from '../middleware/errorHandler';

const { createBrainRoutes } = await import('./brainRoutes');

const provenance = { engine: 'browser', model: 'gemini-nano' };
const service = {
  summarizeChat: vi.fn(async () => ({ summary: 'ok' })),
  summarizeAgentHostSession: vi.fn(async () => ({ summary: 'ok' })),
};

function mount() {
  const app = new Hono<HonoEnv>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('isEmulation', true); // the test mount supplies identity; the real authMiddleware passes it through
    c.set('tenantId', 5);
    c.set('userId', 'user-1');
    c.set('role', TenantRole.MANAGER);
    Object.defineProperty(c, 'executionCtx', { value: { waitUntil: () => {} }, configurable: true });
    await next();
  });
  app.route('/', createBrainRoutes(service as unknown as BrainService, {} as Db));
  return app;
}
const post = (body?: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const NO_KEY = {};
const WITH_KEY = { OPENROUTER_API_KEY: 'k' };

beforeEach(() => {
  service.summarizeChat.mockClear();
  service.summarizeAgentHostSession.mockClear();
});

describe.each([
  ['/chats/9/summarize', service.summarizeChat],
  ['/agent-host-sessions/9/summarize', service.summarizeAgentHostSession],
] as const)('POST %s', (path, use) => {
  it('passes a valid clientResult to the use case, even with no server key configured', async () => {
    const res = await mount().request(path, post({ clientResult: { text: 'We ship Friday.', provenance } }), NO_KEY);
    expect(res.status).toBe(200);
    expect(use).toHaveBeenCalledTimes(1);
    const opts = (use.mock.calls[0] as unknown[]).at(-1);
    expect(opts).toMatchObject({ client: { value: 'We ship Friday.', provenance } });
    if (path.startsWith('/agent-host-sessions')) expect(opts).toMatchObject({ userId: 'user-1' });
  });

  it('answers 400 invalid_client_result for a bad one and never reaches the use case', async () => {
    const res = await mount().request(path, post({ clientResult: { text: 'x', provenance: { engine: 'cloud', model: 'm' } } }), WITH_KEY);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_client_result', reason: 'provenance_engine_invalid' });
    expect(use).not.toHaveBeenCalled();
  });

  it('is unchanged without a clientResult: no client option, and 503 when no server model is configured', async () => {
    expect((await mount().request(path, post(), NO_KEY)).status).toBe(503);
    expect(use).not.toHaveBeenCalled();
    const res = await mount().request(path, post(), WITH_KEY);
    expect(res.status).toBe(200);
    const opts = (use.mock.calls[0] as unknown[]).at(-1) as Record<string, unknown>;
    expect(opts).not.toHaveProperty('client');
  });
});
