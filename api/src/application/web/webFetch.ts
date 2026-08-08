import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Server-side web fetch for the Brain — lets the co-pilot read an external
 * URL/file/website the user pastes (e.g. a GitHub ROADMAP.md, a docs page).
 *
 * Why server-side: the Brain runs in the browser, where fetching an arbitrary
 * third-party URL is blocked by CORS. The gateway fetches it instead, behind
 * the {@link assertSafeUrl} SSRF guard, and returns plain text the model can
 * read. We strip HTML to text and cap the size so a huge page can't blow the
 * model's context window.
 */

import { assertSafeUrl, resolveAndAssertPublic, BlockedUrlError } from '../../infrastructure/net/ssrfGuard';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

/** Max decoded text returned to the model (chars). A roadmap/docs page fits
 *  comfortably; anything larger is truncated with a marker. */
const MAX_TEXT_CHARS = 60_000;
/** Hard cap on bytes read off the wire before we stop (defends against a huge
 *  binary/stream). */
const MAX_BYTES = 5 * 1024 * 1024;
/** Abort a slow origin so a hung request can't wedge the worker. */
const FETCH_TIMEOUT_MS = 15_000;
/** Max redirect hops to follow manually. Each hop is re-validated through the
 *  SSRF guard, so an initially-public origin can't 302 us to a private target. */
const MAX_REDIRECTS = 5;

/** HTTP status codes that carry a `Location` we must re-validate before following. */
function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

export interface WebFetchResult {
  /** The URL actually fetched (after github-blob → raw rewrite + redirects). */
  url: string;
  /** Original URL the caller passed. */
  requestedUrl: string;
  status: number;
  contentType: string;
  /** Page <title> when the document was HTML, else null. */
  title: string | null;
  /** Plain-text content (HTML stripped), capped at {@link MAX_TEXT_CHARS}. */
  text: string;
  truncated: boolean;
  /**
   * Whether the origin permits BuilderForce framing this page in an `<iframe>`,
   * read off `X-Frame-Options` / CSP `frame-ancestors`. The canvas Web page panel
   * uses it to decide between the live frame and its reader view — the browser
   * gives the embedder no event it can trust when a frame is refused, so the
   * answer has to come from the one place that can see the response headers.
   */
  frameable: boolean;
  /** Which header refused the frame (`x-frame-options` | `frame-ancestors`), else null. */
  frameBlockedBy: 'x-frame-options' | 'frame-ancestors' | null;
}

/** Our own origins, which a `frame-ancestors` list may name explicitly. */
const SELF_FRAME_ANCESTOR = /builderforce\.ai/i;

/**
 * Decide whether a response allows US to frame it.
 *
 * `X-Frame-Options` has no "allow this specific embedder" value that browsers
 * still honour (`ALLOW-FROM` is dead), so ANY value refuses a third-party frame.
 * CSP `frame-ancestors` does, so a list is read: a wildcard opens it, an explicit
 * BuilderForce origin opens it, and anything else (including `'none'`/`'self'`)
 * closes it. Absent headers mean the default — framing is allowed.
 */
export function framePolicy(
  xFrameOptions: string | null,
  contentSecurityPolicy: string | null,
): { frameable: boolean; frameBlockedBy: WebFetchResult['frameBlockedBy'] } {
  if (xFrameOptions && xFrameOptions.trim()) return { frameable: false, frameBlockedBy: 'x-frame-options' };
  const directive = (contentSecurityPolicy ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => /^frame-ancestors\b/i.test(part));
  if (!directive) return { frameable: true, frameBlockedBy: null };
  const sources = directive.split(/\s+/).slice(1).filter(Boolean);
  const allowed = sources.some((source) => source === '*' || source === 'https:' || SELF_FRAME_ANCESTOR.test(source));
  return allowed ? { frameable: true, frameBlockedBy: null } : { frameable: false, frameBlockedBy: 'frame-ancestors' };
}

/**
 * GitHub (and GitLab) "blob" pages render the file inside a heavy JS app, so
 * fetching the HTML yields almost no readable content. Rewrite a blob URL to
 * the raw file so we get the actual document text the user wanted.
 */
