/**
 * The API drawer's *Try it · Send*, performed by the EXTENSION so the webview has no CORS problem.
 * It is a request the person composed in the drawer, so it goes only where the person's own
 * machine is: the literals `localhost`, `127.0.0.1` and `[::1]`, or an origin they listed in the
 * USER-level `builderforce.knowledge.devOrigins` (a workspace file can never widen it).
 *
 * The rule is enforced in layers, all in this pure module (the transport is injected):
 *   1. shape      the webview's message is validated at runtime (types, sizes, method, headers);
 *   2. target     the RAW url text is read for its authority, never trusted to the URL parser's
 *                 normalisation (`2130706433`, `0x7f.1`, `localhost.`, `a@b`, `%2e`, `\` are refused);
 *   3. port       well-known data-store / control ports are denied;
 *   4. consent    the first send to each origin:port in a session asks the person;
 *   5. address    the transport resolves through {@link guardedLookup}: a loopback name must resolve
 *                 to loopback, so DNS rebinding cannot redirect it;
 *   6. response   a 3xx is returned as it is (never followed), the body is capped in BYTES while it
 *                 streams, and ONE deadline covers connect, headers and body.
 * One request runs at a time. A network failure is one generic error: the reason would map the network.
 */

import type { KnowledgeTryRequest, KnowledgeTryResponse } from "./knowledgeProtocol";

export type TryRefusal = "shape" | "url" | "method" | "origin" | "port" | "declined" | "busy" | "size" | "connect" | "timeout";

/** A refusal or a failure; the host turns the code into the person's language. */
export class TryRequestError extends Error {
  constructor(readonly code: TryRefusal, message: string) {
    super(message);
    this.name = "TryRequestError";
  }
}

export const TRY_TIMEOUT_MS = 15_000;
/** The most response body BYTES returned to the webview. */
export const TRY_BODY_CAP = 256 * 1024;
export const TRY_URL_MAX = 8 * 1024;
export const TRY_REQUEST_BODY_MAX = 256 * 1024;
export const TRY_HEADERS_MAX = 20;
export const TRY_HEADER_LEN_MAX = 1024;

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const NO_BODY = new Set(["GET", "HEAD"]);
/** The only request headers that cross: everything else (cookies, auth, host) is dropped. */
const HEADER_ALLOW = new Set(["content-type", "accept"]);
/** Docker, Redis, Elasticsearch, memcached, CouchDB, kubelet, etcd, MongoDB, Postgres, MySQL. */
const DENIED_PORTS = new Set([2375, 2376, 6379, 9200, 9300, 11211, 5984, 10250, 10255, 2379, 27017, 5432, 3306]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

// ── addresses ──────────────────────────────────────────────────────────────────

const octets = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((n) => n <= 255) ? o : null;
};

