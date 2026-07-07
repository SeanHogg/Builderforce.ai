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
}

export async function getProjectEvermindHead(projectId: number): Promise<ProjectEvermindHead> {
  return apiRequest<ProjectEvermindHead>(`/api/projects/${projectId}/evermind/head`);
}

/** Read the inspection console payload (head summary + queued depth + recent-learned ring). */
export async function getProjectEvermindContributions(projectId: number): Promise<ProjectEvermindContributions> {
  return apiRequest<ProjectEvermindContributions>(`/api/projects/${projectId}/evermind/contributions`);
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
