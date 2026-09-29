/**
 * Project Evermind API client — the /api/projects/:id/evermind/* reads and writes the
 * web makes OUTSIDE the console: the head (run chip, status badge), the inspection
 * payload (brain map, canvas), teaching from a transcript, and seeding a freshly
 * trained artifact. The console itself runs on the shared brain-ui REST adapter
 * (`createEvermindRestAdapter`), the one implementation every host uses.
 * See [[evermind-learning-architecture]].
 */
import type { EvermindRequest } from '@seanhogg/builderforce-brain-ui';
import { apiRequest } from './apiClient';
import type {
  ProjectEvermindMode,
  ProjectEvermindHead,
  ProjectEvermindContributions,
} from './projectEvermindTypes';

export type * from './projectEvermindTypes';

/**
 * The web's authenticated call for the shared console adapter: the workspace JWT, a JSON
 * body, and the statuses the console reports itself kept off the global error toast.
 */
export const evermindConsoleRequest: EvermindRequest = <T,>(
  path: string,
  init?: { method?: string; body?: string; expectedErrors?: number[] },
) => apiRequest<T>(path, {
  ...(init?.method ? { method: init.method } : {}),
  ...(init?.body !== undefined ? { body: init.body, headers: { 'Content-Type': 'application/json' } } : {}),
  ...(init?.expectedErrors ? { expectedErrors: init.expectedErrors } : {}),
});

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
