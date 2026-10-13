/**
 * THE HOSTED-SITE A/B SPLIT (PRD 33 §5.1.4 "Test it", S4e).
 *
 * When an `ab_tests` row whose arms name an Insights site (variant payload
 * `{ siteId, versionToken?, r2Prefix? }` — a prescription's `rx-<id>` test) is
 * RUNNING, a hosted app's visitors are split between the live release and the
 * preview release: the first page view assigns a sticky `bf_ab_<testId>` cookie by the
 * variants' allocation and counts ONE exposure through THE A/B engine
 * (`marketing/experimentation.recordExposure`); every later request (the page's
 * own assets included) is served from the same arm. The injected Insights loader
 * carries `data-variant`, so the recording — and the conversion ingest records —
 * name the arm the visitor saw.
 *
 * Runs in the SITES Worker (`siteStaticServe.serveCountedAsset`), so it is
 * dependency-light like `siteReplayInjection`: one cached query through the core
 * handle, keyed under the tenant's sites version — starting or stopping a test
 * calls `bumpReplaySitesVersion`, which switches the split on or off on the next
 * request. Every failure falls back to the live release: a split is never worth
 * breaking a page for.
 */
import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { abTests, abTestVariants } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import {
  abCookieName,
  abSetCookie,
  assignVariant,
  readCookie,
  variantLabel,
  type SplitVariant,
} from '../../domain/replay/abSplit';
import { tenantSitesKey } from '../replay/replayCacheKeys';
import { recordExposure } from '../marketing/experimentation';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { enabledHostedReplaySiteId } from './siteReplayInjection';
import type { SiteRecord } from './siteHosting';

const SOURCE = 'application/ide/siteAbSplit.ts';
const SPLIT_TTL_SECONDS = 5 * 60;

/** One arm: the live release (`r2Prefix` null) or a preview release. */
export interface RunningSplitVariant extends SplitVariant {
  r2Prefix: string | null;
  versionToken: string | null;
}

export interface RunningSplit {
  testId: number;
  variants: RunningSplitVariant[];
  /** What converts: a named smart event, or null for the site's goal events. */
  success: { smartEvent: string | null };
}

/** The `ab_test_variants.payload` a prescription test writes (`prescriptionActions.ts`). */
export interface SplitVariantPayload {
  siteId: string;
  prescriptionId: string;
  versionToken?: string | null;
  r2Prefix?: string | null;
  success?: { smartEvent?: string | null } | null;
}

const asPayload = (raw: unknown): Partial<SplitVariantPayload> =>
  (raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Partial<SplitVariantPayload>) : {});

/**
 * The running prescription test of this Insights site, or null. Cached under the
 * tenant's sites version; one indexed read on a miss.
 */
export async function runningSplitForSite(env: Env, tenantId: number, replaySiteId: string): Promise<RunningSplit | null> {
  const key = `${await tenantSitesKey(env, tenantId)}:ab:${replaySiteId}`;
  const found = await getOrSetCached(env, key, async (): Promise<{ split: RunningSplit | null }> => {
    const rows = await buildDatabase(env)
      .select({
        testId: abTests.id,
        variantId: abTestVariants.id,
        key: abTestVariants.key,
        trafficPercent: abTestVariants.trafficPercent,
        payload: abTestVariants.payload,
      })
      .from(abTestVariants)
      .innerJoin(abTests, eq(abTests.id, abTestVariants.testId))
      .where(scopedToTenant(abTests, tenantId, and(
        eq(abTests.status, 'running'),
        // ANY running test whose arms name this site — a prescription's (`rx-…`) today,
        // the canvas `experiment` object's once it binds here (ROADMAP).
        sql`${abTestVariants.payload}->>'siteId' = ${replaySiteId}`,
      )));
    if (rows.length < 2) return { split: null };
    // One running test per site is the action's rule; should two ever overlap, the newest wins.
    const testId = Math.max(...rows.map((r) => r.testId));
    const mine = rows.filter((r) => r.testId === testId);
    if (mine.length < 2) return { split: null };
    const success = mine.map((r) => asPayload(r.payload).success).find((s) => s && typeof s === 'object') ?? null;
    return {
      split: {
        testId,
        variants: mine.map((r) => {
          const payload = asPayload(r.payload);
          return {
            id: r.variantId,
            key: r.key,
            trafficPercent: Number(r.trafficPercent) || 0,
            r2Prefix: typeof payload.r2Prefix === 'string' && payload.r2Prefix ? payload.r2Prefix : null,
            versionToken: typeof payload.versionToken === 'string' && payload.versionToken ? payload.versionToken : null,
          };
        }),
        success: { smartEvent: typeof success?.smartEvent === 'string' && success.smartEvent ? success.smartEvent : null },
      },
    };
  }, { kvTtlSeconds: SPLIT_TTL_SECONDS, l1TtlMs: 30_000 });
  return found.split;
}

