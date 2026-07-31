/**
 * WebSecurityScanner — the "point at your live website, get security findings NOW"
 * engine. A deterministic, dependency-free HTTP scan that runs INSIDE the Worker
 * request (no external scanner infra, no queue) so a user configures a URL and sees
 * real findings in a couple of seconds — the immediate-value demo.
 *
 * WHAT IT CHECKS (OWASP Secure Headers Project + common transport/cookie/CORS
 * misconfigurations + content + exposed-file probes observable over HTTP):
 *   Response headers:
 *   - HTTPS enforcement (does http:// upgrade to https://)
 *   - HSTS (Strict-Transport-Security present + adequate max-age)
 *   - Content-Security-Policy present
 *   - Clickjacking protection (X-Frame-Options / CSP frame-ancestors)
 *   - X-Content-Type-Options: nosniff
 *   - Referrer-Policy / Permissions-Policy
 *   - Server / framework version disclosure (info leak)
 *   - Cookie flags (Secure / HttpOnly / SameSite)
 *   - Over-permissive CORS (Access-Control-Allow-Origin: * [+ credentials])
 *   Response body:
 *   - Mixed content (http:// sub-resources on an https page)
 *   - Directory listing exposure ("Index of /")
 *   Exposed-file probes (content-signature verified to avoid SPA 200 false positives):
 *   - /.env, /.git/config, /.git/HEAD, /server-status
 *   - Missing /.well-known/security.txt (advisory)
 *
 * NOT covered here (needs infrastructure this runtime does not have): peer TLS
 * certificate chain / expiry / cipher inspection (Cloudflare Worker `fetch` does not
 * surface the peer certificate) and CVE-feed version fingerprinting (needs an
 * external advisory feed). Those remain in the gap register.
 *
 * DESIGN
 * - The check logic is a PURE function of a normalized {@link ScanContext}
 *   ({@link evaluateHeaders}) so it is unit-testable with zero network. Only
 *   {@link scanWebTarget} does IO, and its `fetch` is injectable.
 * - Findings share the platform finding shape (severity / recommendation / a stable
 *   dedupe marker) so {@link webSecurityScan} can push them through the SAME
 *   SecurityAuditService pipeline the Security agent and GitHub alerts use — one
 *   board, one severity vocabulary, one audit ledger (see githubAlerts.ts).
 * - SSRF-guarded: this fetches a USER-SUPPLIED URL from our infrastructure, so
 *   {@link normalizeScanTarget} rejects non-http(s) schemes and private / loopback /
 *   link-local / metadata hosts before any request is made. A security product that
 *   is itself an SSRF vector would be the worst possible irony.
 */
import type { FindingSeverity, TrustCriterion } from './SecurityAuditService';

/** A single web-scan check result, mapped onto the platform finding shape. */
export interface WebFinding {
  /** Stable check identity, e.g. 'hsts-missing' — half of the dedupe marker. */
  checkId: string;
  title: string;
  detail: string;
  severity: FindingSeverity;
  recommendation: string;
  /** The Trust Service Criterion the finding maps to (for the ticket + rollup). */
  tsc: TrustCriterion;
  /** `[web:<checkId>:<origin>]` — the dedupe marker embedded in the ticket title. */
  marker: string;
}

/** The normalized, network-free input the pure checks run against. */
export interface ScanContext {
  /** Origin that was scanned, lowercased — e.g. `https://example.com`. */
  origin: string;
  /** The final URL after redirects. */
  finalUrl: string;
  /** Lowercased response header name → value (last wins). */
  headers: Record<string, string>;
  /** Raw Set-Cookie header lines from the primary response. */
  cookies: string[];
  /**
   * Result of probing `http://<host>`:
   *   'upgraded'    — redirected to https (good)
   *   'not-upgraded'— answered over http without upgrading (bad)
   *   'unknown'     — probe failed / not attempted (no finding raised)
   */
  httpProbe: 'upgraded' | 'not-upgraded' | 'unknown';
}

