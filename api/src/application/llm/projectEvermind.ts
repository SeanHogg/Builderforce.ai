/**
 * Project Evermind registry + R2 layout — the per-project, self-learning model.
 *
 * This is the read/registry half of the concurrent-learning architecture
 * ([[evermind-learning-architecture]]): the canonical project model lives in R2
 * as VERSIONED IMMUTABLE objects, and the `project_evermind` row (migration 0258)
 * tracks the current version + learning mode. Writes are funnelled through the
 * ProjectEvermindCoordinator Durable Object (the single serialized writer); this
 * module never mutates weights — it resolves the current head, seeds the base
 * version, and records the version bump the coordinator produces.
 *
 * R2 layout (UPLOADS), one immutable folder per version so every replica read is
 * coherent and the per-isolate model cache (loadEvermindModel) is always safe:
 *   evermind/project/<tenantId>/<projectId>/v<version>/model.evermind
 *   evermind/project/<tenantId>/<projectId>/v<version>/tokenizer.json
 *
 * Head resolution is served through the canonical read-through cache, keyed by a
 * per-project version token bumped on every seed / merge, so a learn never serves
 * a stale head.
 */
import { and, eq, sql } from 'drizzle-orm';
import { projectEvermind } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';

/** R2 key prefix under which per-project Evermind model versions live. */
export const PROJECT_EVERMIND_ROOT = 'evermind/project';

/** Learning modes (mirrors the `mode` column). */
export type ProjectEvermindMode = 'connected' | 'offline-frozen';

export interface ProjectEvermindHead {
  tenantId: number;
  projectId: number;
  name: string;
  /** Current canonical version. 0 = not yet seeded (no model in R2). */
  version: number;
  mode: ProjectEvermindMode;
  contributions: number;
  /** Immutable ref usable by {@link loadEvermindModel}; null when unseeded. */
  ref: string | null;
}

/** Stable base path for a project's model versions. */
export function projectEvermindBase(tenantId: number, projectId: number): string {
  return `${PROJECT_EVERMIND_ROOT}/${tenantId}/${projectId}`;
}

/**
 * Immutable per-version ref. The objects live at `<ref>/model.evermind` and
 * `<ref>/tokenizer.json`, i.e. the SAME layout `loadEvermindModel` expects, so
 * the existing R2 loader + per-isolate cache serve a project model unchanged.
 */
export function projectEvermindRef(tenantId: number, projectId: number, version: number): string {
  return `${projectEvermindBase(tenantId, projectId)}/v${version}`;
}

/** Per-project cache version key — bumped on every seed / merge. */
function versionKey(tenantId: number, projectId: number): string {
  return `project_evermind:${tenantId}:${projectId}`;
}

function toMode(raw: string | null | undefined): ProjectEvermindMode {
  return raw === 'offline-frozen' ? 'offline-frozen' : 'connected';
}

/**
 * Resolve the current head for a project (cached, version-token keyed). Returns
 * an unseeded head (version 0, ref null) when no row exists yet, so callers can
 * uniformly branch on `version === 0`.
 */
