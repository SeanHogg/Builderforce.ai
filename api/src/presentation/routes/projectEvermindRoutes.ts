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
 *   GET  /contribution/:id — poll ONE contribution from enqueue to merged provenance
 *   POST /seed         — initialize the project's base model (manager, JWT only)
 *   PATCH /mode        — connected | offline-frozen (manager, JWT only)
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import { EvermindModelPackage } from '@seanhogg/builderforce-memory-engine';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import { requireFrontierAccess } from '../middleware/featureGate';
import { resolveHostAuth } from '../../infrastructure/auth/agentHostAuth';
import { TenantRole } from '../../domain/shared/types';
import { projects } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env, HonoEnv } from '../../env';
import { seedProjectEvermindFromPublished } from '../../application/llm/evermindRecipes';
import {
  assessEvermindCoherence,
  probeEvermindGeneration,
  type ArtifactStore,
} from '../../application/llm/evermindRuntime';
import {
  analyzeProjectEvermindKnowledge,
  applyKnowledgeRepairs,
  type KnowledgeFinding,
} from '../../application/llm/evermindAnalyzer';
import { purgeProjectQaCache } from '../../application/llm/projectFacts';
import { isRoutableModel } from '../../application/llm/vendors/registry';
import {
  getProjectEvermindHead,
  resolveEvermindTargets,
  contributeTextToProjectEverminds,
  seedProjectEvermind,
  setProjectEvermindMode,
  setProjectEvermindInference,
  setProjectEvermindTeacher,
  dispatchProjectEvermindLearnText,
  getProjectEvermindContributions,
  getProjectEvermindContributionStatus,
  validateProjectEvermindRecall,
  recallProjectEvermindMemory,
  flushProjectEvermind,
  extractMemoriesToEvermind,
  MEMORY_EXTRACT_MAX_ENTRIES,
  projectEvermindRef,
  type ProjectEvermindMode,
  type MemoryExtractEntry,
  resolveEffectiveEvermindProjectId,
  reindexProjectEvermindRecall,
  discardProjectEvermindPending,
  reseedProjectEvermind,
  generateDefaultEvermindBase,
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

/**
 * REFUSE A WRITE TO AN EVERMIND THIS PROJECT DOES NOT OWN.
 *
 * The defect this closes was an affordance that silently did nothing. An IDE build
 * with no Evermind of its own INHERITS its container project's for reads — every read
 * path resolves `resolveEffectiveEvermindProjectId` — so the console showed
 * `seeded: true`, a version, contributions, the lot. Every WRITE, though, posted to
 * the raw project id, matched zero rows, and returned 200. Seeding "succeeded" and
 * nothing changed. Teaching "succeeded" and nothing was learned. The console was later
 * made read-only for that case, which hid the buttons but left the endpoints accepting
 * the writes — so anything that is not the console (the agent front door, the on-prem
 * runtime, a script, a curl) still got a cheerful lie.
 *
 * 409 CONFLICT, not 403 or 404: the caller is authorised and the project exists. What
 * is wrong is the TARGET — this project has no Evermind of its own, and the one it
 * reads from belongs to another project. The response names that project so the caller
 * can retry against it, which is the difference between a refusal and a dead end.
 *
 * Reads deliberately do NOT go through this: inheriting a container's Evermind for
 * reads is the intended behaviour and is why an IDE build gets useful recall at all.
 */
async function refuseInheritedWrite(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<Response | null> {
  const effectiveId = await resolveEffectiveEvermindProjectId(env, db, tenantId, projectId);
  if (effectiveId === projectId) return null;
  return json({
    error: 'This build has no Evermind of its own — it reads the one belonging to its '
      + 'container project. Write to that project instead, or seed an Evermind here first.',
    code: 'evermind_inherited_read_only',
    projectId,
    inheritedFromProjectId: effectiveId,
  }, 409);
}

// ── Shared core handlers (auth-agnostic) ──────────────────────────────────────

async function headCore(env: Env, db: Db, tenantId: number, projectId: number): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  // An IDE build without its own Evermind inherits its container project's.
  const effectiveId = await resolveEffectiveEvermindProjectId(env, db, tenantId, projectId);
  const head = await getProjectEvermindHead(env, db, tenantId, effectiveId);
  const inherited = effectiveId !== projectId;
  return json({ version: head.version, ref: head.ref, mode: head.mode, name: head.name, contributions: head.contributions, inferenceEnabled: head.inferenceEnabled, teacherModel: head.teacherModel, lastLearnedAt: head.lastLearnedAt, seeded: head.version > 0, quarantinedAt: head.quarantinedAt, quarantineReason: head.quarantineReason, inherited, ...(inherited ? { inheritedFromProjectId: effectiveId } : {}) });
}

/**
 * List ALL Everminds this project targets — its own head plus the heads of the IDE
 * builds grouped under it (`resolveEvermindTargets`). The one enumeration a surface uses
 * to show/triage "which Everminds does this project have"; each carries its id + ref +
 * version so a fan-out is legible. Cached via the resolver.
 */
async function targetsCore(env: Env, db: Db, tenantId: number, projectId: number): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const heads = await resolveEvermindTargets(env, db, tenantId, projectId);
  return json({
    targets: heads.map((h) => ({
      projectId: h.projectId,
      ref: h.ref,
      version: h.version,
      name: h.name,
      mode: h.mode,
      inferenceEnabled: h.inferenceEnabled,
      seeded: h.version > 0,
    })),
  });
}

