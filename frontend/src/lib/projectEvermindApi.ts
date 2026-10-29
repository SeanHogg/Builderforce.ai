/**
 * Project Evermind API client — the /api/projects/:id/evermind/* reads and writes the
 * web makes OUTSIDE the console: the head (run chip, status badge), the inspection
 * payload (brain map, canvas), teaching from a transcript, and seeding a freshly
 * trained artifact. The console itself runs on the shared brain-ui REST adapter
 * (`createEvermindRestAdapter`), the one implementation every host uses.
 * See [[evermind-learning-architecture]].
 */
import type { EvermindRequest } from '@seanhogg/builderforce-brain-ui';
import { ApiRequestError, apiRequest } from './apiClient';
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
export interface LearningPipelineReport {
  baseline: { headVersion: number; factCount: number; capturedAt: string } | null;
  pending: Array<{
    id: number;
    statement: string;
    factKey: string;
    contradicts: boolean;
    baselineContent: string | null;
    createdAt: string;
  }>;
  metrics: {
    runs: number;
    produced: number;
    candidates: number;
    extractionRate: number;
    contradictionRate: number;
    reviewHours: number | null;
    transferUplift: number | null;
  };
}

/** Manager review surface for the learning pipeline (roadmap 07bc5793). 403 is expected for non-managers. */
export async function getLearningPipeline(projectId: number): Promise<LearningPipelineReport> {
  return apiRequest<LearningPipelineReport>(`/api/projects/${projectId}/evermind/learning`, { expectedErrors: [403, 404] });
}

export async function captureLearningBaseline(projectId: number): Promise<{ factCount: number; headVersion: number; capturedAt: string }> {
  return apiRequest(`/api/projects/${projectId}/evermind/learning/baseline`, {
    method: 'POST',
    expectedErrors: [403],
  });
}

export async function reviewLearningCandidate(
  projectId: number,
  candidateId: number,
  verdict: 'approved' | 'rejected',
): Promise<{ id: number; status: string }> {
  return apiRequest(`/api/projects/${projectId}/evermind/learning/candidates/${candidateId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ verdict }),
  });
}

/** The code the API answers a transfer with (409) when a PERSON authored the fact's key. */
export const FACT_OWNED_BY_PERSON = 'fact_owned_by_person';

/**
 * A transfer the writer refused because a person owns the fact key: not an outage, a
 * conflict a manager resolves (edit or retire that fact, or reject the learning).
 */
export class FactOwnedByPersonError extends Error {
  readonly code = FACT_OWNED_BY_PERSON;
  constructor(message: string) {
    super(message);
    this.name = 'FactOwnedByPersonError';
  }
}

export async function transferLearningCandidate(
  projectId: number,
  candidateId: number,
): Promise<{ ok: boolean; id: number }> {
  try {
    return await apiRequest(`/api/projects/${projectId}/evermind/learning/candidates/${candidateId}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      // The 409s are answers this surface renders itself, not faults to toast.
      expectedErrors: [409],
    });
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 409 && error.code === FACT_OWNED_BY_PERSON) {
      throw new FactOwnedByPersonError(error.message);
    }
    throw error;
  }
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