export async function getProjectEvermindHead(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<ProjectEvermindHead> {
  const token = await getCacheVersion(env, versionKey(tenantId, projectId));
  return getOrSetCached(
    env,
    `project_evermind:head:${tenantId}:${projectId}:v:${token}`,
    async (): Promise<ProjectEvermindHead> => {
      const [row] = await db
        .select()
        .from(projectEvermind)
        .where(and(eq(projectEvermind.tenantId, tenantId), eq(projectEvermind.projectId, projectId)))
        .limit(1);
      if (!row || row.version <= 0) {
        return { tenantId, projectId, name: row?.name ?? 'Project Evermind', version: 0, mode: toMode(row?.mode), contributions: row?.contributions ?? 0, ref: null };
      }
      return {
        tenantId,
        projectId,
        name: row.name,
        version: row.version,
        mode: toMode(row.mode),
        contributions: row.contributions,
        ref: projectEvermindRef(tenantId, projectId, row.version),
      };
    },
    { kvTtlSeconds: 60 },
  );
}

/** Minimal R2 slice we use for writing model versions (keeps this mockable). */
export interface ArtifactWriteStore {
  put(key: string, value: ArrayBuffer | string): Promise<unknown>;
}

/**
 * Write a model version's two objects (model.evermind + tokenizer.json) to R2 at
 * the immutable per-version ref. Pure R2 IO — the caller owns the DB version bump
 * (so the row only advances once the bytes are durably written).
 */
export async function putProjectEvermindVersion(
  store: ArtifactWriteStore,
  tenantId: number,
  projectId: number,
  version: number,
  modelBlob: ArrayBuffer,
  tokenizer: { vocab: Record<string, number>; merges: string[] },
): Promise<string> {
  const ref = projectEvermindRef(tenantId, projectId, version);
  await store.put(`${ref}/model.evermind`, modelBlob);
  await store.put(`${ref}/tokenizer.json`, JSON.stringify({ vocab: tokenizer.vocab, merges: tokenizer.merges }));
  return ref;
}

/**
 * Seed a project's base model (version 1) from a published `.evermind` blob +
 * tokenizer. Idempotent-ish: if a row already exists at version ≥ 1 it is left
 * untouched and the existing head returned (seeding twice is a no-op, not a
 * clobber). Used by the publish/clone flow that promotes a trained model into a
 * project's learnable base.
 */
export async function seedProjectEvermind(
  env: Env,
  db: Db,
  store: ArtifactWriteStore,
  params: {
    tenantId: number;
    projectId: number;
    name?: string;
    modelBlob: ArrayBuffer;
    tokenizer: { vocab: Record<string, number>; merges: string[] };
  },
): Promise<ProjectEvermindHead> {
  const { tenantId, projectId } = params;
  const existing = await getProjectEvermindHead(env, db, tenantId, projectId);
  if (existing.version >= 1) return existing;

  await putProjectEvermindVersion(store, tenantId, projectId, 1, params.modelBlob, params.tokenizer);

  const name = params.name?.trim() || 'Project Evermind';
  // Advance an existing version-0 row to 1; if none exists, insert. The insert's
  // onConflictDoNothing covers a concurrent seeder that won the race (its bytes
  // are identical-shaped base weights, so either winner is correct).
  const advanced = await db
    .update(projectEvermind)
    .set({ version: 1, name, updatedAt: new Date() })
    .where(and(
      eq(projectEvermind.tenantId, tenantId),
      eq(projectEvermind.projectId, projectId),
      eq(projectEvermind.version, 0),
    ))
    .returning({ id: projectEvermind.id });
  if (advanced.length === 0) {
    await db
      .insert(projectEvermind)
      .values({ tenantId, projectId, name, version: 1, mode: 'connected', contributions: 0 })
      .onConflictDoNothing({ target: [projectEvermind.tenantId, projectEvermind.projectId] });
  }

  await bumpCacheVersion(env, versionKey(tenantId, projectId));
  return getProjectEvermindHead(env, db, tenantId, projectId);
}

/**
 * Record a merge the coordinator just wrote to R2: advance the DB version to
 * `newVersion`, increment contributions, stamp last_learned_at, and bump the
 * head cache. The R2 bytes for `newVersion` MUST already be durable. Guarded so
 * it only advances forward (a late/duplicate merge can't roll the head back).
 */
export async function recordProjectEvermindMerge(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  newVersion: number,
  mergedCount: number,
): Promise<void> {
  await db
    .update(projectEvermind)
    .set({
      version: newVersion,
      contributions: sql`${projectEvermind.contributions} + ${mergedCount}`,
      lastLearnedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(
      eq(projectEvermind.tenantId, tenantId),
      eq(projectEvermind.projectId, projectId),
      // forward-only: ignore a stale merge that races behind a newer head
      sql`${projectEvermind.version} < ${newVersion}`,
    ));
  await bumpCacheVersion(env, versionKey(tenantId, projectId));
}

/**
 * Model-pin prefix that targets a project's CURRENT Evermind version. A caller
 * pins `project_evermind:<projectId>` and the gateway expands it to the concrete
 * `evermind/<ref>` of the head version at run time — so each run transparently
 * picks up the latest learned model (pull-on-boundary via immutable per-version
 * refs + the per-isolate model cache).
 */
export const PROJECT_EVERMIND_MODEL_PREFIX = 'project_evermind:';

/**
 * Expand a `project_evermind:<projectId>` model pin into the concrete
 * `evermind/<ref>` for the project's current head. Returns:
 *   - `evermind/<ref>` when seeded,
 *   - undefined when the pin is malformed or the model isn't seeded yet (caller
 *     then falls back to the plan default rather than 500ing).
 * Any non-matching model string returns `passthrough` unchanged.
 */
export async function resolveProjectEvermindModelPin(
  env: Env,
  db: Db,
  tenantId: number,
  model: string,
): Promise<{ matched: boolean; model: string | undefined }> {
  if (!model.startsWith(PROJECT_EVERMIND_MODEL_PREFIX)) return { matched: false, model };
  const projectId = Number(model.slice(PROJECT_EVERMIND_MODEL_PREFIX.length).trim());
  if (!Number.isInteger(projectId) || projectId <= 0) return { matched: true, model: undefined };
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  return { matched: true, model: head.ref ? `evermind/${head.ref}` : undefined };
}

/** Durable Object instance name for a project's coordinator (single writer). */
export function coordinatorName(tenantId: number, projectId: number): string {
  return `proj:${tenantId}:${projectId}`;
}

/** Resolve the coordinator DO stub for a project, or null when the binding is unset. */
function coordinatorStub(env: Env, tenantId: number, projectId: number): DurableObjectStub | null {
  const ns = env.PROJECT_EVERMIND;
  if (!ns) return null;
  return ns.get(ns.idFromName(coordinatorName(tenantId, projectId)));
}

export interface LearnDispatchResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Push a weight-delta learning contribution to a project's coordinator (the only
 * writer). `diffB64` is a base64 serialized RowDelta (from the engine's
 * `diffCheckpoints(base, adapted)`); `baseVersion` is the head the agent pulled.
 * Returns a structured result so callers (gateway route / cloud finalize) can
 * surface "stale base" / "frozen" / "not seeded" honestly. No-op (503) when the
 * coordinator binding is unset.
 */
export async function dispatchProjectEvermindLearn(
  env: Env,
  tenantId: number,
  projectId: number,
  diffB64: string,
  baseVersion: number,
  weight?: number,
): Promise<LearnDispatchResult> {
  const stub = coordinatorStub(env, tenantId, projectId);
  if (!stub) return { ok: false, status: 503, body: { error: 'concurrent learning not configured (no coordinator binding)' } };
  const res = await stub.fetch('https://coordinator/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, projectId, diff: diffB64, baseVersion, ...(weight != null ? { weight } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Set the learning mode (connected | offline-frozen). Bumps the head cache. */
export async function setProjectEvermindMode(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  mode: ProjectEvermindMode,
): Promise<void> {
  await db
    .update(projectEvermind)
    .set({ mode, updatedAt: new Date() })
    .where(and(eq(projectEvermind.tenantId, tenantId), eq(projectEvermind.projectId, projectId)));
  await bumpCacheVersion(env, versionKey(tenantId, projectId));
}