/** A completed scan: the context, the findings, and the rolled-up posture score. */
export interface WebScanResult {
  origin: string;
  finalUrl: string;
  findings: WebFinding[];
  /** 0..100 posture score derived from finding severities. */
  score: number;
  /** Server header if disclosed, for the run summary. */
  server: string | null;
}

export class ScanTargetError extends Error {
  constructor(public readonly code: 'invalid_url' | 'blocked_host', message: string) {
    super(message);
    this.name = 'ScanTargetError';
  }
}

// ── SSRF guard ────────────────────────────────────────────────────────────────

/** Hostnames that must never be fetched from our infrastructure. */
const BLOCKED_HOST_EXACT = new Set(['localhost', 'localhost.localdomain', 'metadata.google.internal']);

/** True for a hostname that resolves to a private / loopback / link-local space. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase();
  if (BLOCKED_HOST_EXACT.has(h)) return true;
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.localhost')) return true;

  // IPv6 loopback / unique-local / link-local.
  if (h === '::1' || h === '[::1]') return true;
  if (h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80') || h.startsWith('[fc') || h.startsWith('[fd') || h.startsWith('[fe80')) return true;

  // IPv4 literal ranges: 10/8, 127/8, 169.254/16 (link-local + AWS/GCP metadata),
  // 172.16/12, 192.168/16, 0.0.0.0.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/**
 * Validate + normalize a user-supplied scan target to an `https`/`http` origin URL.
 * Throws {@link ScanTargetError} on a bad scheme or a blocked (private/loopback) host.
 * A bare `example.com` defaults to `https://`.
 */
