/**
 * Cloud (Worker/DO) `web` capability — the Worker-safe backing for the shared
 * `@builderforce/agent-tools` `web_fetch` tool. Same tool contract as every other
 * surface (Dependency Inversion); only the backing differs. On Cloudflare the fetch
 * is the platform `fetch`, so there is no HTTP client to configure — what this module
 * genuinely owns is the SAFETY envelope around it:
 *
 *   1. **Egress policy** ({@link classifyWebEgress}) — an agent-supplied URL is
 *      untrusted input. A Worker's `fetch` can reach the internal network of whatever
 *      it is peered with, and `http://169.254.169.254/` is the classic cloud
 *      credential-metadata endpoint, so a prompt-injected page could otherwise turn
 *      the agent into a confused deputy (SSRF). Only `http(s)` to a non-private,
 *      non-loopback, non-link-local host is allowed. Pure → unit-testable.
 *   2. **Bounded read** — the body is streamed and cut at {@link MAX_FETCH_BYTES} so a
 *      multi-hundred-MB download can neither exhaust the isolate nor blow the model's
 *      context, and the whole call carries an `AbortSignal.timeout` so a hung origin
 *      cannot stall an alarm tick into the orphan reaper.
 *   3. **HTML → text** ({@link htmlToText}) — the model wants prose, not markup; raw
 *      HTML is mostly tokens it pays for and cannot use.
 *
 * Fetches are served through the canonical read-through cache (`getOrSetCached`, L1
 * Map + L2 KV) keyed by the normalized URL, so the very common "agent re-reads the
 * same doc page across steps / across ticks" costs one real egress. A FAILED fetch is
 * invalidated immediately after (a transient 502 must not be pinned for the TTL).
 *
 * `search` is the second half, and it is CONDITIONAL. Search is a metered third-party
 * API with no platform-funded key, so the backing is only present when the tenant's own
 * BYO key resolves (`webSearchCredential.ts` → `integration_credentials`). No key means
 * no `search` method here, which means the engine omits `web.search` from the run's
 * capability set, which means the registry never advertises `web_search` — the surface
 * behaves exactly as it did before search existed. The agent is never handed a tool
 * that is certain to fail. The vendor itself is behind a port (`webSearchVendors.ts`).
 */

import type { WebCapability, WebFetchResult, WebSearchResult } from '@builderforce/agent-tools';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import { enforceOutboundFetchCap, recordOutboundFetch } from '../web/outboundFetchLedger';
import type { WebSearchVendor } from './webSearchVendors';

/** Hard ceiling on bytes read off one response. Beyond this the content is truncated
 *  (and flagged) rather than the fetch failing — a truncated doc is still useful. */
export const MAX_FETCH_BYTES = 512 * 1024;
/** Characters of extracted text handed to the model (a full page of prose is ~10k). */
export const MAX_TEXT_CHARS = 60_000;
/** Whole-call deadline. Well under a DO alarm tick's budget so a hung origin can never
 *  be mistaken for a silent (crashed) run by the orphan reaper. */
export const FETCH_TIMEOUT_MS = 15_000;

const CACHE_KV_TTL_SECONDS = 600;
const CACHE_L1_TTL_MS = 60_000;

/** Hostnames that always resolve inside the deployment, whatever their A record says. */
const BLOCKED_HOST_SUFFIXES = ['.local', '.localhost', '.internal', '.home.arpa'];
const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal']);

/** True for an IPv4 literal in a range that is not routable on the public internet:
 *  this-network, private (RFC1918), loopback, link-local (incl. the 169.254.169.254
 *  cloud metadata endpoint), CGNAT, IETF protocol assignments, benchmarking,
 *  multicast, and reserved. */
function isPrivateIPv4(octets: IPv4): boolean {
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  return a >= 224; // multicast (224/4) + reserved (240/4), incl. 255.255.255.255
}

/** The four octets of an IPv4 literal — a fixed-length tuple so the range checks above
 *  can index it without a possibly-undefined guard on every octet. */
type IPv4 = [number, number, number, number];

/** Parse a dotted-quad into its octets, or null when `host` is not an IPv4 literal. */
function parseIPv4(host: string): IPv4 | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    octets.push(n);
  }
  return octets as IPv4;
}

