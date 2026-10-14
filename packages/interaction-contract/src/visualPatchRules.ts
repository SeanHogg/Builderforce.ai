/**
 * The allow-lists a visual patch is held to (PRD 33 §5.2 "Render") — style
 * properties, colours from the page's own palette, same-origin links, and the
 * sanitiser for `insertAfter` HTML. Split from `visualPatch.ts` so the op
 * validator and the HTML sanitiser share one copy of every rule.
 *
 * The sanitiser REBUILDS the markup from what it parsed (tags and attributes on the
 * allow-list, text escaped), so what survives is only ever what the lists name. A
 * comment, a doctype, a processing instruction, an unknown tag, an `on*` handler,
 * a `javascript:` or external link, or a stray `<` rejects the whole fragment.
 */

export const VISUAL_PATCH_LIMITS = {
  maxOps: 12,
  maxText: 500,
  maxAttr: 300,
  maxStyleValue: 64,
  maxHtml: 2_000,
} as const;

/** Properties whose value must be a colour from the page's palette. */
export const PATCH_COLOUR_PROPERTIES = ['color', 'background-color', 'border-color'] as const;

/** Every property `setStyle` (and an inserted `style`) may set. */
export const PATCH_STYLE_PROPERTIES: readonly string[] = [
  // layout
  'display', 'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'gap', 'order', 'text-align',
  // spacing
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  // size
  'width', 'height', 'max-width', 'min-width', 'min-height', 'font-size', 'font-weight', 'line-height', 'letter-spacing',
  // colour
  ...PATCH_COLOUR_PROPERTIES,
  // visibility
  'visibility', 'opacity',
];

/** Tags an `insertAfter` fragment may contain. */
export const PATCH_HTML_TAGS: readonly string[] = [
  'p', 'span', 'strong', 'em', 'b', 'i', 'br', 'small', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'a', 'div', 'section', 'blockquote',
];

const VOID_TAGS = new Set(['br']);
/** Attributes an inserted tag may carry (`href` on `a` only). */
const HTML_ATTRS = new Set(['href', 'title', 'aria-label', 'style']);

export const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
/** A non-colour style value: keywords, numbers and units only — no functions, urls or `#`. */
const PLAIN_STYLE_VALUE = /^[-a-z0-9.%\s]+$/i;
/** A colour literal (used only when no palette is in hand — the runner's re-check). */
const COLOUR_LITERAL = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\))$/i;

/** `#abc` → `#aabbcc`; lowercase; no spaces. The palette and a value meet in this form. */
export function normaliseColour(value: string): string {
  const v = value.trim().toLowerCase().replace(/\s+/g, '');
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : v;
}

