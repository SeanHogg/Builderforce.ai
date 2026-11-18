/**
 * Egress CSP for the in-browser preview origin's scripts (make.md §4 W10, control 6).
 *
 * The process Workers (`process-worker.js`, `python-worker.js`, `php-worker.js`) run the
 * user's app code on `preview.builderforce.ai`. Nothing inside them is a security
 * boundary (W10 principle 2), so egress is decided by the browser: the CSP header on the
 * worker script's own response becomes the Worker global's policy (CSP3). `connect-src`
 * alone would leave `importScripts`, dynamic `import()` and nested Workers open, so every
 * policy here starts from `default-src 'none'` and names `script-src`, `worker-src` and
 * `connect-src` explicitly.
 *
 * Pure: strings in, strings out. Which allowlist applies to a request (the signed
 * `?policy=` id) is {@link ./workerEgressPolicy}.
 *
 * ── DECISIONS ────────────────────────────────────────────────────────────────
 * `script-src 'unsafe-eval'`: the Node process worker runs app modules through `eval` /
 * `new Function` (its `vm` and ESM loader shims), so without it no app runs. This CSP is
 * about EGRESS, not script injection: the app's code is untrusted by design and already
 * executes; what must not happen is that code loading or sending anything to a host
 * outside the allowlist. `'wasm-unsafe-eval'` is named as well because Pyodide, php-wasm
 * and PGlite compile WebAssembly (it is implied by `'unsafe-eval'`, listed so the policy
 * still reads correctly if eval is ever dropped).
 *
 * `script-src https://cdn.jsdelivr.net`: Pyodide (`importScripts` / `import()` of
 * `pyodide.js|mjs`), php-wasm and PGlite are imported from jsDelivr at run time. No worker
 * imports a script from its own origin, so `'self'` is not in `script-src` either.
 *
 * `worker-src 'none'`: process Workers never start nested Workers — every process is
 * spawned page-side by the relay (`WorkerSupply` / `relay-spawn`). App code that tries
 * `new Worker()` is a violation and is reported.
 *
 * No `'self'` and no preview origin in `connect-src`: a fetch to the preview origin from
 * a Worker would enter the service worker as if it were preview ingress (identity
 * laundering), and `/__bfwc/` cannot be carved out of `'self'` (CSP source expressions
 * only ALLOW paths; there is no exclusion, and path matching is dropped after a
 * redirect anyway). No worker needs its own origin over the network — loopback
 * (`localhost:<port>`) is served in-runtime by `PortRegistry`, never by `fetch` — so the
 * origin is left out entirely, which excludes `/__bfwc/` with no residual.
 *
 * `sw.js` gets `default-src 'none'; connect-src 'self'`: a routed request is answered
 * from a MessagePort (`respondWith`), and most requests it does not route are left to
 * the browser (no `respondWith`), governed by the requesting client's own CSP. The one
 * exception is the restart re-judge (`sw.ts`, `needsClientLookup`): a same-origin GET/HEAD
 * subresource from a client the worker forgot is looked up, and when it is not a
 * virtual-server page the worker passes it on with `fetch(request)` — a fetch made BY the
 * service worker, governed by THIS policy. `swGuard.needsLookup` limits it to the preview
 * origin, so `'self'` is exactly what it needs. The service worker is platform code, not
 * the app's, so `'self'` here is not the Worker identity-laundering case above. It still
 * imports nothing (`script-src` falls back to `'none'`).
 *
 * `relay.html` keeps `frame-ancestors` first and adds `worker-src` naming exactly the
 * four scripts it starts (the query, e.g. `?policy=`, is ignored by CSP path matching),
 * `connect-src 'none'`, `object-src 'none'` and `base-uri 'none'`. It has one inline
 * script, so neither `default-src` nor `script-src` is set on it.
 *
 * Residual (method-blind): CSP cannot restrict HTTP methods. The npm registry accepts
 * token-authenticated `PUT` (publish), so code holding its own npm token could write to
 * it. Closing that needs a read-only registry proxy on the API, not a CSP.
 */
import { PREVIEW_HOST } from './previewIngress';
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
 * The read-only hosts the runtimes and their installers need, as CSP source expressions.
 * Read from the worker bundles of `@seanhogg/builderforce-webcontainers`: npm tarballs and
 * metadata, jsDelivr (Pyodide, php-wasm, PGlite, Composer's GitHub dists and their
 * listings), PyPI (micropip), Packagist metadata (`/packages/{name}.json` and the `p2`
 * mirror) and GitHub.
 *
 * GitHub (`github.com`, `api.github.com`, `codeload.github.com`, `raw.githubusercontent.com`,
 * `objects.githubusercontent.com`) is allowed so a repo can be imported and run straight
 * in the runtime, and so Composer's `api.github.com/repos/…/zipball/…` dists (which
 * redirect to codeload) install. The write risk on `api.github.com` (gists, pushes) needs a
 * token, and the runtime never hands GitHub credentials to app processes: the user's
 * GitHub connection stays host-side (the Builderforce API or the trusted page), so app
 * code can read public GitHub but cannot write as the user. Residual: an app that brings
 * its own token can still write — CSP cannot restrict methods.
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
  // GitHub reads: repo import/run and Composer dists (see above).
  'https://github.com',
  'https://api.github.com',
  'https://codeload.github.com',
  'https://raw.githubusercontent.com',
  'https://objects.githubusercontent.com',
];

/** Where the runtimes import interpreter and library scripts from. */
export const WORKER_SCRIPT_SOURCES: readonly string[] = ["'unsafe-eval'", "'wasm-unsafe-eval'", 'https://cdn.jsdelivr.net'];

/** The scripts the relay may start: the service worker and the three process Workers. */
export const PREVIEW_WORKER_SCRIPTS = ['sw.js', 'process-worker.js', 'python-worker.js', 'php-worker.js'] as const;

const reporting = `report-uri ${CSP_REPORT_URL}; report-to ${CSP_REPORT_GROUP}`;

/** The process Workers' CSP: the default allowlist plus the app's declared origins. */
export function workerScriptCsp(extraConnectSources: readonly string[] = []): string {
  const connect = [...new Set([...DEFAULT_CONNECT_SOURCES, ...extraConnectSources])];
  return [
    "default-src 'none'",
    `script-src ${WORKER_SCRIPT_SOURCES.join(' ')}`,
    "worker-src 'none'",
    `connect-src ${connect.join(' ')}`,
    reporting,
  ].join('; ');
}

/** The service worker's CSP: it imports nothing, and fetches only its own origin (the restart pass-through). */
export function serviceWorkerCsp(): string {
  return `default-src 'none'; connect-src 'self'; ${reporting}`;
}

/** The relay page's CSP: framed only by the app, starts only the preview scripts, connects nowhere. */
export function relayCsp(appOrigins: readonly string[]): string {
  const workers = PREVIEW_WORKER_SCRIPTS.map((file) => `https://${PREVIEW_HOST}${PREVIEW_SCRIPT_PREFIX}${file}`);
  return [
    `frame-ancestors ${appOrigins.join(' ')}`,
    `worker-src ${workers.join(' ')}`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    reporting,
  ].join('; ');
}
