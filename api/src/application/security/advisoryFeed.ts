/**
 * advisoryFeed — the CVE advisory-feed PORT behind the web scan's CVE stage.
 *
 * WHY A PORT AND NOT A CLIENT
 * "Which CVEs affect nginx 1.18.0" is answerable only by a subscription this
 * deployment may or may not hold. That is a capability of the ENVIRONMENT, not a
 * property of the scanner, and the scanner must behave correctly under both. So the
 * lookup sits behind an interface with two adapters, chosen by configuration exactly
 * as `driveProviders` / `mailboxProviders` choose theirs:
 *
 *   • {@link httpAdvisoryFeed} — a real feed reached with a URL + an API key read
 *     from configuration. No vendor key is hardcoded anywhere; an unconfigured
 *     deployment simply reports the adapter as not configured, the same honesty
 *     `availableDriveProviders` applies to an OAuth client that was never set up.
 *   • {@link nullAdvisoryFeed} — THE DEFAULT. It performs no lookup and returns
 *     `performed: false` with a reason. This is the whole reason the port exists: the
 *     alternative — an adapter that returns an empty advisory list when it cannot ask
 *     anyone — makes an unconfigured deployment report "no known vulnerabilities",
 *     which is a false all-clear and strictly worse than saying nothing.
 *
 * CACHING. An advisory answer for a given product+version is stable for hours and
 * costs an external round trip (and, on a metered feed, money). Lookups therefore go
 * through the canonical read-through cache, never an inline Map+TTL.
 */
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { Advisory, AdvisoryLookupOutcome, SoftwareFingerprint } from './softwareFingerprint';
import type { FindingSeverity } from './SecurityAuditService';
import type { Env } from '../../env';

/**
 * A source of published vulnerability advisories for `{product, version}` pairs.
 * `lookup` NEVER throws: a feed that is down must degrade to `performed: false` with
 * a reason, because a thrown error in the middle of a scan would either lose the
 * other stages' findings or — worse — be caught somewhere generic and turn into the
 * same false all-clear the null adapter exists to prevent.
 */
export interface AdvisoryFeedPort {
  /** Stable adapter id, recorded on the finding + the stage report. */
  readonly id: string;
  readonly label: string;
  /** True when this deployment holds the configuration this adapter needs. */
  configured(env: Env): boolean;
  lookup(env: Env, fingerprints: SoftwareFingerprint[]): Promise<AdvisoryLookupOutcome>;
}

/** How long an advisory answer is reused. Advisory data moves on the scale of hours;
 *  an unpatched CVE does not become safe within one. */
const ADVISORY_CACHE_TTL_SECONDS = 6 * 60 * 60;

/** Bound on one lookup so a slow feed cannot hold a scan open indefinitely. */
const ADVISORY_TIMEOUT_MS = 10_000;

/**
 * The default adapter: no feed, no lookup, and it says so. Deliberately not a
 * "return nothing" stub — `performed: false` is a different claim from "found
 * nothing", and every consumer downstream branches on exactly that difference.
 */
export const nullAdvisoryFeed: AdvisoryFeedPort = {
  id: 'none',
  label: 'No advisory feed',
  configured: () => true, // always available; it is the fallback
  lookup: async () => ({
    performed: false,
    feedId: 'none',
    reason: 'no CVE advisory feed is configured for this deployment',
    advisories: [],
  }),
};

/** Feed severity strings folded onto the platform's five-value scale. */
function mapSeverity(raw: unknown): FindingSeverity {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'critical') return 'critical';
  if (s === 'high' || s === 'important') return 'high';
  if (s === 'moderate' || s === 'medium') return 'medium';
  if (s === 'low' || s === 'minor') return 'low';
  // Unrated ⇒ `medium`, never `info`: an advisory the feed did not grade is still a
  // published vulnerability, and `info` would drop it below the score's noticing.
  return 'medium';
}

/** The advisory shape an OSV-compatible feed returns (the de-facto interchange
 *  format; GitHub Advisories, OSV.dev and most commercial feeds all speak it). */
interface OsvVulnerability {
  id?: unknown;
  summary?: unknown;
  details?: unknown;
  references?: Array<{ url?: unknown }>;
  database_specific?: { severity?: unknown };
  severity?: unknown;
  affected?: Array<{
    package?: { name?: unknown };
    ranges?: Array<{ events?: Array<{ introduced?: unknown; fixed?: unknown; last_affected?: unknown }> }>;
  }>;
}

/**
 * Parse one OSV-shaped vulnerability into the platform's {@link Advisory}. PURE and
 * exported so the mapping is tested against real feed payloads without a network —
 * a feed that renames a field would otherwise degrade silently into "no ranges",
 * which reads downstream as "not affected".
 */
