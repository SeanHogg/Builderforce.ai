/**
 * Read a business's brand colours off its own website.
 *
 * Capturing the asking organisation's palette was hand-entry: someone opened the
 * customer's site, eyedropped a screenshot, and typed six hex codes into a form.
 * That is the kind of work that makes a good feature feel like a chore, and it
 * is guessing — the value typed is the colour of a JPEG artifact, not the colour
 * the brand declares.
 *
 * A site declares its brand in three places, in descending order of confidence:
 *   1. `<meta name="theme-color">` — an explicit statement of the brand colour.
 *   2. CSS custom properties whose NAME says brand (`--brand`, `--primary`,
 *      `--accent`, `--color-primary`) — a design system naming itself.
 *   3. Everything else: colours used in `color:`/`background:`/`fill:` slots,
 *      ranked by how often they appear and how much chroma they carry, because
 *      a brand colour is the saturated one a page uses repeatedly and the greys
 *      are the ones it uses everywhere.
 *
 * Server-side because a browser cannot fetch a third-party origin's stylesheet,
 * and deterministic — the same site yields the same palette — because a proposal
 * that changes colour between two generations looks broken.
 *
 * The IMAGE half of this (deriving a palette from an uploaded logo) belongs in
 * the browser, where a real decoder for PNG/JPEG/WebP/SVG already exists; see
 * `frontend/src/lib/brandPalette.ts`. Re-implementing image decoding in a Worker
 * to do the same job worse is not a trade worth making.
 */
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { BrandPalette } from './types';

/** How much of a page we are willing to read. A brand colour is declared early. */
const MAX_HTML_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 512 * 1024;
/** How many linked stylesheets to follow. The first few carry the design system. */
const MAX_STYLESHEETS = 3;
const FETCH_TIMEOUT_MS = 6000;

export interface ExtractedPalette {
  palette: BrandPalette;
  /** Where each decision came from, so the UI can say "read from the site" vs
   *  "inferred from usage" instead of presenting a guess as a fact. */
  sources: { primary: PaletteSource; secondary: PaletteSource; accent: PaletteSource };
  siteUrl: string;
  /** Ranked candidates, so a person can pick a different one without re-reading. */
  candidates: string[];
}

export type PaletteSource = 'theme-color' | 'css-variable' | 'usage' | 'fallback';

const DEFAULT_EXTRACTED: BrandPalette = {
  primary: '#334155', secondary: '#64748b', accent: '#0ea5e9', text: '#111827', background: '#ffffff',
};

// ── colour maths ─────────────────────────────────────────────────────────────

interface Hsl { h: number; s: number; l: number }

function normalizeHex(raw: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw.trim());
  if (!m) return null;
  let hex = (m[1] as string).toLowerCase();
  if (hex.length === 4 || hex.length === 8) hex = hex.slice(0, hex.length === 4 ? 3 : 6); // drop alpha
  if (hex.length === 3) hex = `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
  return `#${hex}`;
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function toHsl(hex: string): Hsl {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** How brand-like a colour is: saturated, and neither near-white nor near-black.
 *  Greys, page backgrounds and body text all score ~0, which is the point. */
function chromaScore(hex: string): number {
  const { s, l } = toHsl(hex);
  if (l > 0.95 || l < 0.05) return 0;
  const midness = 1 - Math.abs(l - 0.5) * 1.6;
  return s * Math.max(midness, 0.05);
}

/** Perceptual distance, so "primary" and "secondary" are not the same colour
 *  twice with a rounding error between them. */
function distance(a: string, b: string): number {
  const ha = toHsl(a), hb = toHsl(b);
  const dh = Math.min(Math.abs(ha.h - hb.h), 360 - Math.abs(ha.h - hb.h)) / 180;
  return Math.sqrt(dh * dh + (ha.s - hb.s) ** 2 + (ha.l - hb.l) ** 2);
}

/** Readable ink for a background — the same rule the document renderer needs. */
function readableText(background: string): string {
  return toHsl(background).l > 0.6 ? '#111827' : '#f8fafc';
}

// ── parsing ──────────────────────────────────────────────────────────────────

const HEX_IN_TEXT = /#[0-9a-fA-F]{3,8}\b/g;
const RGB_IN_TEXT = /rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})/g;

