import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { hmacBase64Url } from '../../infrastructure/crypto/hmac';
import { issueVoiceProvenance, type VoiceProvenancePorts, type VoiceProvenanceRecord } from '../../application/studio/voiceProvenanceService';

const rows: VoiceProvenanceRecord[] = [];
const ports: VoiceProvenancePorts = {
  loadClone: async () => ({ id: 7, tenantId: 1, userId: 'o', consentAttestedAt: new Date(), consentTextVersion: 'v1' }),
  canUse: async () => true,
  insert: async (r) => { rows.push(r); return 'inserted'; },
  find: async (by) =>
    rows.find((r) =>
      'watermarkId' in by ? r.manifest.watermarkId === by.watermarkId
      : 'audioSha256' in by ? r.manifest.audioSha256 === by.audioSha256
      : r.manifest.clipId === by.clipId) ?? null,
  cloneLabel: async () => ({ name: 'Alice', visibility: 'marketplace' }),
  sign: (input) => hmacBase64Url('route-secret', input),
  newClipId: () => '11111111-1111-4111-8111-111111111111',
  now: () => new Date('2026-11-08T10:00:00Z'),
};

vi.mock('../../application/studio/voiceProvenancePorts', () => ({
  createVoiceProvenancePorts: () => ports,
}));

import { createVoiceProvenanceRoutes } from './voiceProvenanceRoutes';

const SHA = 'cd'.repeat(32);
const WM = 'fedcba9876543210';

function app() {
  const a = new Hono();
  a.route('/', createVoiceProvenanceRoutes({} as never) as never);
  return a;
}

describe('GET /verify', () => {
  it('400s without a valid lookup key', async () => {
    // A real request always carries a Worker env; `{}` = no rate-limiter bound, which fails open.
    expect((await app().request('/verify?watermarkId=nothex', {}, {})).status).toBe(400);
    expect((await app().request('/verify', {}, {})).status).toBe(400);
  });

  it('404s an unknown clip and 200s a registered one', async () => {
    expect((await app().request(`/verify?watermarkId=${WM}`, {}, {})).status).toBe(404);
    await issueVoiceProvenance(ports, {
      tenantId: 1, userId: 'u', cloneId: 7, engine: 'clone-client', model: 'm', audioSha256: SHA, watermarkId: WM,
    });
    const byWm = await app().request(`/verify?watermarkId=${WM}`, {}, {});
    expect(byWm.status).toBe(200);
    const body = (await byWm.json()) as Record<string, unknown>;
    expect(body).toEqual({
      valid: true,
      clipId: '11111111-1111-4111-8111-111111111111',
      watermarked: true,
      voiceName: null, // self-reported: never names the voice
      voiceDeleted: false,
      selfReported: true,
      audioHashSupplied: false,
      audioMatchesSignedHash: false,
      trust: 'watermark_only',
      engine: 'clone-client',
      model: 'm',
      consentTextVersion: 'v1',
      createdAt: '2026-11-08T10:00:00.000Z',
    });
    // The public view never carries who or which workspace.
    expect(JSON.stringify(body)).not.toMatch(/ownerUserId|tenantId|manifest|signature/);
    expect((await app().request(`/verify?audioSha256=${SHA}`, {}, {})).status).toBe(200);
  });
});

describe('POST /verify', () => {
  it('422s a tampered manifest and 200s the genuine one', async () => {
    const genuine = rows[0] ?? (await issueVoiceProvenance(ports, {
      tenantId: 1, userId: 'u', cloneId: 7, engine: 'clone-client', model: 'm', audioSha256: SHA, watermarkId: WM,
    }));
    const post = (manifest: unknown, signature: string) =>
      app().request('/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ manifest, signature }),
      }, {});

    const ok = await post(genuine.manifest, genuine.signature);
    expect(ok.status).toBe(200);
    expect(JSON.stringify(await ok.json())).not.toMatch(/ownerUserId|tenantId/);
    expect((await post({ ...genuine.manifest, tenantId: 2 }, genuine.signature)).status).toBe(422);
  });
});
