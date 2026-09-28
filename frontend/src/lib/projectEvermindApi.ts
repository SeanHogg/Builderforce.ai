/**
 * Project Evermind API client — /api/projects/:id/evermind/*.
 *
 * Backs the "Project Evermind" panel: read the per-project self-learning model's
 * status, promote a published Studio model into it (seed), and flip the two run
 * switches — inference (do agent runs EXECUTE on it) and mode (does the project
 * CONTRIBUTE learnings back). See [[evermind-learning-architecture]].
 */
import { apiRequest } from './apiClient';
import type {
  ProjectEvermindMode,
  ProjectEvermindHead,
  ProjectEvermindRecentEntry,
  ProjectEvermindContributions,
  ProjectEvermindTarget,
} from './projectEvermindTypes';

export type * from './projectEvermindTypes';

/**
 * List every Evermind this project targets — its own head plus the heads of the IDE
 * builds grouped under it. Read-only; drives the console's "Everminds under this
 * project" list. Ordered [self, …builds].
 */
export async function listProjectEvermindTargets(projectId: number): Promise<ProjectEvermindTarget[]> {
  const res = await apiRequest<{ targets: ProjectEvermindTarget[] }>(
    `/api/projects/${projectId}/evermind/targets`,
  );
  return res.targets ?? [];
}

export async function getProjectEvermindHead(projectId: number): Promise<ProjectEvermindHead> {
  return apiRequest<ProjectEvermindHead>(`/api/projects/${projectId}/evermind/head`);
}

/** Read the inspection console payload (head summary + queued depth + recent-learned ring). */
export async function getProjectEvermindContributions(projectId: number): Promise<ProjectEvermindContributions> {
  return apiRequest<ProjectEvermindContributions>(`/api/projects/${projectId}/evermind/contributions`);
}

/** A scored recall match — a learned memory plus its 0..1 relevance to a task. */
export interface ProjectEvermindValidateMatch extends ProjectEvermindRecentEntry {
  /** Lexical relevance of this memory to the validated task, 0..1. */
  score: number;
}

/** The Validate result: which learned memories would answer a candidate task. */
export interface ProjectEvermindValidateResult {
  prompt: string;
  version: number;
  seeded: boolean;
  matches: ProjectEvermindValidateMatch[];
  /** Id of the memory most likely used to respond, or null if none matched. */
  primaryId: number | null;
  /** Which ranker produced these matches: the model's own SSM embedding (semantic)
   *  or a lexical fallback when the model couldn't be reached. */
  method: 'embedding' | 'lexical';
}

/**
 * Validate a candidate task against the project's Evermind: which learned memories
 * would answer it (ranked, best first). Read-only recall preview — never teaches.
 */
export async function validateProjectEvermind(
  projectId: number,
  prompt: string,
): Promise<ProjectEvermindValidateResult> {
  return apiRequest<ProjectEvermindValidateResult>(
    `/api/projects/${projectId}/evermind/validate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    },
  );
}

/**
 * Teach the project's Evermind from raw text (a chat transcript / exemplar). The
 * UNIFIED `/learn-text` producer door: the coordinator adapts + merges in its alarm,
 * so this is a cheap POST. Optional `prompt` is the task the text answered (threaded
 * to the teacher for task→ideal-answer distillation).
 */
export async function teachProjectEvermindFromText(
  projectId: number,
  text: string,
  prompt?: string,
): Promise<{ ok: boolean; queued?: number; contributionId?: number }> {
  return apiRequest<{ ok: boolean; queued?: number; contributionId?: number }>(
    `/api/projects/${projectId}/evermind/learn-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(prompt ? { prompt } : {}) }),
    },
  );
}

/** How one enqueued contribution ended up (mirrors the api `ProjectEvermindContributionState`). */
export type ProjectEvermindContributionState = 'pending' | 'merged' | 'dropped' | 'unknown';

/** One contribution's status, from enqueue through to the provenance its merge recorded. */
export interface ProjectEvermindContributionStatus {
  contributionId: number;
  state: ProjectEvermindContributionState;
  kind?: 'text' | 'delta';
  /** The version it merged INTO (present only when `merged`). */
  version?: number;
  distilled?: boolean;
  teacherModel?: string;
  skipReason?: string;
  skipDetail?: string;
  attemptedTeacherModel?: string;
}

/**
 * Poll what became of a teach. `/learn-text` returns the instant the contribution is
 * queued — the frontier teacher only runs later in the coordinator's debounced merge —
 * so this is the only read that can say whether it was actually distilled, learned
 * un-taught, or faulted, and why.
 */
