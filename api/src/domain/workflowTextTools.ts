/**
 * Text Parser node kinds — pure, stateless string primitives for `regex-match`,
 * `html-to-text`, `html-table`, `html-elements`, `match-elements`,
 * `match-pattern-advanced`, `replace`, `chunk-text`, and `convert-encoding`
 * (`cloudExecutor.ts`). Kept separate from `workflowExpr.ts`, which is
 * documented as scoped to the Flow Control expression engine
 * (transform/filter/branch/router/assert/switch).
 *
 * Every function bounds its input to stay sandbox-safe: no backtracking-prone
 * regex construction (a pattern is compiled once, matched, and discarded —
 * never used to build a second dynamic regex) and a hard input-length cap so a
 * pathological payload can't turn a single node into a long-running match.
 *
 * The HTML functions here are a lightweight REGEX tag-scanner, not a real DOM
 * parser (the Worker runtime carries no cheerio/jsdom) — same tradeoff
 * `htmlToText` below already makes. They handle well-formed HTML the way a
 * scraped page or an email body actually looks; malformed/nested markup of the
 * same tag can under- or over-match, same as `htmlToText`'s tag-stripper.
 */

const MAX_INPUT_LENGTH = 200_000;
const MAX_PATTERN_LENGTH = 500;
const VALID_FLAGS = /^[gimsuy]*$/;

export interface RegexMatchResult {
  matched: boolean;
  matches: string[];
  groups: Record<string, string> | null;
}

/**
 * Match `pattern` (with `flags`) against `input`. Never throws: an invalid
 * pattern/flags string, or oversized input/pattern, resolves to a "no match"
 * result rather than failing the node — the config field is user-authored, so
 * a typo should read as an empty match, not an execution error.
 */
export function regexMatch(pattern: string, flags: string, input: string): RegexMatchResult {
  const empty: RegexMatchResult = { matched: false, matches: [], groups: null };
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return empty;
  const safeFlags = VALID_FLAGS.test(flags ?? '') ? flags : '';
  const text = (input ?? '').slice(0, MAX_INPUT_LENGTH);
  try {
    if (safeFlags.includes('g')) {
      const matches = [...text.matchAll(new RegExp(pattern, safeFlags))].map((m) => m[0]);
      return { matched: matches.length > 0, matches, groups: null };
    }
    const m = new RegExp(pattern, safeFlags).exec(text);
    if (!m) return empty;
    return { matched: true, matches: [...m].map((g) => g ?? ''), groups: m.groups ? { ...m.groups } : null };
  } catch {
    return empty;
  }
}

/** Strip tags/scripts/styles and collapse whitespace — a lightweight
 *  tag-stripper (not a full HTML parser), matching Make's "HTML to text". */
export function htmlToText(html: string): string {
  const text = (html ?? '').slice(0, MAX_INPUT_LENGTH);
  return text
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const MAX_ELEMENTS = 500;

/** Parse the FIRST `<table>` in `html` into rows of cell text (`<th>`/`<td>`),
 *  matching Make's "Get content from HTML table". */
export function htmlTable(html: string): string[][] {
  const text = (html ?? '').slice(0, MAX_INPUT_LENGTH);
  const tableMatch = /<table[\s\S]*?<\/table>/i.exec(text);
  if (!tableMatch) return [];
  const rowMatches = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const rows: string[][] = [];
  for (const rowHtml of rowMatches.slice(0, MAX_ELEMENTS)) {
    const cellMatches = rowHtml.match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/gi) ?? [];
    const cells = cellMatches.map((c) => htmlToText(c));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

export interface HtmlElement {
  text: string;
  attrs: Record<string, string>;
}

function parseAttrs(openTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z-]+)\s*=\s*"([^"]*)"|([a-zA-Z-]+)\s*=\s*'([^']*)'/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(openTag))) {
    const key = (m[1] ?? m[3] ?? '').toLowerCase();
    if (key) attrs[key] = m[2] ?? m[4] ?? '';
  }
  return attrs;
}

/** Every `<tagName ...>...</tagName>` (or self-closing `<tagName .../>`) block
 *  in `html`, with its text and attributes — matching Make's "Get elements
 *  from HTML / XML". `tagName` is sanitized to `[a-zA-Z0-9]+`; anything else
 *  degrades to no matches rather than building an unsafe pattern from it. */
export function htmlElements(html: string, tagName: string): HtmlElement[] {
  const tag = (tagName ?? '').trim().replace(/[^a-zA-Z0-9]/g, '');
  if (!tag) return [];
  const text = (html ?? '').slice(0, MAX_INPUT_LENGTH);
  const re = new RegExp(`<${tag}((?:\\s+[^<>]*)?)\\s*/?>(?:([\\s\\S]*?)<\\/${tag}\\s*>)?`, 'gi');
  const out: HtmlElement[] = [];
  let m: RegExpExecArray | null;
  while (out.length < MAX_ELEMENTS && (m = re.exec(text))) {
    out.push({ text: htmlToText(m[2] ?? ''), attrs: parseAttrs(m[1] ?? '') });
  }
  return out;
}

