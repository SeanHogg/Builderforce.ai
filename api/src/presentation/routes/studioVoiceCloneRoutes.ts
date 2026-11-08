import { InternalError } from '../../domain/shared/errors';
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
 */

import { Hono, type Context } from 'hono';
import { and, desc, eq } from 'drizzle-orm';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { requireFeature } from '../middleware/featureGate';
import {
  ideProjects,
  studioVoiceCloneLicenses,
  studioVoiceClones,
  studioVoiceovers,
} from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import {
  bumpCacheVersion,
  getCacheVersion,
  getOrSetCached,
} from '../../infrastructure/cache/readThroughCache';
import {
  canUseClone,
  synthesizeForClone,
  TtsProviderUnavailable,
  VoiceCloneConsentRequired,
  VoiceCloneForbidden,
  VoiceCloneNotFound,
  VoiceCloneReferenceMissing,
  VoiceCloneSynthesisConflict,
} from '../../application/studio/voiceCloneService';
import {
  acquireFreeVoiceLicense,
  VoiceCloneLicensePaymentRequired,
} from '../../application/studio/voiceLicenseService';
import {
  getOwnerEmbedding,
  parseEmbedding,
  parseSampleRate,
  sealEmbedding,
  storeOwnerEmbeddingIfMissing,
} from '../../application/studio/voiceEmbeddingVault';
import {
  VoiceProvenanceConflict,
  VoiceProvenanceInvalid,
  VoiceProvenanceUnavailable,
  issueVoiceProvenance,
  CLIENT_REPORTED_ENGINE,
} from '../../application/studio/voiceProvenanceService';
import { voiceRateLimited, VOICE_REGISTER_RPM } from './voiceRateLimit';
import {
  createVoiceProvenancePorts,
  findProvenanceForVoiceover,
} from '../../application/studio/voiceProvenancePorts';
import { LIST_ROW_CAP } from '../../domain/shared/boundedInt';
import { parseBody, parseOptionalBody, z, zNonEmptyString } from './requestBody';
import { listUsableClones } from '../../application/studio/voiceCloneList';
import { completeVoiceCheckout, startVoiceCheckout } from '../../application/studio/voiceCommerce';
import { ListingError } from '../../application/marketplace/creationListings';

const VoiceCheckoutStartBody = z.object({ returnUrl: z.string().optional(), buyerEmail: z.string().optional() });
const VoiceCheckoutCompleteBody = z.object({ checkoutSessionId: zNonEmptyString });

/** `POST /:id/synthesize` — the handler answers "text is required" (422). */
const SynthesizeBody = z.object({
  text: z.string().nullish(),
  speed: z.number().optional(),
  language: z.string().optional(),
});

/** `POST /:id/provenance` — an on-device clip registers its hash + watermark id. */
const RegisterClipBody = z.object({
  watermarkId: z.string(),
  audioSha256: z.string(),
  engine: z.string().min(1).max(32),
  model: z.string().min(1).max(64),
});

const CONSENT_TEXT_VERSION = 'v1';

/** Minimal uploaded-file shape — the Worker FormData typing surfaces entries as
 *  `string`, so we cast multipart file parts to this instead of the DOM `File`. */
interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A clone row trimmed to what clients need. No-leak contract: R2 keys and the
 *  speaker embedding are NEVER in a list/marketplace/create payload, for anyone.
 *  The embedding is returned ONLY by the owner-only `GET /:id/embedding`, to the
 *  owner's own authenticated session (never to buyers/licensees/other users). */
