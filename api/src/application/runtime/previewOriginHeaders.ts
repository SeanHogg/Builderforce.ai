/**
 * The response headers of the in-browser preview origins (make.md › PRD 31 §4 W10,
 * controls 1 and 6). Every header set and CSP string has ONE owner,
 * `@seanhogg/builderforce-webcontainers/preview-headers`; this module is the API's
 * {@link PREVIEW_HEADERS} profile of it (embeddable, reporting to the API, `text/javascript`,
 * Worker scripts cached five minutes), plus what only the API decides: who may frame a
 * preview origin, what the container ingress gets, and whether a service worker script may
 * be served at all.
 *
 * Pure: strings in, header records out. The middleware
 * (`presentation/middleware/browserPreviewOrigin`) only routes.
 *
 * Every set the runtime's own files get also carries `Cross-Origin-Embedder-Policy:
 * credentialless` and `Cross-Origin-Resource-Policy: cross-origin` ({@link EMBEDDABLE}): the
 * app frames the relay from a cross-origin-isolated page (COEP), which refuses a nested
 * document or script that does not opt in itself. They add to the contract's headers, never
 * replace one.
 */
import { PREVIEW_DEFAULT_EGRESS, previewHeaders, type HeaderSet } from '@seanhogg/builderforce-webcontainers/preview-headers';
import { appOrigins, isDevEnvironment } from '../shared/appOrigins';
import { CSP_REPORT_PATH, CSP_REPORT_URL, PREVIEW_CSP_REPORTING } from './workerCsp';
import type { WorkerEgressPolicy } from './workerEgressPolicy';

export type { HeaderSet };

/** What lets the cross-origin-isolated app frame and load the preview origin's files. */
export const EMBEDDABLE: Readonly<HeaderSet> = Object.freeze({
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
});

/**
 * The header sets the API serves on its preview origins: `relay(frameAncestors)`,
 * `serviceWorker()`, `workerScript([...policy.connectSources, ...ownPaths])` and
 * `document(host, frameAncestors)`. A process Worker script is cached per URL, and the URL
 * carries `?policy=`, so two policies never share a cache entry (versioned by the package,
 * so a short cache is enough); its `ownPaths` are path-scoped sources on the platform's
 * preview hosts (the .NET bundle's `https://<host>/dotnet/`) — never a bare origin.
 */
export const PREVIEW_HEADERS = previewHeaders({
  embed: EMBEDDABLE,
  reporting: PREVIEW_CSP_REPORTING,
  scriptType: 'text/javascript',
  workerScriptCache: 'public, max-age=300',
});

/**
 * The pages allowed to frame a preview origin: the app's own origins, and local dev ones only
 * in a development environment — in production a page on `localhost:3000` must never drive a relay.
 */
export function previewFrameAncestors(corsOrigins: string | undefined, environment: string | undefined): string[] {
  return appOrigins(corsOrigins, isDevEnvironment(environment));
}

/**
 * What the container-preview ingress's answers on the shared host get (a different product
 * that shares the host: its dev servers load what they like, so no document CSP and no CORP
 * override) — only what keeps it from being sniffed or joined to a sibling's agent cluster.
 */
export const INGRESS_HEADERS: Readonly<HeaderSet> = Object.freeze({ 'X-Content-Type-Options': 'nosniff', 'Origin-Agent-Cluster': '?1' });

/** The configuration a `sw.js` URL carries (`?mode=relay&policy=<id>&egress=<sources>&report=<url>`). */
export interface ServiceWorkerQuery {
  mode: string | null;
  policy: string | null;
  egress: string[];
  report: string | null;
  /** Query keys outside {@link SERVICE_WORKER_KEYS} (`csp`, anything newer): any one refuses the script. */
  unknownKeys: string[];
  /**
   * Query keys named more than once (`?egress=a&egress=b`): any one refuses the script. The
   * runtime writes each key once; with a repeat, this gate (reading the first value) and the
   * worker could check different values.
   */
  repeatedKeys: string[];
}

