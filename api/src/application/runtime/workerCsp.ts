/**
 * The Content-Security-Policies of the in-browser preview origins (make.md §4 W10,
 * controls 1 and 6): `preview.builderforce.ai` (the workspace's shared origin) and each
 * application's own `<key>.preview.builderforce.ai`.
 *
 * THE CONTRACT is `@seanhogg/builderforce-webcontainers` › packages/browser/README.md ›
 * "Preview origin headers" (2026.11.5). Every string here is that section's, spelled
 * once; the headers that carry them are {@link ./previewOriginHeaders}.
 *
 * - Process Worker scripts (`process-worker.js`, `python-worker.js`, `php-worker.js`,
 *   `dotnet-worker.js`, `rust-worker.js`): the app's code runs in them, and nothing
 *   inside them is a security boundary (W10 principle 2), so the browser decides egress:
 *   the CSP on the script's own response is the Worker global's policy (CSP3). Their
 *   `<egress>` is {@link DEFAULT_CONNECT_SOURCES} (what the runtimes and their installers
 *   read) plus the app's DECLARED origins from a signed `?policy=`
 *   ({@link ./workerEgressPolicy}). `'unsafe-eval'` because the Node worker runs app
 *   modules through `eval`/`new Function`; `'wasm-unsafe-eval'` for Pyodide, php-wasm and
 *   PGlite. No `'self'` in `connect-src`: a Worker fetch to its own origin would enter the
 *   service worker as preview ingress (identity laundering), and loopback is served
 *   in-runtime, never by `fetch`.
 * - `sw.js`: imports nothing and fetches only its own origin (the restart pass-through).
 * - `relay.html`: one inline script, framed only by the app, starts Workers only from its
 *   own origin, connects nowhere — so a preview that scripts it gains no egress.
 * - Every other response from a preview origin (404s, a page loaded before the worker took
 *   control): the same document policy the service worker stamps, plus `frame-ancestors`.
 *
 * Residual (method-blind): CSP cannot restrict HTTP methods. The npm registry accepts
 * token-authenticated `PUT` (publish), and `api.github.com` writes with a token, so code
 * that brings its own token could write there. The runtime never hands GitHub or npm
 * credentials to app processes; closing it fully needs read-only proxies, not a CSP.
 */
import { DEFAULT_INTERNAL_API_BASE_URL } from './sandbox/egressAllowlist';

/** The preview origin's script directory (the service worker's scope). */
export const PREVIEW_SCRIPT_PREFIX = '/__bfwc/';

/** Where browsers send CSP violation reports. On the API host: reports are telemetry only. */
export const CSP_REPORT_PATH = '/api/runtime/csp-report';
export const CSP_REPORT_URL = `${DEFAULT_INTERNAL_API_BASE_URL}${CSP_REPORT_PATH}`;

/** The `report-to` group name, declared by {@link REPORTING_ENDPOINTS_HEADER}. */
export const CSP_REPORT_GROUP = 'bfwc-csp';

/** `Reporting-Endpoints` header value that names {@link CSP_REPORT_GROUP}. */
export const REPORTING_ENDPOINTS_HEADER = `${CSP_REPORT_GROUP}="${CSP_REPORT_URL}"`;

/**
 * The read-only hosts the runtimes and their installers need, as CSP source expressions:
 * npm tarballs and metadata, jsDelivr (Pyodide, php-wasm, PGlite, Composer's GitHub dists),
 * PyPI (micropip), Packagist metadata and GitHub reads (repo import/run, Composer's
 * `api.github.com/repos/…/zipball/…` dists). Applied to every process Worker whatever
 * its policy says.
 */
export const DEFAULT_CONNECT_SOURCES: readonly string[] = [
  'https://registry.npmjs.org',
  'https://cdn.jsdelivr.net',
  'https://data.jsdelivr.com',
  'https://pypi.org',
  'https://files.pythonhosted.org',
  // Path-scoped: only the read-only package metadata, not Packagist's token API.
  'https://packagist.org/packages/',
  'https://repo.packagist.org',
  // NuGet reads for `dotnet restore` (the v3 index and flat container, and the CDN it may
  // redirect to). Never `https://www.nuget.org`: that is the push (write) path. No crates.io
  // host: the Rust runtime runs prebuilt wasm and never fetches crates.
  'https://api.nuget.org',
  'https://globalcdn.nuget.org',
  'https://github.com',
  'https://api.github.com',
  'https://codeload.github.com',
  'https://raw.githubusercontent.com',
  'https://objects.githubusercontent.com',
];

