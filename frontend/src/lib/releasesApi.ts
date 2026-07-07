import { apiRequest } from './apiClient';

/** Product releases client (EMP-10a). */

export interface Release {
  id: string;
  name: string;
  version: string | null;
  projectId: number | null;
  status: string;
  targetDate: string | null;
  releasedAt: string | null;
  releaseDate: string | null;
  notes: string | null;
}

export interface ReleaseInput {
  name?: string;
  version?: string;
  projectId?: number | null;
  status?: string;
  targetDate?: string | null;
  releasedAt?: string | null;
  notes?: string;
}

export const releasesApi = {
  list: (projectId?: number): Promise<{ releases: Release[] }> =>
    apiRequest<{ releases: Release[] }>(`/api/releases${projectId != null ? `?projectId=${projectId}` : ''}`),

  create: (body: ReleaseInput): Promise<Release> =>
    apiRequest<Release>('/api/releases', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: ReleaseInput): Promise<Release> =>
    apiRequest<Release>(`/api/releases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/api/releases/${id}`, { method: 'DELETE' }),
};