/**
 * The only query keys a `sw.js` URL may carry here. An allowlist, not a denylist: preview code
 * is same-origin with `sw.js` and can re-register it with any query, so a key the runtime reads
 * that is not checked here (`csp=report-only` turns the whole preview CSP report-only) would be
 * the preview's to set. Builderforce never runs report-only, so `csp` is always refused.
 */
const SERVICE_WORKER_KEYS: ReadonlySet<string> = new Set(['mode', 'policy', 'egress', 'report']);

/** An egress source as the runtime writes one: an https/wss origin, optionally `*.`-wildcarded, no path. */
const EGRESS_SOURCE = /^(?:https|wss):\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i;

/** Read a `sw.js` URL's configuration. Egress entries are lowercased, as the runtime writes them. */
export function serviceWorkerQueryOf(url: URL): ServiceWorkerQuery {
  const egress = (url.searchParams.get('egress') ?? '').split(' ').filter(Boolean).map((s) => s.toLowerCase());
  const keys = [...url.searchParams.keys()];
  const unknownKeys = [...new Set(keys)].filter((key) => !SERVICE_WORKER_KEYS.has(key));
  const repeatedKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index))];
  return { mode: url.searchParams.get('mode'), policy: url.searchParams.get('policy'), egress, report: url.searchParams.get('report'), unknownKeys, repeatedKeys };
}

/**
 * The CSP report endpoints a preview origin may be configured with: the production API's
 * ({@link CSP_REPORT_URL}), plus the same path on each host in `extraHosts` (`CSP_REPORT_HOSTS`,
 * comma-separated: a staging API). Exact URLs, never a domain match — `*.builderforce.ai`
 * includes users' published sites, which must never receive a preview's reports.
 */
export function cspReportUrls(extraHosts: string | undefined): string[] {
  const hosts = (extraHosts ?? '').split(',').map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h));
  return [...new Set([CSP_REPORT_URL, ...hosts.map((host) => `https://${host}${CSP_REPORT_PATH}`)])];
}

/**
 * Whether `sw.js` may be served for `query`, given what its `policy` resolved to on this
 * host (`resolved`: the default when the id was absent or did not verify for this host).
 *
 * The worker stamps its egress and report endpoint into every response it serves, and takes
 * both from its own URL — so this is the only place they are checked:
 * - no key outside {@link SERVICE_WORKER_KEYS} (so never `csp=report-only`), and no key twice;
 * - `mode` must be `relay`: any other mode takes attaches from any top-level page on the
 *   origin, which a relay origin never allows;
 * - a `policy` is present: it must verify for THIS host (`resolved.id` is it), else refused;
 * - `egress` must be within what is granted: {@link PREVIEW_DEFAULT_EGRESS} (the runtime's own
 *   package CDN, which it adds to every origin's egress) plus, with a verified policy, the
 *   origins it declares. Without a policy that is the CDN alone — nothing an app declared.
 *   A narrower egress only makes the preview stricter, so it is accepted (the README's
 *   "exactly" read as "never wider"); a wider one is not;
 * - `report` must be one of `reportUrls` ({@link cspReportUrls}) exactly — a configuration
 *   without it would hide the preview's violations.
 */
export function serviceWorkerAllowed(
  query: ServiceWorkerQuery,
  resolved: WorkerEgressPolicy,
  reportUrls: readonly string[] = [CSP_REPORT_URL],
): boolean {
  if (query.unknownKeys.length > 0 || query.repeatedKeys.length > 0) return false;
  if (query.mode !== 'relay') return false;
  if (query.policy !== null && resolved.id !== query.policy) return false;
  if (query.report === null || !reportUrls.includes(query.report)) return false;
  const granted = new Set([...PREVIEW_DEFAULT_EGRESS, ...resolved.connectSources].map((s) => s.toLowerCase()));
  return query.egress.every((source) => EGRESS_SOURCE.test(source) && granted.has(source));
}
