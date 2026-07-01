/**
 * Project Evermind routes — the surface-agnostic seam for the per-project
 * self-learning model ([[evermind-learning-architecture]]).
 *
 * Two auth front doors share ONE set of core handlers (DRY): the web UI and any
 * JWT caller reach `/api/projects/:projectId/evermind/*`; on-prem agents (which
 * authenticate with their agentHost key, not a JWT) reach the read/learn subset
 * at `/api/agent/projects/:projectId/evermind/*`. Both resolve to the same
 * tenant-scoped service functions, so the replica-sync logic is defined once.
 *
 *   GET  /head        — current { version, ref, mode } to compare a replica against
 *   GET  /model       — download a version's `.evermind` bytes (replica refresh)
 *   GET  /tokenizer    — download a version's tokenizer.json
 *   POST /learn        — push a weight delta (→ coordinator DO, the single writer)
 *   POST /seed         — initialize the project's base model (manager, JWT only)
 *   PATCH /mode        — connected | offline-frozen (manager, JWT only)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { resolveHostAuth } from '../../infrastructure/auth/agentHostAuth';
import { TenantRole } from '../../domain/shared/types';
import { projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { resolveTenantModel, TENANT_MODEL_REF_PREFIX } from '../../application/llm/tenantModelService';
import {
  getProjectEvermindHead,
  seedProjectEvermind,
  setProjectEvermindMode,
  setProjectEvermindInference,
  dispatchProjectEvermindLearn,
  projectEvermindRef,
  type ProjectEvermindMode,
} from '../../application/llm/projectEvermind';

/** Verify the project exists AND belongs to this tenant (IDOR guard). */
async function ownsProject(db: Db, tenantId: number, projectId: number): Promise<boolean> {
  if (!Number.isInteger(projectId) || projectId <= 0) return false;
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.tenantId, tenantId)))
    .limit(1);
  return !!row;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Shared core handlers (auth-agnostic) ──────────────────────────────────────

async function headCore(env: Env, db: Db, tenantId: number, projectId: number): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  return json({ version: head.version, ref: head.ref, mode: head.mode, name: head.name, contributions: head.contributions, inferenceEnabled: head.inferenceEnabled, seeded: head.version > 0 });
}

async function artifactCore(env: Env, db: Db, tenantId: number, projectId: number, versionQ: string | undefined, file: 'model.evermind' | 'tokenizer.json'): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  if (!env.UPLOADS) return json({ error: 'R2 artifact storage not configured' }, 503);
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  const qv = Number(versionQ);
  const version = Number.isInteger(qv) && qv > 0 ? qv : head.version;
  if (version <= 0) return json({ error: 'project Evermind not seeded' }, 404);
  const obj = await env.UPLOADS.get(`${projectEvermindRef(tenantId, projectId, version)}/${file}`);
  if (!obj) return json({ error: `${file} version ${version} not found` }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': file === 'model.evermind' ? 'application/octet-stream' : 'application/json',
      'X-Evermind-Version': String(version),
      // Immutable per version — safe to cache hard on the client (pull-on-boundary).
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  });
}

async function learnCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const body = (await c.req.json<{ diff?: unknown; baseVersion?: unknown; weight?: unknown }>().catch(() => ({}))) as {
    diff?: unknown; baseVersion?: unknown; weight?: unknown;
  };
  const diff = typeof body.diff === 'string' ? body.diff : '';
  const baseVersion = typeof body.baseVersion === 'number' ? body.baseVersion : NaN;
  if (!diff || !Number.isInteger(baseVersion)) return json({ error: 'diff (base64) and baseVersion are required' }, 400);
  const result = await dispatchProjectEvermindLearn(env, tenantId, projectId, diff, baseVersion, typeof body.weight === 'number' ? body.weight : undefined);
  return json(result.body, result.status);
}

const pid = (c: Context): number => Number(c.req.param('projectId'));

// ── JWT front door (web UI + internal JWT callers) ───────────────────────────

