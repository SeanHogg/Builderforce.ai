import { apiRequest } from './apiClient';

/** Product releases client (EMP-10a). Dates are plan vs actual (migration 1266). */

export interface Release {
  id: string;
  name: string;
  version: string | null;
  projectId: number | null;
  status: string;
  /** The planned ship date. */
  targetDate: string | null;
  /** When it actually shipped — set by the server on the move to `released`,
   *  cleared on a move back to planned / in_progress, kept on cancel. */
  releasedAt: string | null;
  notes: string | null;
}

export interface ReleaseInput {
  name?: string;
  version?: string;
  projectId?: number | null;
  status?: string;
  targetDate?: string | null;
  /** Optional back-dated ship date on a write that marks the release released. */
  releasedAt?: string | null;
  notes?: string;
}

/** The plan-vs-actual grade of the listed releases (server-computed). */
export interface ReleaseSchedule {
  released: number;
  /** Released with a target to grade against — the on-time rate's denominator. */
  measured: number;
  onTime: number;
  late: number;
  onTimeRatePct: number | null;
  avgDaysLate: number | null;
  overdue: number;
  upcoming: number;
}

export interface ReleaseList {
  releases: Release[];
  schedule: ReleaseSchedule;
}

export const releasesApi = {
  list: (projectId?: number): Promise<ReleaseList> =>
    apiRequest<ReleaseList>(`/api/releases${projectId != null ? `?projectId=${projectId}` : ''}`),

  create: (body: ReleaseInput): Promise<Release> =>
    apiRequest<Release>('/api/releases', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: ReleaseInput): Promise<Release> =>
    apiRequest<Release>(`/api/releases/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string): Promise<void> =>
    apiRequest<void>(`/api/releases/${id}`, { method: 'DELETE' }),
};
