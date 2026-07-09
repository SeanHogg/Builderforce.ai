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
import { EvermindLM, EvermindModelPackage, BPETokenizer } from '@seanhogg/builderforce-memory-engine';
import {
  deriveLimbicSetpoints,
  homeostasis,
  applyDelta,
  appraiseAmygdala,
  appraiseTask,
  thalamusGate,
  basalGangliaExploreBias,
  type LimbicState,
  type LimbicSetpoints,
} from '@builderforce/agent-tools';
import { projectEvermind } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, getCacheVersion, bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { rankEvermindRecall, hashRecallPrompt, type RankedRecall } from './evermindRecall';

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
  /**
   * Opt-in consumer flag. When true AND seeded, agent runs for this project resolve
   * their inference model to {@link ref} — see {@link resolveProjectInferenceModel}.
   */
  inferenceEnabled: boolean;
  /**
   * Optional frontier-LLM teacher (any gateway model id). When set, the coordinator
   * distills: it adapts the SSM on that model's exemplar for each run instead of the
   * raw run text. null = self-learning on raw text only. See {@link setProjectEvermindTeacher}.
   */
  teacherModel: string | null;
  /** ISO timestamp of the last merged contribution, or null if never learned. */
  lastLearnedAt: string | null;
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
        return { tenantId, projectId, name: row?.name ?? 'Project Evermind', version: 0, mode: toMode(row?.mode), contributions: row?.contributions ?? 0, inferenceEnabled: row?.inferenceEnabled ?? false, teacherModel: row?.teacherModel ?? null, lastLearnedAt: row?.lastLearnedAt?.toISOString() ?? null, ref: null };
      }
      return {
        tenantId,
        projectId,
        name: row.name,
        version: row.version,
        mode: toMode(row.mode),
        contributions: row.contributions,
        inferenceEnabled: row.inferenceEnabled,
        teacherModel: row.teacherModel ?? null,
        lastLearnedAt: row.lastLearnedAt?.toISOString() ?? null,
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
 * A tiny generic corpus the DEFAULT project Evermind's byte-BPE tokenizer trains
 * on so it can round-trip code + English out of the box (the base vocab always
 * covers all 256 bytes, so any input is representable regardless). Small on
 * purpose — this is a learnable STARTER substrate that the project's runs then
 * adapt, not a pretrained frontier model.
 */
const DEFAULT_EVERMIND_CORPUS = [
  'function build(project) { return project.tasks.map(t => t.done); }',
  'const value = await fetch(url).then(r => r.json());',
  'export interface Config { name: string; version: number; }',
  'The agent reviews the change, runs the tests, and opens a pull request.',
  'if (error) { logger.warn(error.message); return null; }',
  'class Service { constructor(private readonly repo: Repository) {} }',
  'Summarize the run, list the files touched, and note any follow-ups.',
].join('\n');

/**
 * Generate a fresh DEFAULT base Evermind (a small randomly-initialised EvermindLM
 * + a self-contained byte-BPE tokenizer trained on {@link DEFAULT_EVERMIND_CORPUS}).
 * This is what every project gets so it ALWAYS has a model to run/learn/edit even
 * when the manager never seeds one from a published Studio model. Pure compute —
 * the caller writes the bytes.
 */
export function generateDefaultEvermindBase(): { modelBlob: ArrayBuffer; tokenizer: { vocab: Record<string, number>; merges: string[] } } {
  const tok = new BPETokenizer();
  tok.train(DEFAULT_EVERMIND_CORPUS);
  const lm = new EvermindLM({ vocabSize: tok.vocabSize });
  const pkg = EvermindModelPackage.fromLM(lm, {
    name: 'Project Evermind (starter)',
    version: '1',
    card: {
      description: 'Default starter Evermind — a small self-learning base that adapts to this project as its agents run.',
      trainingSummary: 'Randomly initialised EvermindLM with a byte-BPE tokenizer; learns from project runs.',
      license: 'proprietary',
      tags: ['evermind', 'starter', 'project'],
    },
  });
  const vocab = Object.fromEntries(tok.vocab) as Record<string, number>;
  const merges = [...tok.merges.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
  return { modelBlob: pkg.toBlob(), tokenizer: { vocab, merges } };
}

/**
 * Ensure a project has a base Evermind: if it's already seeded (version ≥ 1) this
 * is a no-op returning the current head; otherwise it seeds a freshly-generated
 * DEFAULT base ({@link generateDefaultEvermindBase}) as version 1. Idempotent and
 * safe under concurrency (seedProjectEvermind's onConflictDoNothing). Inference
 * stays OFF by default — a starter base is a learnable substrate, not something to
 * silently run agents on until the manager opts in.
 */
export async function ensureProjectEvermindSeeded(
  env: Env,
  db: Db,
  store: ArtifactWriteStore,
  tenantId: number,
  projectId: number,
  name?: string,
): Promise<ProjectEvermindHead> {
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  if (head.version >= 1) return head;
  const { modelBlob, tokenizer } = generateDefaultEvermindBase();
  return seedProjectEvermind(env, db, store, { tenantId, projectId, ...(name ? { name } : {}), modelBlob, tokenizer });
}

/**
 * Best-effort default-Evermind provisioning for the project-creation paths. Never
 * throws and never blocks project creation on failure — a project without R2 or a
 * transient error just has no starter model yet (the manager can seed later). Kept
 * as a thin wrapper so every create route calls ONE thing.
 */
export async function provisionDefaultProjectEvermind(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  name?: string,
): Promise<void> {
  try {
    if (!env.UPLOADS) return; // no artifact storage → nothing to seed
    await ensureProjectEvermindSeeded(env, db, env.UPLOADS, tenantId, projectId, name);
  } catch {
    /* best-effort: project creation must succeed even if seeding fails */
  }
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
 *   - `evermind/<ref>` when seeded AND the project opted into inference,
 *   - undefined when the pin is malformed, unseeded, or inference is OFF (caller
 *     then falls back to the plan default rather than 500ing).
 * Gated on `inferenceEnabled` — the SAME opt-in {@link resolveProjectInferenceModel}
 * uses — so the manager's toggle is the single source of truth and a hand-crafted
 * pin can't run a project's agents on its Evermind against that setting.
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
  const resolved = await resolveProjectInferenceModel(env, db, tenantId, projectId);
  return { matched: true, model: resolved };
}

/**
 * Consumer emitter (the other half of the pin). Resolve the inference model for a
 * project run: when the project opted into running on its Evermind (`inferenceEnabled`)
 * AND a base is seeded, returns the concrete `evermind/<ref>` of the CURRENT head so
 * the caller can hard-pin it (pull-on-boundary via the immutable per-version ref).
 * Returns undefined when inference is off or the model isn't seeded — the caller
 * then keeps its normal model selection (plan default), so this is safe to call on
 * every run. Cached through {@link getProjectEvermindHead}.
 */
export async function resolveProjectInferenceModel(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<string | undefined> {
  if (!Number.isInteger(projectId) || projectId <= 0) return undefined;
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  if (!head.inferenceEnabled || !head.ref) return undefined;
  return `evermind/${head.ref}`;
}

/** Toggle the opt-in inference consumer flag. Bumps the head cache. */
export async function setProjectEvermindInference(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  enabled: boolean,
): Promise<void> {
  await db
    .update(projectEvermind)
    .set({ inferenceEnabled: enabled, updatedAt: new Date() })
    .where(and(eq(projectEvermind.tenantId, tenantId), eq(projectEvermind.projectId, projectId)));
  await bumpCacheVersion(env, versionKey(tenantId, projectId));
}

/**
 * Pin (or clear) the frontier-LLM TEACHER for a project's Evermind. A non-empty
 * `model` (any gateway model id — Opus, Mistral, GLM, …) makes the coordinator
 * distill: each run adapts the SSM on that model's exemplar instead of raw text.
 * `null`/empty clears it (self-learning on raw text only). Bumps the head cache so
 * the coordinator's next alarm reads the new teacher. Idempotent.
 */
export async function setProjectEvermindTeacher(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  model: string | null,
): Promise<void> {
  const teacherModel = model && model.trim() ? model.trim() : null;
  await db
    .update(projectEvermind)
    .set({ teacherModel, updatedAt: new Date() })
    .where(and(eq(projectEvermind.tenantId, tenantId), eq(projectEvermind.projectId, projectId)));
  await bumpCacheVersion(env, versionKey(tenantId, projectId));
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

/**
 * The UNIFIED producer entry point: push RAW RUN TEXT to a project's coordinator.
 * The coordinator (single writer) adapts the base on the text and merges the delta
 * IN ITS ALARM — off the request path — so every surface (IDE, cloud, on-prem) is a
 * cheap text-poster and none pays training CPU on its own request/tick. This is why
 * the cloud finalize (a CF Worker/DO with a tight CPU budget) can contribute at all.
 * Best-effort: no-op (503) when the coordinator binding is unset; the DO gates
 * seeded/frozen itself.
 */
export async function dispatchProjectEvermindLearnText(
  env: Env,
  tenantId: number,
  projectId: number,
  text: string,
  weight?: number,
  prompt?: string | null,
): Promise<LearnDispatchResult> {
  const trimmed = (text ?? '').trim();
  if (trimmed.length < 20) return { ok: false, status: 400, body: { error: 'text too short' } };
  const promptTrimmed = (prompt ?? '').trim();
  const stub = coordinatorStub(env, tenantId, projectId);
  if (!stub) return { ok: false, status: 503, body: { error: 'concurrent learning not configured (no coordinator binding)' } };
  const res = await stub.fetch('https://coordinator/learn-text', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId, projectId, text: trimmed.slice(0, 8000), ...(promptTrimmed ? { prompt: promptTrimmed.slice(0, 8000) } : {}), ...(weight != null ? { weight } : {}) }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** One inspectable contribution the coordinator merged (mirrors the DO's RecentEntry). */
export interface ProjectEvermindRecentEntry {
  /** Stable unique id — targets a specific learned memory (e.g. Validate highlight).
   *  Backfilled from `at` for legacy ring entries written before ids were stamped. */
  id: number;
  kind: 'text' | 'delta';
  version: number;
  at: number;
  weight: number;
  prompt?: string;
  text?: string;
}

/** The coordinator's live learning snapshot: queued count + recent merged contributions. */
export interface ProjectEvermindActivity {
  pending: number;
  recent: ProjectEvermindRecentEntry[];
}

/**
 * Read the project coordinator's live learning activity (pending queue depth +
 * the recent-contributions ring). Read-only — never triggers a merge. Degrades to
 * an empty snapshot when the coordinator binding is unset or the DO has no state
 * yet, so a caller can always render the panel.
 */
export async function getProjectEvermindActivity(
  env: Env,
  tenantId: number,
  projectId: number,
): Promise<ProjectEvermindActivity> {
  const stub = coordinatorStub(env, tenantId, projectId);
  if (!stub) return { pending: 0, recent: [] };
  try {
    const res = await stub.fetch('https://coordinator/recent');
    if (!res.ok) return { pending: 0, recent: [] };
    const body = (await res.json().catch(() => ({}))) as Partial<ProjectEvermindActivity>;
    // Backfill a stable id for legacy ring entries written before ids were stamped,
    // so every entry the console sees can be targeted (Validate highlight / detail).
    const recent = Array.isArray(body.recent)
      ? body.recent.map((e) => ({ ...e, id: typeof e.id === 'number' ? e.id : e.at }))
      : [];
    return { pending: typeof body.pending === 'number' ? body.pending : 0, recent };
  } catch {
    return { pending: 0, recent: [] };
  }
}

/**
 * Force the coordinator to merge its queued contributions NOW ("Learn now" /
 * distill), instead of waiting out the debounce window. Returns how many merged +
 * the resulting version. No-op (503) when the coordinator binding is unset; the DO
 * gates seeded/frozen itself, so a frozen model simply merges nothing.
 */
/**
 * The project Evermind's current affective (limbic) state, computed by the SHARED
 * `@builderforce/agent-tools` limbic compiler — the exact same "personality =
 * setpoints, limbic = dynamics" implementation the on-prem runtime and cloud engine
 * run (see [[limbic-system]]). Nothing is fabricated: the resting {@link setpoints}
 * come from the personality layer (neutral until a project carries a personality),
 * and {@link state} folds the project's real recent learning activity through the
 * amygdala/hypothalamus/thalamus/basal-ganglia dynamics. Powers the brain-map's
 * limbic-region charges + captions.
 */
export interface ProjectEvermindAffect {
  /** The 8-dim current affective state, grounded in recent activity. */
  state: LimbicState;
  /** The resting setpoints the dynamics relax toward (the personality layer). */
  setpoints: LimbicSetpoints;
  /** Thalamus attention gain (Yerkes–Dodson gate on the current arousal). */
  attentionGain: number;
  /** Basal-ganglia explore-vs-exploit bias derived from the current state. */
  exploreBias: number;
}

/**
 * Derive the project Evermind's current affective state from its recent merged
 * contributions. Starts at the personality setpoints (neutral when the project has
 * no personality) and, oldest→newest, relaxes toward them (homeostasis) then applies
 * each contribution as a "progress" learning event plus the task prompt's salience —
 * mirroring how the runtime's amygdala/thalamus appraise a run. Pure + cheap (folds
 * the bounded recent ring), so it runs inside the cached contributions read.
 */
export function computeProjectAffect(recent: ProjectEvermindRecentEntry[]): ProjectEvermindAffect {
  // No project-level personality is stored today, so the setpoints are the neutral
  // resting baseline; wired through `deriveLimbicSetpoints` so a future project
  // personality flows in without touching the brain map.
  const setpoints = deriveLimbicSetpoints(undefined);
  let state: LimbicState = { ...setpoints };
  const ordered = [...recent].sort((a, b) => a.at - b.at);
  for (const e of ordered) {
    state = homeostasis(state, setpoints, { rate: 0.15 });
    const intensity = Math.max(0.2, Math.min(1, e.weight || 0.5));
    state = applyDelta(state, appraiseAmygdala({ kind: 'progress', intensity }));
    if (e.prompt) state = appraiseTask(e.prompt, state);
  }
  return {
    state,
    setpoints,
    attentionGain: thalamusGate(state),
    exploreBias: basalGangliaExploreBias(state),
  };
}

/** The Evermind console's read payload: the head summary + live learning activity. */
export interface ProjectEvermindContributions {
  version: number;
  seeded: boolean;
  mode: ProjectEvermindMode;
  contributions: number;
  inferenceEnabled: boolean;
  teacherModel: string | null;
  lastLearnedAt: string | null;
  pending: number;
  recent: ProjectEvermindRecentEntry[];
  /** Current affective (limbic) state — powers the brain-map's limbic regions. */
  affect: ProjectEvermindAffect;
}

/**
 * The combined read for the Evermind inspection console: the head summary plus the
 * coordinator's live activity (pending depth + recent-contributions ring). Served
 * through the read-through cache keyed by the per-project version token, so a busy
 * poll doesn't hammer the DB or the coordinator DO, yet a seed/merge/toggle (all of
 * which bump the token) invalidates it immediately.
 */
export async function getProjectEvermindContributions(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
): Promise<ProjectEvermindContributions> {
  const token = await getCacheVersion(env, versionKey(tenantId, projectId));
  return getOrSetCached(
    env,
    `project_evermind:contrib:${tenantId}:${projectId}:v:${token}`,
    async (): Promise<ProjectEvermindContributions> => {
      const head = await getProjectEvermindHead(env, db, tenantId, projectId);
      const activity = await getProjectEvermindActivity(env, tenantId, projectId);
      return {
        version: head.version,
        seeded: head.version > 0,
        mode: head.mode,
        contributions: head.contributions,
        inferenceEnabled: head.inferenceEnabled,
        teacherModel: head.teacherModel,
        lastLearnedAt: head.lastLearnedAt,
        pending: activity.pending,
        recent: activity.recent,
        affect: computeProjectAffect(activity.recent),
      };
    },
    { kvTtlSeconds: 10 },
  );
}

/** A scored recall match — a recent contribution plus its 0..1 relevance to a task. */
export type ProjectEvermindValidateMatch = RankedRecall;

/**
 * The Validate result: for a candidate task prompt, which of the project Evermind's
 * learned memories would answer it (ranked, best first), plus the id of the top
 * match. Read-only preview — never teaches or merges.
 */
export interface ProjectEvermindValidateResult {
  prompt: string;
  version: number;
  seeded: boolean;
  matches: ProjectEvermindValidateMatch[];
  /** Id of the best match (the memory most likely used to respond), or null if none. */
  primaryId: number | null;
}

/**
 * Validate: given a candidate task prompt, rank the project Evermind's recent
 * learned memories by how well each would answer it — the "which memory would be
 * used to respond?" preview behind the console's Validate button. A lexical recall
 * preview over the inspectable recent ring (see {@link rankEvermindRecall}); cached
 * behind the head version token + a prompt hash so a re-validate is free until the
 * model learns something new.
 */
export async function validateProjectEvermindRecall(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  prompt: string,
): Promise<ProjectEvermindValidateResult> {
  const clean = prompt.trim().slice(0, 2000);
  const token = await getCacheVersion(env, versionKey(tenantId, projectId));
  return getOrSetCached(
    env,
    `project_evermind:validate:${tenantId}:${projectId}:v:${token}:${hashRecallPrompt(clean)}`,
    async (): Promise<ProjectEvermindValidateResult> => {
      const contrib = await getProjectEvermindContributions(env, db, tenantId, projectId);
      const matches = rankEvermindRecall(clean, contrib.recent, { limit: 8 });
      return { prompt: clean, version: contrib.version, seeded: contrib.seeded, matches, primaryId: matches[0]?.id ?? null };
    },
    { kvTtlSeconds: 30 },
  );
}

/** One recalled memory for a Brain reply — a learned exemplar + its relevance. */
export interface ProjectEvermindRecallItem {
  id: number;
  text: string;
  score: number;
}

/** The reply-time recall payload the Brain run loop consumes (mirrors brain-embedded
 *  `EvermindRecallResult`): the project's learning posture + the recalled memories. */
export interface ProjectEvermindRecallResult {
  seeded: boolean;
  version: number;
  mode: ProjectEvermindMode;
  items: ProjectEvermindRecallItem[];
}

/** Snippet length for a recalled memory shown in the chat (keeps the prompt block small). */
const RECALL_SNIPPET_CHARS = 240;

/**
 * Recall the project Evermind's learned memories most relevant to `query`, for a
 * project-scoped Brain reply. Wraps {@link validateProjectEvermindRecall} (the same
 * cached lexical ranker the console's Validate uses) and adds the head's learning
 * posture (mode/version) so the run loop knows whether the turn will also be
 * contributed back. Returns an unseeded result (no items) when the project has no
 * base model, so the caller can always render.
 */
export async function recallProjectEvermindMemory(
  env: Env,
  db: Db,
  tenantId: number,
  projectId: number,
  query: string,
): Promise<ProjectEvermindRecallResult> {
  const head = await getProjectEvermindHead(env, db, tenantId, projectId);
  if (head.version < 1) return { seeded: false, version: 0, mode: head.mode, items: [] };
  const clean = query.trim();
  if (!clean) return { seeded: true, version: head.version, mode: head.mode, items: [] };
  const validate = await validateProjectEvermindRecall(env, db, tenantId, projectId, clean);
  const items = validate.matches
    .map((m) => ({
      id: m.id,
      text: ((m.text ?? m.prompt ?? '') as string).replace(/\s+/g, ' ').trim().slice(0, RECALL_SNIPPET_CHARS),
      score: m.score,
    }))
    .filter((it) => it.text.length > 0);
  return { seeded: true, version: head.version, mode: head.mode, items };
}

export async function flushProjectEvermind(
  env: Env,
  tenantId: number,
  projectId: number,
): Promise<LearnDispatchResult> {
  const stub = coordinatorStub(env, tenantId, projectId);
  if (!stub) return { ok: false, status: 503, body: { error: 'concurrent learning not configured (no coordinator binding)' } };
  const res = await stub.fetch('https://coordinator/flush', { method: 'POST' });
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