export function normalizeScanTarget(raw: string): string {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) throw new ScanTargetError('invalid_url', 'A website URL is required.');

  // A non-http(s) scheme (ftp:, file:, javascript:, …) is rejected outright rather
  // than silently rewritten; a bare host with no scheme defaults to https.
  const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed);
  const scheme = schemeMatch?.[1];
  if (scheme && !/^https?$/i.test(scheme)) {
    throw new ScanTargetError('invalid_url', `Only http(s) URLs can be scanned (got "${scheme}:").`);
  }
  const withScheme = scheme ? trimmed : `https://${trimmed}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    throw new ScanTargetError('invalid_url', `"${trimmed}" is not a valid URL.`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new ScanTargetError('invalid_url', `Only http(s) URLs can be scanned (got "${u.protocol}").`);
  }
  if (isBlockedHost(u.hostname)) {
    throw new ScanTargetError('blocked_host', `"${u.hostname}" is a private or loopback address and cannot be scanned.`);
  }
  return u.toString();
}

// ── Severity → score weighting ──────────────────────────────────────────────────

const SEVERITY_WEIGHT: Record<FindingSeverity, number> = {
  critical: 40, high: 20, medium: 10, low: 4, info: 1,
};

/** Roll a finding set up into a 0..100 posture score (100 = clean). */
export function scoreFindings(findings: WebFinding[]): number {
  const penalty = findings.reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 4), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** `[web:<checkId>:<origin>]` — mirrors githubAlerts' alertMarker for dedupe. */
export function webMarker(checkId: string, origin: string): string {
  return `[web:${checkId}:${origin.toLowerCase()}]`;
}

// ── Pure checks ─────────────────────────────────────────────────────────────────

/** Parse the numeric `max-age=` from a header value, or null. */
function maxAge(value: string | undefined): number | null {
  if (!value) return null;
  const m = /max-age\s*=\s*(\d+)/i.exec(value);
  return m ? Number(m[1]) : null;
}

/** Build a finding, stamping the marker + criterion. */
function make(
  ctx: ScanContext,
  checkId: string,
  severity: FindingSeverity,
  tsc: TrustCriterion,
  title: string,
  detail: string,
  recommendation: string,
): WebFinding {
  return { checkId, severity, tsc, title, detail, recommendation, marker: webMarker(checkId, ctx.origin) };
}

/** 180 days — the HSTS max-age below which a site is only weakly protected. */
const HSTS_MIN_MAX_AGE = 15_552_000;

/**
 * Run every security-header / transport / cookie / CORS check against a normalized
 * context. PURE — no network, no clock, no DB — so it is exhaustively unit-testable.
 */
export function evaluateHeaders(ctx: ScanContext): WebFinding[] {
  const h = ctx.headers;
  const out: WebFinding[] = [];
  const site = ctx.origin;

  // 1. HTTPS enforcement — the http:// origin must redirect to https://.
  if (ctx.httpProbe === 'not-upgraded') {
    out.push(make(ctx, 'https-enforced', 'high', 'security',
      'Site is reachable over plain HTTP without redirecting to HTTPS',
      `\`http://${new URL(site).host}\` answered over an unencrypted connection instead of redirecting to HTTPS. Traffic (including session cookies) can be read or modified in transit.`,
      'Configure the web server / CDN to 301-redirect all HTTP requests to the HTTPS equivalent, then enable HSTS.'));
  }

  // 2. HSTS.
  const hsts = h['strict-transport-security'];
  if (!hsts) {
    out.push(make(ctx, 'hsts-missing', 'medium', 'security',
      'Missing Strict-Transport-Security (HSTS) header',
      'Without HSTS, a browser can be downgraded to HTTP on the first visit or by an active attacker (SSL-strip), even when a redirect is in place.',
      'Add `Strict-Transport-Security: max-age=31536000; includeSubDomains` (consider `preload`) on HTTPS responses.'));
  } else {
    const age = maxAge(hsts);
    if (age != null && age < HSTS_MIN_MAX_AGE) {
      out.push(make(ctx, 'hsts-weak', 'low', 'security',
        'HSTS max-age is shorter than recommended',
        `Strict-Transport-Security max-age is ${age}s (< ${HSTS_MIN_MAX_AGE}s / 180 days), narrowing the window in which the browser enforces HTTPS.`,
        'Raise HSTS `max-age` to at least 15552000 (180 days); 31536000 (1 year) is recommended for preload.'));
    }
  }

  // 3. Content-Security-Policy.
  const csp = h['content-security-policy'];
  if (!csp) {
    out.push(make(ctx, 'csp-missing', 'medium', 'security',
      'Missing Content-Security-Policy header',
      'No CSP means the browser has no allowlist for scripts/styles/frames, so an injected `<script>` (XSS) or a malicious third-party resource runs unrestricted.',
      'Define a Content-Security-Policy (start in report-only mode), at minimum locking down `script-src`, `object-src \'none\'`, and `frame-ancestors`.'));
  }

  // 4. Clickjacking — needs X-Frame-Options OR CSP frame-ancestors.
  const xfo = h['x-frame-options'];
  const hasFrameAncestors = !!csp && /frame-ancestors/i.test(csp);
  if (!xfo && !hasFrameAncestors) {
    out.push(make(ctx, 'clickjacking', 'medium', 'security',
      'No clickjacking protection (X-Frame-Options / frame-ancestors)',
      'The page can be embedded in an attacker-controlled `<iframe>`, enabling clickjacking / UI-redress attacks.',
      'Send `X-Frame-Options: DENY` (or `SAMEORIGIN`) and/or a CSP `frame-ancestors \'self\'` directive.'));
  }

  // 5. MIME sniffing.
  const xcto = (h['x-content-type-options'] ?? '').toLowerCase();
  if (xcto !== 'nosniff') {
    out.push(make(ctx, 'nosniff-missing', 'low', 'security',
      'Missing X-Content-Type-Options: nosniff',
      'Without `nosniff`, browsers may MIME-sniff responses and execute a file served with the wrong Content-Type as script.',
      'Add `X-Content-Type-Options: nosniff` to all responses.'));
  }

  // 6. Referrer-Policy.
  if (!h['referrer-policy']) {
    out.push(make(ctx, 'referrer-policy-missing', 'low', 'confidentiality',
      'Missing Referrer-Policy header',
      'The full URL (which may carry tokens or identifiers) can leak to third-party sites via the Referer header on outbound links and resource loads.',
      'Add `Referrer-Policy: strict-origin-when-cross-origin` (or stricter).'));
  }

  // 7. Permissions-Policy.
  if (!h['permissions-policy'] && !h['feature-policy']) {
    out.push(make(ctx, 'permissions-policy-missing', 'info', 'security',
      'Missing Permissions-Policy header',
      'No Permissions-Policy means powerful browser features (camera, microphone, geolocation, etc.) are not explicitly restricted for the page or its frames.',
      'Add a `Permissions-Policy` header disabling the features the site does not use, e.g. `geolocation=(), camera=(), microphone=()`.'));
  }

  // 8. Version / technology disclosure.
  const discloseHeaders = ['server', 'x-powered-by', 'x-aspnet-version', 'x-aspnetmvc-version', 'x-generator'];
  const disclosed = discloseHeaders
    .map((name) => ({ name, value: h[name] }))
    .filter((d) => d.value && /\d/.test(d.value)); // only flag when a VERSION is leaked
  if (disclosed.length > 0) {
    const list = disclosed.map((d) => `\`${d.name}: ${d.value}\``).join(', ');
    out.push(make(ctx, 'version-disclosure', 'low', 'confidentiality',
      'Server / framework version disclosed in response headers',
      `The response advertises specific software versions (${list}), letting an attacker match the site to published CVEs for those versions.`,
      'Suppress or genericize version-bearing headers (`Server`, `X-Powered-By`, `X-AspNet-Version`, `X-Generator`) at the web server / framework level.'));
  }

  // 9. Cookie flags — aggregate one finding per missing flag class.
  const parsed = ctx.cookies.map(parseCookie).filter((c): c is ParsedCookie => c !== null);
  const insecure = parsed.filter((c) => !c.secure).map((c) => c.name);
  const nonHttpOnly = parsed.filter((c) => !c.httpOnly).map((c) => c.name);
  const noSameSite = parsed.filter((c) => !c.sameSite).map((c) => c.name);
  if (insecure.length > 0) {
    out.push(make(ctx, 'cookie-insecure', 'medium', 'confidentiality',
      'Cookie set without the Secure flag',
      `These cookies can be sent over unencrypted HTTP: ${insecure.map((n) => `\`${n}\``).join(', ')}.`,
      'Add the `Secure` attribute to every cookie so it is only ever sent over HTTPS.'));
  }
  if (nonHttpOnly.length > 0) {
    out.push(make(ctx, 'cookie-not-httponly', 'low', 'confidentiality',
      'Cookie readable from JavaScript (no HttpOnly flag)',
      `These cookies are exposed to \`document.cookie\` and can be stolen via XSS: ${nonHttpOnly.map((n) => `\`${n}\``).join(', ')}.`,
      'Add the `HttpOnly` attribute to session / auth cookies so client-side script cannot read them.'));
  }
  if (noSameSite.length > 0) {
    out.push(make(ctx, 'cookie-no-samesite', 'low', 'security',
      'Cookie set without a SameSite attribute',
      `These cookies have no SameSite protection against cross-site request forgery: ${noSameSite.map((n) => `\`${n}\``).join(', ')}.`,
      'Set `SameSite=Lax` (or `Strict`) on cookies; use `SameSite=None; Secure` only for genuinely cross-site cookies.'));
  }

  // 10. Over-permissive CORS.
  const acao = (h['access-control-allow-origin'] ?? '').trim();
  const acac = (h['access-control-allow-credentials'] ?? '').trim().toLowerCase();
  if (acao === '*') {
    if (acac === 'true') {
      // Browsers reject *+credentials, but advertising both signals a misconfigured
      // policy that often reflects the Origin instead — worth a high-severity flag.
      out.push(make(ctx, 'cors-wildcard-credentials', 'high', 'security',
        'CORS allows any origin together with credentials',
        'The response sends `Access-Control-Allow-Origin: *` alongside `Access-Control-Allow-Credentials: true`. A policy that reflects the Origin with credentials lets any site read authenticated responses.',
        'Never combine a wildcard/reflected origin with credentials. Allowlist specific trusted origins and echo only those.'));
    } else {
      out.push(make(ctx, 'cors-wildcard', 'low', 'security',
        'CORS is open to any origin (Access-Control-Allow-Origin: *)',
        'Any website can read this endpoint\'s responses. Acceptable for genuinely public data, but a risk if the endpoint returns anything user- or tenant-specific.',
        'Restrict `Access-Control-Allow-Origin` to the specific origins that need cross-site access.'));
    }
  }

  return out;
}

// ── Body content checks ──────────────────────────────────────────────────────

/** How much of the response body the content checks read (bounded). */
export const BODY_SNIPPET_LIMIT = 200_000;

/**
 * Content checks against the fetched HTML body. PURE. `body` is the (bounded)
 * response text; empty string when unavailable (non-HTML / read failed) → no findings.
 */
export function evaluateBody(ctx: ScanContext, body: string): WebFinding[] {
  const out: WebFinding[] = [];
  if (!body) return out;

  // Directory listing — the classic auto-generated "Index of /" page leaks the file tree.
  if (/<title>\s*Index of \//i.test(body) || /Directory listing for/i.test(body)) {
    out.push(make(ctx, 'directory-listing', 'medium', 'confidentiality',
      'Directory listing is enabled',
      'The server returned an auto-generated directory index, exposing the names (and often the full tree) of files that were never meant to be browsable.',
      'Disable automatic directory indexing (`Options -Indexes` / `autoindex off`) and place an index document in each servable directory.'));
  }

  // Mixed content — an https page pulling scripts/styles/iframes over plain http.
  if (new URL(ctx.origin).protocol === 'https:') {
    const mixed = /(?:src|href)\s*=\s*["']http:\/\/[^"']+["']/i.test(body)
      && !/(?:src|href)\s*=\s*["']http:\/\/(?:www\.)?w3\.org\//i.test(
        // ignore the XML namespace URL that is not an actual fetched resource
        body.replace(/xmlns[^=]*=\s*["']http:\/\/[^"']+["']/gi, ''),
      );
    if (mixed) {
      out.push(make(ctx, 'mixed-content', 'medium', 'security',
        'Page loads sub-resources over insecure HTTP (mixed content)',
        'This HTTPS page references scripts, styles, or frames via `http://`. Browsers block or downgrade such resources, and an active attacker can tamper with any that load.',
        'Serve every sub-resource over HTTPS (use protocol-relative or absolute https URLs) and add a CSP `upgrade-insecure-requests` directive.'));
    }
  }

  return out;
}

