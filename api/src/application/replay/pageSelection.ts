/**
 * Which pages a page review captures (PRD 33 §5.2 "Which pages"): the entry pages,
 * the pages a funnel steps through, the pages a live proof measures, then the top
 * routes by page views — at most {@link PAGE_REVIEW_MAX_PAGES} per site, cached under
 * the site's version token.
 *
 * A route TEMPLATE (`/product/:id`) is not a page a browser can open, so it is never
 * selected; neither is a pattern step (`contains`) — only a step that names a path.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import type { ReplayFunnelDto, ReplayRouteStatDto } from '@builderforce/interaction-contract';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { realizations } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { asJsonRecord } from '../../domain/shared/json';
import type { ReplayScope } from '../../domain/replay/replayScope';
import { ReplayFunnelService } from './ReplayFunnelService';
import { ReplayHeatmapService } from './ReplayHeatmapService';
import { replayReadKeys } from './replayCacheKeys';
import { getSiteForTenant, type ReplaySiteRecord } from './replaySites';

export const PAGE_REVIEW_MAX_PAGES = 25;
/** Routes by page views a review always includes. */
export const PAGE_REVIEW_TOP_ROUTES = 20;
/** Entry pages (by sessions that started there) a review always includes. */
export const PAGE_REVIEW_ENTRY_PAGES = 5;
const SELECTION_WINDOW_DAYS = 30;
const PROOFS_READ = 10;
const TTL = { kvTtlSeconds: 3_600, l1TtlMs: 60_000 };
const PATH_FIELDS = new Set(['entryPath', 'visitedPath', 'exitPath']);

/** A concrete path a browser can open (not a template, not a pattern). */
export function isCapturablePath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && path.length <= 400
    && !/(^|\/):[^/]*/.test(path) && !/[*\s]/.test(path);
}

export interface PageSelectionInput {
  routes: readonly ReplayRouteStatDto[];
  funnels: readonly ReplayFunnelDto[];
  proofPaths: readonly string[];
}

/** Pure: entry pages, funnel pages, proof pages, then top routes; deduped, ≤ 25. */
export function selectPages(input: PageSelectionInput, max: number = PAGE_REVIEW_MAX_PAGES): string[] {
  const entries = [...input.routes]
    .filter((r) => r.sessions > 0)
    .sort((a, b) => b.sessions - a.sessions || a.route.localeCompare(b.route))
    .slice(0, PAGE_REVIEW_ENTRY_PAGES)
    .map((r) => r.route);
  const funnelPages = input.funnels.flatMap((f) => f.steps
    .filter((s) => s.stepKind === 'page' && (s.matchMode === 'equals' || s.matchMode === 'prefix'))
    .map((s) => s.match.trim()));
  const top = [...input.routes]
    .sort((a, b) => b.pageviews - a.pageviews || a.route.localeCompare(b.route))
    .slice(0, PAGE_REVIEW_TOP_ROUTES)
    .map((r) => r.route);
  const out: string[] = [];
  for (const path of [...entries, ...funnelPages, ...input.proofPaths, ...top]) {
    if (out.length >= max) break;
    if (isCapturablePath(path) && !out.includes(path)) out.push(path);
  }
  return out;
}

/** The paths a project's measured proofs sample (`realizations.measure.sample.filter`). */
export function proofPathsOf(measures: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const raw of measures) {
    const filter = asJsonRecord(asJsonRecord(asJsonRecord(raw).sample).filter);
    const clauses = Array.isArray(filter.all) ? filter.all : [];
    for (const clause of clauses) {
      const c = asJsonRecord(clause);
      if (!PATH_FIELDS.has(String(c.field)) || (c.op !== 'eq' && c.op !== 'in')) continue;
      const values = Array.isArray(c.value) ? c.value : [c.value];
      for (const v of values) if (typeof v === 'string') out.push(v.trim());
    }
  }
  return out;
}

async function readProofPaths(db: Db, site: ReplaySiteRecord): Promise<string[]> {
  if (site.kind !== 'hosted' || site.projectId === null) return [];
  const rows = await db
    .select({ measure: realizations.measure })
    .from(realizations)
    .where(scopedToTenant(realizations, site.tenantId, and(eq(realizations.projectId, site.projectId), isNotNull(realizations.measure))))
    .limit(PROOFS_READ);
  return proofPathsOf(rows.map((r) => r.measure));
}

/** The key pages of a site, cached under its version token. */
export async function pagesToReview(env: Env, db: Db, scope: ReplayScope, opts: { now?: Date } = {}): Promise<string[]> {
  const keys = await replayReadKeys(env, scope);
  return getOrSetCached(env, keys.pageSelection(), async () => {
    const clock = () => opts.now ?? new Date();
    const site = await getSiteForTenant(env, db, scope.tenantId, scope.siteId);
    const [routes, funnels, proofPaths] = await Promise.all([
      new ReplayHeatmapService(env, db, clock).routes(scope, SELECTION_WINDOW_DAYS),
      new ReplayFunnelService(env, db, clock).list(scope),
      readProofPaths(db, site),
    ]);
    return selectPages({ routes, funnels, proofPaths });
  }, TTL);
}