/**
 * The egress policy. Returns `null` when `rawUrl` may be fetched, else a short human
 * reason the agent sees as the tool error. Deliberately a DENY-list of address ranges
 * over an allow-list of hosts: the agent's legitimate job is reading arbitrary public
 * documentation, so hosts cannot be enumerated — but the ranges that must never be
 * reachable from an agent-controlled URL are a small, closed set.
 *
 * Caveat this cannot close: the check is on the URL's LITERAL host, so a public
 * hostname whose DNS resolves into a private range (DNS rebinding) still passes.
 * Cloudflare Workers expose no pre-connect resolved-IP hook, so that residual is
 * accepted here and mitigated by the fact that this surface has no internal services
 * peered to it. Pure → unit-testable.
 */
export function classifyWebEgress(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return 'not a valid absolute URL — pass a full http(s) URL including the scheme';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return `scheme '${u.protocol.replace(':', '')}' is not allowed — only http and https can be fetched`;
  }

  // WHATWG `URL.hostname` KEEPS the brackets on an IPv6 literal (`[::1]`), so strip
  // them before any address matching — leaving them on silently defeated every IPv6
  // rule below.
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host) return 'the URL has no host';
  if (BLOCKED_HOSTS.has(host)) return `'${host}' is a loopback/metadata host and cannot be fetched`;
  if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return `'${host}' is an internal-network hostname and cannot be fetched`;
  }

  const v4 = parseIPv4(host);
  if (v4 && isPrivateIPv4(v4)) {
    return `'${host}' is a private/loopback/link-local address and cannot be fetched`;
  }

  if (host.includes(':')) {
    // IPv4-mapped IPv6 — judge the address it actually wraps. `URL` canonicalizes the
    // dotted form (`::ffff:169.254.169.254`) into hex groups (`::ffff:a9fe:a9fe`), so
    // BOTH spellings must be decoded or the mapped form is a trivial bypass.
    const mapped = parseMappedIPv4(host);
    if (mapped) {
      return isPrivateIPv4(mapped)
        ? `'${host}' maps to a private/loopback address and cannot be fetched`
        : null;
    }
    if (/^(::1?|0(:0){7}|0(:0){6}:1)$/.test(host)) {
      return `'${host}' is the IPv6 loopback/unspecified address and cannot be fetched`;
    }
    // fc00::/7 unique-local, fe80::/10 link-local.
    if (/^f[cd][0-9a-f]{0,2}:/.test(host)) return `'${host}' is a unique-local IPv6 address and cannot be fetched`;
    if (/^fe[89ab][0-9a-f]?:/.test(host)) return `'${host}' is a link-local IPv6 address and cannot be fetched`;
  }

  return null;
}

/** Decode an IPv4-mapped IPv6 host (`::ffff:1.2.3.4` or its canonical `::ffff:102:304`)
 *  into the IPv4 address it wraps, or null when `host` is not one. */
function parseMappedIPv4(host: string): IPv4 | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
  if (dotted?.[1]) return parseIPv4(dotted[1]);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (hex?.[1] && hex[2]) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  }
  return null;
}

/**
 * Reduce an HTML document to the readable text a model can actually use: drop the
 * non-content elements wholesale (script/style/noscript/head-ish chrome), turn block
 * boundaries into newlines so paragraphs and list items stay separated, strip the
 * remaining tags, then decode the handful of entities that survive. Intentionally a
 * regex reduction, not a parser — a DOM parser is not available on the Worker and the
 * goal is legible prose, not fidelity. Pure → unit-testable.
 */