export function createProjectEvermindRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const t = (c: Context) => c.get('tenantId') as number;

  router.get('/:projectId/evermind/head', (c) => headCore(c.env as Env, db, t(c), pid(c)));
  router.get('/:projectId/evermind/model', (c) => artifactCore(c.env as Env, db, t(c), pid(c), c.req.query('version'), 'model.evermind'));
  router.get('/:projectId/evermind/tokenizer', (c) => artifactCore(c.env as Env, db, t(c), pid(c), c.req.query('version'), 'tokenizer.json'));
  router.post('/:projectId/evermind/learn', (c) => learnCore(c.env as Env, db, t(c), pid(c), c));

  /** Seed the base model (version 1) from a published `.evermind` blob (manager). */
  router.post('/:projectId/evermind/seed', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    if (!c.env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const body = (await c.req.json<{ model?: unknown; tokenizer?: unknown; name?: unknown }>().catch(() => ({}))) as {
      model?: unknown; tokenizer?: unknown; name?: unknown;
    };
    const modelB64 = typeof body.model === 'string' ? body.model : '';
    const tokenizer = body.tokenizer as { vocab?: unknown; merges?: unknown } | undefined;
    if (!modelB64) return c.json({ error: 'model (base64 .evermind) is required' }, 400);
    if (!tokenizer || typeof tokenizer.vocab !== 'object' || !Array.isArray(tokenizer.merges)) {
      return c.json({ error: 'tokenizer { vocab, merges } is required' }, 400);
    }

    let modelBlob: ArrayBuffer;
    try {
      const bin = atob(modelB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      modelBlob = bytes.buffer;
      const verdict = EvermindModelPackage.fromBlob(modelBlob).validate();
      if (!verdict.ok) return c.json({ error: `invalid .evermind artifact: ${verdict.errors.join('; ')}` }, 400);
    } catch (err) {
      return c.json({ error: `could not parse .evermind artifact: ${err instanceof Error ? err.message : String(err)}` }, 400);
    }

    const head = await seedProjectEvermind(c.env as Env, db, c.env.UPLOADS, {
      tenantId, projectId,
      ...(typeof body.name === 'string' ? { name: body.name } : {}),
      modelBlob,
      tokenizer: { vocab: tokenizer.vocab as Record<string, number>, merges: tokenizer.merges as string[] },
    });
    return c.json({ seeded: true, version: head.version, ref: head.ref, mode: head.mode }, 201);
  });

  /**
   * Seed the base model from an ALREADY-PUBLISHED Studio Evermind model (manager).
   * Body: { slug, name? }. Server-side copy — reads the published model's two R2
   * objects (`<ref>/model.evermind` + `<ref>/tokenizer.json`) and seeds the project
   * base, so the browser never round-trips the model blob. This is the practical
   * "Enable project Evermind" path the UI drives.
   */
  router.post('/:projectId/evermind/seed-from-model', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const env = c.env as Env;
    if (!env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const body = (await c.req.json<{ slug?: unknown; name?: unknown }>().catch(() => ({}))) as { slug?: unknown; name?: unknown };
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) return c.json({ error: 'slug (a published Evermind model) is required' }, 400);

    // Resolve the published model → its immutable R2 ref (tenant-scoped, so no IDOR).
    const tm = await resolveTenantModel(env, db, tenantId, `${TENANT_MODEL_REF_PREFIX}${slug}`);
    if (!tm || !tm.baseModel?.startsWith('evermind/')) {
      return c.json({ error: 'no published Evermind model with that slug' }, 404);
    }
    const ref = tm.baseModel.slice('evermind/'.length);

    const [modelObj, tokObj] = await Promise.all([
      env.UPLOADS.get(`${ref}/model.evermind`),
      env.UPLOADS.get(`${ref}/tokenizer.json`),
    ]);
    if (!modelObj) return c.json({ error: 'published model artifact not found in storage' }, 404);
    if (!tokObj) return c.json({ error: 'published model tokenizer not found in storage' }, 404);

    const modelBlob = await modelObj.arrayBuffer();
    const verdict = EvermindModelPackage.fromBlob(modelBlob).validate();
    if (!verdict.ok) return c.json({ error: `invalid .evermind artifact: ${verdict.errors.join('; ')}` }, 400);
    const tokenizer = (await tokObj.json().catch(() => null)) as { vocab?: unknown; merges?: unknown } | null;
    if (!tokenizer || typeof tokenizer.vocab !== 'object' || !Array.isArray(tokenizer.merges)) {
      return c.json({ error: 'published model tokenizer is malformed' }, 400);
    }

    const head = await seedProjectEvermind(env, db, env.UPLOADS, {
      tenantId, projectId,
      name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : (tm.name ?? undefined),
      modelBlob,
      tokenizer: { vocab: tokenizer.vocab as Record<string, number>, merges: tokenizer.merges as string[] },
    });
    return c.json({ seeded: true, version: head.version, ref: head.ref, mode: head.mode, inferenceEnabled: head.inferenceEnabled }, 201);
  });

  /** Set the learning mode (manager). Body: { mode: 'connected' | 'offline-frozen' }. */
  router.patch('/:projectId/evermind/mode', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const body = (await c.req.json<{ mode?: unknown }>().catch(() => ({}))) as { mode?: unknown };
    const mode = body.mode === 'offline-frozen' || body.mode === 'connected' ? (body.mode as ProjectEvermindMode) : null;
    if (!mode) return c.json({ error: "mode must be 'connected' or 'offline-frozen'" }, 400);
    await setProjectEvermindMode(c.env as Env, db, tenantId, projectId, mode);
    const head = await getProjectEvermindHead(c.env as Env, db, tenantId, projectId);
    return c.json({ ok: true, mode: head.mode });
  });

  /** Toggle whether this project's agent runs execute ON its Evermind (manager).
   *  Body: { enabled: boolean }. The emitter of the `project_evermind:<id>` pin. */
  router.patch('/:projectId/evermind/inference', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const body = (await c.req.json<{ enabled?: unknown }>().catch(() => ({}))) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled (boolean) is required' }, 400);
    const head = await getProjectEvermindHead(c.env as Env, db, tenantId, projectId);
    if (body.enabled && head.version <= 0) {
      return c.json({ error: 'seed a base model before enabling inference' }, 409);
    }
    await setProjectEvermindInference(c.env as Env, db, tenantId, projectId, body.enabled);
    return c.json({ ok: true, inferenceEnabled: body.enabled });
  });

  return router;
}

// ── Agent (on-prem host key) front door — read + learn subset ─────────────────

export function createProjectEvermindAgentRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  // Each handler authenticates the agentHost key itself (Bearer + X-AgentHost-Id),
  // then scopes strictly to that host's tenant.
  const auth = async (c: Context): Promise<number | null> => {
    const host = await resolveHostAuth(db, c);
    return host?.tenantId ?? null;
  };

  router.get('/:projectId/evermind/head', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    return headCore(c.env as Env, db, tenantId, pid(c));
  });
  router.get('/:projectId/evermind/model', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    return artifactCore(c.env as Env, db, tenantId, pid(c), c.req.query('version'), 'model.evermind');
  });
  router.get('/:projectId/evermind/tokenizer', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    return artifactCore(c.env as Env, db, tenantId, pid(c), c.req.query('version'), 'tokenizer.json');
  });
  router.post('/:projectId/evermind/learn', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    return learnCore(c.env as Env, db, tenantId, pid(c), c);
  });

  return router;
}
