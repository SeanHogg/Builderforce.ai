/**
 * Project Evermind API client — /api/projects/:id/evermind/*.
 *
 * Backs the "Project Evermind" panel: read the per-project self-learning model's
 * status, promote a published Studio model into it (seed), and flip the two run
 * switches — inference (do agent runs EXECUTE on it) and mode (does the project
 * CONTRIBUTE learnings back). See [[evermind-learning-architecture]].
 */
import { apiRequest } from './apiClient';

export type ProjectEvermindMode = 'connected' | 'offline-frozen';

/** Current head for a project's Evermind (mirrors the api `headCore` response). */
export interface ProjectEvermindHead {
  version: number;
  ref: string | null;
  mode: ProjectEvermindMode;
  name: string;
  contributions: number;
  inferenceEnabled: boolean;
  /** Pinned frontier-LLM teacher model id, or null for self-learning on raw run text. */
  teacherModel: string | null;
  /** ISO timestamp of the last merged contribution, or null if never learned. */
  lastLearnedAt: string | null;
  seeded: boolean;
}

/** One inspectable contribution the coordinator merged into a version. */
export interface ProjectEvermindRecentEntry {
  /** Stable unique id — targets a specific learned memory (Validate highlight / detail). */
  id: number;
  /** 'text' = a run/exemplar adapted here; 'delta' = a pre-diffed weight delta. */
  kind: 'text' | 'delta';
  /** The version this contribution was merged into. */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** FedAvg sample weight. */
  weight: number;
  /** Readable snippet of the task prompt (text-path only). */
  prompt?: string;
  /** Readable snippet of the run/exemplar text learned (text-path only). */
  text?: string;
}

/** The 8 affective (limbic) state dimensions the runtime models. Mirrors
 *  `@builderforce/agent-tools` `LimbicDimName` — keep in sync. */
export type LimbicDimName =
  | 'valence' | 'arousal'
  | 'driveCuriosity' | 'driveCaution' | 'driveEffort' | 'driveSocial'
  | 'attention' | 'exploration';

/** The project Evermind's current affective (limbic) state — computed server-side by
 *  the shared limbic compiler from the model's setpoints + recent activity. */
export interface ProjectEvermindAffect {
  /** Current 8-dim affective state, grounded in recent learning activity. */
  state: Record<LimbicDimName, number>;
  /** Resting setpoints the dynamics relax toward (the personality layer). */
  setpoints: Record<LimbicDimName, number>;
  /** Thalamus attention gain (Yerkes–Dodson gate on current arousal). */
  attentionGain: number;
  /** Basal-ganglia explore-vs-exploit bias derived from the current state. */
  exploreBias: number;
}

/** One measured training run behind a version bump (mirrors api `ProjectEvermindTrainingPoint`).
 *  The real neocortex-update signal the Knowledge Map surfaces — nothing fabricated. */
export interface ProjectEvermindTrainingPoint {
  /** The version this training run produced. */
  version: number;
  /** Epoch ms the merge landed. */
  at: number;
  /** Mean next-token training loss across the adaptations folded into this version
   *  (0 when the merge was pure pre-diffed deltas, so no local fit measured a loss). */
  loss: number;
  /** Training sequences (token windows) fed to the trainer this merge. */
  seqs: number;
  /** Distinct neocortex weights the merge changed. */
  moved: number;
  /** L2 norm of the weight movement base→merged — magnitude of the update. */
  deltaNorm: number;
  /** Contributions folded into this version. */
  merged: number;
}

/** The Evermind inspection console payload — head summary + live learning activity. */
export interface ProjectEvermindContributions {
  version: number;
  seeded: boolean;
  mode: ProjectEvermindMode;
  contributions: number;
  inferenceEnabled: boolean;
  teacherModel: string | null;
  lastLearnedAt: string | null;
  /** Contributions queued but not yet merged (in the coordinator's debounce window). */
  pending: number;
  recent: ProjectEvermindRecentEntry[];
  /** Per-version training telemetry (newest first) — loss + weight movement, the real
   *  data behind each neocortex update. Empty for projects that predate this telemetry. */
  training: ProjectEvermindTrainingPoint[];
  /** Current affective (limbic) state — powers the brain-map's limbic regions. */
  affect: ProjectEvermindAffect;
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

/** One recalled learned memory for a Brain reply (mirrors api `ProjectEvermindRecallItem`). */
export interface ProjectEvermindRecallItem {
  id: number;
  text: string;
  score: number;
}

/** Reply-time recall payload — the project's learning posture + recalled memories. */
export interface ProjectEvermindRecallResult {
  seeded: boolean;
  version: number;
  mode: ProjectEvermindMode;
  items: ProjectEvermindRecallItem[];
}

/**
 * Recall the project Evermind's learned memories most relevant to a Brain turn's
 * query. Read-only; drives the in-chat recall/learn/reconcile steps + grounds the
 * reply. Returns an unseeded (empty) result for a project without a base model.
 */
export async function recallProjectEvermind(
  projectId: number,
  query: string,
): Promise<ProjectEvermindRecallResult> {
  return apiRequest<ProjectEvermindRecallResult>(
    `/api/projects/${projectId}/evermind/recall`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
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
): Promise<{ ok: boolean; queued?: number }> {
  return apiRequest<{ ok: boolean; queued?: number }>(
    `/api/projects/${projectId}/evermind/learn-text`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(prompt ? { prompt } : {}) }),
    },
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

/** Toggle whether the project's agent runs EXECUTE on its Evermind. */
export async function setProjectEvermindInference(
  projectId: number,
  enabled: boolean,
): Promise<{ ok: boolean; inferenceEnabled: boolean }> {
  return apiRequest<{ ok: boolean; inferenceEnabled: boolean }>(
    `/api/projects/${projectId}/evermind/inference`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
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