export async function getProjectEvermindContributionStatus(
  projectId: number,
  contributionId: number,
): Promise<ProjectEvermindContributionStatus> {
  return apiRequest<ProjectEvermindContributionStatus>(
    `/api/projects/${projectId}/evermind/contribution/${contributionId}`,
  );
}

/** Force a merge NOW ("Learn now" / distill) instead of waiting out the debounce window. */
export async function flushProjectEvermind(
  projectId: number,
): Promise<{ ok: boolean; merged: number; version: number; pending: number }> {
  return apiRequest<{ ok: boolean; merged: number; version: number; pending: number }>(
    `/api/projects/${projectId}/evermind/flush`,
    { method: 'POST' },
  );
}

/**
 * Seed the project base directly from a freshly-built `.evermind` artifact (the
 * in-browser Workflow Builder "Build" path): base64 model bytes + its tokenizer.
 * Manager-only server-side; validates the artifact before writing version 1.
 */
export async function seedProjectEvermindFromArtifact(
  projectId: number,
  params: { model: string; tokenizer: { vocab: Record<string, number>; merges: string[] }; name?: string },
): Promise<{ seeded: boolean; version: number; ref: string | null; mode: ProjectEvermindMode }> {
  return apiRequest<{ seeded: boolean; version: number; ref: string | null; mode: ProjectEvermindMode }>(
    `/api/projects/${projectId}/evermind/seed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: params.model, tokenizer: params.tokenizer, ...(params.name ? { name: params.name } : {}) }),
    },
  );
}

/** Promote a published Studio Evermind model into the project base (server-side copy). */
export async function seedProjectEvermindFromModel(
  projectId: number,
  slug: string,
  name?: string,
): Promise<{ seeded: boolean; version: number }> {
  return apiRequest<{ seeded: boolean; version: number }>(
    `/api/projects/${projectId}/evermind/seed-from-model`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug, ...(name ? { name } : {}) }),
    },
  );
}

/**
 * Toggle whether the project's agent runs EXECUTE on its Evermind.
 *
 * ENABLING is benchmark-gated server-side: a head that fails the coherence probe is
 * REFUSED with a 422 (it can't be promoted to serve while it produces gibberish).
 * 422 is listed as an expected error so it surfaces as a normal thrown Error (the
 * message is the server's plain-language reason) for the caller to render inline —
 * NOT a global system-fault toast / support prompt. `force` bypasses the probe
 * (deliberate operator override).
 */
export async function setProjectEvermindInference(
  projectId: number,
  enabled: boolean,
  opts?: { force?: boolean },
): Promise<{ ok: boolean; inferenceEnabled: boolean }> {
  return apiRequest<{ ok: boolean; inferenceEnabled: boolean }>(
    `/api/projects/${projectId}/evermind/inference`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled, ...(opts?.force ? { force: true } : {}) }),
      expectedErrors: [422],
    },
  );
}

/** Pin (or clear with null) the frontier-LLM teacher the project distils runs through. */
export async function setProjectEvermindTeacher(
  projectId: number,
  model: string | null,
): Promise<{ ok: boolean; teacherModel: string | null }> {
  return apiRequest<{ ok: boolean; teacherModel: string | null }>(
    `/api/projects/${projectId}/evermind/teacher`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    },
  );
}

/** One graded test-bench generation (mirrors api `EvermindProbeResult` samples). */
export interface ProjectEvermindProbeSample {
  prompt: string;
  /** The raw text the model generated — shown verbatim. */
  text: string;
  /** Whether this output would be served to a user, or refused as unusable. */
  coherent: boolean;
  /** The signal that rejected it (`repetition`, `non-words`, …); null when it passed. */
  failure: string | null;
  /** Plain-language explanation of `failure` (empty when coherent). */
  detail: string;
}

/** A test-bench run: the operator's prompt, or the fixed readiness suite. */
export interface ProjectEvermindProbeResult {
  version: number;
  projectId: number;
  mode: 'readiness' | 'prompt';
  ready: boolean;
  passRate: number;
  samples: ProjectEvermindProbeSample[];
}

/**
 * TEST BENCH — generate from the project's Evermind and grade the output with the same
 * rule the serve path applies. With a `prompt`, runs that prompt; without one, runs the
 * fixed readiness suite that gates enabling inference.
 *
 * This is what makes "what will this model produce?" answerable BEFORE a user finds out:
 * `validate` only previews which learned MEMORIES would be recalled and generates
 * nothing. Manager-gated server-side; 409 when the model isn't set up and 422 when the
 * artifact can't be run, both surfaced as ordinary inline errors rather than a system fault.
 */
export async function probeProjectEvermind(
  projectId: number,
  prompt?: string,
): Promise<ProjectEvermindProbeResult> {
  return apiRequest<ProjectEvermindProbeResult>(
    `/api/projects/${projectId}/evermind/probe`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(prompt ? { prompt } : {}),
      expectedErrors: [409, 422],
    },
  );
}

/**
 * REPLACE the model's weights with a fresh base, as a new version — from a published
 * Studio model (`slug`) or a clean starter base when omitted. The repair path for a
 * model that has trained itself into gibberish. Inference is left OFF: the new base has
 * to pass a readiness check before it may serve again.
 */
export async function reseedProjectEvermind(
  projectId: number,
  slug?: string,
): Promise<{ ok: boolean; version: number; inferenceEnabled: boolean }> {
  return apiRequest<{ ok: boolean; version: number; inferenceEnabled: boolean }>(
    `/api/projects/${projectId}/evermind/reseed`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(slug ? { slug } : {}),
    },
  );
}

/** Recompute every learned memory's recall embedding against the CURRENT model, so
 *  retrieval stops drifting as the model learns. */
export async function reindexProjectEvermind(
  projectId: number,
): Promise<{ ok: boolean; reindexed: number; skipped: number; version: number }> {
  return apiRequest<{ ok: boolean; reindexed: number; skipped: number; version: number }>(
    `/api/projects/${projectId}/evermind/reindex`,
    { method: 'POST', expectedErrors: [409, 503] },
  );
}

/** Discard queued-but-unmerged contributions and purge cached answers. Never touches
 *  what the model has already learned. */
export async function cleanupProjectEvermind(
  projectId: number,
): Promise<{ ok: boolean; discarded: number; cachedAnswers: number }> {
  return apiRequest<{ ok: boolean; discarded: number; cachedAnswers: number }>(
    `/api/projects/${projectId}/evermind/cleanup`,
    { method: 'POST' },
  );
}

/** What a knowledge audit concluded about one learned memory. */
export type ProjectEvermindKnowledgeVerdict = 'ok' | 'incoherent' | 'incorrect' | 'outdated' | 'unusable' | 'redundant';

/** One audited memory + (where repairable) the correction that would replace it. */
export interface ProjectEvermindKnowledgeFinding {
  id: number;
  verdict: ProjectEvermindKnowledgeVerdict;
  issue: string;
  prompt?: string;
  excerpt: string;
  correction?: string;
  source: 'coherence-gate' | 'frontier';
}

/** A read-only knowledge audit. */
export interface ProjectEvermindKnowledgeAnalysis {
  version: number;
  analyzed: number;
  /** The frontier model that graded, or null when only the local coherence screen ran. */
  model: string | null;
  findings: ProjectEvermindKnowledgeFinding[];
  /** Present when the frontier review couldn't run — local findings are still returned. */
  warning?: string;
}

/** What applying findings actually changed. */
export interface ProjectEvermindKnowledgeRepair {
  corrected: number;
  forgotten: number;
  merged: number;
  version: number;
  skipped: Array<{ id: number; reason: string }>;
}

/**
 * ANALYZE — read back what the Evermind has learned and have it checked for mistakes,
 * stale facts and nonsense. Read-only: nothing changes until findings are applied.
 * Frontier-gated server-side (402 when the plan can't reach a frontier model).
 */
export async function analyzeProjectEvermind(
  projectId: number,
): Promise<ProjectEvermindKnowledgeAnalysis> {
  return apiRequest<ProjectEvermindKnowledgeAnalysis>(
    `/api/projects/${projectId}/evermind/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      expectedErrors: [402],
    },
  );
}

/**
 * APPLY an audit's findings: forget the bad memories and re-teach the corrections in
 * their place (write-through — update == replace), then merge so the fixes are real
 * weights rather than a queued intention.
 */
export async function applyProjectEvermindFindings(
  projectId: number,
  findings: ProjectEvermindKnowledgeFinding[],
): Promise<ProjectEvermindKnowledgeRepair> {
  return apiRequest<ProjectEvermindKnowledgeRepair>(
    `/api/projects/${projectId}/evermind/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apply: true, findings }),
      expectedErrors: [400, 402],
    },
  );
}

/** Set the learning mode: connected (contribute) | offline-frozen (pinned, no write-back). */
export async function setProjectEvermindMode(
  projectId: number,
  mode: ProjectEvermindMode,
): Promise<{ ok: boolean; mode: ProjectEvermindMode }> {
  return apiRequest<{ ok: boolean; mode: ProjectEvermindMode }>(
    `/api/projects/${projectId}/evermind/mode`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    },
  );
}
