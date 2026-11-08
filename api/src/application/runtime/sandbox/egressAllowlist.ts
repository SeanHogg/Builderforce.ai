/**
 * Egress allowlist for the run sandbox container (security gap G1).
 *
 * The sandbox needs SOME network — it clones through the Worker's git proxy, installs
 * packages and runs builds — but never "anywhere". `AgentContainerDO` starts an exec
 * container with `enableInternet = false` and routes ALL its outbound HTTP(S) through
 * {@link egressAllowlistHandler} (the `@cloudflare/containers` outbound interception,
 * enforced by the platform, not by anything the agent's shell can unset). This module is
 * the ONE place the allowed hosts, methods and paths are declared, the one place the
 * enforcement flag is read, and the decision function + handler.
 */
import type { OutboundHandler } from '@cloudflare/containers';
import type { Env } from '../../../env';

/**
 * The enforcement switch, read in ONE place. Off (default) ⇒ the sandbox behaves exactly as
 * before this feature: open internet, and none of the library's interception path runs.
 * 'true' enables the allowlist.
 */
export function egressEnforced(env: Pick<Env, 'SANDBOX_EGRESS_ENFORCE'> | null | undefined): boolean {
  return env?.SANDBOX_EGRESS_ENFORCE === 'true';
}

/** Run sandboxes are the `exec:<id>` instances; web scans and managed hosts use other names. */
export function isRunSandboxName(name: string | undefined | null): boolean {
  return typeof name === 'string' && name.startsWith('exec:');
}

/** Where the Worker answers when `INTERNAL_API_BASE_URL` is unset. */
export const DEFAULT_INTERNAL_API_BASE_URL = 'https://api.builderforce.ai';

/** THE base URL the container reaches this Worker on — used by the open spec AND the allowlist, so they cannot disagree. */
export function internalApiBaseUrl(env: Pick<Env, 'INTERNAL_API_BASE_URL'> | null | undefined): string {
  return env?.INTERNAL_API_BASE_URL ?? DEFAULT_INTERNAL_API_BASE_URL;
}

/** The hostname the container reaches this Worker on — from the environment, never from the
 *  open body (which is request-controlled). Null when unparseable or not a name. */
export function internalApiHost(env: Pick<Env, 'INTERNAL_API_BASE_URL'> | null | undefined): string | null {
  try {
    const host = normalizeEgressHost(new URL(internalApiBaseUrl(env)).hostname);
    return host && !isIpLiteral(host) && !isDeniedName(host) ? host : null;
  } catch { return null; }
}

const READ = ['GET', 'HEAD'] as const;

const GIT_UPLOAD_PACK_CONTENT_TYPE = 'application/x-git-upload-pack-request';

export interface EgressRule {
  /** Host pattern: exact, or `*.x` for subdomains of x only. */
  host: string;
  /** Methods allowed on any path. */
  methods: readonly string[];
  /** Additionally allow POST to paths matching this, with the given request content-type (git smart-HTTP fetch). */
  post?: { path: RegExp; contentType: string };
}

/**
 * Every third-party host a sandbox may reach, with what it may do there. Add a host here,
 * not at a call site. The Worker's own host is not listed: it comes from the environment and
 * is scoped to the container-git proxy and the container-op callback ({@link internalPathAllowed}).
 *
 * Reviewed for "a GET makes the host fetch an arbitrary URL for the caller" (an SSRF-style
 * relay that would turn a read-only host into an exfiltration channel): none of the hosts
 * below do that. `proxy.golang.org` / `sum.golang.org` DO (a GET of an unknown module path
 * makes the proxy fetch it from a caller-chosen server) and are deliberately absent.
 */