// ── Exposed-file probes ──────────────────────────────────────────────────────

/** One probed path + the content signature that confirms a real exposure. */
export interface ProbeSpec {
  path: string;
  checkId: string;
  severity: FindingSeverity;
  tsc: TrustCriterion;
  title: string;
  detail: string;
  recommendation: string;
  /** True only when the RESPONSE BODY confirms the file is really served (guards
   *  against SPA/catch-all routes that answer 200 + index.html for every path). */
  matches: (body: string) => boolean;
}

/** The result of GETting a probe path (network-free consumers get this shape). */
export interface ProbeResult {
  path: string;
  status: number;
  body: string;
}

/** High-signal sensitive paths that must never be publicly served. */
export const SENSITIVE_PROBES: ProbeSpec[] = [
  {
    path: '/.env', checkId: 'exposed-dotenv', severity: 'critical', tsc: 'confidentiality',
    title: 'Environment file (.env) is publicly accessible',
    detail: 'A request for `/.env` returned a dotenv file — these routinely contain database URLs, API keys, and secrets. This is a critical credential exposure.',
    recommendation: 'Remove `.env` from the web root immediately, rotate every credential it contained, and block dotfiles at the server/CDN.',
    matches: (b) => /^[A-Z][A-Z0-9_]*\s*=/m.test(b) && !/<html|<!doctype/i.test(b),
  },
  {
    path: '/.git/config', checkId: 'exposed-git-config', severity: 'high', tsc: 'confidentiality',
    title: 'Git repository config (/.git/config) is exposed',
    detail: 'A request for `/.git/config` returned a Git configuration file, meaning the whole `.git` directory is likely downloadable — attackers can reconstruct your full source history, including secrets committed in the past.',
    recommendation: 'Deny access to the `.git` directory at the web server / CDN, and never deploy the working `.git` folder to production.',
    matches: (b) => /\[core\]|\[remote\s|repositoryformatversion/i.test(b) && !/<html|<!doctype/i.test(b),
  },
  {
    path: '/.git/HEAD', checkId: 'exposed-git-head', severity: 'high', tsc: 'confidentiality',
    title: 'Git metadata (/.git/HEAD) is exposed',
    detail: 'A request for `/.git/HEAD` returned a Git ref pointer, a strong signal that the `.git` directory is publicly served and the repository can be cloned.',
    recommendation: 'Block the `.git` directory at the web server / CDN and redeploy without it.',
    matches: (b) => /^ref:\s+refs\//m.test(b.trim()) && !/<html|<!doctype/i.test(b),
  },
  {
    path: '/server-status', checkId: 'exposed-server-status', severity: 'medium', tsc: 'confidentiality',
    title: 'Apache server-status page is exposed',
    detail: 'The `/server-status` page (mod_status) is publicly reachable, leaking live request URLs, client IPs, and server internals.',
    recommendation: 'Restrict `/server-status` to localhost / trusted IPs, or disable mod_status in production.',
    matches: (b) => /Apache Server Status/i.test(b),
  },
];

/** The security.txt probe is inverted: a MISSING contact file is the (advisory) finding. */
export const SECURITY_TXT_PATH = '/.well-known/security.txt';

/**
 * Turn probe responses into findings. PURE. A sensitive path only yields a finding
 * when it returned 200 AND its content signature matches (so an SPA that 200s every
 * route does not produce false criticals). A missing security.txt yields one info.
 */
export function evaluateExposures(ctx: ScanContext, probes: ProbeResult[]): WebFinding[] {
  const out: WebFinding[] = [];
  const byPath = new Map(probes.map((p) => [p.path, p]));

  for (const spec of SENSITIVE_PROBES) {
    const r = byPath.get(spec.path);
    if (r && r.status === 200 && spec.matches(r.body)) {
      out.push(make(ctx, spec.checkId, spec.severity, spec.tsc, spec.title, spec.detail, spec.recommendation));
    }
  }

  const sec = byPath.get(SECURITY_TXT_PATH);
  const hasSecurityTxt = !!sec && sec.status === 200 && /Contact\s*:/i.test(sec.body);
  if (!hasSecurityTxt) {
    out.push(make(ctx, 'security-txt-missing', 'info', 'security',
      'No security.txt vulnerability-disclosure contact',
      'The site publishes no `/.well-known/security.txt`, so a researcher who finds a vulnerability has no standard, machine-readable way to report it to you.',
      'Publish `/.well-known/security.txt` with at least a `Contact:` line (per RFC 9116) so vulnerabilities are reported to you rather than disclosed publicly.'));
  }

  return out;
}

/** All probe paths a full scan fetches (sensitive set + security.txt). */
export const ALL_PROBE_PATHS: string[] = [...SENSITIVE_PROBES.map((p) => p.path), SECURITY_TXT_PATH];

interface ParsedCookie { name: string; secure: boolean; httpOnly: boolean; sameSite: boolean; }

/** Parse one Set-Cookie header line into { name, flags }. Null when nameless. */
function parseCookie(line: string): ParsedCookie | null {
  const parts = line.split(';').map((p) => p.trim());
  const first = parts[0] ?? '';
  const name = first.split('=')[0]?.trim();
  if (!name) return null;
  const flags = parts.slice(1).map((p) => p.toLowerCase());
  return {
    name,
    secure: flags.includes('secure'),
    httpOnly: flags.some((f) => f === 'httponly'),
    sameSite: flags.some((f) => f.startsWith('samesite')),
  };
}

// ── IO: fetch + build context ────────────────────────────────────────────────────

/** Lowercase a Headers object into a plain record + pull Set-Cookie lines. */
function collect(res: { headers: Headers }): { headers: Record<string, string>; cookies: string[] } {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => { headers[key.toLowerCase()] = value; });
  // getSetCookie() preserves multiple cookies; a joined get() collapses them, so
  // prefer it and fall back for runtimes without it.
  const getter = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const cookies = typeof getter === 'function'
    ? getter.call(res.headers)
    : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
  return { headers, cookies };
}