export function parseOsvAdvisory(raw: unknown, product: string): Advisory | null {
  const v = raw as OsvVulnerability;
  const id = typeof v?.id === 'string' ? v.id : null;
  if (!id) return null;
  const ranges: Advisory['ranges'] = [];
  for (const affected of v.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      let introduced: string | undefined;
      for (const ev of range.events ?? []) {
        if (typeof ev.introduced === 'string') {
          // OSV spells "from the beginning" as the literal `0`, which is not a
          // version — carrying it through would compare as 0.0.0 and be harmless,
          // but dropping it is what actually means "unbounded below".
          introduced = ev.introduced === '0' ? undefined : ev.introduced;
        }
        if (typeof ev.fixed === 'string') { ranges.push({ introduced, fixed: ev.fixed }); introduced = undefined; }
        else if (typeof ev.last_affected === 'string') { ranges.push({ introduced, lastAffected: ev.last_affected }); introduced = undefined; }
      }
      // An `introduced` with no terminator: affected from there onwards, still
      // published. Recorded with `lastAffected` unset would match nothing, so it is
      // expressed as "introduced .. no fix" via a very high lastAffected sentinel.
      if (introduced) ranges.push({ introduced, lastAffected: '999999.0.0' });
    }
  }
  if (ranges.length === 0) return null; // no expressible range ⇒ no defensible match
  return {
    id,
    product,
    summary: (typeof v.summary === 'string' && v.summary) || (typeof v.details === 'string' ? v.details.slice(0, 300) : id),
    severity: mapSeverity(v.database_specific?.severity ?? v.severity),
    ranges,
    references: (v.references ?? []).map((r) => (typeof r?.url === 'string' ? r.url : '')).filter(Boolean),
  };
}

/**
 * A real advisory feed reached over HTTPS with a bearer key, both read from
 * configuration (`CVE_ADVISORY_FEED_URL`, `CVE_ADVISORY_FEED_API_KEY`). Speaks the
 * OSV query shape, which is what OSV.dev, GitHub Advisories and the commercial feeds
 * that proxy them all accept — so pointing the URL at a different vendor is a config
 * change rather than a code change, which is the point of the port.
 */
export const httpAdvisoryFeed: AdvisoryFeedPort = {
  id: 'http',
  label: 'Configured advisory feed',
  configured: (env) => Boolean(env?.CVE_ADVISORY_FEED_URL?.trim() && env?.CVE_ADVISORY_FEED_API_KEY?.trim()),

  async lookup(env, fingerprints) {
    const url = env.CVE_ADVISORY_FEED_URL?.trim();
    const apiKey = env.CVE_ADVISORY_FEED_API_KEY?.trim();
    if (!url || !apiKey) {
      return { performed: false, feedId: this.id, reason: 'the advisory feed URL or API key is not configured', advisories: [] };
    }
    if (fingerprints.length === 0) {
      return { performed: true, feedId: this.id, advisories: [] };
    }

    // Cached per exact product+version set: the same site re-scanned weekly asks the
    // identical question, and the answer is stable for hours.
    const cacheKey = `websec:adv:${[...fingerprints].map((f) => `${f.product}@${f.version}`).sort().join(',')}`;
    try {
      return await getOrSetCached<AdvisoryLookupOutcome>(env, cacheKey, async () => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            queries: fingerprints.map((f) => ({ package: { name: f.product }, version: f.version })),
          }),
          signal: AbortSignal.timeout(ADVISORY_TIMEOUT_MS),
        });
        if (!res.ok) {
          return { performed: false, feedId: this.id, reason: `the advisory feed returned HTTP ${res.status}`, advisories: [] };
        }
        const body = await res.json() as { results?: Array<{ vulns?: unknown[] }> };
        const advisories: Advisory[] = [];
        (body.results ?? []).forEach((result, i) => {
          // Results are positional against the queries we sent — that is the OSV
          // contract, and it is what carries the product name onto each advisory.
          const product = fingerprints[i]?.product;
          if (!product) return;
          for (const vuln of result?.vulns ?? []) {
            const parsed = parseOsvAdvisory(vuln, product);
            if (parsed) advisories.push(parsed);
          }
        });
        return { performed: true, feedId: this.id, advisories };
      }, { kvTtlSeconds: ADVISORY_CACHE_TTL_SECONDS });
    } catch (e) {
      reportCaughtError(e, {
        source: 'application/security/advisoryFeed.ts', operation: 'httpAdvisoryFeed.lookup', level: 'warning',
        context: { logMessage: `[advisoryFeed] lookup failed: ${(e as Error).message}` },
      });
      // Degrade to "not performed" — never to an empty advisory list, which the
      // renderer would present as an all-clear the feed never gave us.
      return { performed: false, feedId: this.id, reason: `the advisory feed could not be reached (${(e as Error).message})`, advisories: [] };
    }
  },
};

/** Every adapter, most-specific first — the null feed is last because it always applies. */
const FEEDS: readonly AdvisoryFeedPort[] = [httpAdvisoryFeed, nullAdvisoryFeed];

/** The feed this deployment will actually use: the first configured adapter. */
export function resolveAdvisoryFeed(env: Env): AdvisoryFeedPort {
  return FEEDS.find((f) => f.id !== nullAdvisoryFeed.id && f.configured(env)) ?? nullAdvisoryFeed;
}

/**
 * What this deployment can offer, and honestly whether it is usable — the same
 * `configured` honesty `availableDriveProviders` applies, so an operator can see
 * "the feed adapter exists but this environment holds no key" instead of wondering
 * why every scan says the lookup did not run.
 */
export function availableAdvisoryFeeds(env: Env): Array<{ id: string; label: string; configured: boolean }> {
  return FEEDS.map((f) => ({ id: f.id, label: f.label, configured: f.id === nullAdvisoryFeed.id ? true : f.configured(env) }));
}
