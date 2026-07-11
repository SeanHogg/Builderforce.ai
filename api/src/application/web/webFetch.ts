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

import { assertSafeUrl, resolveAndAssertPublic } from '../../infrastructure/net/ssrfGuard';

/** Max decoded text returned to the model (chars). A roadmap/docs page fits
 *  comfortably; anything larger is truncated with a marker. */
const MAX_TEXT_CHARS = 60_000;
/** Hard cap on bytes read off the wire before we stop (defends against a huge
 *  binary/stream). */
const MAX_BYTES = 5 * 1024 * 1024;
/** Abort a slow origin so a hung request can't wedge the worker. */
const FETCH_TIMEOUT_MS = 15_000;

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
export async function fetchWebDocument(rawUrl: string): Promise<WebFetchResult> {
  const requestedUrl = rawUrl;
  const target = normalizeFetchUrl(rawUrl);
  // SSRF guard (allows http + https). Throws on internal/loopback/metadata hosts.
  const parsed = assertSafeUrl(target, { allowHttp: true });
  // DNS-rebinding guard (best-effort, defence-in-depth): resolve the hostname over
  // DoH and reject if it maps to a private IP. Fails OPEN on a DoH lookup failure —
  // assertSafeUrl above already blocks literal private IPs, so this only closes the
  // residual "public name → private IP" rebinding case when the lookup succeeds.
  await resolveAndAssertPublic(parsed.hostname);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // A real UA + text Accept — some origins 403 an empty UA.
        'User-Agent': 'BuilderforceBrain/1.0 (+https://builderforce.ai)',
        'Accept': 'text/html,text/plain,text/markdown,application/json;q=0.9,*/*;q=0.5',
      },
    });
  } catch (e) {
    clearTimeout(timer);
    const reason = e instanceof Error && e.name === 'AbortError' ? 'timed out' : 'failed';
    throw new Error(`Could not reach ${target} (request ${reason}).`);
  }
  clearTimeout(timer);

  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  const finalUrl = res.url || target;

  if (!res.ok) {
    return {
      url: finalUrl, requestedUrl, status: res.status, contentType,
      title: null, text: '', truncated: false,
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

  return { url: finalUrl, requestedUrl, status: res.status, contentType, title, text, truncated };
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
      await reader.cancel().catch(() => {});
      break;
    }
  }
  out += decoder.decode();
  return out;
}