/** Read the inspection console payload: head summary + queued depth + recent-learned ring. */
async function contributionsCore(env: Env, db: Db, tenantId: number, projectId: number): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  // Same inheritance as headCore — the console must not report "Not set up" for an
  // IDE build whose container project has a live Evermind.
  const effectiveId = await resolveEffectiveEvermindProjectId(env, db, tenantId, projectId);
  const payload = await getProjectEvermindContributions(env, db, tenantId, effectiveId);
  // Tell the console WHOSE Evermind it is looking at.
  //
  // Inheritance is the intended model for non-`evermind` builds (see the decision
  // note on `ideProjectRoutes`' create handler), but until now it was invisible: the
  // console read the CONTAINER's head — so `seeded: true`, stats rendered — while
  // every mutation on that panel (seed-from-model, mode, inference, teacher, teach,
  // flush) posts to the RAW project id, which has no `project_evermind` row. Those
  // writes updated zero rows and returned OK, so the panel offered management
  // controls that silently did nothing.
  //
  // Surfacing `inherited` lets the console render read-only and point at the owner
  // instead. This is a projection, not a change to the cached payload — the cache
  // key is the effective project's version token and must stay that way.
  const inherited = effectiveId !== projectId;
  return json({
    ...payload,
    inherited,
    ...(inherited ? { inheritedFromProjectId: effectiveId } : {}),
  });
}

/**
 * Poll ONE enqueued contribution's outcome.
 *
 * `/learn-text` returns the moment the contribution is queued — the frontier teacher
 * only runs later, in the coordinator's debounced merge alarm — so the POST's 200 can
 * only ever mean "accepted", never "taught". This is the read that lets a surface
 * resolve its optimistic state into the real one: still pending, merged (with the
 * teacher provenance the ring recorded), or dropped without becoming a memory.
 *
 * Follows the same inheritance as the console's other reads: an IDE build with no
 * Evermind of its own polls its container's coordinator, which is where its
 * contribution was actually enqueued.
 */
async function contributionStatusCore(env: Env, db: Db, tenantId: number, projectId: number, contributionId: number): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  if (!Number.isInteger(contributionId) || contributionId <= 0) return json({ error: 'contributionId must be a positive integer' }, 400);
  const effectiveId = await resolveEffectiveEvermindProjectId(env, db, tenantId, projectId);
  return json(await getProjectEvermindContributionStatus(env, tenantId, effectiveId, contributionId));
}

