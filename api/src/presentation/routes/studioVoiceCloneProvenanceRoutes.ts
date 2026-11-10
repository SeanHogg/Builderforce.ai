/**
 * Voice provenance routes: register a clip made on the caller's device, and read a
 * stored voiceover's signed provenance. Registered onto the voice-clone router by
 * `createStudioVoiceCloneRoutes`, behind its auth middleware.
 */

import type { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { issueVoiceProvenance, CLIENT_REPORTED_ENGINE } from '../../application/studio/voiceProvenanceService';
import { createVoiceProvenancePorts } from '../../application/studio/voiceProvenancePorts';
import { readVoiceoverProvenance } from '../../application/studio/voiceoverAccess';
import { voiceRateLimited, VOICE_REGISTER_RPM } from './voiceRateLimit';
import { parseBody, z } from './requestBody';
import { mapVoiceCloneError } from './studioVoiceCloneErrors';

/** `POST /:id/provenance` — an on-device clip registers its hash + watermark id. */
const RegisterClipBody = z.object({
  watermarkId: z.string(),
  audioSha256: z.string(),
  engine: z.string().min(1).max(32),
  model: z.string().min(1).max(64),
});

export function registerVoiceProvenanceRoutes(router: Hono<HonoEnv>, db: Db): void {
  // ── Register a clip made on the caller's device (hash + watermark id) ────
  // The server never sees the audio: it signs what the client reports, after the
  // same access + consent gates as server synthesis.
  router.post('/:id/provenance', async (c) => {
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);
    const limited = await voiceRateLimited(c, `voice-register:${c.get('tenantId')}:${c.get('userId')}`, VOICE_REGISTER_RPM);
    if (limited) return limited;
    const body = await parseBody(c, RegisterClipBody);
    try {
      const record = await issueVoiceProvenance(createVoiceProvenancePorts(db, c.env as Env), {
        tenantId: c.get('tenantId'),
        userId: c.get('userId'),
        cloneId,
        // The server never saw this audio: whatever engine the client names, the
        // manifest says the registration is client-reported (surfaced as selfReported).
        engine: CLIENT_REPORTED_ENGINE,
        model: body.model,
        audioSha256: body.audioSha256,
        watermarkId: body.watermarkId,
      });
      return c.json({ manifest: record.manifest, signature: record.signature, watermarked: record.watermarked }, 201);
    } catch (err) {
      return mapVoiceCloneError(c, err);
    }
  });

  // ── A stored voiceover's signed provenance (access-checked) ──────────────
  router.get('/:id/voiceovers/:voiceoverId/provenance', async (c) => {
    const tenantId = c.get('tenantId');
    const cloneId = Number(c.req.param('id'));
    const voiceoverId = Number(c.req.param('voiceoverId'));
    if (!Number.isInteger(cloneId) || !Number.isInteger(voiceoverId)) return c.json({ error: 'Not found' }, 404);

    const out = await readVoiceoverProvenance(db, { tenantId, cloneId, voiceoverId });
    if (!out.ok) return out.reason === 'forbidden' ? c.json({ error: 'Forbidden' }, 403) : c.json({ error: 'Not found' }, 404);
    return c.json({ manifest: out.manifest, signature: out.signature, watermarked: out.watermarked });
  });
}