/** Link-local, metadata, private, CGNAT, unspecified and v4-mapped addresses: never a dev origin. */
export function isBlockedAddress(address: string): boolean {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = octets(host);
  if (v4) {
    const [a, b] = v4 as [number, number];
    return a === 0 || a === 10 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (!host.includes(":")) return false;
  return host === "::" || host.startsWith("::ffff:") || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
}

export type AddressMode = "loopback" | "dev";

const isLoopbackAddress = (address: string): boolean => {
  const host = address.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = octets(host);
  return v4 ? v4[0] === 127 : host === "::1";
};

/** Whether a RESOLVED address is acceptable: loopback names only reach loopback; dev origins anything not blocked. */
export const acceptAddress = (mode: AddressMode, address: string): boolean => (mode === "loopback" ? isLoopbackAddress(address) : !isBlockedAddress(address));

type LookupCb = (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void;
export type LookupFn = (hostname: string, options: object, cb: LookupCb) => void;

/** Wraps a DNS lookup so a name resolving outside the mode is refused at connect time (stops DNS rebinding). */
export function guardedLookup(inner: LookupFn, mode: AddressMode): LookupFn {
  return (hostname, options, cb) => inner(hostname, options, (err, address, family) => {
    if (err) return cb(err, address, family);
    const list = Array.isArray(address) ? address.map((a) => a.address) : [address];
    if (list.length === 0 || !list.every((a) => acceptAddress(mode, a))) return cb(new Error("address refused"), "", 0);
    return cb(null, address, family);
  });
}

// ── configured origins ─────────────────────────────────────────────────────────

/** The origin of each configured dev origin that parses as http(s) and is not a blocked address literal. */
export function devOriginsOf(configured: readonly unknown[] | undefined): string[] {
  const out: string[] = [];
  for (const entry of configured ?? []) {
    if (typeof entry !== "string") continue;
    try {
      const url = new URL(entry.trim());
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && !isBlockedAddress(url.hostname)) out.push(url.origin);
    } catch { /* not an address: ignored */ }
  }
  return out;
}

/**
 * Reads the setting from `WorkspaceConfiguration.inspect()`: ONLY the person's user-level value counts.
 * A workspace or folder value (a `.vscode/settings.json` that came with a cloned repo) is ignored.
 */
export const devOriginsFromInspect = (inspected: { globalValue?: unknown } | undefined): string[] =>
  devOriginsOf(Array.isArray(inspected?.globalValue) ? (inspected.globalValue as unknown[]) : undefined);

// ── the target ─────────────────────────────────────────────────────────────────

export interface Target { url: URL; mode: AddressMode; port: number; key: string }

/** The authority of the RAW text (between `://` and the first `/ ? # \`), or null when it is not http(s). */
function rawAuthority(raw: string): string | null {
  const m = /^https?:\/\/([^/?#\\]*)/i.exec(raw);
  return m ? m[1]! : null;
}

/** Decides where a request may go, from the raw text; throws a refusal otherwise. */
export function targetOf(raw: string, devOrigins: readonly string[]): Target {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new TryRequestError("url", "not an address");
  }
  const authority = rawAuthority(raw);
  if (authority === null || /[@%\s]/.test(authority) || url.username || url.password) throw new TryRequestError("origin", "origin not allowed");
  const rawHost = authority.replace(/:\d*$/, "").toLowerCase();
  const loopback = LOOPBACK_HOSTS.has(rawHost) && url.hostname === (rawHost === "localhost" ? "localhost" : rawHost);
  if (!loopback && !devOrigins.includes(url.origin)) throw new TryRequestError("origin", "origin not allowed");
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  if (DENIED_PORTS.has(port)) throw new TryRequestError("port", "port not allowed");
  return { url, mode: loopback ? "loopback" : "dev", port, key: `${url.protocol}//${url.hostname}:${port}` };
}

// ── the request's shape ────────────────────────────────────────────────────────

export interface CleanRequest { method: string; url: string; headers: Record<string, string>; body?: string }

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v) as never);

/** Validates the webview's message at runtime and keeps only the allow-listed headers. */
export function cleanRequest(raw: unknown): CleanRequest {
  if (!isPlainObject(raw)) throw new TryRequestError("shape", "request is not an object");
  const { url, method, headers, body } = raw;
  if (typeof url !== "string" || url.length > TRY_URL_MAX) throw new TryRequestError("shape", "bad url");
  if (typeof method !== "string" || !METHODS.has(method)) throw new TryRequestError("method", "bad method");
  if (body !== undefined && (typeof body !== "string" || body.length > TRY_REQUEST_BODY_MAX)) throw new TryRequestError("shape", "bad body");
  const kept: Record<string, string> = {};
  if (headers !== undefined) {
    if (!isPlainObject(headers)) throw new TryRequestError("shape", "bad headers");
    const entries = Object.entries(headers);
    if (entries.length > TRY_HEADERS_MAX) throw new TryRequestError("shape", "too many headers");
    for (const [name, value] of entries) {
      if (typeof value !== "string" || name.length > TRY_HEADER_LEN_MAX || value.length > TRY_HEADER_LEN_MAX) throw new TryRequestError("shape", "bad header");
      if (HEADER_ALLOW.has(name.toLowerCase())) kept[name.toLowerCase()] = value;
    }
  }
  return { method, url, headers: kept, ...(body !== undefined && !NO_BODY.has(method) ? { body } : {}) };
}

// ── the run ────────────────────────────────────────────────────────────────────

export interface OpenRequest { method: string; url: URL; headers: Record<string, string>; body?: string; mode: AddressMode }