/**
 * Validate: rank which learned memories would answer a candidate task prompt (the
 * "what would this recall?" preview). Read-only — never teaches or merges; the
 * result is cached behind the head version token + a prompt hash.
 */
async function validateCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const body = (await c.req.json<{ prompt?: unknown }>().catch(() => ({}))) as { prompt?: unknown };
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  if (!prompt.trim()) return json({ error: 'prompt is required' }, 400);
  return json(await validateProjectEvermindRecall(env, db, tenantId, projectId, prompt));
}

/**
 * Reply-time recall — for a project-scoped Brain turn, return the learned memories
 * most relevant to the user's message plus the project's learning posture, so the
 * run loop can ground the answer on them and surface recall/learn/reconcile steps.
 * Read-only (never teaches); reuses the cached lexical ranker. An empty/absent
 * query yields an empty (non-error) result so the loop just skips the memory steps.
 */
async function recallCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const body = (await c.req.json<{ query?: unknown }>().catch(() => ({}))) as { query?: unknown };
  const query = typeof body.query === 'string' ? body.query : '';
  return json(await recallProjectEvermindMemory(env, db, tenantId, projectId, query));
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

/**
 * Text-path learn — the UNIFIED producer door. A surface (IDE/cloud/on-prem) POSTs
 * raw run text; the coordinator adapts+diffs it IN ITS ALARM, so no caller pays
 * training CPU. `{ text, weight? }`.
 */
/**
 * Contribute run/teach text to a project's Evermind. `fanOut` distinguishes the two
 * callers of this door: the on-prem RUN contribution (agent front door) targets the
 * project's WHOLE Evermind set (self + IDE builds) via {@link contributeTextToProjectEverminds};
 * the explicit "Teach a task" UI (JWT front door) targets the ONE Evermind in the URL.
 */
async function learnTextCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context, fanOut = false): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const inheritedBlock = await refuseInheritedWrite(env, db, tenantId, projectId);
  if (inheritedBlock) return inheritedBlock;
  const body = (await c.req.json<{ text?: unknown; weight?: unknown; prompt?: unknown }>().catch(() => ({}))) as { text?: unknown; weight?: unknown; prompt?: unknown };
  const text = typeof body.text === 'string' ? body.text : '';
  if (!text.trim()) return json({ error: 'text is required' }, 400);
  const prompt = typeof body.prompt === 'string' ? body.prompt : undefined;
  const weight = typeof body.weight === 'number' ? body.weight : undefined;
  if (fanOut) {
    const contributed = await contributeTextToProjectEverminds(env, db, tenantId, projectId, text, weight, prompt);
    // `baseVersion` kept for on-prem back-compat (it reads a single version); `contributed`
    // names every Evermind that received the text.
    return json({ ok: true, contributed, ...(contributed[0] ? { baseVersion: contributed[0].version } : {}) });
  }
  const result = await dispatchProjectEvermindLearnText(env, tenantId, projectId, text, weight, prompt);
  return json(result.body, result.status);
}

/**
 * Batch "Import from builderforce-memory" — the VS Code Evermind console reads the
 * local memory snapshot and POSTs its entries `{ entries: [{ key, text, prompt? }] }`.
 * Each is folded into THIS Evermind and a single flush merges them, so the editor can
 * then compact the absorbed entries to stubs. Manager-gated (a training write).
 */
