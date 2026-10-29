/**
 * Site hosting client — publish a built app to <sub>.builderforce.ai, preview it live,
 * and roll a site back to an earlier release. Split out of `api.ts`, which keeps the
 * projects / files / datasets / agents calls; both share the IDE route prefix.
 */

import { apiRequest } from './apiClient';
import { isPlanLimitError } from './planLimitError';
import { IDE } from './api';

// ---------------------------------------------------------------------------
// IDE: Subdomain hosting (publish a Designer build to <sub>.builderforce.ai)
// ---------------------------------------------------------------------------

export interface SiteInfo {
  subdomain: string;
  mode: string;
  status: string;
  versionToken: string;
  assetCount: number;
  /** A real number: the route reads the int8 as text and coerces once, so no
   *  consumer has to know the column is a bigint. */
  totalBytes: number;
  publishedAt: string | null;
  url: string;
  pathUrl: string;
}

export interface SitePublishResult {
  subdomain: string;
  versionToken: string;
  assetCount: number;
  totalBytes: number;
  url: string;
  pathUrl: string;
}

/** Current published-site record for a project (or null if never published). */
export async function fetchSite(projectId: number | string): Promise<SiteInfo | null> {
  const res = await apiRequest<{ site: SiteInfo | null }>(`${IDE}/projects/${projectId}/site`);
  return res?.site ?? null;
}

export interface LivePreviewService {
  id: string;
  label: string;
  url: string;
}

export interface LivePreviewLink {
  url: string;
  expiresInSeconds: number;
  /** `starting` = the dev server is booting; the link works as soon as it answers. */
  status: 'live' | 'starting';
  /** Extra processes (API, Expo) when a run boots more than one service. */
  services?: LivePreviewService[];
}

/**
 * The LIVE preview link for a project, or null when there isn't one.
 *
 * A live preview is a dev server running inside the project's cloud-run container,
 * exposed through the signed preview ingress — it reflects the work in progress, where a
 * published build reflects the last publish. Null covers every "not right now" (the
 * feature is off for this deployment, the plan doesn't include it, no run is holding a
 * preview, the container died), because the caller's fallback is the same in all of
 * them: show the published build instead.
 *
 * Rethrows {@link PlanLimitError} so a panel can render an upgrade gate; every other
 * miss (no run, 404, 429) is `null`.
 */
export async function loadLivePreview(opts: {
  projectId?: number | string;
  executionId?: number | null;
}): Promise<LivePreviewLink | null> {
  const path = opts.executionId != null
    ? `/api/runtime/executions/${opts.executionId}/preview-url`
    : `/api/runtime/projects/${opts.projectId}/preview-url`;
  if (opts.executionId == null && (opts.projectId == null || opts.projectId === '')) return null;
  try {
    const res = await apiRequest<{
      available?: boolean;
      url?: string;
      expiresInSeconds?: number;
      status?: 'live' | 'starting';
      services?: LivePreviewService[];
    }>(path, { expectedErrors: [404, 429] });
    if (!res?.available || !res.url) return null;
    return {
      url: res.url,
      expiresInSeconds: res.expiresInSeconds ?? 0,
      status: res.status ?? 'live',
      services: res.services,
    };
  } catch (e) {
    if (isPlanLimitError(e)) throw e;
    return null;
  }
}

/** Same as {@link loadLivePreview} but swallows a 402 — the published-build fallback. */
export async function fetchLivePreviewUrl(projectId: number | string): Promise<LivePreviewLink | null> {
  try {
    return await loadLivePreview({ projectId });
  } catch {
    return null;
  }
}

type SiteAssets = Array<{ path: string; data: Uint8Array }>;

/**
 * POST a built site to the publish endpoint — the ONE multipart builder behind
 * {@link publishSite} and {@link publishSitePreview}. One part per file, the part
 * name being the dist-relative path, plus the endpoint's own `fields`.
 * apiRequest leaves Content-Type unset for FormData so the multipart boundary
 * survives — no header surgery needed.
 */
function postSiteAssets<T>(projectId: number | string, assets: SiteAssets, fields: Record<string, string>): Promise<T> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.append(name, value);
  for (const { path, data } of assets) {
    form.append(path, new Blob([data as BlobPart]), path);
  }
  return apiRequest<T>(`${IDE}/projects/${projectId}/publish`, { method: 'POST', body: form });
}

/**
 * Publish a built static site. `assets` are the files under the build's `dist/`
 * root (path is dist-relative). Sent as multipart/form-data — one part per file,
 * the part name being the relative path — plus an optional `subdomain` field.
 * Always targets the auth API (the publish endpoint lives in ideRoutes).
 */