export interface OpenedResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  /** The body as it arrives. */
  body: AsyncIterable<Uint8Array>;
  /** Closes the socket. */
  destroy(): void;
}

export interface TryPorts {
  /** Sends the request without following redirects or using a proxy; `signal` aborts connect and headers. */
  open(req: OpenRequest, signal: AbortSignal): Promise<OpenedResponse>;
  /** Asks the person whether this origin:port may be sent to. */
  confirm(key: string): Promise<boolean>;
  now(): number;
}

export interface TryRunner {
  run(raw: unknown, devOrigins: readonly string[]): Promise<KnowledgeTryResponse>;
}

const flat = (h: OpenedResponse["headers"]): Record<string, string> =>
  Object.fromEntries(Object.entries(h).flatMap(([k, v]) => (v === undefined ? [] : [[k, Array.isArray(v) ? v.join(", ") : v]])));

/** One runner per extension session: it remembers the origins the person approved and allows one request at a time. */
export function createTryRunner(ports: TryPorts, limits: { timeoutMs?: number; bodyCap?: number } = {}): TryRunner {
  const timeoutMs = limits.timeoutMs ?? TRY_TIMEOUT_MS;
  const cap = limits.bodyCap ?? TRY_BODY_CAP;
  const approved = new Set<string>();
  let busy = false;

  async function send(req: CleanRequest, target: Target): Promise<KnowledgeTryResponse> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const deadline = new Promise<never>((_resolve, reject) => {
      abort.signal.addEventListener("abort", () => reject(new TryRequestError("timeout", "no answer in time")), { once: true });
    });
    deadline.catch(() => undefined);
    const started = ports.now();
    let opened: OpenedResponse | undefined;
    try {
      opened = await Promise.race([ports.open({ method: req.method, url: target.url, headers: req.headers, ...(req.body !== undefined ? { body: req.body } : {}), mode: target.mode }, abort.signal), deadline]);
      const declared = Number(Array.isArray(opened.headers["content-length"]) ? NaN : opened.headers["content-length"]);
      if (Number.isFinite(declared) && declared > cap) throw new TryRequestError("size", "response too large");
      const chunks: Uint8Array[] = [];
      let total = 0;
      let truncated = false;
      const it = opened.body[Symbol.asyncIterator]();
      while (!truncated) {
        const next = await Promise.race([it.next(), deadline]);
        if (next.done) break;
        const room = cap - total;
        const cut = next.value.length > room;
        const chunk = cut ? next.value.subarray(0, room) : next.value;
        chunks.push(chunk);
        total += chunk.length;
        if (total >= cap) {
          // A body of exactly `cap` bytes is not marked: only a cut chunk or a following one is.
          truncated = cut || !(await Promise.race([it.next(), deadline])).done;
          break;
        }
      }
      if (truncated) opened.destroy();
      const merged = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { merged.set(c, at); at += c.length; }
      return { status: opened.status, headers: flat(opened.headers), body: new TextDecoder().decode(merged), ms: ports.now() - started, ...(truncated ? { truncated: true } : {}) };
    } catch (error) {
      opened?.destroy();
      if (error instanceof TryRequestError) throw error;
      throw new TryRequestError(abort.signal.aborted ? "timeout" : "connect", "request failed");
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async run(raw, devOrigins) {
      if (busy) throw new TryRequestError("busy", "another request is running");
      busy = true;
      try {
        const req = cleanRequest(raw);
        const target = targetOf(req.url, devOrigins);
        if (!approved.has(target.key)) {
          if (!(await ports.confirm(target.key))) throw new TryRequestError("declined", "the person declined");
          approved.add(target.key);
        }
        return await send(req, target);
      } finally {
        busy = false;
      }
    },
  };
}

/**
 * The error the view is shown for a failed Send. A refusal speaks in the person's language; anything
 * else is "could not connect" to the person, and the real error goes to `log` (the BuilderForce
 * output channel) so a failure can be diagnosed.
 */
export function userFailureOf(error: unknown, text: (code: TryRefusal) => string, log: (line: string) => void): Error {
  if (error instanceof TryRequestError) return new Error(text(error.code));
  log(`knowledge tryRequest failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  return new Error(text("connect"));
}
