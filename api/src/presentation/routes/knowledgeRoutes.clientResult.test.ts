/**
 * PRD 42 Part D on `POST /ai/draft` (the streamed SOP draft/rewrite): a valid clientResult
 * is answered as ONE SSE content chunk in the shape the editor already parses, with no
 * model call; an invalid one is a 400; an absent one still asks the gateway.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tenantProxyForPlan: vi.fn(),
  recordClientResultUsage: vi.fn(async () => {}),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', 2); c.set('userId', 'u1'); c.set('role', 'developer'); await next(); },
  requireRole: () => async (_c: any, next: any) => next(),
}));
vi.mock('../../application/llm/tenantProxy', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/llm/tenantProxy')>()),
  tenantProxyForPlan: mocks.tenantProxyForPlan,
}));
vi.mock('../../application/llm/clientResultUsage', () => ({ recordClientResultUsage: mocks.recordClientResultUsage }));

import { createKnowledgeRoutes } from './knowledgeRoutes';
import type { Db } from '../../infrastructure/database/connection';

const provenance = { engine: 'webllm', model: 'Qwen-0.5B' };
const draft = (body: unknown) => createKnowledgeRoutes({} as Db).request('/ai/draft', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}, {});

beforeEach(() => {
  mocks.tenantProxyForPlan.mockReset();
  mocks.recordClientResultUsage.mockClear();
});

describe('POST /ai/draft clientResult', () => {
  it('streams the device-written draft as one SSE chunk and makes no model call', async () => {
    const res = await draft({ prompt: 'Write the offboarding SOP', clientResult: { text: '# Offboarding\n1. Revoke access', provenance } });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    const frames = (await res.text()).split('\n\n').filter(Boolean).map((f) => f.replace(/^data: /, ''));
    expect(JSON.parse(frames[0]!)).toEqual({ choices: [{ delta: { content: '# Offboarding\n1. Revoke access' } }] });
    expect(frames[1]).toBe('[DONE]');
    expect(mocks.tenantProxyForPlan).not.toHaveBeenCalled();
    expect(mocks.recordClientResultUsage).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ tenantId: 2, userId: 'u1', provenance }));
  });

  it('answers 400 invalid_client_result for a bad one', async () => {
    const res = await draft({ prompt: 'Write it', clientResult: { text: 'x'.repeat(60_001), provenance } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_client_result', reason: 'text_too_long' });
    expect(mocks.tenantProxyForPlan).not.toHaveBeenCalled();
  });

  it('is unchanged without a clientResult: the gateway is asked', async () => {
    mocks.tenantProxyForPlan.mockRejectedValue(new Error('no plan'));
    try { await draft({ prompt: 'Write it' }); } catch { /* the gateway rejection is the point */ }
    expect(mocks.tenantProxyForPlan).toHaveBeenCalledTimes(1);
    expect(mocks.recordClientResultUsage).not.toHaveBeenCalled();
  });
});