export async function publishSite(
  projectId: number | string,
  assets: SiteAssets,
  subdomain?: string,
): Promise<SitePublishResult> {
  const result = await postSiteAssets<SitePublishResult>(projectId, assets, subdomain ? { subdomain } : {});
  // Loaded on demand: `api.ts` sits in the root layout's static closure, and the
  // publish signal is only needed by the few surfaces that publish. The listeners
  // import the same module, so the import resolves to the instance they subscribed on.
  void import('./sitePublishEvents').then(({ notifySitePublished }) => notifySitePublished(Number(projectId), result));
  return result;
}

/** What a preview publish answers (`publishPreviewRelease`): a release beside the live one. */
export interface SitePreviewResult {
  /** The preview release's key — what `replayApi.previewUrl` turns into a short-lived link. */
  versionToken: string;
  /** The release still serving live. */
  liveVersionToken: string;
  assetCount: number;
  totalBytes: number;
  /** The site's LIVE address — the preview itself is only reachable through its signed link. */
  url: string;
  preview: true;
  /** Whether the preview was recorded on the fix; false when the fix is no longer open for one. */
  recorded: boolean;
}

/**
 * Publish a built site as a PREVIEW release for an Insights fix (PRD 33 §5.1.4): the
 * release lands beside the live one and is recorded on the prescription; the live
 * pointer does not move. It is not live, so — unlike {@link publishSite} — it does
 * not announce a published site.
 */
export function publishSitePreview(
  projectId: number | string,
  assets: SiteAssets,
  prescriptionId: string,
): Promise<SitePreviewResult> {
  return postSiteAssets<SitePreviewResult>(projectId, assets, { preview: '1', prescription: prescriptionId });
}

// ---------------------------------------------------------------------------
// Rollback — published releases
// ---------------------------------------------------------------------------

/** One published release of a project's site. */
export interface SiteRelease {
  versionToken: string;
  source: string;
  assetCount: number;
  totalBytes: number;
  publishedAt: string | null;
  /** True for the release the site is serving right now. */
  current: boolean;
}

export async function fetchSiteReleases(projectId: number | string): Promise<SiteRelease[]> {
  return apiRequest<SiteRelease[]>(`${IDE}/projects/${projectId}/site/releases`);
}

/** Point the site back at an earlier build. A pointer move, not a rebuild. */
export async function restoreSiteRelease(
  projectId: number | string,
  versionToken: string,
): Promise<{ success: boolean; url: string }> {
  return apiRequest(`${IDE}/projects/${projectId}/site/releases/${versionToken}/restore`, { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Packaging — turn a built app into something installable
// ---------------------------------------------------------------------------

/** Targets a BUILT app can be packaged for. `web`/`roblox` are game-only. */
export const APP_PACKAGE_TARGETS = ['pwa', 'android', 'ios'] as const;
export type AppPackageTarget = (typeof APP_PACKAGE_TARGETS)[number];

export interface PackageAppResult {
  success: boolean;
  target: AppPackageTarget;
  state: { directory: string; detail: string; setupSteps: Array<{ key: string; label: string; detail: string; blocking: boolean; url?: string }> };
  writtenPaths: string[];
}

/**
 * Package the built `dist/` as a PWA, an Android project, or an iOS project.
 *
 * Takes the same asset shape as {@link publishSite} — the build happens in the
 * in-browser runtime, so what is packaged is byte-for-byte what was previewed.
 */
export async function packageApp(
  projectId: number | string,
  target: AppPackageTarget,
  assets: Array<{ path: string; data: Uint8Array }>,
): Promise<PackageAppResult> {
  const form = new FormData();
  form.append('target', target);
  for (const { path, data } of assets) {
    // The content type decides which half of the bundle a part lands in on the
    // server, so a real one matters: a PNG read as text is a corrupted PNG.
    form.append(path, new Blob([data as BlobPart], { type: guessAssetType(path) }), path);
  }
  return apiRequest<PackageAppResult>(`${IDE}/projects/${projectId}/package`, { method: 'POST', body: form });
}

/** Minimal extension→type map, only precise enough to split text from binary. */
function guessAssetType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (['woff', 'woff2', 'ttf', 'otf'].includes(ext)) return `font/${ext}`;
  if (ext === 'mp3' || ext === 'wav' || ext === 'ogg') return `audio/${ext}`;
  if (ext === 'mp4' || ext === 'webm') return `video/${ext}`;
  if (ext === 'wasm') return 'application/wasm';
  return 'text/plain';
}
