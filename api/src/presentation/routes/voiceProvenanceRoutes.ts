/**
 * Public voice-clip provenance verification: `/api/voice/provenance/*`.
 *
 * Uncredentialed by design — the point of provenance is that a stranger holding
 * a clip can ask "did Builderforce make this, and under whose consent?".
 *
 *   GET  /verify?watermarkId=… | audioSha256=… | clipId=…   look a clip up
 *   POST /verify { manifest, signature }                      check a copy you hold
 *
 * The answer is the PUBLIC view (no owner or tenant id). A VALID verdict is
 * cached briefly; a miss never is (the clip may be registered a moment later).
 */

import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { SHA256_HEX, WATERMARK_ID_HEX } from '@builderforce/voice-provenance';
import {
  verifyVoiceProvenanceManifestPublic,
  VoiceProvenanceUnavailable,
  type ProvenanceLookup,
} from '../../application/studio/voiceProvenanceService';
import { createVoiceProvenancePorts } from '../../application/studio/voiceProvenancePorts';
import { lookupVoiceProvenancePublic } from '../../application/studio/voiceProvenanceLookup';
import { parseBody, z } from './requestBody';
import { clientIp, voiceRateLimited, VOICE_VERIFY_RPM } from './voiceRateLimit';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const VerifyClaimBody = z.object({ manifest: z.unknown(), signature: z.unknown(), audioSha256: z.string().optional() });

function lookupFromQuery(query: Record<string, string | undefined>): ProvenanceLookup | null {
  const { watermarkId, audioSha256, clipId } = query;
  if (watermarkId && WATERMARK_ID_HEX.test(watermarkId)) return { watermarkId };
  if (audioSha256 && SHA256_HEX.test(audioSha256)) return { audioSha256 };
  if (clipId && UUID.test(clipId)) return { clipId };
  return null;
}

/** A hash the caller computed from the audio they hold, to compare with the signed one. */
function claimedHashFromQuery(query: Record<string, string | undefined>): string | undefined {
  const { audioSha256 } = query;
  return audioSha256 && SHA256_HEX.test(audioSha256) ? audioSha256 : undefined;
}

export function createVoiceProvenanceRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();

  // Public and uncredentialed: throttle per client address (L4).
  router.use('*', async (c, next) => {
    const limited = await voiceRateLimited(c, `voice-verify:${clientIp(c)}`, VOICE_VERIFY_RPM);
    if (limited) return limited;
    return next();
  });

  // Query params: `watermarkId` | `audioSha256` | `clipId` pick the lookup (that
  // precedence); when `audioSha256` accompanies `watermarkId`/`clipId` it is the
  // caller's hash, compared to the signed one -> `audioMatchesSignedHash`.
  router.get('/verify', async (c) => {
    const query = c.req.query();
    const by = lookupFromQuery(query);
    if (!by) return c.json({ error: 'Provide a valid watermarkId, audioSha256 or clipId.' }, 400);
    const claimedHash = claimedHashFromQuery(query);
    try {
      const verdict = await lookupVoiceProvenancePublic(db, c.env as Env, by, claimedHash);
      return c.json(verdict, verdict.valid ? 200 : verdict.reason === 'not_found' ? 404 : 422);
    } catch (err) {
      if (err instanceof VoiceProvenanceUnavailable) return c.json({ error: err.message, code: err.code }, 503);
      throw err;
    }
  });

  router.post('/verify', async (c) => {
    const body = await parseBody(c, VerifyClaimBody);
    try {
      const claimed = typeof body.audioSha256 === 'string' && SHA256_HEX.test(body.audioSha256) ? body.audioSha256 : undefined;
      const verdict = await verifyVoiceProvenanceManifestPublic(createVoiceProvenancePorts(db, c.env as Env), body, claimed);
      return c.json(verdict, verdict.valid ? 200 : verdict.reason === 'not_found' ? 404 : 422);
    } catch (err) {
      if (err instanceof VoiceProvenanceUnavailable) return c.json({ error: err.message, code: err.code }, 503);
      throw err;
    }
  });

  return router;
}