async function extractMemoriesCore(env: Env, db: Db, tenantId: number, projectId: number, c: Context): Promise<Response> {
  if (!(await ownsProject(db, tenantId, projectId))) return json({ error: 'project not found' }, 404);
  const inheritedBlock = await refuseInheritedWrite(env, db, tenantId, projectId);
  if (inheritedBlock) return inheritedBlock;
  const body = (await c.req.json<{ entries?: unknown }>().catch(() => ({}))) as { entries?: unknown };
  if (!Array.isArray(body.entries)) return json({ error: 'entries[] is required' }, 400);
  const entries: MemoryExtractEntry[] = [];
  for (const raw of body.entries) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const key = typeof r.key === 'string' ? r.key : '';
    const text = typeof r.text === 'string' ? r.text : '';
    if (!key || !text.trim()) continue;
    entries.push({
      key,
      text,
      ...(typeof r.prompt === 'string' ? { prompt: r.prompt } : {}),
      ...(typeof r.weight === 'number' ? { weight: r.weight } : {}),
    });
  }
  if (entries.length === 0) return json({ error: 'no valid entries (each needs a key + non-empty text)' }, 400);
  if (entries.length > MEMORY_EXTRACT_MAX_ENTRIES) return json({ error: `too many entries (max ${MEMORY_EXTRACT_MAX_ENTRIES})` }, 400);
  const out = await extractMemoriesToEvermind(env, db, tenantId, projectId, entries);
  if (!out.ok) return json({ error: out.error }, out.status);
  return json(out.result);
}

const pid = (c: Context): number => Number(c.req.param('projectId'));

// ── JWT front door (web UI + internal JWT callers) ───────────────────────────

/** Wall-clock budget for one test-bench generation. Well inside a Worker's CPU
 *  allowance, so an over-long run returns a flagged partial rather than being killed
 *  mid-request with a 5xx the operator cannot interpret. */
const PROBE_DEADLINE_MS = 8000;

