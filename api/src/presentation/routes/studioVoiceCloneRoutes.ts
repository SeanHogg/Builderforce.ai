import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * Studio voice-clone routes (Voice PRD #1994): `/api/studio/voice-clones/*`.
 *
 * Create (enrol) → list (owned + licensed) → marketplace catalog → synthesize
 * (the metered, cached spine in voiceCloneService) → stream audio → delete.
 * Reads are served through the version-token read-through cache; writes bump the
 * token. Pro-gated creation + consent attestation (PRD §5) live on the create
 * path; the access + consent gates on synthesis live in the service so they
 * can't be bypassed.
 *
 * The marketplace commerce, owner-embedding and provenance routes live in their
 * own modules and are registered onto this router IN THE ORDER they always had
 * (Hono matches in registration order), behind the same auth middleware.
 */

import { Hono } from 'hono';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/featureGate';
import { synthesizeForClone } from '../../application/studio/voiceCloneService';
import { parseEmbedding, parseSampleRate } from '../../application/studio/voiceEmbeddingVault';
import { cachedMarketplaceClones, cachedUsableClones, toPublicClone } from '../../application/studio/voiceCloneCatalog';
import { enrolVoiceClone, type UploadedFile } from '../../application/studio/voiceCloneEnrolment';
import { deleteVoiceClone } from '../../application/studio/voiceCloneDeletion';
import { readVoiceoverAudio } from '../../application/studio/voiceoverAccess';
import { parseOptionalBody, z } from './requestBody';
import { mapVoiceCloneError } from './studioVoiceCloneErrors';
import { registerVoiceCloneCommerceRoutes } from './studioVoiceCloneCommerceRoutes';
import { registerVoiceCloneEmbeddingRoutes } from './studioVoiceCloneEmbeddingRoutes';
import { registerVoiceProvenanceRoutes } from './studioVoiceCloneProvenanceRoutes';

/** The public clone projection — owned by the catalog; re-exported for this module's callers. */
export { toPublicClone };

/** `POST /:id/synthesize` — the handler answers "text is required" (422). */
const SynthesizeBody = z.object({
  text: z.string().nullish(),
  speed: z.number().optional(),
  language: z.string().optional(),
});

export function createStudioVoiceCloneRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── Create / enrol a clone ──────────────────────────────────────────────
  router.post('/', async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const env = c.env as Env;

    // One shared gate: superadmin → premiumOverride → plan grant, else a 402 upgrade
    // payload naming the feature + required plan. Voice cloning is a paid feature.
    const gate = await requireFeature(c, 'voiceCloning');
    if (gate) return gate;

    const form = await c.req.formData();
    const name = String(form.get('name') ?? '').trim();
    if (!name) return c.json({ error: 'name is required' }, 422);

    // Consent gate (PRD §5 / ToS §9a) — explicit affirmation required.
    const consentAttested = String(form.get('consentAttested') ?? '') === 'true';
    if (!consentAttested) {
      return c.json({ error: 'Consent attestation is required to create a voice clone.' }, 422);
    }

    // Optional reference sample (needed for the server synth path).
    const referenceRaw = form.get('reference') as unknown as UploadedFile | string | null;
    const reference = referenceRaw && typeof referenceRaw !== 'string' && typeof referenceRaw.arrayBuffer === 'function'
      ? referenceRaw
      : null;

    // Optional client-enrolled speaker embedding (the on-device path's identity).
    let embedding: number[] | null = null;
    const embeddingRaw = form.get('embedding');
    if (typeof embeddingRaw === 'string' && embeddingRaw) {
      try {
        const parsed = JSON.parse(embeddingRaw);
        embedding = parseEmbedding(parsed);
      } catch (error) { /* ignore malformed embedding — reference path still works */
        reportCaughtError(error, { source: "presentation/routes/studioVoiceCloneRoutes.ts", operation: "createStudioVoiceCloneRoutes" });
      }
    }

    const visibility = (['private', 'unlisted', 'marketplace'] as const).find(
      (v) => v === form.get('visibility'),
    ) ?? 'private';

    // Optional Voice IDE project scoping (0224) — tenant ownership is validated by the use case.
    let ideProjectId: number | null = null;
    const ideProjectRaw = form.get('ideProjectId');
    if (typeof ideProjectRaw === 'string' && ideProjectRaw.trim()) {
      const n = Number(ideProjectRaw);
      if (Number.isInteger(n)) ideProjectId = n;
    }

    const out = await enrolVoiceClone(db, env, {
      tenantId,
      userId,
      name,
      description: String(form.get('description') ?? '') || null,
      provider: String(form.get('provider') ?? 'ssm-webgpu'),
      visibility,
      reference,
      embedding,
      embeddingSampleRate: parseSampleRate(form.get('embeddingSampleRate')),
      ideProjectId,
    });
    if (!out.ok) return c.json({ error: out.error }, out.status);
    return c.json(toPublicClone(out.clone, { tenantId }), 201);
  });

  // ── List clones the caller owns or has licensed (cached) ────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const clones = await cachedUsableClones(db, c.env as Env, tenantId);

    // Optional scoping to a Voice IDE project (0224) — filter the cached list in
    // memory so the per-tenant cache key stays single (no per-project keyspace).
    const ideProjectRaw = c.req.query('ideProjectId');
    const scoped = ideProjectRaw && Number.isInteger(Number(ideProjectRaw))
      ? clones.filter((cl) => cl.ideProjectId === Number(ideProjectRaw))
      : clones;
    return c.json({ clones: scoped });
  });

  // ── Marketplace catalog (cached) ────────────────────────────────────────
  router.get('/marketplace', async (c) => {
    const clones = await cachedMarketplaceClones(db, c.env as Env);
    return c.json({ clones });
  });

  registerVoiceCloneCommerceRoutes(router, db);
  registerVoiceCloneEmbeddingRoutes(router, db);

  // ── Synthesize: the metered, cached spine ───────────────────────────────
  router.post('/:id/synthesize', async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);

    const body = await parseOptionalBody(c, SynthesizeBody);
    const text = (body.text ?? '').trim();
    if (!text) return c.json({ error: 'text is required' }, 422);

    try {
      const result = await synthesizeForClone(db, c.env as Env, {
        cloneId,
        tenantId,
        userId,
        text,
        ...(body.speed !== undefined ? { speed: body.speed } : {}),
        ...(body.language !== undefined ? { language: body.language } : {}),
      });
      return c.json({
        audioUrl: `/api/studio/voice-clones/${cloneId}/voiceovers/${result.voiceoverId}/audio`,
        audioKey: result.audioKey,
        durationMs: result.durationMs,
        wordTimestamps: result.wordTimestamps,
        cached: result.cached,
      });
    } catch (err) {
      return mapVoiceCloneError(c, err);
    }
  });

  registerVoiceProvenanceRoutes(router, db);

  // ── Stream a synthesized voiceover's audio from R2 (access-checked) ──────
  router.get('/:id/voiceovers/:voiceoverId/audio', async (c) => {
    const out = await readVoiceoverAudio(db, c.env as Env, {
      tenantId: c.get('tenantId'),
      cloneId: Number(c.req.param('id')),
      voiceoverId: Number(c.req.param('voiceoverId')),
    });
    if (!out.ok) {
      switch (out.reason) {
        case 'forbidden': return c.json({ error: 'Forbidden' }, 403);
        case 'no_storage': return c.json({ error: 'File storage not configured' }, 503);
        case 'expired': return c.json({ error: 'Audio expired' }, 404);
        default: return c.json({ error: 'Not found' }, 404);
      }
    }
    const headers = new Headers();
    headers.set('Content-Type', out.contentType);
    headers.set('Cache-Control', 'private, max-age=31536000, immutable');
    return new Response(out.body, { headers });
  });

  // ── Delete a clone (owner only) — purge R2 + invalidate caches ──────────
  router.delete('/:id', async (c) => {
    const out = await deleteVoiceClone(db, c.env as Env, {
      tenantId: c.get('tenantId'),
      cloneId: Number(c.req.param('id')),
    });
    if (out === 'not_found') return c.json({ error: 'Not found' }, 404);
    if (out === 'forbidden') return c.json({ error: 'Forbidden' }, 403);
    return c.json({ deleted: true });
  });

  return router;
}
