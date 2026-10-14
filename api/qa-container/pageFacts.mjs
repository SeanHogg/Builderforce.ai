/**
 * The PURE half of the `page_capture` job (PRD 33 §5.2): turn what the browser read
 * off a page into the facts the API stores (`replay_page_captures.seo / content /
 * lab_perf / a11y`) and the rect map. No browser here, so every function is tested
 * with `node --test` against fixture HTML and element lists (`pageFacts.test.mjs`).
 *
 * The browser half (`pageCapture.mjs`) hands over:
 *   html       the document's markup with every `[data-bf-mask]` / `[data-bf-block]`
 *              subtree emptied BEFORE it left the page — masked text never travels
 *   elements   [{ selector, label, role, tag, x, y, w, h, text, masked, interactive,
 *                 fontSize, fontWeight, color, bg, hasLabel, alt, src, tabindex }]
 *              (`selector` from THE `deriveSelector`, via the page kit)
 *   perf       { lcp, cls, longTasks: [ms], navBytes, resources: [{ name, bytes, type, renderBlocking }] }
 */

const TEXT_MAX = 600;
const LARGE_TEXT_PX = 24;
const LARGE_BOLD_PX = 18.66;
const TAP_MIN = 44;
const RECT_ROLES = new Set(['heading', 'cta', 'link', 'input', 'image', 'section']);
const VALUE_PROP_MIN_WORDS = 4;
const WORDS_PER_MINUTE = 230;
const LARGEST_IMAGES = 3;
const LIST_MAX = 25;

// ── Markup (SEO) ──────────────────────────────────────────────────────────────

const decode = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ');