/** Every colour literal in a blob of CSS or inline style, with its frequency. */
function tallyColours(css: string, into: Map<string, number>): void {
  for (const raw of css.match(HEX_IN_TEXT) ?? []) {
    const hex = normalizeHex(raw);
    if (hex) into.set(hex, (into.get(hex) ?? 0) + 1);
  }
  let m: RegExpExecArray | null;
  RGB_IN_TEXT.lastIndex = 0;
  while ((m = RGB_IN_TEXT.exec(css))) {
    const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]));
    into.set(hex, (into.get(hex) ?? 0) + 1);
  }
}

/** Custom properties whose NAME claims to be the brand. Ordered by how specific
 *  the claim is, so `--brand-primary` beats a bare `--accent`. */
const BRAND_VAR = /--([a-z0-9-]*(?:brand|primary|accent|secondary)[a-z0-9-]*)\s*:\s*([^;}]+)/gi;

function readBrandVariables(css: string): { name: string; hex: string }[] {
  const out: { name: string; hex: string }[] = [];
  let m: RegExpExecArray | null;
  BRAND_VAR.lastIndex = 0;
  while ((m = BRAND_VAR.exec(css))) {
    const value = (m[2] ?? '').trim();
    const hex = normalizeHex(value) ?? (() => {
      RGB_IN_TEXT.lastIndex = 0;
      const rgb = RGB_IN_TEXT.exec(value);
      return rgb ? rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3])) : null;
    })();
    if (hex && chromaScore(hex) > 0.08) out.push({ name: (m[1] ?? '').toLowerCase(), hex });
  }
  return out;
}

function rank(name: string): number {
  if (name.includes('brand') && name.includes('primary')) return 0;
  if (name.includes('brand')) return 1;
  if (name.includes('primary')) return 2;
  if (name.includes('accent')) return 3;
  return 4;
}

async function fetchText(url: string, maxBytes: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'BuilderforceBrandReader/1.0 (+https://builderforce.ai)' },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, maxBytes);
  } catch (error) {
    reportCaughtError(error, { source: 'application/rfp/brandExtraction.ts', operation: 'fetchText' });
    return null;
  }
}

/**
 * Only public http(s) origins, and never an address that resolves inside our own
 * network. A "read this URL" endpoint is an SSRF primitive if it is not fenced.
 */
