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
  seeded: boolean;
}

export async function getProjectEvermindHead(projectId: number): Promise<ProjectEvermindHead> {
  return apiRequest<ProjectEvermindHead>(`/api/projects/${projectId}/evermind/head`);
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