export function toPublicClone(row: typeof studioVoiceClones.$inferSelect, viewer?: { tenantId: number }) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    provider: row.provider,
    visibility: row.visibility,
    status: row.status,
    priceMillicents: row.priceMillicents,
    consentAttested: Boolean(row.consentAttestedAt),
    hasReference: Boolean(row.referenceKey),
    // The owner's own IDE project: a licensee or marketplace browser never learns it.
    ideProjectId: viewer?.tenantId === row.tenantId ? row.ideProjectId ?? null : null,
    createdAt: row.createdAt,
  };
}

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
    let referenceKey: string | null = null;
    const reference = form.get('reference') as unknown as UploadedFile | string | null;
    if (reference && typeof reference !== 'string' && typeof reference.arrayBuffer === 'function') {
      if (!env.UPLOADS) return c.json({ error: 'File storage not configured' }, 503);
      const ext = (reference.name.split('.').pop() ?? 'wav').toLowerCase();
      referenceKey = `${tenantId}/voice-clones/${crypto.randomUUID()}.${ext}`;
      await env.UPLOADS.put(referenceKey, await reference.arrayBuffer(), {
        httpMetadata: { contentType: reference.type || 'audio/wav' },
        customMetadata: { tenantId: String(tenantId), kind: 'voice-clone-reference' },
      });
    }

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

    // Optional Voice IDE project scoping (0224): bind the clone to the voice
    // project it was enrolled under, validating tenant ownership so a clone can't
    // be attached to another tenant's project.
    let ideProjectId: number | null = null;
    const ideProjectRaw = form.get('ideProjectId');
    if (typeof ideProjectRaw === 'string' && ideProjectRaw.trim()) {
      const n = Number(ideProjectRaw);
      if (Number.isInteger(n)) {
        const [ip] = await db
          .select({ id: ideProjects.id })
          .from(ideProjects)
          .where(and(eq(ideProjects.id, n), eq(ideProjects.tenantId, tenantId)))
          .limit(1);
        if (!ip) return c.json({ error: 'Invalid IDE project' }, 422);
        ideProjectId = n;
      }
    }

    const [inserted] = await db
      .insert(studioVoiceClones)
      .values({
        tenantId,
        userId,
        ideProjectId,
        name,
        description: String(form.get('description') ?? '') || null,
        provider: String(form.get('provider') ?? 'ssm-webgpu'),
        referenceKey,
        visibility,
        status: 'ready',
        consentAttestedAt: new Date(),
        consentTextVersion: CONSENT_TEXT_VERSION,
      })
      .returning();
    if (!inserted) throw new InternalError('Failed to create voice clone');

    // The embedding is the owner's biometric: sealed per-tenant AND bound to this
    // clone's id (so it cannot be swapped onto another row), which only exists now.
    let created = inserted;
    if (embedding) {
      const sealed = await sealEmbedding(env, tenantId, inserted.id, embedding, parseSampleRate(form.get('embeddingSampleRate')));
      const [withEmbedding] = await db
        .update(studioVoiceClones)
        .set({ embeddingEnc: sealed.enc, embeddingIv: sealed.iv })
        .where(and(eq(studioVoiceClones.id, inserted.id), eq(studioVoiceClones.tenantId, tenantId)))
        .returning();
      if (withEmbedding) created = withEmbedding;
    }

    await bumpCacheVersion(env, `voiceclones:${tenantId}`);
    if (visibility === 'marketplace') await bumpCacheVersion(env, 'voiceclones:marketplace');
    return c.json(toPublicClone(created, { tenantId }), 201);
  });

  // ── List clones the caller owns or has licensed (cached) ────────────────
  router.get('/', async (c) => {
    const tenantId = c.get('tenantId');
    const env = c.env as Env;
    const version = await getCacheVersion(env, `voiceclones:${tenantId}`);

    const clones = await getOrSetCached(
      env,
      `voiceclones:${tenantId}:v:${version}`,
      async () => {
        // Owned + licensed (cross-tenant, by license) — see listUsableClones.
        return (await listUsableClones(db, tenantId)).map((row) => toPublicClone(row, { tenantId }));
      },
      { kvTtlSeconds: 300 },
    );

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
    const env = c.env as Env;
    const version = await getCacheVersion(env, 'voiceclones:marketplace');
    const clones = await getOrSetCached(
      env,
      `voiceclones:marketplace:v:${version}`,
      async () => {
        const rows = await db
          .select()
          .from(studioVoiceClones)
          .where(eq(studioVoiceClones.visibility, 'marketplace'))
          .orderBy(desc(studioVoiceClones.createdAt)).limit(LIST_ROW_CAP);
        return rows.filter((r) => r.status === 'published').map((row) => toPublicClone(row));
      },
      { kvTtlSeconds: 300 },
    );
    return c.json({ clones });
  });

  // ── Acquire a marketplace voice ──────────────────────────────────────────
  // FREE → licensed at once. PRICED → the platform's one hosted checkout
  // (`startVoiceCheckout`); the license is granted by `/checkout/complete` or the
  // webhook (purchaseRegistry), each after re-reading the session from the processor.
  router.post('/marketplace/:id/license', async (c) => {
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId') ?? null;
    try {
      const out = await acquireFreeVoiceLicense(db, { cloneId, tenantId, userId });
      // A revoked license stays revoked: 409, and nothing changed so the cache is left alone.
      if ('applied' in out) return c.json({ reason: out.reason }, 409);
      // The caller's cached list merges in licensed clones — refresh it.
      await bumpCacheVersion(c.env as Env, `voiceclones:${tenantId}`);
      return c.json(out, 201);
    } catch (err) {
      if (err instanceof VoiceCloneLicensePaymentRequired) {
        if (!userId) return c.json({ error: 'Sign in to buy this voice' }, 401);
        const body = await parseOptionalBody(c, VoiceCheckoutStartBody);
        const { checkoutUrl } = await startVoiceCheckout(db, c.env as Env, {
          tenantId,
          buyerUserId: userId,
          buyerEmail: body.buyerEmail ?? null,
          cloneId,
          ...(body.returnUrl ? { returnUrl: body.returnUrl } : {}),
        });
        return c.json({ checkoutUrl }, 200);
      }
      if (err instanceof ListingError) throw err;
      return mapSynthError(c, err);
    }
  });

  // The processor's redirect lands here; the session is re-read FROM the processor.
  router.post('/marketplace/:id/checkout/complete', async (c) => {
    const tenantId = c.get('tenantId');
    const body = await parseBody(c, VoiceCheckoutCompleteBody);
    const purchase = await completeVoiceCheckout(db, c.env as Env, {
      tenantId,
      buyerUserId: c.get('userId') as string,
      checkoutSessionId: body.checkoutSessionId,
    });
    // A revoked license (refunded / disputed) is never reported as purchased.
    if (!purchase.applied) return c.json({ purchased: false, reason: purchase.reason }, 409);
    return c.json({ purchased: true, purchase });
  });

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
      return mapSynthError(c, err);
    }
  });

  // One-time device migration: upload a locally-held embedding if the server lacks one.
  router.put('/:id/embedding', async (c) => {
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);
    const body = (await c.req.json().catch(() => null)) as { embedding?: unknown; sampleRate?: unknown } | null;
    const embedding = parseEmbedding(body?.embedding);
    if (!embedding) return c.json({ error: 'embedding must be a non-empty array of at most 4096 finite numbers' }, 422);
    try {
      const stored = await storeOwnerEmbeddingIfMissing(db, c.env as Env, {
        cloneId, tenantId: c.get('tenantId'), userId: c.get('userId') ?? null, embedding,
        sampleRate: parseSampleRate(body?.sampleRate),
      });
      return c.json({ stored });
    } catch (err) {
      return mapSynthError(c, err);
    }
  });

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
      return mapSynthError(c, err);
    }
  });

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
      return mapSynthError(c, err);
    }
  });

  // ── A stored voiceover's signed provenance (access-checked) ──────────────
  router.get('/:id/voiceovers/:voiceoverId/provenance', async (c) => {
    const tenantId = c.get('tenantId');
    const cloneId = Number(c.req.param('id'));
    const voiceoverId = Number(c.req.param('voiceoverId'));
    if (!Number.isInteger(cloneId) || !Number.isInteger(voiceoverId)) return c.json({ error: 'Not found' }, 404);

    const [clone] = await db
      .select({ id: studioVoiceClones.id, tenantId: studioVoiceClones.tenantId })
      .from(studioVoiceClones)
      .where(eq(studioVoiceClones.id, cloneId))
      .limit(1);
    if (!clone) return c.json({ error: 'Not found' }, 404);
    if (!(await canUseClone(db, clone, tenantId))) return c.json({ error: 'Forbidden' }, 403);

    // Scoped to the CALLER's tenant: a licensee never reads another tenant's voiceover provenance.
    const record = await findProvenanceForVoiceover(db, tenantId, voiceoverId);
    if (!record || record.cloneId !== cloneId) return c.json({ error: 'Not found' }, 404);
    return c.json({ manifest: record.manifest, signature: record.signature, watermarked: record.watermarked });
  });

  // ── Stream a synthesized voiceover's audio from R2 (access-checked) ──────
  router.get('/:id/voiceovers/:voiceoverId/audio', async (c) => {
    const tenantId = c.get('tenantId');
    const cloneId = Number(c.req.param('id'));
    const voiceoverId = Number(c.req.param('voiceoverId'));
    const env = c.env as Env;

    const [clone] = await db
      .select({ id: studioVoiceClones.id, tenantId: studioVoiceClones.tenantId })
      .from(studioVoiceClones)
      .where(eq(studioVoiceClones.id, cloneId))
      .limit(1);
    if (!clone) return c.json({ error: 'Not found' }, 404);
    if (!(await canUseClone(db, clone, tenantId))) return c.json({ error: 'Forbidden' }, 403);

    const [vo] = await db
      .select({ audioKey: studioVoiceovers.audioKey, cloneId: studioVoiceovers.cloneId })
      .from(studioVoiceovers)
      .where(scopedToTenant(studioVoiceovers, tenantId, eq(studioVoiceovers.id, voiceoverId)))
      .limit(1);
    if (!vo || vo.cloneId !== cloneId) return c.json({ error: 'Not found' }, 404);
    if (!env.UPLOADS) return c.json({ error: 'File storage not configured' }, 503);

    const obj = await env.UPLOADS.get(vo.audioKey);
    if (!obj) return c.json({ error: 'Audio expired' }, 404);
    const headers = new Headers();
    headers.set('Content-Type', obj.httpMetadata?.contentType ?? 'audio/wav');
    headers.set('Cache-Control', 'private, max-age=31536000, immutable');
    return new Response(obj.body, { headers });
  });

  // ── Delete a clone (owner only) — purge R2 + invalidate caches ──────────
  router.delete('/:id', async (c) => {
    const tenantId = c.get('tenantId');
    const cloneId = Number(c.req.param('id'));
    const env = c.env as Env;

    const [clone] = await db
      .select()
      .from(studioVoiceClones)
      .where(scopedToTenant(studioVoiceClones, tenantId, eq(studioVoiceClones.id, cloneId)))
      .limit(1);
    if (!clone) return c.json({ error: 'Not found' }, 404);
    if (clone.tenantId !== tenantId) return c.json({ error: 'Forbidden' }, 403);

    // Right-to-delete: collect the tenants who licensed this clone BEFORE the row
    // cascade removes the license bookkeeping. Their cached list (which merges in
    // licensed clones) must be invalidated too, or a deleted clone lingers in a
    // licensee's list for up to the cache TTL after the owner exercises deletion.
    const licenseeRows = await db
      .select({ tenantId: studioVoiceCloneLicenses.tenantId })
      .from(studioVoiceCloneLicenses)
      .where(eq(studioVoiceCloneLicenses.cloneId, cloneId));
    const licenseeTenantIds = [...new Set(licenseeRows.map((r) => r.tenantId))].filter(
      (id) => id !== tenantId,
    );

    // Purge R2 objects (reference + every synthesized voiceover) before the row
    // cascade removes their bookkeeping.
    if (env.UPLOADS) {
      if (clone.referenceKey) await env.UPLOADS.delete(clone.referenceKey).catch((error) => {
        reportCaughtError(error, { source: "presentation/routes/studioVoiceCloneRoutes.ts", operation: "createStudioVoiceCloneRoutes" });
      });
      const voiceovers = await db
        .select({ audioKey: studioVoiceovers.audioKey })
        .from(studioVoiceovers)
        .where(scopedToTenant(studioVoiceovers, tenantId, eq(studioVoiceovers.cloneId, cloneId)));
      await Promise.all(voiceovers.map((v) => env.UPLOADS!.delete(v.audioKey).catch((error) => {
        reportCaughtError(error, { source: "presentation/routes/studioVoiceCloneRoutes.ts", operation: "createStudioVoiceCloneRoutes" });
      })));
    }

    await db.delete(studioVoiceClones).where(scopedToTenant(studioVoiceClones, tenantId, eq(studioVoiceClones.id, cloneId)));
    await bumpCacheVersion(env, `voiceclones:${tenantId}`);
    if (clone.visibility === 'marketplace') await bumpCacheVersion(env, 'voiceclones:marketplace');
    // Invalidate every licensee's list cache so the deletion is immediate for them too.
    await Promise.all(
      licenseeTenantIds.map((id) => bumpCacheVersion(env, `voiceclones:${id}`)),
    );
    return c.json({ deleted: true });
  });

  return router;
}