/** A same-origin URL: a root-relative path or fragment, or an absolute URL on `origin`. */
export function isSameOriginHref(value: string, origin?: string | null): boolean {
  const v = value.trim();
  if (!v || CONTROL_CHARS.test(v) || /^\s*(javascript|data|vbscript):/i.test(v)) return false;
  if (v.startsWith('#')) return true;
  if (v.startsWith('/')) return !v.startsWith('//') && !v.startsWith('/\\');
  if (!origin) return false;
  try {
    return new URL(v).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * One `property: value` pair against the allow-list and the palette; a reason or
 * null. `palette` null (the runner's structural re-check) accepts any colour literal.
 */
export function styleProblem(property: string, value: string, palette: ReadonlySet<string> | null): string | null {
  const prop = property.trim().toLowerCase();
  if (!PATCH_STYLE_PROPERTIES.includes(prop)) return `style property "${prop}" is not allowed`;
  const v = value.trim();
  if (!v || v.length > VISUAL_PATCH_LIMITS.maxStyleValue) return `style value for "${prop}" is empty or too long`;
  if ((PATCH_COLOUR_PROPERTIES as readonly string[]).includes(prop)) {
    if (palette === null) return COLOUR_LITERAL.test(v) ? null : `colour "${v}" is not a colour`;
    return palette.has(normaliseColour(v)) ? null : `colour "${v}" is not in the page's palette`;
  }
  return PLAIN_STYLE_VALUE.test(v) ? null : `style value "${v}" is not allowed`;
}

/** A `style` attribute: every declaration through {@link styleProblem}; the rebuilt value or a reason. */
function cleanStyle(raw: string, palette: ReadonlySet<string> | null): { ok: true; value: string } | { ok: false; reason: string } {
  const out: string[] = [];
  for (const decl of raw.split(';')) {
    if (!decl.trim()) continue;
    const colon = decl.indexOf(':');
    if (colon <= 0) return { ok: false, reason: 'a style declaration is malformed' };
    const property = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    const problem = styleProblem(property, value, palette);
    if (problem) return { ok: false, reason: problem };
    out.push(`${property}: ${value}`);
  }
  return { ok: true, value: out.join('; ') };
}

const escapeText = (text: string) => text.replace(/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/>/g, '&gt;');
const escapeAttr = (text: string) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const TOKEN = /<\/([a-z][a-z0-9]*)\s*>|<([a-z][a-z0-9]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)/giy;
const ATTR = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

export type SanitisedHtml = { ok: true; html: string } | { ok: false; reason: string };

/**
 * Parse an `insertAfter` fragment against the allow-lists and rebuild it. Rejects
 * (never strips) anything outside them, so a validated patch renders exactly what
 * was reviewed.
 */
export function sanitizePatchHtml(
  html: string,
  ctx: { palette: ReadonlySet<string> | null; origin: string | null },
): SanitisedHtml {
  if (typeof html !== 'string' || !html.trim()) return { ok: false, reason: 'the inserted HTML is empty' };
  if (html.length > VISUAL_PATCH_LIMITS.maxHtml) return { ok: false, reason: 'the inserted HTML is too long' };
  if (CONTROL_CHARS.test(html)) return { ok: false, reason: 'the inserted HTML has control characters' };
  const out: string[] = [];
  const open: string[] = [];
  TOKEN.lastIndex = 0;
  let at = 0;
  while (at < html.length) {
    TOKEN.lastIndex = at;
    const m = TOKEN.exec(html);
    if (!m || m.index !== at) return { ok: false, reason: 'the inserted HTML has markup outside the allow-list' };
    at = TOKEN.lastIndex;
    const [, closing, opening, attrs, selfClose, text] = m;
    if (text !== undefined) {
      out.push(escapeText(text));
      continue;
    }
    if (closing !== undefined) {
      const tag = closing.toLowerCase();
      if (open.pop() !== tag) return { ok: false, reason: `the inserted HTML closes <${tag}> out of order` };
      out.push(`</${tag}>`);
      continue;
    }
    const tag = (opening ?? '').toLowerCase();
    if (!PATCH_HTML_TAGS.includes(tag)) return { ok: false, reason: `the tag <${tag}> is not allowed` };
    const kept: string[] = [];
    ATTR.lastIndex = 0;
    for (const a of (attrs ?? '').matchAll(ATTR)) {
      const name = a[1]!.toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? '';
      if (name.startsWith('on')) return { ok: false, reason: 'event handlers are not allowed' };
      if (!HTML_ATTRS.has(name) || (name === 'href' && tag !== 'a')) return { ok: false, reason: `the attribute "${name}" is not allowed` };
      if (CONTROL_CHARS.test(value) || value.length > VISUAL_PATCH_LIMITS.maxAttr) return { ok: false, reason: `the attribute "${name}" is too long` };
      if (name === 'href' && !isSameOriginHref(value, ctx.origin)) return { ok: false, reason: 'links must stay on this site' };
      if (name === 'style') {
        const style = cleanStyle(value, ctx.palette);
        if (!style.ok) return style;
        kept.push(`style="${escapeAttr(style.value)}"`);
        continue;
      }
      kept.push(`${name}="${escapeAttr(value)}"`);
    }
    const head = `<${tag}${kept.length ? ` ${kept.join(' ')}` : ''}>`;
    if (VOID_TAGS.has(tag)) {
      out.push(head);
      continue;
    }
    if (selfClose) return { ok: false, reason: `<${tag}/> cannot be self-closing` };
    out.push(head);
    open.push(tag);
  }
  if (open.length > 0) return { ok: false, reason: `the inserted HTML leaves <${open[open.length - 1]}> open` };
  return { ok: true, html: out.join('') };
}
