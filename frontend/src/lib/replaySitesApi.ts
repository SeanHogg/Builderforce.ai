/**
 * Insights SITES client (PRD 33 §4.2 steps 4–6): the sites a workspace records,
 * their settings, the install check, a project's hosted site and the month's
 * usage.
 *
 * The sibling of `replayApi.ts` (which reads what a site recorded). Paths come
 * from `REPLAY_PATHS` and every shape from `@builderforce/interaction-contract`,
 * so the API and this client cannot drift. Components never build these URLs.
 */

import {
  REPLAY_PATHS,
  type ReplaySiteCreateInput,
  type ReplaySiteDto,
  type ReplaySiteUpdateInput,
  type ReplaySiteVerifyDto,
  type ReplayUsageDto,
} from '@builderforce/interaction-contract';
import { apiRequest, ApiRequestError } from './apiClient';
import { fetchProjects, fetchSite } from './api';
import { fillReplayPath, invalidateCapabilityState, listOf, oneOf } from './capabilityApi';

/** A site write changes what `capabilityState.siteCount` says. */
function afterSiteWrite<T>(value: T): T {
  invalidateCapabilityState();
  return value;
}

/** A tenant project whose site is published — the "use a Builderforce app" choices. */
export interface PublishedProjectChoice {
  projectId: number;
  name: string;
  url: string;
}

/** Projects probed for a published site; the set-up list is a picker, not an index. */
const PUBLISHED_PROBE_LIMIT = 25;

export const replaySitesApi = {
  async list(): Promise<ReplaySiteDto[]> {
    return listOf<ReplaySiteDto>(await apiRequest<unknown>(REPLAY_PATHS.sites), 'sites');
  },

  async get(siteId: string): Promise<ReplaySiteDto | null> {
    return oneOf<ReplaySiteDto>(await apiRequest<unknown>(fillReplayPath(REPLAY_PATHS.site, { siteId })), 'site');
  },

  async createExternal(input: ReplaySiteCreateInput): Promise<ReplaySiteDto> {
    const body = await apiRequest<unknown>(REPLAY_PATHS.sites, {
      method: 'POST',
      body: JSON.stringify(input),
      expectedErrors: [400, 409],
    });
    const site = oneOf<ReplaySiteDto>(body, 'site');
    if (!site) throw new Error('replay site: empty answer');
    return afterSiteWrite(site);
  },

  async update(siteId: string, input: ReplaySiteUpdateInput): Promise<ReplaySiteDto> {
    const body = await apiRequest<unknown>(fillReplayPath(REPLAY_PATHS.site, { siteId }), {
      method: 'PATCH',
      body: JSON.stringify(input),
      expectedErrors: [400],
    });
    const site = oneOf<ReplaySiteDto>(body, 'site');
    if (!site) throw new Error('replay site: empty answer');
    return afterSiteWrite(site);
  },

  /** The live install checks (§4.2 step 6). */
  verify(siteId: string): Promise<ReplaySiteVerifyDto> {
    return apiRequest<ReplaySiteVerifyDto>(fillReplayPath(REPLAY_PATHS.siteVerify, { siteId }));
  },

  /** A project's hosted site, or null when recording is not switched on for it. */
  async projectSite(projectId: number): Promise<ReplaySiteDto | null> {
    try {
      const body = await apiRequest<unknown>(fillReplayPath(REPLAY_PATHS.projectSite, { projectId }), { expectedErrors: [404] });
      return oneOf<ReplaySiteDto>(body, 'site');
    } catch (error) {
      if (error instanceof ApiRequestError && error.status === 404) return null;
      throw error;
    }
  },

  /** Switch recording on for a project's hosted site (idempotent server-side). */
  async enableProjectSite(projectId: number): Promise<ReplaySiteDto> {
    const body = await apiRequest<unknown>(fillReplayPath(REPLAY_PATHS.projectSite, { projectId }), {
      method: 'POST',
      expectedErrors: [400, 409],
    });
    const site = oneOf<ReplaySiteDto>(body, 'site');
    if (!site) throw new Error('replay project site: empty answer');
    return afterSiteWrite(site);
  },

  usage(): Promise<ReplayUsageDto> {
    return apiRequest<ReplayUsageDto>(REPLAY_PATHS.usage);
  },

  /**
   * The workspace's projects that have a published site, for "use a Builderforce
   * app". Reads the existing project list and each project's site record; a
   * project whose site read fails is simply not offered.
   */
  async publishedProjects(): Promise<PublishedProjectChoice[]> {
    const projects = (await fetchProjects()).slice(0, PUBLISHED_PROBE_LIMIT);
    const probed = await Promise.all(projects.map(async (project) => {
      const site = await fetchSite(project.id).catch(() => null);
      return site?.publishedAt ? { projectId: project.id, name: project.name, url: site.url } : null;
    }));
    return probed.filter((choice): choice is PublishedProjectChoice => choice !== null);
  },
};