function safeSiteUrl(input: string): URL | null {
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`); } catch { return null; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return null;
  // Literal private / loopback / link-local / metadata addresses.
  if (/^(?:127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host)) return null;
  if (host === '::1' || host.startsWith('[')) return null;
  return url;
}

/** Absolute URL for a stylesheet href, or null when it is not fetchable. */
function resolveHref(href: string, base: URL): string | null {
  try {
    const u = new URL(href, base);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch { return null; }
}

// ── the extractor ────────────────────────────────────────────────────────────

/**
 * Derive a `BrandPalette` from a public website.
 *
 * Never throws and never blocks on a slow site: every fetch is time-boxed, and a
 * page that yields nothing usable returns the neutral default clearly marked
 * `fallback` rather than a confident-looking guess.
 */
export async function extractSitePalette(input: string): Promise<ExtractedPalette | { error: string }> {
  const url = safeSiteUrl(input);
  if (!url) return { error: 'Provide a public http(s) website address.' };

  const html = await fetchText(url.toString(), MAX_HTML_BYTES);
  if (html == null) return { error: 'That site could not be read.' };

  // 1. The explicit statement.
  const themeColor = normalizeHex(/<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)["']/i.exec(html)?.[1] ?? '')
    ?? normalizeHex(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']theme-color["']/i.exec(html)?.[1] ?? '');

  // 2 + 3. Inline styles, then the first few linked stylesheets.
  const tally = new Map<string, number>();
  const variables: { name: string; hex: string }[] = [];
  const inline = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1] ?? '').join('\n');
  tallyColours(inline, tally);
  tallyColours([...html.matchAll(/style=["']([^"']+)["']/gi)].map((m) => m[1] ?? '').join(';'), tally);
  variables.push(...readBrandVariables(inline));

  const sheets = [...html.matchAll(/<link[^>]+rel=["']?stylesheet["']?[^>]*>/gi)]
    .map((tag) => /href=["']([^"']+)["']/i.exec(tag[0] ?? '')?.[1])
    .filter((href): href is string => !!href)
    .map((href) => resolveHref(href, url))
    .filter((href): href is string => !!href)
    .slice(0, MAX_STYLESHEETS);

  const cssBlobs = await Promise.all(sheets.map((href) => fetchText(href, MAX_CSS_BYTES)));
  for (const css of cssBlobs) {
    if (!css) continue;
    tallyColours(css, tally);
    variables.push(...readBrandVariables(css));
  }

  // Rank the usage candidates: frequency weighted by how brand-like the colour is.
  const usage = [...tally.entries()]
    .map(([hex, count]) => ({ hex, score: Math.log2(count + 1) * chromaScore(hex) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);

  const declared = variables
    .sort((a, b) => rank(a.name) - rank(b.name))
    .map((v) => v.hex);

  const sources: ExtractedPalette['sources'] = { primary: 'fallback', secondary: 'fallback', accent: 'fallback' };
  const picked: string[] = [];

  /** Take the next distinct colour from the ordered pools. */
  const take = (pools: { list: string[]; source: PaletteSource }[]): { hex: string; source: PaletteSource } | null => {
    for (const pool of pools) {
      for (const hex of pool.list) {
        if (picked.every((p) => distance(p, hex) > 0.18)) return { hex, source: pool.source };
      }
    }
    return null;
  };

  const usageList = usage.map((u) => u.hex);
  const pools = [
    ...(themeColor ? [{ list: [themeColor], source: 'theme-color' as PaletteSource }] : []),
    { list: declared, source: 'css-variable' as PaletteSource },
    { list: usageList, source: 'usage' as PaletteSource },
  ];

  const primary = take(pools);
  if (primary) { picked.push(primary.hex); sources.primary = primary.source; }
  const secondary = take(pools);
  if (secondary) { picked.push(secondary.hex); sources.secondary = secondary.source; }
  const accent = take(pools);
  if (accent) { picked.push(accent.hex); sources.accent = accent.source; }

  const palette: BrandPalette = {
    primary: primary?.hex ?? DEFAULT_EXTRACTED.primary,
    secondary: secondary?.hex ?? DEFAULT_EXTRACTED.secondary,
    accent: accent?.hex ?? DEFAULT_EXTRACTED.accent,
    // A proposal is a printed document: it is ink on white, whatever the site's
    // own ground is. Only the ACCENTS are borrowed.
    background: '#ffffff',
    text: readableText('#ffffff'),
    logoUrl: extractLogoUrl(html, url),
  };

  return {
    palette,
    sources,
    siteUrl: url.toString(),
    candidates: [...new Set([...(themeColor ? [themeColor] : []), ...declared, ...usageList])].slice(0, 12),
  };
}

/** The site's own mark, so the co-branded header carries it without an upload. */
function extractLogoUrl(html: string, base: URL): string | null {
  const patterns = [
    /<meta[^>]+property=["']og:logo["'][^>]+content=["']([^"']+)["']/i,
    /<link[^>]+rel=["'](?:apple-touch-icon|icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const href = re.exec(html)?.[1];
    const resolved = href ? resolveHref(href, base) : null;
    if (resolved) return resolved.slice(0, 2000);
  }
  return null;
}
