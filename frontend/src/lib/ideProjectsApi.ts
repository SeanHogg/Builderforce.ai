import { apiRequest, ApiRequestError } from './apiClient';
import type { IdeContainerOption, IdeProject } from './types';

// ---------------------------------------------------------------------------
// IDE projects (0224) — the first-class child entity of a Project. Always the
// auth API (/api/ide-projects); the worker has no ide_projects routes.
// ---------------------------------------------------------------------------

export async function listIdeProjects(): Promise<IdeProject[]> {
  return apiRequest<IdeProject[]>('/api/ide-projects');
}

/** Resolve the IDE project backing a given storage project (e.g. to scope the
 *  Voice studio when the IDE is opened by storage project id).  `null` when it has
 *  none: a project started in Studio never had a build record, and that absence is
 *  an answer, not a failure — the 404 used to file a support ticket on every visit
 *  to such a project's Studio page. */
export async function fetchIdeProjectByStorage(storageProjectId: number): Promise<IdeProject | null> {
  try {
    return await apiRequest<IdeProject>(`/api/ide-projects/by-storage/${storageProjectId}`, { expectedErrors: [404] });
  } catch (e) {
    if (e instanceof ApiRequestError && e.status === 404) return null;
    throw e;
  }
}

/** The build record for an existing project, bound in place when it has none, so
 *  a project started in Studio can be placed on the canvas like any other build.
 *  Idempotent: calling it for a project that already has one returns that record. */
export async function ensureIdeProjectForStorage(storageProjectId: number): Promise<IdeProject> {
  return apiRequest<IdeProject>(`/api/ide-projects/by-storage/${storageProjectId}`, { method: 'PUT' });
}

export async function listIdeContainers(): Promise<IdeContainerOption[]> {
  return apiRequest<IdeContainerOption[]>('/api/ide-projects/containers');
}

export async function createIdeProject(data: {
  name: string;
  /** 'designer' | 'mobile' | 'evermind' | 'finetune' | 'voice'. Defaults server-side to 'designer'. */
  modality?: string;
  /** Optional parent Project to group this build under. */
  containerProjectId?: number | null;
  template?: string | null;
  /** Optional automation workflow to attach (any modality). Not required for evermind. */
  workflowDefinitionId?: string | null;
  /** Evermind modality: the one-click Evermind recipe that provisions the project's model. */
  evermindRecipe?: string | null;
  /** Evermind modality: frontier teacher model to distil through (recipe-dependent). */
  evermindTeacherModel?: string | null;
  /** Evermind modality: for the 'seed-published' recipe, the published model slug to clone. */
  evermindSeedModelSlug?: string | null;
}): Promise<IdeProject> {
  return apiRequest<IdeProject>('/api/ide-projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateIdeProject(
  id: number | string,
  data: {
    name?: string;
    /** Reassign the parent Project; null to ungroup. */
    containerProjectId?: number | null;
    workflowDefinitionId?: string | null;
    status?: string;
  },
): Promise<IdeProject> {
  return apiRequest<IdeProject>(`/api/ide-projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteIdeProject(id: number | string): Promise<void> {
  await apiRequest<void>(`/api/ide-projects/${id}`, { method: 'DELETE' });
}