/**
 * The egress every preview origin's documents get: the package CDN previews load modules
 * from (`https://esm.sh`, the runtime's default `cdn`, which it adds to every origin's
 * egress itself). An application's declared origins come on top, only through its policy.
 */
export const PREVIEW_DEFAULT_EGRESS: readonly string[] = ['https://esm.sh'];

/** The scripts the relay may start: the service worker and the five process Workers. */
export const PREVIEW_WORKER_SCRIPTS = [
  'sw.js', 'process-worker.js', 'python-worker.js', 'php-worker.js', 'dotnet-worker.js', 'rust-worker.js',
] as const;

const directive = (name: string, ...sources: readonly string[]) => [name, ...sources].join(' ');
const unique = (...lists: ReadonlyArray<readonly string[]>) => [...new Set(lists.flat())];

/** A process Worker's CSP: the default allowlist plus the app's declared origins (`extraEgress`). */
export function workerScriptCsp(extraEgress: readonly string[] = []): string {
  const egress = unique(DEFAULT_CONNECT_SOURCES, extraEgress);
  return [
    directive('default-src', "'none'"),
    directive('script-src', "'self'", "'unsafe-eval'", "'wasm-unsafe-eval'", 'blob:', ...egress),
    directive('worker-src', "'self'", 'blob:'),
    directive('connect-src', ...egress),
    directive('report-to', CSP_REPORT_GROUP),
  ].join('; ');
}

/** The service worker's CSP: it imports nothing, and fetches only its own origin. */
export function serviceWorkerCsp(): string {
  return "default-src 'none'; connect-src 'self'";
}

/** The relay page's CSP: framed only by the app, starts Workers only from its own origin, connects nowhere. */
export function relayCsp(appOrigins: readonly string[]): string {
  return [
    directive('default-src', "'none'"),
    directive('script-src', "'unsafe-inline'"),
    directive('worker-src', "'self'"),
    directive('connect-src', "'none'"),
    directive('base-uri', "'none'"),
    directive('form-action', "'none'"),
    directive('frame-ancestors', ...appOrigins),
  ].join('; ');
}

export interface PreviewDocumentCspInput {
  /** The preview origin's own host (`name[:port]`, lowercase): its `ws:`/`wss:` are named explicitly. */
  host: string;
  /** The app origins allowed to frame it. */
  appOrigins: readonly string[];
  /** External sources it may reach. Default {@link PREVIEW_DEFAULT_EGRESS}. */
  egress?: readonly string[];
}

/**
 * What every response from a preview origin that the service worker did not serve gets:
 * the policy the worker stamps (`previewDocumentPolicy` in the package), with
 * `frame-ancestors` limited to the app.
 */
export function previewDocumentCsp({ host, appOrigins, egress = PREVIEW_DEFAULT_EGRESS }: PreviewDocumentCspInput): string {
  const out = unique(egress);
  return [
    directive('default-src', "'self'", ...out),
    directive('script-src', "'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:', ...out),
    directive('style-src', "'self'", "'unsafe-inline'", 'blob:', 'data:', ...out),
    directive('img-src', "'self'", 'data:', 'blob:', ...out),
    directive('font-src', "'self'", 'data:', ...out),
    directive('media-src', "'self'", 'data:', 'blob:', ...out),
    directive('connect-src', "'self'", `ws://${host}`, `wss://${host}`, 'blob:', 'data:', ...out),
    directive('frame-src', "'self'", 'blob:'),
    directive('form-action', "'self'", ...out),
    directive('worker-src', "'self'", 'blob:'),
    directive('frame-ancestors', ...appOrigins),
    directive('report-to', CSP_REPORT_GROUP),
  ].join('; ');
}
