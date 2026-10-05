import { apiRequest } from './apiClient';

/**
 * Client mirror of the People read model — who signed up for, visited and left
 * a lead on a project's published app.
 *
 * A sibling of `growthApi.ts` (same `/api/projects/:id/site/*` family) rather
 * than another section of it, so that catch-all does not keep growing.
 *
 * Server counterpart:
 *   api/src/application/ide/siteAudienceSummary.ts
 *   GET /api/projects/:projectId/site/audience-summary?days=
 */

/** The windows the server accepts; anything else is clamped to 30. */
export type SiteAudienceWindow = 7 | 30 | 90;

export interface SiteAudienceSummary {
  /** False when the project has no published site — every count is then zero. */
  published: boolean;
  users: number;
  /** End users who signed up inside the window. */
  newUsers: number;
  /** Approximate — buffered per isolate server-side. The UI must say so. */
  visitors: number;
  pageViews: number;
  /** Form / waitlist submissions across every collection. */
  leads: number;
  days: number;
  approximateTraffic: true;
}

export const siteAudienceApi = {
  summary: (projectId: number | string, days: SiteAudienceWindow = 30): Promise<SiteAudienceSummary> =>
    apiRequest(`/api/projects/${projectId}/site/audience-summary?days=${days}`),
};