/** Which arm this request is served from, and the site record to serve it with. */
export interface SiteSplitDecision {
  testId: number;
  variant: RunningSplitVariant;
  /** A fresh assignment: set the cookie and count the exposure. */
  assigned: boolean;
  /** `data-variant` for the loader tag. */
  label: string;
  /** The site with the arm's release in place of the live pointer. */
  served: SiteRecord;
}

/** Uniform in [0, 100). */
function roll(): number {
  return (crypto.getRandomValues(new Uint32Array(1))[0]! / 4_294_967_296) * 100;
}

/**
 * The split decision for one request, or null (no running test, recording off, or
 * any failure → the live release). Only a PAGE VIEW assigns an arm: an asset fetched
 * without the cookie is served live rather than minting a cookie a bot never returns.
 */
export async function resolveSiteSplit(
  env: Env,
  site: SiteRecord,
  request: Request,
  opts: { mayAssign: boolean; roll?: () => number },
): Promise<SiteSplitDecision | null> {
  // The hot path: an asset request from a visitor in no test costs no lookup at all.
  if (!opts.mayAssign && !(request.headers.get('cookie') ?? '').includes('bf_ab_')) return null;
  try {
    const replaySiteId = await enabledHostedReplaySiteId(env, site.tenantId, site.projectId);
    if (!replaySiteId) return null;
    const split = await runningSplitForSite(env, site.tenantId, replaySiteId);
    if (!split) return null;
    const cookie = readCookie(request.headers.get('cookie'), abCookieName(split.testId));
    if (!cookie && !opts.mayAssign) return null;
    const pick = assignVariant(split.variants, cookie, (opts.roll ?? roll)());
    if (!pick) return null;
    const { variant } = pick;
    const served = variant.r2Prefix && variant.versionToken
      ? { ...site, r2Prefix: variant.r2Prefix, versionToken: variant.versionToken }
      : site;
    return { testId: split.testId, variant, assigned: pick.assigned, label: variantLabel(split.testId, variant.key), served };
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'resolveSiteSplit' });
    return null;
  }
}

/**
 * The response for a split request: the sticky cookie on an assignment, and never
 * a shared cache entry (two arms share one URL).
 */
export function withSplitCookie(response: Response, decision: SiteSplitDecision): Response {
  const headers = new Headers(response.headers);
  if (decision.assigned) headers.append('Set-Cookie', abSetCookie(decision.testId, decision.variant.key));
  headers.set('Cache-Control', 'private, max-age=0, must-revalidate');
  headers.append('Vary', 'Cookie');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Count the assignment as one exposure. Never throws. */
export async function recordSplitExposure(env: Env, tenantId: number, decision: SiteSplitDecision): Promise<void> {
  if (!decision.assigned) return;
  try {
    await recordExposure(buildDatabase(env), tenantId, decision.variant.id);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'recordSplitExposure' });
  }
}
