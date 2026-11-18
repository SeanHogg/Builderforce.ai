/**
 * The response headers of the in-browser preview origins (make.md › PRD 31 §4 W10,
 * controls 1 and 6) — `@seanhogg/builderforce-webcontainers` › packages/browser/README.md ›
 * "Preview origin headers" (2026.11.5), header for header. The CSP strings are
 * {@link ./workerCsp}; this module decides which set a response gets and whether a
 * service worker script may be served at all.
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
import { appOrigins, isDevEnvironment } from '../shared/appOrigins';
import {
  CSP_REPORT_PATH, CSP_REPORT_URL, PREVIEW_DEFAULT_EGRESS, REPORTING_ENDPOINTS_HEADER, previewDocumentCsp, relayCsp, serviceWorkerCsp,
  workerScriptCsp,
} from './workerCsp';
import type { WorkerEgressPolicy } from './workerEgressPolicy';

export type HeaderSet = Record<string, string>;

/** What lets the cross-origin-isolated app frame and load the preview origin's files. */
export const EMBEDDABLE: Readonly<HeaderSet> = Object.freeze({
  'Cross-Origin-Embedder-Policy': 'credentialless',
  'Cross-Origin-Resource-Policy': 'cross-origin',
});

const NOSNIFF = { 'X-Content-Type-Options': 'nosniff' } as const;
const AGENT_CLUSTER = { 'Origin-Agent-Cluster': '?1' } as const;

/** The script MIME type every preview script is served with. */
export const PREVIEW_SCRIPT_TYPE = 'text/javascript';

/**
 * The pages allowed to frame a preview origin: the app's own origins, and local dev ones only
 * in a development environment — in production a page on `localhost:3000` must never drive a relay.
 */
export function previewFrameAncestors(corsOrigins: string | undefined, environment: string | undefined): string[] {
  return appOrigins(corsOrigins, isDevEnvironment(environment));
}

/** `relay.html`: framed only by `frameAncestors`, never cached (a deploy reaches the next boot). */
export function relayHeaders(frameAncestors: readonly string[]): HeaderSet {
  return {
    ...EMBEDDABLE,
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': relayCsp(frameAncestors),
    ...NOSNIFF,
    ...AGENT_CLUSTER,
    'Cache-Control': 'no-store',
  };
}

/** `sw.js`: browsers re-check a service worker script on navigation, so never let a cache answer for it. */
export function serviceWorkerHeaders(): HeaderSet {
  return {
    ...EMBEDDABLE,
    'Content-Type': PREVIEW_SCRIPT_TYPE,
    'Content-Security-Policy': serviceWorkerCsp(),
    ...NOSNIFF,
    'Cache-Control': 'no-cache',
  };
}

/**
 * A process Worker script under `policy`. The response is cached per URL, and the URL
 * carries `?policy=`, so two policies never share a cache entry; `Vary` names nothing
 * because the policy is in the URL, not in a request header. `ownPaths`: path-scoped sources on
 * the platform's preview hosts the Worker must load (the .NET bundle's `https://<host>/dotnet/`) —
 * never a bare origin, which would let it re-enter `/__bfwc/` as preview ingress.
 */
export function workerScriptHeaders(policy: WorkerEgressPolicy, ownPaths: readonly string[] = []): HeaderSet {
  return {
    ...EMBEDDABLE,
    'Content-Type': PREVIEW_SCRIPT_TYPE,
    'Content-Security-Policy': workerScriptCsp([...policy.connectSources, ...ownPaths]),
    'Reporting-Endpoints': REPORTING_ENDPOINTS_HEADER,
    ...NOSNIFF,
    // Versioned by the package, so a short cache is enough.
    'Cache-Control': 'public, max-age=300',
  };
}

/**
 * Every other response the runtime's origins answer — a 404, a refused `sw.js`, the .NET
 * bundle — on the host it was served from.
 */
export function previewDocumentHeaders(host: string, frameAncestors: readonly string[]): HeaderSet {
  return {
    ...EMBEDDABLE,
    'Content-Security-Policy': previewDocumentCsp({ host: host.toLowerCase(), appOrigins: frameAncestors }),
    'Reporting-Endpoints': REPORTING_ENDPOINTS_HEADER,
    ...NOSNIFF,
    ...AGENT_CLUSTER,
  };
}

/**
 * What the container-preview ingress's answers on the shared host get (a different product
 * that shares the host: its dev servers load what they like, so no document CSP and no CORP
 * override) — only what keeps it from being sniffed or joined to a sibling's agent cluster.
 */
export const INGRESS_HEADERS: Readonly<HeaderSet> = Object.freeze({ ...NOSNIFF, ...AGENT_CLUSTER });

/** The configuration a `sw.js` URL carries (`?mode=relay&policy=<id>&egress=<sources>&report=<url>`). */
export interface ServiceWorkerQuery {
  mode: string | null;
  policy: string | null;
  egress: string[];
  report: string | null;
}

/** An egress source as the runtime writes one: an https/wss origin, optionally `*.`-wildcarded, no path. */
const EGRESS_SOURCE = /^(?:https|wss):\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*(?::\d{1,5})?$/i;

/** Read a `sw.js` URL's configuration. Egress entries are lowercased, as the runtime writes them. */
export function serviceWorkerQueryOf(url: URL): ServiceWorkerQuery {
  const egress = (url.searchParams.get('egress') ?? '').split(' ').filter(Boolean).map((s) => s.toLowerCase());
  return { mode: url.searchParams.get('mode'), policy: url.searchParams.get('policy'), egress, report: url.searchParams.get('report') };
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
  if (query.mode !== 'relay') return false;
  if (query.policy !== null && resolved.id !== query.policy) return false;
  if (query.report === null || !reportUrls.includes(query.report)) return false;
  const granted = new Set([...PREVIEW_DEFAULT_EGRESS, ...resolved.connectSources].map((s) => s.toLowerCase()));
  return query.egress.every((source) => EGRESS_SOURCE.test(source) && granted.has(source));
}