export const EGRESS_RULES: readonly EgressRule[] = [
  // The clone itself goes through the Worker's git proxy; this is for GitHub-hosted dependencies.
  { host: 'github.com', methods: READ, post: { path: /^\/[^/]+\/[^/]+(\.git)?\/git-upload-pack$/, contentType: GIT_UPLOAD_PACK_CONTENT_TYPE } },
  { host: 'api.github.com', methods: READ },
  { host: 'codeload.github.com', methods: READ },
  { host: 'objects.githubusercontent.com', methods: READ },
  { host: '*.githubusercontent.com', methods: READ },
  // Package registries.
  { host: 'registry.npmjs.org', methods: READ },
  { host: 'registry.yarnpkg.com', methods: READ },
  { host: 'pypi.org', methods: READ },
  { host: 'files.pythonhosted.org', methods: READ },
  // Common read-only toolchain / dependency hosts.
  { host: 'nodejs.org', methods: READ },
  { host: 'crates.io', methods: READ },
  { host: 'static.crates.io', methods: READ },
  { host: 'index.crates.io', methods: READ },
  { host: 'rubygems.org', methods: READ },
  { host: 'repo.maven.apache.org', methods: READ },
  { host: 'repo1.maven.org', methods: READ },
  { host: 'deno.land', methods: READ },
  { host: 'jsr.io', methods: READ },
];

/** Names that reach the host/platform itself or a metadata service, whatever they resolve to. */
const ALWAYS_DENIED_NAMES: readonly string[] = [
  'localhost',
  '*.localhost',
  '*.local',
  '*.internal',
  'metadata.google.internal',
  'metadata',
  'instance-data',
];

export type EgressVerdict = { allowed: true } | { allowed: false; reason: string; detail?: string };

/** Lower-case, drop the trailing dot and IPv6 brackets. */
export function normalizeEgressHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  while (h.endsWith('.')) h = h.slice(0, -1);
  return h;
}

/** Any IP literal (v4 dotted/decimal/hex, or v6). Allowlisted hosts are names, so every
 *  literal is refused — which covers 169.254.0.0/16, 100.100.100.200, fd00::/8 and the rest. */
export function isIpLiteral(host: string): boolean {
  const h = normalizeEgressHost(host);
  if (h.includes(':')) return true; // IPv6 (a hostname never has a colon)
  if (/^[0-9.]+$/.test(h)) return true; // dotted or single-number IPv4
  if (/^0x[0-9a-f]+$/i.test(h) || /^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){1,3}$/i.test(h)) return true;
  return false;
}

/** `*.example.com` matches `a.example.com` and `a.b.example.com`; a bare pattern matches exactly. */
export function hostMatchesPattern(host: string, pattern: string): boolean {
  const h = normalizeEgressHost(host);
  const p = normalizeEgressHost(pattern);
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // ".example.com"
    return h.length > suffix.length && h.endsWith(suffix);
  }
  return h === p;
}

function isDeniedName(h: string): boolean {
  return ALWAYS_DENIED_NAMES.some((p) => hostMatchesPattern(h, p));
}

/**
 * The only Worker routes a run sandbox calls: the container-op callback and THIS run's git
 * proxy (`runtimeRoutes.ts`: `/internal/container-op`, `/internal/container-git/:id.git/{info/refs,
 * git-upload-pack,git-receive-pack}`, mounted at `/api/runtime`).
 */
export function internalPathAllowed(path: string, executionId: number | null): boolean {
  if (path === '/api/runtime/internal/container-op') return true;
  if (executionId === null) return false;
  const prefix = `/api/runtime/internal/container-git/${executionId}.git/`;
  return path.startsWith(prefix) && ['info/refs', 'git-upload-pack', 'git-receive-pack'].includes(path.slice(prefix.length));
}

export interface EgressRequestContext {
  /** The Worker's own hostname (from the environment) and the run it serves. */
  internal?: { host: string | null; executionId: number | null };
  /** The request's content-type header, for the git POST rule. */
  contentType?: string | null;
}

/**
 * Decide one outbound request. The Worker's own host is allowed any method, but only on the
 * routes in {@link internalPathAllowed}. `reason` is safe to log (no path, no attacker-chosen
 * value beyond the host); `detail` carries the path for the 403 body only.
 */