export function htmlToText(html: string): string {
  return html
    // 1. Drop what carries no readable content at all.
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    // 2. Flatten SOURCE whitespace FIRST. A newline in the markup is not structure —
    //    HTML collapses it like any other whitespace — so it must be neutralized
    //    BEFORE step 3 introduces the newlines that ARE structure. Doing these two in
    //    the other order cannot tell an authored line-wrap from a paragraph boundary,
    //    and every hand-formatted page comes out shredded into one-word lines.
    .replace(/\s+/g, ' ')
    // 3. Only now do the block boundaries the markup actually declares become newlines.
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6]|blockquote|pre|ul|ol|table)\s*>/gi, '\n\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n\n')
    // 4. Everything else is inline markup — it separates words, so it becomes a space.
    .replace(/<[^>]+>/g, ' ')
    // 5. Decode the entities that survive. `&amp;` goes LAST so a double-encoded
    //    `&amp;lt;` yields the literal text `&lt;` instead of being re-decoded to `<`.
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/gi, '&')
    // 6. Tidy: collapse the runs of spaces and stacked blank lines the steps above
    //    left behind, so adjacent block tags yield ONE paragraph break, not four.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ ?\n[\n ]*/g, '\n\n')
    .trim();
}

/** True for a content type this surface can turn into text for the model. Anything
 *  else (image/pdf/zip/binary) is refused with its type named, so the agent stops
 *  retrying instead of being handed megabytes of mojibake. */
function isTextualContentType(contentType: string): boolean {
  const t = contentType.toLowerCase();
  return (
    t.startsWith('text/') ||
    t.includes('json') ||
    t.includes('xml') ||
    t.includes('javascript') ||
    t.includes('x-yaml') ||
    t.includes('yaml') ||
    t === ''
  );
}

/** Read at most {@link MAX_FETCH_BYTES} off the response body, decoding as UTF-8.
 *  Streams so an oversized body is abandoned rather than buffered whole. Exported so
 *  the search vendors (`webSearchVendors.ts`) read their JSON under the SAME cap
 *  instead of growing a second, unbounded HTTP path. */
export async function readCapped(res: Response): Promise<{ text: string; truncated: boolean }> {
  const body = res.body;
  if (!body) return { text: '', truncated: false };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = MAX_FETCH_BYTES - total;
      if (value.byteLength >= room) {
        chunks.push(value.subarray(0, room));
        total += room;
        truncated = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => { /* already closed */ });
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { joined.set(c, offset); offset += c.byteLength; }
  // Default TextDecoder is utf-8 and non-fatal, so a body cut mid-multibyte-sequence
  // (the truncation case) decodes to a replacement char instead of throwing.
  return { text: new TextDecoder().decode(joined), truncated };
}

/** One real (uncached) fetch, fully bounded. Never throws — every failure comes back
 *  as `{ ok: false, error }` so a bad URL costs the agent one turn, not the run. */
async function fetchUncached(url: string): Promise<WebFetchResult> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        // Identify the agent honestly, and ask for prose over markup where a server
        // content-negotiates.
        'User-Agent': 'BuilderforceAgent/1.0 (+https://builderforce.ai)',
        Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5',
      },
    });
    // A redirect chain can land somewhere the policy would have refused up front, so
    // re-run it on the FINAL URL — otherwise an open redirector on a public host is a
    // trivial bypass straight back to the metadata endpoint.
    const finalUrl = res.url || url;
    const landedBlocked = classifyWebEgress(finalUrl);
    if (landedBlocked) return { ok: false, url: finalUrl, error: `redirected to a blocked address: ${landedBlocked}` };

    const contentType = ((res.headers.get('content-type') ?? '').split(';')[0] ?? '').trim();
    if (!isTextualContentType(contentType)) {
      return { ok: false, url: finalUrl, status: res.status, contentType, error: `content type '${contentType}' is not readable as text` };
    }
    const { text, truncated: bytesTruncated } = await readCapped(res);
    const isHtml = contentType.includes('html') || /^\s*<(!doctype|html)\b/i.test(text);
    const extracted = isHtml ? htmlToText(text) : text.trim();
    const content = extracted.slice(0, MAX_TEXT_CHARS);
    return {
      ok: res.ok,
      url: finalUrl,
      status: res.status,
      contentType,
      content,
      truncated: bytesTruncated || extracted.length > MAX_TEXT_CHARS,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return { ok: false, url, error: timedOut ? `timed out after ${FETCH_TIMEOUT_MS}ms` : `fetch failed: ${msg}` };
  }
}

