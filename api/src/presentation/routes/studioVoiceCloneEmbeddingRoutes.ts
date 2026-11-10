/**
 * Owner-only speaker-embedding routes (`/api/studio/voice-clones/:id/embedding`).
 * The embedding is the owner's biometric, sealed at rest by `voiceEmbeddingVault`;
 * it is read back ONLY here, to the owner's own session. Registered onto the
 * voice-clone router by `createStudioVoiceCloneRoutes`, behind its auth middleware.
 */

import type { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  getOwnerEmbedding,
  parseEmbedding,
  parseSampleRate,
  storeOwnerEmbeddingIfMissing,
} from '../../application/studio/voiceEmbeddingVault';
import { parseOptionalBody, z } from './requestBody';
import { mapVoiceCloneError } from './studioVoiceCloneErrors';

export function registerVoiceCloneEmbeddingRoutes(router: Hono<HonoEnv>, db: Db): void {
  // ── Owner-only speaker embedding (sealed at rest) ───────────────────────
  router.get('/:id/embedding', async (c) => {
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);
    try {
      const own = await getOwnerEmbedding(db, c.env as Env, {
        cloneId, tenantId: c.get('tenantId'), userId: c.get('userId') ?? null,
      });
      if (!own) return c.json({ error: 'No embedding' }, 404);
      c.header('Cache-Control', 'private, no-store');
      return c.json(own);
    } catch (err) {
      return mapVoiceCloneError(c, err);
    }
  });

  // One-time device migration: upload a locally-held embedding if the server lacks one.
  router.put('/:id/embedding', async (c) => {
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);
    // Loose on purpose: `parseEmbedding` / `parseSampleRate` own the field rules and the 422 wording.
    const body = await parseOptionalBody(c, z.looseObject({ embedding: z.unknown().optional(), sampleRate: z.unknown().optional() }));
    const embedding = parseEmbedding(body.embedding);
    if (!embedding) return c.json({ error: 'embedding must be a non-empty array of at most 4096 finite numbers' }, 422);
    try {
      const stored = await storeOwnerEmbeddingIfMissing(db, c.env as Env, {
        cloneId, tenantId: c.get('tenantId'), userId: c.get('userId') ?? null, embedding,
        sampleRate: parseSampleRate(body.sampleRate),
      });
      return c.json({ stored });
    } catch (err) {
      return mapVoiceCloneError(c, err);
    }
  });
}