export function checkEgress(host: string, method = 'GET', path = '/', ctx: EgressRequestContext = {}): EgressVerdict {
  const h = normalizeEgressHost(host);
  const m = method.toUpperCase();
  if (!h) return { allowed: false, reason: 'empty host' };
  if (isIpLiteral(h)) return { allowed: false, reason: 'IP literals are not reachable (link-local, private and metadata ranges included)' };
  if (isDeniedName(h)) return { allowed: false, reason: 'internal or metadata name' };
  const internalHost = ctx.internal?.host ? normalizeEgressHost(ctx.internal.host) : null;
  if (internalHost && h === internalHost) {
    return internalPathAllowed(path, ctx.internal?.executionId ?? null)
      ? { allowed: true }
      : { allowed: false, reason: 'path is not one this run may call on its own API host', detail: `${m} ${path}` };
  }
  const rule = EGRESS_RULES.find((r) => hostMatchesPattern(h, r.host));
  if (!rule) return { allowed: false, reason: 'not on the sandbox egress allowlist' };
  if (rule.methods.includes(m)) return { allowed: true };
  if (m === 'POST' && rule.post && rule.post.path.test(path)
      && (ctx.contentType ?? '').split(';')[0]!.trim().toLowerCase() === rule.post.contentType) return { allowed: true };
  return { allowed: false, reason: `${m} is not permitted on this host`, detail: `${m} ${path}` };
}

/** Last two labels, or just the TLD for a host with two labels or fewer — enough to attribute
 *  a denial without logging an attacker-chosen name. */
function loggableDomain(host: string): string {
  const h = normalizeEgressHost(host);
  if (h.includes(':')) return 'ipv6';
  const labels = h.split('.').filter(Boolean);
  return labels.length <= 2 ? (labels[labels.length - 1] ?? '') : labels.slice(-2).join('.');
}

/** FNV-1a 32-bit, hex: a short stable fingerprint of the full hostname. */
function shortHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) { h ^= value.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

export interface EgressHandlerParams extends Record<string, unknown> {
  executionId: number | null;
  /** The Worker's own hostname, computed from the environment by the DO. */
  internalHost: string | null;
}

/**
 * The catch-all outbound handler for an exec sandbox. Allowed requests are fetched from the
 * Worker over https; redirects are returned to the container (`manual`) so each hop is
 * re-checked; `Cookie` and `Authorization` never leave for a third-party host. A denial is
 * logged with the run it belongs to (domain + hash, never the full attacker-chosen name or
 * the path) and answered 403 with a body naming host, method and path, which git / npm / pip
 * print into the tool output.
 */
export const egressAllowlistHandler: OutboundHandler<unknown, EgressHandlerParams> = async (req, _env, ctx) => {
  const url = new URL(req.url);
  const internal = { host: ctx.params?.internalHost ?? null, executionId: ctx.params?.executionId ?? null };
  const verdict = checkEgress(url.hostname, req.method, url.pathname, { internal, contentType: req.headers.get('content-type') });
  if (verdict.allowed) {
    const headers = new Headers(req.headers);
    if (!internal.host || normalizeEgressHost(url.hostname) !== normalizeEgressHost(internal.host)) {
      headers.delete('cookie');
      headers.delete('authorization');
    }
    const forwarded = new Request(req, { redirect: 'manual', headers });
    if (url.protocol !== 'http:') return fetch(forwarded);
    url.protocol = 'https:';
    return fetch(new Request(url.toString(), forwarded));
  }
  console.warn(JSON.stringify({
    event: 'sandbox.egress.denied',
    domain: loggableDomain(url.hostname),
    hostHash: shortHash(normalizeEgressHost(url.hostname)),
    method: req.method,
    reason: verdict.reason,
    executionId: ctx.params?.executionId ?? null,
    containerId: ctx.containerId,
  }));
  return new Response(
    `Sandbox egress denied: "${url.hostname}" ${verdict.detail ?? req.method} is not allowed (${verdict.reason}). Only GitHub, the package registries and this run's own API routes are reachable.`,
    { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  );
};
