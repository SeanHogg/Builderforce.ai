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
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { HonoEnv, Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { authMiddleware } from '../middleware/authMiddleware';
import { buildPlanLimitsGuard } from '../middleware/planLimitsGuard';
import { resolveIsSuperadmin } from '../../infrastructure/auth/superadminFlag';
import {
  ideProjects,
  studioVoiceCloneLicenses,
  studioVoiceClones,
  studioVoiceovers,
} from '../../infrastructure/database/schema';
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
} from '../../application/studio/voiceCloneService';

const CONSENT_TEXT_VERSION = 'v1';

/** Minimal uploaded-file shape — the Worker FormData typing surfaces entries as
 *  `string`, so we cast multipart file parts to this instead of the DOM `File`. */
interface UploadedFile {
  name: string;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** A clone row trimmed to what clients need (never leak R2 keys / embeddings). */
function toPublicClone(row: typeof studioVoiceClones.$inferSelect) {
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
    ideProjectId: row.ideProjectId ?? null,
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

    // Superadmins never hit a plan wall (shared source of truth with the feature
    // gate); otherwise a non-paid plan gets the standard 402 upgrade payload.
    const guard = buildPlanLimitsGuard(db);
    const proCheck = (await resolveIsSuperadmin(env, userId))
      ? null
      : await guard.checkProFeature(tenantId, 'Voice Cloning');
    if (proCheck) return c.json(proCheck, 402);

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
        if (Array.isArray(parsed)) embedding = parsed.map(Number);
      } catch { /* ignore malformed embedding — reference path still works */ }
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

    const [created] = await db
      .insert(studioVoiceClones)
      .values({
        tenantId,
        userId,
        ideProjectId,
        name,
        description: String(form.get('description') ?? '') || null,
        provider: String(form.get('provider') ?? 'ssm-webgpu'),
        referenceKey,
        embedding,
        visibility,
        status: 'ready',
        consentAttestedAt: new Date(),
        consentTextVersion: CONSENT_TEXT_VERSION,
      })
      .returning();
    if (!created) return c.json({ error: 'Failed to create voice clone' }, 500);

    await bumpCacheVersion(env, `voiceclones:${tenantId}`);
    if (visibility === 'marketplace') await bumpCacheVersion(env, 'voiceclones:marketplace');
    return c.json(toPublicClone(created), 201);
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
        const owned = await db
          .select()
          .from(studioVoiceClones)
          .where(eq(studioVoiceClones.tenantId, tenantId))
          .orderBy(desc(studioVoiceClones.createdAt));

        const licenseRows = await db
          .select({ cloneId: studioVoiceCloneLicenses.cloneId })
          .from(studioVoiceCloneLicenses)
          .where(
            and(
              eq(studioVoiceCloneLicenses.tenantId, tenantId),
              eq(studioVoiceCloneLicenses.status, 'active'),
            ),
          );
        const licensedIds = licenseRows.map((r) => r.cloneId);
        const licensed = licensedIds.length
          ? await db.select().from(studioVoiceClones).where(inArray(studioVoiceClones.id, licensedIds))
          : [];

        return [...owned, ...licensed].map(toPublicClone);
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
          .orderBy(desc(studioVoiceClones.createdAt));
        return rows.filter((r) => r.status === 'published').map(toPublicClone);
      },
      { kvTtlSeconds: 300 },
    );
    return c.json({ clones });
  });

  // ── Synthesize: the metered, cached spine ───────────────────────────────
  router.post('/:id/synthesize', async (c) => {
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const cloneId = Number(c.req.param('id'));
    if (!Number.isInteger(cloneId)) return c.json({ error: 'invalid clone id' }, 400);

    const body = await c.req
      .json<{ text?: string; speed?: number; language?: string }>()
      .catch(() => ({}) as { text?: string; speed?: number; language?: string });
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
      .where(eq(studioVoiceovers.id, voiceoverId))
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
      .where(eq(studioVoiceClones.id, cloneId))
      .limit(1);
    if (!clone) return c.json({ error: 'Not found' }, 404);
    if (clone.tenantId !== tenantId) return c.json({ error: 'Forbidden' }, 403);

    // Purge R2 objects (reference + every synthesized voiceover) before the row
    // cascade removes their bookkeeping.
    if (env.UPLOADS) {
      if (clone.referenceKey) await env.UPLOADS.delete(clone.referenceKey).catch(() => {});
      const voiceovers = await db
        .select({ audioKey: studioVoiceovers.audioKey })
        .from(studioVoiceovers)
        .where(eq(studioVoiceovers.cloneId, cloneId));
      await Promise.all(voiceovers.map((v) => env.UPLOADS!.delete(v.audioKey).catch(() => {})));
    }

    await db.delete(studioVoiceClones).where(eq(studioVoiceClones.id, cloneId));
    await bumpCacheVersion(env, `voiceclones:${tenantId}`);
    if (clone.visibility === 'marketplace') await bumpCacheVersion(env, 'voiceclones:marketplace');
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
  if (err instanceof TtsProviderUnavailable) {
    return c.json({ error: err.message, code: 'provider_unavailable' }, 503);
  }
  return c.json({ error: 'Synthesis failed', detail: String((err as Error)?.message ?? err) }, 502);
}