/** Every `<tag …>` opening tag with its attributes (lowercase names). */
export function tagsOf(html, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\b([^>]*)>`, 'gi');
  for (const m of html.matchAll(re)) {
    const attrs = {};
    for (const a of m[1].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      attrs[a[1].toLowerCase()] = decode(a[2] ?? a[3] ?? a[4] ?? '');
    }
    out.push(attrs);
  }
  return out;
}

const metaContent = (metas, key, value) => metas.find((m) => (m[key] ?? '').toLowerCase() === value)?.content ?? null;

/** Visible words of the body: scripts, styles, templates and tags removed. */
export function bodyText(html) {
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return decode(body
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

const wordsOf = (text) => (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []);

function jsonLdTypes(html) {
  const types = new Set();
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const t = node['@type'];
    if (typeof t === 'string') types.add(t);
    else if (Array.isArray(t)) t.filter((x) => typeof x === 'string').forEach((x) => types.add(x));
    if (node['@graph']) visit(node['@graph']);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(m[1])); } catch { /* malformed JSON-LD is no JSON-LD */ }
  }
  return [...types].slice(0, LIST_MAX);
}

/** `seo` facts from the page's markup. */
export function seoFacts(html, pageUrl) {
  const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim() || null;
  const metas = tagsOf(html, 'meta');
  const links = tagsOf(html, 'link');
  const description = metaContent(metas, 'name', 'description')?.trim() || null;
  const robots = metaContent(metas, 'name', 'robots');
  const headingLevels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number(m[1]));
  let headingOrderOk = true;
  for (let i = 1; i < headingLevels.length; i++) if (headingLevels[i] > headingLevels[i - 1] + 1) headingOrderOk = false;
  const images = tagsOf(html, 'img');
  let origin = null;
  try { origin = new URL(pageUrl).origin; } catch { /* no origin, no internal links */ }
  let internalLinks = 0;
  let externalLinks = 0;
  for (const a of tagsOf(html, 'a')) {
    const href = a.href ?? '';
    if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) continue;
    try {
      if (origin && new URL(href, pageUrl).origin === origin) internalLinks += 1;
      else externalLinks += 1;
    } catch { /* unparsable href */ }
  }
  return {
    title,
    titleLength: title ? title.length : 0,
    metaDescription: description,
    metaDescriptionLength: description ? description.length : 0,
    canonical: links.find((l) => (l.rel ?? '').toLowerCase().split(/\s+/).includes('canonical'))?.href ?? null,
    robots,
    indexable: !/noindex/i.test(robots ?? ''),
    h1Count: headingLevels.filter((l) => l === 1).length,
    headingLevels: headingLevels.slice(0, 60),
    headingOrderOk,
    og: {
      title: !!metaContent(metas, 'property', 'og:title'),
      description: !!metaContent(metas, 'property', 'og:description'),
      image: !!metaContent(metas, 'property', 'og:image'),
    },
    twitterCard: !!metaContent(metas, 'name', 'twitter:card'),
    structuredDataTypes: jsonLdTypes(html),
    imageCount: images.length,
    imagesWithAlt: images.filter((i) => typeof i.alt === 'string' && i.alt.trim().length > 0).length,
    internalLinks,
    externalLinks,
    wordCount: wordsOf(bodyText(html)).length,
    hreflang: links.filter((l) => (l.rel ?? '').toLowerCase() === 'alternate' && l.hreflang).map((l) => l.hreflang).slice(0, LIST_MAX),
  };
}

// ── Content ───────────────────────────────────────────────────────────────────

/** Syllables of an English word (heuristic, as Flesch–Kincaid tools count them). */
export function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch–Kincaid grade of a text; null under 30 words. */
export function readabilityGrade(text) {
  const words = wordsOf(text);
  if (words.length < 30) return null;
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length);
  const syl = words.reduce((n, w) => n + syllables(w), 0);
  return Math.round((0.39 * (words.length / sentences) + 11.8 * (syl / words.length) - 15.59) * 10) / 10;
}

const TRUST = [
  ['testimonial', /\b(testimonial|what (our )?customers say|loved by|“[^”]{20,}”)/i],
  ['review', /\b(\d[\d,.]*\s*reviews?|reviewed|trustpilot|g2)\b/i],
  ['rating', /(★|\b\d(\.\d)?\s*\/\s*5\b|\b\d(\.\d)? out of 5\b|\bstars?\b)/i],
  ['guarantee', /\b(guarantee|money[- ]back|free returns?|risk[- ]free|cancel any ?time)\b/i],
  ['security', /\b(secure (checkout|payment)|ssl|encrypted|pci|gdpr|soc ?2)\b/i],
  ['stats', /\b(trusted by|used by|\d[\d,.]*\+?\s*(customers|teams|companies|users))\b/i],
];

/** `content` facts — masked elements contribute no text. */
export function contentFacts(elements, { foldHeight }) {
  const visible = elements.filter((e) => !e.masked && e.text);
  const inFold = visible.filter((e) => e.y < foldHeight && e.y + e.h > 0);
  const foldText = [...new Set(inFold.map((e) => e.text.trim()).filter(Boolean))].join(' ').replace(/\s+/g, ' ').trim();
  const headings = inFold.filter((e) => e.role === 'heading');
  const valueProp = headings.some((h) => wordsOf(h.text).length >= VALUE_PROP_MIN_WORDS)
    || (headings.length > 0 && wordsOf(foldText).length >= 12);
  const ctas = elements.filter((e) => e.role === 'cta');
  const ctaLabels = [...new Set(ctas.filter((e) => !e.masked).map((e) => (e.label || '').trim()).filter(Boolean))].slice(0, LIST_MAX);
  const prose = visible.filter((e) => e.role === 'text' || e.role === 'heading').map((e) => e.text).join('. ');
  const allText = visible.map((e) => e.text).join(' ');
  const altText = elements.filter((e) => e.role === 'image').map((e) => e.alt ?? '').join(' ');
  const trustSignals = TRUST.filter(([, re]) => re.test(allText)).map(([kind]) => kind);
  if (/\blogo/i.test(altText) && elements.filter((e) => e.role === 'image' && /\blogo/i.test(e.alt ?? '')).length >= 3) trustSignals.push('logos');
  const words = wordsOf(allText).length;
  return {
    aboveFoldText: foldText.slice(0, TEXT_MAX),
    aboveFoldWords: wordsOf(foldText).length,
    valuePropAboveFold: valueProp,
    ctaLabels,
    ctaCount: ctas.length,
    ctaAboveFold: ctas.filter((e) => e.y < foldHeight).length,
    readabilityGrade: readabilityGrade(prose),
    readingTimeSec: Math.round((words / WORDS_PER_MINUTE) * 60),
    formFields: elements.filter((e) => e.role === 'input').length,
    trustSignals,
    palette: paletteOf(elements),
  };
}

// ── Colour ────────────────────────────────────────────────────────────────────

/** `rgb(…)` / `rgba(…)` / `#rgb` / `#rrggbb` → [r, g, b, a] or null. */
export function parseColour(value) {
  const v = String(value ?? '').trim().toLowerCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  return null;
}

const toHex = ([r, g, b]) => `#${[r, g, b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`;

/** The page's own colours (text + backgrounds), most used first, as `#rrggbb`. */
export function paletteOf(elements, max = 12) {
  const counts = new Map();
  for (const e of elements) {
    for (const raw of [e.color, e.bg]) {
      const c = parseColour(raw);
      if (!c || c[3] < 0.5) continue;
      const hex = toHex(c);
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([hex]) => hex);
}

const channel = (n) => {
  const s = n / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** WCAG contrast ratio of two colours. */
export function contrastRatio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ── Accessibility ─────────────────────────────────────────────────────────────

/** `a11y` facts. Tap targets are judged only on the phone capture. */
export function a11yFacts(elements, { device }) {
  const contrastFailures = [];
  for (const e of elements) {
    if (!e.text || e.masked || !e.selector) continue;
    const fg = parseColour(e.color);
    const bg = parseColour(e.bg);
    if (!fg || !bg || bg[3] < 1) continue;
    const large = e.fontSize >= LARGE_TEXT_PX || (e.fontSize >= LARGE_BOLD_PX && e.fontWeight >= 700);
    const required = large ? 3 : 4.5;
    const ratio = contrastRatio(fg, bg);
    if (ratio < required) contrastFailures.push({ selector: e.selector, ratio: Math.round(ratio * 100) / 100, required });
  }
  return {
    contrastFailures: contrastFailures.slice(0, LIST_MAX),
    smallTapTargets: device === 'phone'
      ? elements.filter((e) => e.interactive && e.w > 0 && e.h > 0 && (e.w < TAP_MIN || e.h < TAP_MIN))
        .map((e) => ({ selector: e.selector, w: Math.round(e.w), h: Math.round(e.h) })).slice(0, LIST_MAX)
      : [],
    missingLabels: elements.filter((e) => e.role === 'input' && !e.hasLabel).map((e) => ({ selector: e.selector })).slice(0, LIST_MAX),
    missingAlt: elements.filter((e) => e.role === 'image' && (e.alt === null || e.alt === undefined)).map((e) => ({ selector: e.selector })).slice(0, LIST_MAX),
    focusOrderIssues: elements.filter((e) => Number(e.tabindex) > 0).length,
  };
}

// ── Lab performance ───────────────────────────────────────────────────────────

const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i;

/** `lab_perf` facts from one load. CLS × 1000, as the field histogram. */
export function labPerfFacts(perf, elements, { foldHeight }) {
  const resources = Array.isArray(perf?.resources) ? perf.resources : [];
  const images = resources
    .filter((r) => r.type === 'img' || IMAGE_URL.test(r.name ?? ''))
    .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
    .slice(0, LARGEST_IMAGES)
    .map((r) => {
      const el = elements.find((e) => e.role === 'image' && e.src && (e.src === r.name || r.name.endsWith(e.src)));
      return { url: String(r.name).slice(0, 400), bytes: Math.round(r.bytes ?? 0), selector: el?.selector ?? null, aboveFold: !!el && el.y < foldHeight };
    });
  const longTasks = Array.isArray(perf?.longTasks) ? perf.longTasks : [];
  return {
    lcpMs: Number.isFinite(perf?.lcp) ? Math.round(perf.lcp) : null,
    cls: Number.isFinite(perf?.cls) ? Math.round(perf.cls * 1000) : null,
    tbtMs: Math.round(longTasks.reduce((sum, d) => sum + Math.max(0, d - 50), 0)),
    pageWeightBytes: Math.round(resources.reduce((sum, r) => sum + (r.bytes ?? 0), 0) + (perf?.navBytes ?? 0)),
    requestCount: resources.length + 1,
    largestImages: images,
    renderBlocking: resources.filter((r) => r.renderBlocking === 'blocking').map((r) => String(r.name).slice(0, 400)).slice(0, LIST_MAX),
  };
}

// ── Rect map ──────────────────────────────────────────────────────────────────

/** The rect map: headings, CTAs, links, inputs, images, sections — labels empty when masked. */
export function rectMapOf(elements, max = 400) {
  const seen = new Set();
  const out = [];
  for (const e of elements) {
    if (!RECT_ROLES.has(e.role) || !e.selector || seen.has(e.selector) || e.w <= 0 || e.h <= 0) continue;
    seen.add(e.selector);
    out.push({ selector: e.selector, x: Math.round(e.x), y: Math.round(e.y), w: Math.round(e.w), h: Math.round(e.h), label: e.masked ? '' : String(e.label ?? '').slice(0, 120), role: e.role });
    if (out.length >= max) break;
  }
  return out;
}

/** Every fact the capture callback posts, from one snapshot. */
export function captureFacts(snapshot, { device, url }) {
  const foldHeight = snapshot.viewport?.h ?? 900;
  const elements = Array.isArray(snapshot.elements) ? snapshot.elements : [];
  return {
    seo: seoFacts(snapshot.html ?? '', url),
    content: contentFacts(elements, { foldHeight }),
    labPerf: labPerfFacts(snapshot.perf ?? {}, elements, { foldHeight }),
    a11y: a11yFacts(elements, { device }),
  };
}