/** `htmlElements` filtered to those whose text matches `pattern` — matching
 *  Make's "Match elements". An empty pattern returns every element. */
export function matchElements(html: string, tagName: string, pattern: string): HtmlElement[] {
  const elements = htmlElements(html, tagName);
  const trimmed = (pattern ?? '').trim();
  if (!trimmed) return elements;
  if (trimmed.length > MAX_PATTERN_LENGTH) return [];
  try {
    const re = new RegExp(trimmed, 'i');
    return elements.filter((el) => re.test(el.text));
  } catch {
    return [];
  }
}

export interface AdvancedMatch {
  match: string;
  groups: Record<string, string>;
  index: number;
}

/** Every match of `pattern` against `input`, each with its named capture
 *  groups as a structured object — matching Make's "Match pattern (Advanced)".
 *  Unlike `regexMatch` above (a flat list of whole matches OR one match's
 *  positional groups), this always returns every match AND its named groups
 *  together, which is what "advanced" means in Make's own module. */
export function matchPatternAdvanced(pattern: string, flags: string, input: string): AdvancedMatch[] {
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return [];
  const safeFlags = VALID_FLAGS.test(flags ?? '') ? flags : '';
  const withG = safeFlags.includes('g') ? safeFlags : `${safeFlags}g`;
  const text = (input ?? '').slice(0, MAX_INPUT_LENGTH);
  try {
    return [...text.matchAll(new RegExp(pattern, withG))]
      .slice(0, MAX_ELEMENTS)
      .map((m) => ({ match: m[0], groups: m.groups ? { ...m.groups } : {}, index: m.index ?? -1 }));
  } catch {
    return [];
  }
}

/** Find/replace — `literal` treats `pattern` as a plain substring (every
 *  occurrence); otherwise `pattern` is a regex and `replacement` may use
 *  `$1`/`$<name>` backreferences, same as `String.prototype.replace`. */
export function replaceText(input: string, pattern: string, replacement: string, flags: string, literal: boolean): string {
  const text = (input ?? '').slice(0, MAX_INPUT_LENGTH);
  const repl = (replacement ?? '').slice(0, MAX_PATTERN_LENGTH);
  if (literal) {
    return pattern ? text.split(pattern).join(repl) : text;
  }
  if (!pattern || pattern.length > MAX_PATTERN_LENGTH) return text;
  const safeFlags = VALID_FLAGS.test(flags ?? '') ? flags : '';
  try {
    return text.replace(new RegExp(pattern, safeFlags.includes('g') ? safeFlags : `${safeFlags}g`), repl);
  } catch {
    return text;
  }
}

/** Split `input` into fixed-size, optionally overlapping chunks — matching
 *  Make AI Toolkit's "Chunk text" (feeding a downstream LLM/embedding node
 *  with each chunk one at a time needs Iterator-style dynamic fan-out, which
 *  this architecture does not have yet — see ROADMAP.md; this node still
 *  returns the full chunk array as one JSON payload, usable by anything
 *  downstream that reads it as a list). */
export function chunkText(input: string, chunkSize: number, overlap: number): string[] {
  const text = (input ?? '').slice(0, MAX_INPUT_LENGTH);
  if (!text) return [];
  const size = Number.isFinite(chunkSize) && chunkSize > 0 ? Math.floor(chunkSize) : 1000;
  const ov = Number.isFinite(overlap) && overlap >= 0 && overlap < size ? Math.floor(overlap) : 0;
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - ov;
  }
  return chunks;
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return s;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export type EncodingMode =
  | 'base64-encode' | 'base64-decode' | 'url-encode' | 'url-decode' | 'hex-encode' | 'hex-decode';

/** Encode/decode `input` — matching Make's "Convert encoding". Never throws:
 *  malformed input for a decode mode (bad base64, bad %-escape) degrades to
 *  an empty string rather than failing the node. */
export function convertEncoding(mode: string, input: string): string {
  const text = (input ?? '').slice(0, MAX_INPUT_LENGTH);
  try {
    switch (mode as EncodingMode) {
      case 'base64-encode':
        return btoa(bytesToBinaryString(new TextEncoder().encode(text)));
      case 'base64-decode': {
        const binary = atob(text);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return new TextDecoder().decode(bytes);
      }
      case 'url-encode':
        return encodeURIComponent(text);
      case 'url-decode':
        return decodeURIComponent(text);
      case 'hex-encode':
        return bytesToHex(new TextEncoder().encode(text));
      case 'hex-decode':
        return new TextDecoder().decode(hexToBytes(text));
      default:
        return text;
    }
  } catch {
    return '';
  }
}