export function normalizeFetchUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  // https://github.com/<owner>/<repo>/blob/<ref>/<path> → raw.githubusercontent.com
  if (u.hostname === 'github.com') {
    const m = /^\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(u.pathname);
    if (m) return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}${u.search}`;
  }
  // https://gitlab.com/<group>/<repo>/-/blob/<ref>/<path> → /-/raw/
  if (u.hostname === 'gitlab.com' && u.pathname.includes('/-/blob/')) {
    u.pathname = u.pathname.replace('/-/blob/', '/-/raw/');
    return u.toString();
  }
  return raw;
}

/** Extract the <title> text from an HTML document, if present. */
function extractTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m?.[1] != null ? decodeEntities(m[1].trim()) : null;
}

/** Strip HTML to readable text: drop script/style/head, tags → spaces, collapse
 *  whitespace, decode the common entities. Deliberately lightweight (no DOM in
 *  the Workers runtime) — good enough to feed a page's prose to the model. */
function htmlToText(html: string): string {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|head|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>(?=)/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return collapse(decodeEntities(body));
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

/** Collapse runs of blank space while keeping paragraph breaks. */
function collapse(s: string): string {
  return s
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Fetch a public URL server-side and return readable text. Throws on a blocked
 * (SSRF) URL; returns a {@link WebFetchResult} with the upstream status for
 * non-2xx so the model can tell the user the page was unreachable.
 */
/**
 * Fetch `startUrl`, following redirects MANUALLY so the SSRF guard re-runs on
 * every hop. `redirect: 'follow'` would let a permitted public origin 302 us to
 * `169.254.169.254`/localhost with the guard never re-checking; instead we take
 * one hop at a time, re-validating each `Location` through {@link assertSafeUrl}
 * + {@link resolveAndAssertPublic} BEFORE the next fetch. Bounded at
 * {@link MAX_REDIRECTS} hops. Throws on a blocked hop; returns the final response
 * plus the URL actually fetched.
 */
async function fetchFollowingRedirects(
  startUrl: string,
  signal: AbortSignal,
): Promise<{ res: Response; finalUrl: string }> {
  let current = startUrl;
  for (let hop = 0; ; hop++) {
    // SSRF guard (http + https). Throws on internal/loopback/metadata hosts, then
    // best-effort DNS-rebinding check (resolves the name and rejects private IPs).
    const parsed = assertSafeUrl(current, { allowHttp: true });
    await resolveAndAssertPublic(parsed.hostname);

    const res = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        // A real UA + text Accept — some origins 403 an empty UA.
        'User-Agent': 'BuilderforceBrain/1.0 (+https://builderforce.ai)',
        'Accept': 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5',
      },
    });

    if (!isRedirectStatus(res.status)) {
      return { res, finalUrl: current };
    }
    const location = res.headers.get('location');
    if (!location) {
      // Redirect status but no Location — nothing to follow; hand it back as-is.
      return { res, finalUrl: current };
    }
    if (hop >= MAX_REDIRECTS) {
      throw new Error(`Too many redirects fetching ${startUrl} (>${MAX_REDIRECTS}).`);
    }
    // Discard the redirect body and resolve the next hop (Location may be relative).
    await res.body?.cancel().catch((error) => {
      reportCaughtError(error, { source: "application/web/webFetch.ts", operation: "fetchFollowingRedirects" });
    });
    current = new URL(location, current).toString();
  }
}

export async function fetchWebDocument(rawUrl: string): Promise<WebFetchResult> {
  const requestedUrl = rawUrl;
  const target = normalizeFetchUrl(rawUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  let finalUrl: string;
  try {
    ({ res, finalUrl } = await fetchFollowingRedirects(target, controller.signal));
  } catch (e) {
    clearTimeout(timer);
    // A BlockedUrlError / SSRF assertion is a security decision, not a transport
    // failure — re-throw it verbatim so the caller sees why the URL was refused.
    if (e instanceof BlockedUrlError || (e instanceof Error && /public host|valid absolute URL|http:\/\/ or https/.test(e.message))) {
      throw e;
    }
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timed out' : 'failed';
    throw new Error(`Could not reach ${target} (request ${reason}).`);
  }
  clearTimeout(timer);

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const frame = framePolicy(res.headers.get('x-frame-options'), res.headers.get('content-security-policy'));

  if (!res.ok) {
    return {
      url: finalUrl, requestedUrl, status: res.status, contentType,
      title: null, text: '', truncated: false, ...frame,
    };
  }

  // Bound how much we read off the wire regardless of content-type.
  const raw = await readCapped(res, MAX_BYTES);
  const isHtml = contentType.includes('text/html') || /^\s*<(!doctype|html)/i.test(raw);
  const title = isHtml ? extractTitle(raw) : null;
  let text = isHtml ? htmlToText(raw) : raw.trim();

  let truncated = raw.length >= MAX_BYTES;
  if (text.length > MAX_TEXT_CHARS) {
    text = text.slice(0, MAX_TEXT_CHARS);
    truncated = true;
  }

  return { url: finalUrl, requestedUrl, status: res.status, contentType, title, text, truncated, ...frame };
}

/** How long a fetched document stays warm. Matches the cloud surface's `web_fetch`
 *  cache (`cloudWeb.CACHE_KV_TTL_SECONDS`): long enough that one research turn reads a
 *  source once, short enough that a page the user is actively editing goes stale fast. */
const DOC_CACHE_KV_TTL_SECONDS = 600;
const DOC_CACHE_L1_TTL_MS = 60_000;

/**
 * {@link fetchWebDocument} behind the canonical read-through cache (L1 Map + L2 KV).
 *
 * A research pipeline is re-read-heavy by construction: search returns sources, the
 * model fetches one, reasons, then fetches it again a step later to quote it — and on
 * the canvas the same board is often re-researched by several people in one session.
 * Keyed on the NORMALIZED url (the github-blob rewrite happens first) so the two forms
 * of the same file share one entry.
 *
 * Failures are not cached: {@link fetchWebDocument} throws on an SSRF-blocked or
 * unreachable URL, and a throwing loader leaves the cache untouched, so a transient
 * outage is retryable on the model's very next step. A non-2xx RESPONSE is a real
 * answer from the origin and is cached like any other. `env` may be absent (tests,
 * non-Worker callers) — the helper's contract is "no KV → call the loader".
 */
export async function fetchWebDocumentCached(env: Env | undefined, rawUrl: string): Promise<WebFetchResult> {
  return getOrSetCached<WebFetchResult>(
    env as Env,
    `web-doc:${normalizeFetchUrl(rawUrl)}`,
    () => fetchWebDocument(rawUrl),
    { kvTtlSeconds: DOC_CACHE_KV_TTL_SECONDS, l1TtlMs: DOC_CACHE_L1_TTL_MS },
  );
}

/** Read a response body as text but stop after `maxBytes` so a huge/streamed
 *  body can't exhaust memory. */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, maxBytes);
  const decoder = new TextDecoder();
  let out = '';
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (total >= maxBytes) {
      await reader.cancel().catch((error) => {
        reportCaughtError(error, { source: "application/web/webFetch.ts", operation: "readCapped" });
      });
      break;
    }
  }
  out += decoder.decode();
  return out;
}