/**
 * Scan a normalized target: one primary GET (headers) + one best-effort http probe
 * (upgrade check), then run the pure checks. `fetchFn` is injectable for tests.
 */
export async function scanWebTarget(
  target: string,
  opts: { fetchFn?: typeof fetch; signal?: AbortSignal } = {},
): Promise<WebScanResult> {
  const origin = normalizeScanTarget(target);
  const doFetch = opts.fetchFn ?? fetch;
  const u = new URL(origin);

  // Primary request — follow redirects so we read the headers of the page actually served.
  const ua = { 'user-agent': 'BuilderforceSecurityScanner/1.0 (+https://builderforce.ai)' };
  const res = await doFetch(origin, {
    method: 'GET',
    redirect: 'follow',
    signal: opts.signal,
    headers: ua,
  });
  const { headers, cookies } = collect(res);

  // Read a bounded slice of the body for the content checks (mixed content /
  // directory listing). Only HTML is worth reading; a read failure degrades to "".
  let body = '';
  const ctype = (headers['content-type'] ?? '').toLowerCase();
  if (ctype.includes('html') || ctype === '') {
    try { body = (await (res as Response).text()).slice(0, BODY_SNIPPET_LIMIT); } catch { body = ''; }
  }

  // http upgrade probe (only meaningful when the origin is https).
  let httpProbe: ScanContext['httpProbe'] = 'unknown';
  if (u.protocol === 'https:') {
    try {
      const httpUrl = `http://${u.host}${u.pathname}${u.search}`;
      const probe = await doFetch(httpUrl, { method: 'GET', redirect: 'manual', signal: opts.signal });
      const loc = probe.headers.get('location') ?? '';
      if ((probe.status >= 300 && probe.status < 400 && /^https:/i.test(loc)) || probe.status === 0) {
        httpProbe = 'upgraded';
      } else if (probe.status >= 200 && probe.status < 300) {
        httpProbe = 'not-upgraded';
      } else {
        httpProbe = 'upgraded'; // any non-200 over http (incl. connection refused surfaced as throw) = not plainly served
      }
    } catch {
      httpProbe = 'unknown';
    }
  }

  const ctx: ScanContext = {
    origin: `${u.protocol}//${u.host}`.toLowerCase(),
    finalUrl: (res as Response).url || origin,
    headers,
    cookies,
    httpProbe,
  };

  // Exposed-file probes — fired in parallel, best-effort. Each reads a bounded body
  // so the content-signature check can reject SPA catch-all 200s.
  const probes = await Promise.all(ALL_PROBE_PATHS.map(async (path): Promise<ProbeResult> => {
    try {
      const pr = await doFetch(`${ctx.origin}${path}`, { method: 'GET', redirect: 'manual', signal: opts.signal, headers: ua });
      let pbody = '';
      try { pbody = (await (pr as Response).text()).slice(0, 4_000); } catch { pbody = ''; }
      return { path, status: pr.status, body: pbody };
    } catch {
      return { path, status: 0, body: '' };
    }
  }));

  const findings = [
    ...evaluateHeaders(ctx),
    ...evaluateBody(ctx, body),
    ...evaluateExposures(ctx, probes),
  ];
  return {
    origin: ctx.origin,
    finalUrl: ctx.finalUrl,
    findings,
    score: scoreFindings(findings),
    server: headers['server'] ?? null,
  };
}
