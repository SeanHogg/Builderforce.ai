import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

let callerTenant = 1;
vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: { set: (k: string, v: unknown) => void }, next: () => Promise<void>) => {
    c.set('tenantId', callerTenant);
    c.set('userId', 'u');
    await next();
  },
}));
vi.mock('../../application/studio/voiceCloneAccess', async (orig) => ({
  ...(await orig<object>()),
  canUseClone: async () => true,
}));
// The provenance row belongs to tenant 1 (the synthesizer); the port must be asked for the CALLER's tenant.
const findForVoiceover = vi.fn(async (_db: unknown, tenantId: number, voiceoverId: number) =>
  tenantId === 1 && voiceoverId === 5
    ? { manifest: { clipId: 'c' }, signature: 's', watermarked: true, tenantId: 1, cloneId: 7, voiceoverId: 5 }
    : null);
vi.mock('../../application/studio/voiceProvenancePorts', () => ({
  createVoiceProvenancePorts: () => ({}),
  findProvenanceForVoiceover: (...a: [unknown, number, number]) => findForVoiceover(...a),
}));

import { createStudioVoiceCloneRoutes } from './studioVoiceCloneRoutes';

const db = {
  select: () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => Promise.resolve([{ id: 7, tenantId: 1 }]);
    return chain;
  },
} as never;

function app() {
  const a = new Hono();
  a.route('/', createStudioVoiceCloneRoutes(db) as never);
  return a;
}

describe('GET /:id/voiceovers/:voiceoverId/provenance', () => {
  it('serves the synthesizing tenant', async () => {
    callerTenant = 1;
    const res = await app().request('/7/voiceovers/5/provenance');
    expect(res.status).toBe(200);
  });

  it('a licensee walking another tenant\'s voiceover id gets 404', async () => {
    callerTenant = 2;
    const res = await app().request('/7/voiceovers/5/provenance');
    expect(res.status).toBe(404);
    expect(findForVoiceover).toHaveBeenLastCalledWith(expect.anything(), 2, 5);
  });
});