/** Everything the optional `search` half needs: which vendor adapter to call, the
 *  tenant's resolved key, and (when the run has a DB) the tenant to meter the query
 *  against. Assembled by the engine from {@link resolveWebSearchCredential}. */
export interface CloudWebSearchBacking {
  vendor: WebSearchVendor;
  apiKey: string;
  /** Consumption metering. Search bills per QUERY, so a real (uncached) query is one
   *  outbound fetch on the tenant's meter — same unit, same ledger as the Brain's
   *  `/fetch-url` proxy. Omitted only where no tenant DB is in scope (tests). */
  meter?: { db: Db; tenantId: number };
}

/** Collapse a query to its cache identity: search engines are whitespace- and
 *  case-insensitive, so `React Hooks ` and `react hooks` are one paid query, not two.
 *  Pure → unit-testable. */
export function normalizeSearchQuery(raw: string): string {
  return (raw ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Build the cloud surface's `web` capability.
 *
 * `fetch` is unconditional. `search` is present ONLY when `args.search` is supplied —
 * i.e. only when a usable BYO key resolved for this tenant. With no backing the
 * returned object has no `search` method at all, so `WebCapability.search` is
 * `undefined` and the engine's capability set (and therefore the advertised toolset)
 * is byte-identical to the pre-search behaviour.
 */
export function buildCloudWebCapability(args: { env: Env; search?: CloudWebSearchBacking | null }): WebCapability {
  const { env, search } = args;
  if (!search) return { fetch: (rawUrl: string) => fetchCached(env, rawUrl) };
  const { vendor, apiKey, meter } = search;
  return {
    fetch: (rawUrl: string) => fetchCached(env, rawUrl),
    async search(rawQuery: string): Promise<WebSearchResult> {
      const query = (rawQuery ?? '').trim();
      if (!query) return { ok: false, query, error: 'query is required' };

      // Cache on the NORMALIZED query but search on what the agent actually typed —
      // the same read-through cache (L1 Map + L2 KV) and the same TTLs as web_fetch,
      // for the same reason: a multi-step run re-asks the same question across ticks,
      // and here each repeat is also real vendor spend.
      const key = `web-search:${vendor.id}:${normalizeSearchQuery(query)}`;
      const result = await getOrSetCached<WebSearchResult>(env, key, async () => {
        // Metering lives INSIDE the loader so a cache hit is neither charged nor
        // gated — only a query that actually hits the wire is metered.
        if (meter) {
          const cap = await enforceOutboundFetchCap(meter.db, meter.tenantId, env);
          if (!cap.allowed) {
            return {
              ok: false,
              query,
              error: `monthly outbound-fetch allowance exhausted (${cap.used}/${cap.limit} on the ${cap.effectivePlan} plan) — web search is paused until it resets`,
            };
          }
        }
        const r = await vendor.search(query, apiKey);
        if (r.ok && meter) {
          await recordOutboundFetch(meter.db, meter.tenantId, vendor.endpoint).catch(() => { /* best-effort */ });
        }
        return r;
      }, {
        kvTtlSeconds: CACHE_KV_TTL_SECONDS,
        l1TtlMs: CACHE_L1_TTL_MS,
      });
      // A vendor blip (or a cap that resets) must be retryable on the next step, never
      // pinned for the TTL — same rule as a failed fetch.
      if (!result.ok) await invalidateCached(env, key).catch(() => { /* best-effort */ });
      return result;
    },
  };
}

/** The cached `fetch` half, shared by both shapes of the capability above. */
async function fetchCached(env: Env, rawUrl: string): Promise<WebFetchResult> {
  const url = (rawUrl ?? '').trim();
  const blocked = classifyWebEgress(url);
  if (blocked) return { ok: false, url, error: blocked };

  const key = `web-fetch:${url}`;
  const result = await getOrSetCached<WebFetchResult>(env, key, () => fetchUncached(url), {
    kvTtlSeconds: CACHE_KV_TTL_SECONDS,
    l1TtlMs: CACHE_L1_TTL_MS,
  });
  // Never pin a failure for the TTL — a transient 502/timeout must be retryable on
  // the agent's very next step.
  if (!result.ok) await invalidateCached(env, key).catch(() => { /* best-effort */ });
  return result;
}
