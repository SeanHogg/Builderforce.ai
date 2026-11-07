/**
 * PRD 42 Part D on the résumé routes: rewrite and merge accept `clientResult` (valid ⇒
 * handed to the service; invalid ⇒ 400 `invalid_client_result`; absent ⇒ unchanged call),
 * and GRADE ignores it entirely (principle 6, done-check 8).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../../env';

const mocks = vi.hoisted(() => ({
  rewriteToXyz: vi.fn(async () => ({ ok: 'rewrite' })),
  mergeBullets: vi.fn(async () => ({ ok: 'merge' })),
  gradeResume: vi.fn(async () => ({ ok: 'grade' })),
}));

vi.mock('../middleware/authMiddleware', async (importOriginal) => {
  const real = await importOriginal<typeof import('../middleware/authMiddleware')>();
  const fakeAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
    c.set('tenantId', 7);
    c.set('userId', 'u1');
    await next();
  };
  return { ...real, authMiddleware: fakeAuth };
});
vi.mock('../../application/career/resumeAi', () => ({
  ResumeAiService: vi.fn(function ResumeAiService() {
    return { rewriteToXyz: mocks.rewriteToXyz, mergeBullets: mocks.mergeBullets, gradeResume: mocks.gradeResume };
  }),
}));

import { createCareerAiRoutes } from './careerAiRoutes';

const RESUME = 'Led a team of five engineers to rebuild the billing pipeline over two quarters.';
const provenance = { engine: 'webllm', model: 'Qwen-0.5B' };

function post(path: string, body: unknown) {
  const router = createCareerAiRoutes({} as never);
  return router.request(path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }, {} as never);
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockClear();
});

describe('POST /rewrite-bullets', () => {
  it('passes a valid clientResult to the service', async () => {
    const res = await post('/rewrite-bullets', { resumeText: RESUME, clientResult: { json: { rewrites: [] }, provenance } });
    expect(res.status).toBe(200);
    expect(mocks.rewriteToXyz).toHaveBeenCalledWith(7, RESUME, { userId: 'u1', client: { value: { rewrites: [] }, provenance } });
  });

  it('answers 400 invalid_client_result for a bad one and runs nothing', async () => {
    const res = await post('/rewrite-bullets', { resumeText: RESUME, clientResult: { json: 'not-an-object', provenance } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_client_result', reason: 'json_invalid' });
    expect(mocks.rewriteToXyz).not.toHaveBeenCalled();
  });

  it('is unchanged without a clientResult', async () => {
    await post('/rewrite-bullets', { resumeText: RESUME });
    expect(mocks.rewriteToXyz).toHaveBeenCalledWith(7, RESUME, { userId: 'u1' });
  });
});

describe('POST /merge-bullets', () => {
  const texts = [RESUME, `${RESUME} Also shipped the invoicing redesign.`];

  it('passes a valid clientResult to the service', async () => {
    const res = await post('/merge-bullets', { resumeTexts: texts, clientResult: { json: { merged: [] }, provenance } });
    expect(res.status).toBe(200);
    expect(mocks.mergeBullets).toHaveBeenCalledWith(7, texts, { userId: 'u1', client: { value: { merged: [] }, provenance } });
  });

  it('answers 400 for a bad one', async () => {
    const res = await post('/merge-bullets', { resumeTexts: texts, clientResult: { json: { merged: [] }, provenance: { engine: 'cloud', model: 'm' } } });
    expect(res.status).toBe(400);
    expect(mocks.mergeBullets).not.toHaveBeenCalled();
  });

  it('is unchanged without a clientResult', async () => {
    await post('/merge-bullets', { resumeTexts: texts });
    expect(mocks.mergeBullets).toHaveBeenCalledWith(7, texts, { userId: 'u1' });
  });
});

describe('POST /grade — EXCLUDED', () => {
  it('ignores clientResult entirely: even an invalid one is not a 400 and never reaches the service', async () => {
    const res = await post('/grade', { resumeText: RESUME, clientResult: { json: { score: 100 }, provenance: { engine: 'nope', model: '' } } });
    expect(res.status).toBe(200);
    expect(mocks.gradeResume).toHaveBeenCalledWith(7, RESUME, undefined, { userId: 'u1' });
  });

  it('a valid clientResult changes nothing about the grade call', async () => {
    await post('/grade', { resumeText: RESUME, clientResult: { json: { score: 100 }, provenance } });
    expect(mocks.gradeResume).toHaveBeenCalledWith(7, RESUME, undefined, { userId: 'u1' });
  });
});
