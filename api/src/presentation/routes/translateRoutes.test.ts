/**
 * POST /api/translate — validation, the 429 / 503 mappings and the anonymous refusal.
 * Cache behaviour is covered by the use-case test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ window: vi.fn(), budget: vi.fn() }));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: () => Promise<void>) => {
    if (!c.req.header('Authorization')) return c.json({ error: 'Unauthorized' }, 401);
    c.set('userId', 'u1');
    c.set('tenantId', 7);
    await next();
  },
}));
vi.mock('../../application/ratelimit/slidingWindow', () => ({ checkSlidingWindow: mocks.window }));
vi.mock('../../application/translate/translateBudget', () => ({ spendTranslateBudget: mocks.budget }));

import { createTranslateRoutes } from './translateRoutes';
import { errorHandler } from '../middleware/errorHandler';
import { TranslationUnavailableError } from '../../application/translate/translateText';

const auth = { Authorization: 'Bearer t', 'Content-Type': 'application/json' };
const post = (app: ReturnType<typeof createTranslateRoutes>, body: unknown, headers: Record<string, string> = auth) =>
  // parseBody REJECTS; the app's own error handler is what answers 400.
  app.onError(errorHandler as never).request('/', { method: 'POST', headers, body: JSON.stringify(body) }, {});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.window.mockResolvedValue({ allowed: true, current: 1, limit: 30, resetAt: 'x', retryAfterSeconds: 1 });
  mocks.budget.mockResolvedValue(null);
});

describe('POST /api/translate', () => {
  it('returns translations in order', async () => {
    const run = vi.fn(async ({ texts }: { texts: string[] }) => texts.map((t) => `en:${t}`));
    const res = await post(createTranslateRoutes(() => run), { texts: ['a', 'b'], to: 'en', from: 'es' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ translations: ['en:a', 'en:b'] });
    expect(run).toHaveBeenCalledWith({ texts: ['a', 'b'], to: 'en', from: 'es' });
  });

  it('rejects 0 texts and 21 texts with 400', async () => {
    const run = vi.fn();
    const app = createTranslateRoutes(() => run);
    expect((await post(app, { texts: [], to: 'en' })).status).toBe(400);
    expect((await post(app, { texts: Array.from({ length: 21 }, () => 'x'), to: 'en' })).status).toBe(400);
    expect((await post(app, { texts: ['x'] })).status).toBe(400);
    expect((await post(app, { texts: ['x'], to: 'en' })).status).toBe(400); // `from` is required
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 429 when rate-limited, without calling the model', async () => {
    mocks.window.mockResolvedValue({ allowed: false, current: 31, limit: 30, resetAt: 'x', retryAfterSeconds: 9 });
    const run = vi.fn();
    const res = await post(createTranslateRoutes(() => run), { texts: ['a'], to: 'en', from: 'es' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('9');
    expect(run).not.toHaveBeenCalled();
  });

  it('answers 429 when the daily character budget is spent, without calling the model', async () => {
    mocks.budget.mockResolvedValue({ allowed: false, current: 9, limit: 9, resetAt: 'later', retryAfterSeconds: 3600 });
    const run = vi.fn();
    const res = await post(createTranslateRoutes(() => run), { texts: ['abc', 'de'], to: 'en', from: 'es' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('3600');
    expect(mocks.budget).toHaveBeenCalledWith(expect.anything(), 7, 5);
    expect(run).not.toHaveBeenCalled();
  });

  it('echoes the texts for from === to with no model call and no budget spend', async () => {
    const run = vi.fn();
    const res = await post(createTranslateRoutes(() => run), { texts: ['a', 'b'], to: 'en', from: 'EN' });
    expect(await res.json()).toEqual({ translations: ['a', 'b'] });
    expect(run).not.toHaveBeenCalled();
    expect(mocks.budget).not.toHaveBeenCalled();
  });

  it('answers 503 when the translation model is unavailable', async () => {
    const run = vi.fn().mockRejectedValue(new TranslationUnavailableError());
    const res = await post(createTranslateRoutes(() => run), { texts: ['a'], to: 'en', from: 'es' });
    expect(res.status).toBe(503);
  });

  it('refuses an anonymous caller', async () => {
    const run = vi.fn();
    const res = await post(createTranslateRoutes(() => run), { texts: ['a'], to: 'en', from: 'es' }, { 'Content-Type': 'application/json' });
    expect(res.status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });
});