/** Map the service's typed errors to HTTP. Honest 503 when no provider is wired
 *  (the package surfaces it as a fallback reason — never fake audio, PRD §7). */
function mapSynthError(c: Context<HonoEnv>, err: unknown) {
  if (err instanceof VoiceCloneNotFound) return c.json({ error: err.message }, 404);
  if (err instanceof VoiceCloneForbidden) return c.json({ error: err.message }, 403);
  if (err instanceof VoiceCloneConsentRequired) return c.json({ error: err.message }, 422);
  if (err instanceof VoiceCloneReferenceMissing) return c.json({ error: err.message }, 422);
  if (err instanceof VoiceCloneSynthesisConflict) return c.json({ error: err.message }, 409);
  if (err instanceof VoiceProvenanceInvalid) return c.json({ error: err.message }, 422);
  if (err instanceof VoiceProvenanceConflict) return c.json({ error: err.message }, 409);
  if (err instanceof VoiceProvenanceUnavailable) {
    return c.json({ error: err.message, code: err.code }, 503);
  }
  if (err instanceof TtsProviderUnavailable) {
    return c.json({ error: err.message, code: 'provider_unavailable' }, 503);
  }
  return c.json({ error: 'Synthesis failed', detail: String((err as Error)?.message ?? err) }, 502);
}