export function createProjectEvermindRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);
  const t = (c: Context) => c.get('tenantId') as number;

  router.get('/:projectId/evermind/head', (c) => headCore(c.env as Env, db, t(c), pid(c)));
  router.get('/:projectId/evermind/targets', (c) => targetsCore(c.env as Env, db, t(c), pid(c)));
  router.get('/:projectId/evermind/contributions', (c) => contributionsCore(c.env as Env, db, t(c), pid(c)));
  router.get('/:projectId/evermind/contribution/:contributionId', (c) => contributionStatusCore(c.env as Env, db, t(c), pid(c), Number(c.req.param('contributionId'))));
  router.post('/:projectId/evermind/validate', (c) => validateCore(c.env as Env, db, t(c), pid(c), c));
  router.post('/:projectId/evermind/recall', (c) => recallCore(c.env as Env, db, t(c), pid(c), c));
  router.get('/:projectId/evermind/model', (c) => artifactCore(c.env as Env, db, t(c), pid(c), c.req.query('version'), 'model.evermind'));
  router.get('/:projectId/evermind/tokenizer', (c) => artifactCore(c.env as Env, db, t(c), pid(c), c.req.query('version'), 'tokenizer.json'));
  router.post('/:projectId/evermind/learn-text', (c) => learnTextCore(c.env as Env, db, t(c), pid(c), c));
  /** Import a batch of raw memories (VS Code "Import from builderforce-memory") + flush. */
  router.post('/:projectId/evermind/extract-memories', requireRole(TenantRole.MANAGER), (c) => extractMemoriesCore(c.env as Env, db, t(c), pid(c), c));

  /** Seed the base model (version 1) from a published `.evermind` blob (manager). */
  // Deliberately NOT guarded by `refuseInheritedWrite`: seeding is precisely how an
  // inheriting build STOPS inheriting. Refusing it would make inheritance a one-way
  // trap — the build could never get an Evermind of its own.
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
  // Same exemption as `/seed` above — this is the other way a project acquires its own
  // Evermind, so it must remain reachable while the project is still inheriting.
  router.post('/:projectId/evermind/seed-from-model', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const env = c.env as Env;
    if (!env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const body = (await c.req.json<{ slug?: unknown; name?: unknown }>().catch(() => ({}))) as { slug?: unknown; name?: unknown };
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    if (!slug) return c.json({ error: 'slug (a published Evermind model) is required' }, 400);

    // Shared server-side R2 copy → project base (same path the create-time recipe uses).
    const seeded = await seedProjectEvermindFromPublished(
      env, db, tenantId, projectId, slug,
      typeof body.name === 'string' ? body.name : undefined,
    );
    if (!seeded.ok) {
      // "no published model with that slug" is a 404; malformed artifacts are 400.
      const status = /no published/i.test(seeded.error ?? '') ? 404 : 400;
      return c.json({ error: seeded.error ?? 'could not seed from model' }, status);
    }
    const head = await getProjectEvermindHead(env, db, tenantId, projectId);
    return c.json({ seeded: true, version: head.version, ref: head.ref, mode: head.mode, inferenceEnabled: head.inferenceEnabled }, 201);
  });

  /** Set the learning mode (manager). Body: { mode: 'connected' | 'offline-frozen' }. */
  router.patch('/:projectId/evermind/mode', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    const body = (await c.req.json<{ mode?: unknown }>().catch(() => ({}))) as { mode?: unknown };
    const mode = body.mode === 'offline-frozen' || body.mode === 'connected' ? (body.mode as ProjectEvermindMode) : null;
    if (!mode) return c.json({ error: "mode must be 'connected' or 'offline-frozen'" }, 400);
    await setProjectEvermindMode(c.env as Env, db, tenantId, projectId, mode);
    const head = await getProjectEvermindHead(c.env as Env, db, tenantId, projectId);
    return c.json({ ok: true, mode: head.mode });
  });

  /** Toggle whether this project's agent runs execute ON its Evermind (manager).
   *  Body: { enabled: boolean }. The emitter of the `project_evermind:<id>` pin.
   *  ENABLING is BENCHMARK-GATED: the head must pass a coherence probe (it can't be
   *  promoted to serve while it produces gibberish) — a 422 with the probe samples
   *  explains a refusal. `force:true` bypasses the probe (deliberate operator override). */
  router.patch('/:projectId/evermind/inference', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    const env = c.env as Env;
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    const body = (await c.req.json<{ enabled?: unknown; force?: unknown }>().catch(() => ({}))) as { enabled?: unknown; force?: unknown };
    if (typeof body.enabled !== 'boolean') return c.json({ error: 'enabled (boolean) is required' }, 400);
    const head = await getProjectEvermindHead(env, db, tenantId, projectId);
    if (body.enabled && head.version <= 0) {
      return c.json({ error: 'seed a base model before enabling inference' }, 409);
    }
    // Gate the enable on the coherence probe unless the operator forces it. The probe
    // needs the R2 store; if it isn't bound we allow the toggle (serve-time gate + the
    // auto-quarantine still protect users).
    const store = env.UPLOADS as ArtifactStore | undefined;
    const assessReadiness = body.enabled && body.force !== true && store
      ? (ref: string) => assessEvermindCoherence(store, ref)
      : undefined;
    const result = await setProjectEvermindInference(env, db, tenantId, projectId, body.enabled, { ...(assessReadiness ? { assessReadiness } : {}) });
    if (!result.ok) {
      return c.json({
        error: 'This Evermind is not coherent enough to serve yet — it produced gibberish on the readiness probe. Retrain or set a frontier teacher, then try again (or force to override).',
        reason: result.reason,
        readiness: result.readiness,
      }, 422);
    }
    return c.json({ ok: true, inferenceEnabled: result.inferenceEnabled });
  });

  /** Pin/clear the frontier-LLM TEACHER (manager). Body: { model: string | null }.
   *  A non-empty model id makes the coordinator distill runs through that frontier
   *  model; null/empty clears it (self-learning on raw run text only). */
  router.patch('/:projectId/evermind/teacher', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    const body = (await c.req.json<{ model?: unknown }>().catch(() => ({}))) as { model?: unknown };
    if (body.model != null && typeof body.model !== 'string') {
      return c.json({ error: 'model must be a string or null' }, 400);
    }
    const model = typeof body.model === 'string' && body.model.trim() ? body.model.trim() : null;
    if (model) {
      // Refuse an id that routes nowhere. Dispatch would silently fall back to the
      // default vendor, which has never heard of it, so EVERY coordinator alarm
      // would 503 forever with nothing to self-correct it (see isRoutableModel).
      if (!isRoutableModel(model)) {
        return c.json({
          error: `'${model}' is not a routable model id. Use a catalog id or an explicit vendor prefix (e.g. 'direct/xai/grok-4.5', 'xai-oauth/grok-4.5').`,
        }, 400);
      }
      // Setting a frontier teacher IS frontier use — gate it on frontier access
      // (paid plan OR a connected BYO account OR superadmin). Clearing (model=null)
      // stays open so a downgraded tenant can always turn distillation off.
      const gate = await requireFrontierAccess(c);
      if (gate) return gate;
      // Only meaningful once seeded — a teacher distils INTO a base model.
      const head = await getProjectEvermindHead(c.env as Env, db, tenantId, projectId);
      if (head.version <= 0) return c.json({ error: 'seed a base model before setting a teacher' }, 409);
    }
    await setProjectEvermindTeacher(c.env as Env, db, tenantId, projectId, model);
    return c.json({ ok: true, teacherModel: model });
  });

  /**
   * TEST BENCH — run a prompt through the head and see EXACTLY what it produces,
   * graded by the same gate the serve path applies (manager; it costs CPU).
   *
   * This is the answer to "how does a person validate what the model will produce?".
   * `validate` only ever previewed which learned MEMORIES would be recalled — it never
   * generated a single token, so the only way to discover that a head emitted gibberish
   * was for a user to receive some. Body: `{ prompt?, maxTokens?, temperature?, seed? }`.
   * With no prompt it runs the standard readiness suite (the identical probe the
   * enable-inference gate uses), so "will this pass the gate?" is answerable up front.
   */
  // POST, but a READ: it samples the head this project actually serves from and
  // mutates nothing, so it follows the same inheritance every other read does.
  router.post('/:projectId/evermind/probe', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    const env = c.env as Env;
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const store = env.UPLOADS as ArtifactStore | undefined;
    if (!store) return c.json({ error: 'R2 artifact storage not configured' }, 503);
    // Reads inherit (an IDE build probes the head it actually serves from).
    const effectiveId = await resolveEffectiveEvermindProjectId(env, db, tenantId, projectId);
    const head = await getProjectEvermindHead(env, db, tenantId, effectiveId);
    if (head.version <= 0 || !head.ref) return c.json({ error: 'this project’s Evermind is not set up yet' }, 409);

    const body = (await c.req.json<{ prompt?: unknown; maxTokens?: unknown; temperature?: unknown; seed?: unknown }>().catch(() => ({}))) as {
      prompt?: unknown; maxTokens?: unknown; temperature?: unknown; seed?: unknown;
    };
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : '';
    const opts = {
      ...(typeof body.maxTokens === 'number' ? { maxTokens: Math.min(Math.max(16, body.maxTokens), 512) } : {}),
      ...(typeof body.temperature === 'number' ? { temperature: Math.min(Math.max(0, body.temperature), 2) } : {}),
      ...(typeof body.seed === 'number' ? { seed: body.seed } : {}),
      // Generation is synchronous CPU on THIS request. The token clamp above bounds
      // how much work is asked for, but not how long it takes — a large head on a
      // slow isolate could approach the Worker CPU limit and die with no message and
      // no output. The budget turns that into a partial answer flagged `truncated`.
      deadlineMs: PROBE_DEADLINE_MS,
    };

    try {
      if (!prompt) {
        // Readiness suite — the same verdict the enable gate will reach.
        const readiness = await assessEvermindCoherence(store, head.ref);
        return c.json({
          version: head.version, projectId: effectiveId, mode: 'readiness' as const,
          ready: readiness.ready, passRate: readiness.passRate, samples: readiness.samples,
        });
      }
      const sample = await probeEvermindGeneration(store, head.ref, prompt, opts);
      return c.json({
        version: head.version, projectId: effectiveId, mode: 'prompt' as const,
        ready: sample.coherent, passRate: sample.coherent ? 1 : 0, samples: [sample], usage: sample.usage,
        // A run cut short by the budget is reported as such: an incoherent verdict on
        // a half-finished generation says something about the CLOCK, not the model.
        truncated: sample.truncated, elapsedMs: sample.elapsedMs,
      });
    } catch (err) {
      // A broken/absent artifact is an operator-visible condition, not a 500 mystery.
      return c.json({ error: err instanceof Error ? err.message : 'could not run the model' }, 422);
    }
  });

  /**
   * RE-SEED — replace this Evermind's weights with a fresh base, as a new version
   * (manager). Body: `{ slug? }` — a published Studio model, or omitted for a fresh
   * starter base.
   *
   * The repair door for a head that trained itself into gibberish. Until now
   * `seedProjectEvermind` deliberately refused to clobber an existing head, so a bad
   * model could be quarantined but never fixed from the product — "retrain or re-seed"
   * was an operator action with nowhere to perform it. Inference is left OFF: a fresh
   * base has proven nothing and must re-earn the right to serve through the same
   * benchmark gate as any other enable.
   */
  router.post('/:projectId/evermind/reseed', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    const env = c.env as Env;
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    if (!env.UPLOADS) return c.json({ error: 'R2 artifact storage not configured' }, 503);

    const body = (await c.req.json<{ slug?: unknown; name?: unknown }>().catch(() => ({}))) as { slug?: unknown; name?: unknown };
    const slug = typeof body.slug === 'string' ? body.slug.trim() : '';
    const name = typeof body.name === 'string' ? body.name : undefined;

    if (slug) {
      const seeded = await seedProjectEvermindFromPublished(env, db, tenantId, projectId, slug, name, { replace: true });
      if (!seeded.ok) {
        const status = /no published/i.test(seeded.error ?? '') ? 404 : 400;
        return c.json({ error: seeded.error ?? 'could not re-seed from that model' }, status);
      }
    } else {
      // No slug → a fresh STARTER base. Deliberately allowed: a project whose model is
      // unusable is better off back at a clean learnable substrate than stuck on it.
      const { modelBlob, tokenizer } = generateDefaultEvermindBase();
      await reseedProjectEvermind(env, db, env.UPLOADS, { tenantId, projectId, ...(name ? { name } : {}), modelBlob, tokenizer });
    }
    const head = await getProjectEvermindHead(env, db, tenantId, projectId);
    return c.json({ ok: true, version: head.version, ref: head.ref, inferenceEnabled: head.inferenceEnabled, quarantinedAt: head.quarantinedAt });
  });

  /**
   * REINDEX — recompute every learned memory's recall embedding against the CURRENT
   * head (manager). Embeddings are computed at merge time with the model as it was
   * then, while recall embeds the QUERY with today's model, so retrieval quality decays
   * silently as the model learns. Nothing re-derived them until now.
   */
  router.post('/:projectId/evermind/reindex', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    const result = await reindexProjectEvermindRecall(c.env as Env, tenantId, projectId);
    return c.json(result.body, result.status as never);
  });

  /**
   * CLEAN UP — drop queued-but-unmerged contributions and/or purge the memory-first
   * Q&A cache (manager). Body: `{ pending?: boolean, qaCache?: boolean }`, both default
   * true. Durable facts and everything already LEARNED are never touched here; use the
   * knowledge analyzer to repair learned knowledge.
   */
  router.post('/:projectId/evermind/cleanup', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    const env = c.env as Env;
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    const body = (await c.req.json<{ pending?: unknown; qaCache?: unknown }>().catch(() => ({}))) as { pending?: unknown; qaCache?: unknown };
    const doPending = body.pending !== false;
    const doQa = body.qaCache !== false;

    let discarded = 0;
    if (doPending) {
      const res = await discardProjectEvermindPending(env, tenantId, projectId);
      discarded = typeof res.body['discarded'] === 'number' ? (res.body['discarded'] as number) : 0;
    }
    const cachedAnswers = doQa ? await purgeProjectQaCache(env, db, tenantId, projectId) : 0;
    return c.json({ ok: true, discarded, cachedAnswers });
  });

  /**
   * ANALYZE — audit what this Evermind has learned and (optionally) fix it (manager).
   *
   * GET-shaped POST with `{ apply?: boolean, findings?: [...] }`:
   *   - no `apply` → read-only review; returns per-memory verdicts + proposed corrections
   *     so the operator sees what would change before anything does;
   *   - `apply: true` → repairs. With `findings` supplied, exactly those are applied
   *     (the operator's selection); without, the analysis is re-run and every actionable
   *     finding applied.
   *
   * Frontier-gated when it reaches a frontier model: reviewing knowledge with Opus is
   * frontier use. The local coherence screen alone needs no gate, but the endpoint runs
   * both, so the gate is applied up front for honesty about what it will spend.
   */
  router.post('/:projectId/evermind/analyze', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    const env = c.env as Env;
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    const gate = await requireFrontierAccess(c);
    if (gate) return gate;

    const body = (await c.req.json<{ apply?: unknown; limit?: unknown; findings?: unknown }>().catch(() => ({}))) as {
      apply?: unknown; limit?: unknown; findings?: unknown;
    };
    const limit = typeof body.limit === 'number' ? body.limit : undefined;
    // Analysis + repair both operate on the head this project actually serves from.
    const effectiveId = await resolveEffectiveEvermindProjectId(env, db, tenantId, projectId);

    if (body.apply !== true) {
      return c.json(await analyzeProjectEvermindKnowledge(env, db, tenantId, effectiveId, { ...(limit ? { limit } : {}) }));
    }

    // Apply: prefer the operator's explicit selection; otherwise re-analyze and fix all.
    let findings: KnowledgeFinding[];
    if (Array.isArray(body.findings)) {
      findings = body.findings.filter((f): f is KnowledgeFinding =>
        !!f && typeof f === 'object' && typeof (f as KnowledgeFinding).id === 'number' && typeof (f as KnowledgeFinding).verdict === 'string');
      if (findings.length === 0) return c.json({ error: 'findings[] contained no applicable entries' }, 400);
    } else {
      findings = (await analyzeProjectEvermindKnowledge(env, db, tenantId, effectiveId, { ...(limit ? { limit } : {}) })).findings;
    }
    const repair = await applyKnowledgeRepairs(env, db, tenantId, effectiveId, findings);
    return c.json({ ok: true, ...repair });
  });

  /** Force a merge NOW ("Learn now" / distill) instead of waiting out the debounce
   *  window (manager). The coordinator gates seeded/frozen itself, so a frozen model
   *  simply merges nothing. Returns { merged, version, pending }. */
  router.post('/:projectId/evermind/flush', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = t(c);
    const projectId = pid(c);
    if (!(await ownsProject(db, tenantId, projectId))) return c.json({ error: 'project not found' }, 404);
    const inheritedBlock = await refuseInheritedWrite(c.env as Env, db, tenantId, projectId);
    if (inheritedBlock) return inheritedBlock;
    const result = await flushProjectEvermind(c.env as Env, tenantId, projectId);
    return c.json(result.body, result.status as never);
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
  router.get('/:projectId/evermind/targets', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    return targetsCore(c.env as Env, db, tenantId, pid(c));
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
  router.post('/:projectId/evermind/learn-text', async (c) => {
    const tenantId = await auth(c);
    if (tenantId == null) return json({ error: 'unauthorized' }, 401);
    // On-prem RUN contribution → fan out to the project's whole Evermind set.
    return learnTextCore(c.env as Env, db, tenantId, pid(c), c, true);
  });

  return router;
}
