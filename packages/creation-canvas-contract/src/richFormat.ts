/**
 * The formatting vocabulary a canvas document may carry BEYOND markdown —
 * underline, colour, font, size and alignment — spelled once, for every reader.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────
 * A canvas `document` is stored as markdown and nothing else, and five surfaces
 * depend on there being exactly one stored form: the card renderer, the page
 * editor, the print sheet, the `.docx`/`.pdf` writers on the API, and Brain
 * reading the document back as context. That single format is why the editor's
 * toolbar stopped where markdown stops — a control producing a style the save
 * dropped would be a lie told once per keystroke.
 *
 * But "let me edit this like Word" includes exactly the four things markdown has
 * no syntax for, and an imported `.docx` carries all four before anybody types.
 * So the format GROWS rather than being replaced or shadowed by a sidecar: one
 * documented attribute syntax, stored inside the markdown, parsed by every
 * reader through this module. An older document contains none of it and reads
 * identically; a reader that has not learned it shows the attributes as text
 * rather than losing the words.
 *
 * ── THE SYNTAX ───────────────────────────────────────────────────────────────
 * Pandoc's attribute spans, narrowed to a closed vocabulary:
 *
 *   inline   `[the words]{u color=#c0392b font=Georgia size=14pt}`
 *   block    `A centred paragraph. {align=center}`   (suffix on the block)
 *
 * Chosen over raw `<u>`/`<span style>` for two reasons that are not taste.
 * First, a block-level HTML wrapper stops markdown being parsed inside it under
 * CommonMark's HTML-block rules, so `**bold**` inside a centred paragraph would
 * arrive as literal asterisks on the card. Second, the shared markdown pipeline
 * deliberately carries no `rehype-raw` — it also renders chat, where raw HTML is
 * model output — so an HTML spelling would have to be either unrendered or
 * unsafe. An attribute span is neither: it is inert text everywhere it is not
 * understood.
 *
 * ── CANONICAL ORDER ──────────────────────────────────────────────────────────
 * A span WRAPS its emphasis: `[**bold and underlined**]{u}`, never
 * `**[bold and underlined]{u}**`. Every writer here emits that order and
 * {@link canonicalRichText} rewrites the other one, so a parser can split spans
 * first and read emphasis inside each without an emphasis marker ever being
 * orphaned across a boundary.
 */

/** Paragraph alignment. `left` is the default and is never written out. */
export type RichAlign = 'left' | 'center' | 'right' | 'justify';

export const RICH_ALIGNMENTS: readonly RichAlign[] = ['left', 'center', 'right', 'justify'];

/** The formatting a run of text carries that markdown itself cannot express. */
export interface RichMarks {
  underline?: boolean;
  /** `#rrggbb`, lowercase. */
  color?: string;
  /** A font family NAME, not a CSS stack — the readers each resolve it. */
  font?: string;
  /** Point size. */
  size?: number;
}

/**
 * The families the editor offers.
 *
 * A closed list, because every reader has to resolve the name to something it
 * can actually draw: a `.docx` writes it into `w:rFonts`, the PDF writer has
 * only the base-14 faces, and the browser needs a stack with a fallback. Web
 * fonts are absent on purpose — a document that renders in a font the printer
 * does not have is a document that prints wrong.
 */
export interface RichFontFamily {
  /** The name as stored and as written into a `.docx`. */
  id: string;
  /** The CSS stack the browser renders it with. */
  stack: string;
  /** Which base-14 PDF family it falls back to. */
  pdf: 'sans' | 'serif' | 'mono';
}

export const RICH_FONTS: readonly RichFontFamily[] = [
  { id: 'Arial', stack: 'Arial, Helvetica, sans-serif', pdf: 'sans' },
  { id: 'Calibri', stack: 'Calibri, Candara, Segoe, Optima, sans-serif', pdf: 'sans' },
  { id: 'Verdana', stack: 'Verdana, Geneva, sans-serif', pdf: 'sans' },
  { id: 'Trebuchet MS', stack: '"Trebuchet MS", Tahoma, sans-serif', pdf: 'sans' },
  { id: 'Georgia', stack: 'Georgia, "Times New Roman", serif', pdf: 'serif' },
  { id: 'Times New Roman', stack: '"Times New Roman", Times, serif', pdf: 'serif' },
  { id: 'Garamond', stack: 'Garamond, "Palatino Linotype", Palatino, serif', pdf: 'serif' },
  { id: 'Courier New', stack: '"Courier New", Courier, monospace', pdf: 'mono' },
];

/** Point sizes the editor offers. Word's own list, which is what a person
 * reaching for a size expects to find. */
export const RICH_SIZES: readonly number[] = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 48, 72];

/** Smallest and largest size accepted from any source, editor or import. */
const MIN_SIZE = 6;
const MAX_SIZE = 144;

/* ------------------------------------------------------------- validation --- */

const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff',
  yellow: '#ffff00', orange: '#ffa500', purple: '#800080', gray: '#808080', grey: '#808080',
};

/**
 * A colour, normalised to `#rrggbb`, or `undefined` when it is not one.
 *
 * Accepts what the sources actually produce: `#abc` and `#aabbcc` from an author
 * or an import, `rgb(1, 2, 3)` from a browser's editing command, and the handful
 * of CSS names a pasted document carries. Everything else — a gradient, a
 * `var()`, a function nobody has heard of — is refused rather than passed
 * through, because this value is interpolated into a `style` attribute.
 */
export function normalizeRichColor(value: string | null | undefined): string | undefined {
  const raw = (value ?? '').trim().toLowerCase();
  if (!raw) return undefined;
  if (NAMED_COLORS[raw]) return NAMED_COLORS[raw];
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(raw);
  if (hex) {
    const digits = hex[1]!;
    return `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join('') : digits}`;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(raw);
  if (!rgb) return undefined;
  const channel = (part: string): string => Math.max(0, Math.min(255, Math.round(Number(part)))).toString(16).padStart(2, '0');
  return `#${channel(rgb[1]!)}${channel(rgb[2]!)}${channel(rgb[3]!)}`;
}

/** The hex colour without its `#`, uppercased — the spelling Office XML wants. */
export function richColorHex(color: string): string {
  return color.replace('#', '').toUpperCase();
}

/**
 * A font family name, or `undefined`.
 *
 * Not restricted to {@link RICH_FONTS}: an imported `.docx` names whatever the
 * author had, and dropping to a default would silently restyle their document.
 * It IS restricted in shape — letters, digits, spaces and the punctuation real
 * family names use — because the value reaches a CSS `font-family` and a `.docx`
 * attribute.
 */
export function normalizeRichFont(value: string | null | undefined): string | undefined {
  // First family, THEN unquote: a stack is `"Times New Roman", Times, serif`, so
  // stripping the outer quotes before the split leaves one hanging on the name.
  const raw = (value ?? '').split(',')[0]?.trim().replace(/^["']|["']$/g, '').trim() ?? '';
  return raw && raw.length <= 48 && /^[\w .+-]+$/.test(raw) ? raw : undefined;
}

/** The CSS stack for a family — its own when we know it, otherwise the name
 *  itself with a generic fallback so an imported font still degrades sanely. */
export function richFontStack(font: string): string {
  const known = RICH_FONTS.find((entry) => entry.id.toLowerCase() === font.toLowerCase());
  return known ? known.stack : `"${font}", serif`;
}

/** The base-14 PDF family a name resolves to. */
export function richFontPdfFamily(font: string | undefined): 'sans' | 'serif' | 'mono' | undefined {
  if (!font) return undefined;
  const known = RICH_FONTS.find((entry) => entry.id.toLowerCase() === font.toLowerCase());
  if (known) return known.pdf;
  if (/mono|courier|consol/i.test(font)) return 'mono';
  if (/serif|times|georgia|garamond|book|roman/i.test(font)) return 'serif';
  return 'sans';
}

/** A point size within bounds, or `undefined`. `px` and half-points are accepted
 *  because that is what browsers and Office XML respectively store. */
export function normalizeRichSize(value: string | number | null | undefined, unit: 'pt' | 'px' | 'half' = 'pt'): number | undefined {
  const raw = typeof value === 'number' ? value : Number.parseFloat(String(value ?? '').trim());
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  const points = unit === 'px' ? raw * 0.75 : unit === 'half' ? raw / 2 : raw;
  const rounded = Math.round(points * 2) / 2;
  return rounded >= MIN_SIZE && rounded <= MAX_SIZE ? rounded : undefined;
}

export function isRichAlign(value: string | null | undefined): value is RichAlign {
  return RICH_ALIGNMENTS.includes((value ?? '') as RichAlign);
}

/** Marks with nothing set at all — the signal to write no span. */
export function hasRichMarks(marks: RichMarks | null | undefined): boolean {
  return !!marks && (!!marks.underline || !!marks.color || !!marks.font || !!marks.size);
}

/** Later marks win, so a nested span overrides the one it sits inside. */
export function mergeRichMarks(outer: RichMarks, inner: RichMarks): RichMarks {
  return {
    ...(outer.underline || inner.underline ? { underline: true } : {}),
    ...(outer.color ? { color: outer.color } : {}),
    ...(outer.font ? { font: outer.font } : {}),
    ...(outer.size ? { size: outer.size } : {}),
    ...(inner.color ? { color: inner.color } : {}),
    ...(inner.font ? { font: inner.font } : {}),
    ...(inner.size ? { size: inner.size } : {}),
  };
}

export function sameRichMarks(a: RichMarks, b: RichMarks): boolean {
  return !!a.underline === !!b.underline && a.color === b.color && a.font === b.font && a.size === b.size;
}

/* -------------------------------------------------------------- attributes --- */

/** One `key=value` (or bare `u`) inside the braces. Values may be quoted, which
 *  is how a family name with a space is written. */
const ATTRIBUTE = /([a-z]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s"']+)))?/gi;

/** What a `{...}` group carried: run marks, block alignment, or neither. */
export interface RichAttributes {
  marks: RichMarks;
  align?: RichAlign;
  /** False when the braces held anything this vocabulary does not define, so the
   *  caller leaves the text exactly as the author wrote it. */
  recognised: boolean;
}

/**
 * Read the inside of a `{...}` group.
 *
 * An unknown key makes the WHOLE group unrecognised rather than being skipped:
 * `{ping=1}` in a sentence is somebody's prose or somebody's template, and
 * silently eating half of it is worse than rendering it.
 */
export function parseRichAttributes(source: string): RichAttributes {
  const marks: RichMarks = {};
  let align: RichAlign | undefined;
  let recognised = false;
  const body = source.trim();
  if (!body) return { marks, recognised: false };
  ATTRIBUTE.lastIndex = 0;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE.exec(body)) != null) {
    // Anything BETWEEN two attributes that is not whitespace is not ours: the
    // group is somebody's prose or somebody's template, and half-reading it is
    // worse than leaving it alone.
    if (body.slice(cursor, match.index).trim()) return { marks: {}, recognised: false };
    cursor = match.index + match[0].length;
    const key = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? '';
    if (key === 'u' && !value) { marks.underline = true; recognised = true; continue; }
    if (key === 'color') {
      const color = normalizeRichColor(value);
      if (!color) return { marks: {}, recognised: false };
      marks.color = color; recognised = true; continue;
    }
    if (key === 'font') {
      const font = normalizeRichFont(value);
      if (!font) return { marks: {}, recognised: false };
      marks.font = font; recognised = true; continue;
    }
    if (key === 'size') {
      const size = normalizeRichSize(value.replace(/pt$/i, ''));
      if (!size) return { marks: {}, recognised: false };
      marks.size = size; recognised = true; continue;
    }
    if (key === 'align' && isRichAlign(value)) { align = value; recognised = true; continue; }
    return { marks: {}, recognised: false };
  }
  if (body.slice(cursor).trim()) return { marks: {}, recognised: false };
  return { marks, ...(align ? { align } : {}), recognised };
}

/** The canonical `{...}` body for a set of marks and an alignment. Empty when
 *  there is nothing to say, so callers can concatenate unconditionally. */
export function formatRichAttributes(marks: RichMarks, align?: RichAlign): string {
  const parts = [
    marks.underline ? 'u' : '',
    marks.color ? `color=${marks.color}` : '',
    marks.font ? (/\s/.test(marks.font) ? `font="${marks.font}"` : `font=${marks.font}`) : '',
    marks.size ? `size=${marks.size}pt` : '',
    align && align !== 'left' ? `align=${align}` : '',
  ].filter(Boolean);
  return parts.join(' ');
}

/* ------------------------------------------------------------ inline spans --- */

/** `[content]{attributes}`. The content carries no brackets of its own — every
 *  writer escapes them — so the match cannot run past its own span. */
const SPAN = /\[([^\][]*)\]\{([^{}]*)\}/g;

/** Emphasis wrapped OUTSIDE a span, which is the order a DOM walk produces. */
const OUTER_EMPHASIS = /(\*\*|__|~~|\*|_)\[([^\][]*)\]\{([^{}]+)\}\1/g;

/**
 * Rewrite `**[x]{u}**` as `[**x**]{u}` so span-splitting never orphans an
 * emphasis marker. Repeated for the doubly-wrapped case (`**_[x]{u}_**`).
 */
export function canonicalRichText(text: string): string {
  let out = text;
  for (let pass = 0; pass < 3 && OUTER_EMPHASIS.test(out); pass += 1) {
    OUTER_EMPHASIS.lastIndex = 0;
    out = out.replace(OUTER_EMPHASIS, (_match, mark: string, content: string, attributes: string) =>
      parseRichAttributes(attributes).recognised ? `[${mark}${content}${mark}]{${attributes}}` : _match);
  }
  OUTER_EMPHASIS.lastIndex = 0;
  return out;
}

/** A stretch of text and the marks it carries. */
export interface RichSegment {
  text: string;
  marks: RichMarks;
}

/**
 * Split inline text into marked and unmarked stretches, in document order.
 *
 * The unmarked stretches still hold their markdown — emphasis, code, links — so
 * a caller parses each segment the way it always did and applies the marks on
 * top. A `{...}` this vocabulary does not define is left inside the text.
 */
export function splitRichSpans(text: string): RichSegment[] {
  const source = canonicalRichText(text);
  const segments: RichSegment[] = [];
  let cursor = 0;
  SPAN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SPAN.exec(source)) != null) {
    const { marks, recognised } = parseRichAttributes(match[2]!);
    if (!recognised || !hasRichMarks(marks)) continue;
    if (match.index > cursor) segments.push({ text: source.slice(cursor, match.index), marks: {} });
    segments.push({ text: match[1]!, marks });
    cursor = match.index + match[0].length;
  }
  if (cursor < source.length) segments.push({ text: source.slice(cursor), marks: {} });
  return segments.filter((segment) => segment.text.length > 0);
}

/** Wrap text in a span, or return it untouched when there is nothing to mark. */
export function wrapRichSpan(text: string, marks: RichMarks): string {
  const attributes = formatRichAttributes(marks);
  return attributes && text ? `[${text}]{${attributes}}` : text;
}

/** Inline text with every span reduced to the words inside it — what a reader
 *  that cannot draw the marks should show. */
export function stripRichSpans(text: string): string {
  return splitRichSpans(text).map((segment) => segment.text).join('');
}

/* ------------------------------------------------------------ block suffix --- */

const BLOCK_SUFFIX = /\s*\{([^{}]*)\}\s*$/;

/** A block's own attributes, taken off the end of its text. */
export interface RichBlock {
  text: string;
  align?: RichAlign;
  marks: RichMarks;
}

/**
 * Read (and remove) a block attribute suffix.
 *
 * Only a suffix that parses as this vocabulary is taken — a line ending in
 * `{ok}` or in a snippet of JSON keeps its braces and its meaning. A group that
 * closes an inline span is not a block suffix either: `A [stressed]{u}` ends in
 * braces, and reading them as the paragraph's own would underline nothing and
 * leave the bracket showing.
 */
export function readRichBlock(text: string): RichBlock {
  const match = BLOCK_SUFFIX.exec(text);
  if (!match || text.slice(0, match.index).endsWith(']')) return { text, marks: {} };
  const { marks, align, recognised } = parseRichAttributes(match[1]!);
  if (!recognised) return { text, marks: {} };
  return { text: text.slice(0, match.index), ...(align ? { align } : {}), marks };
}

/** Write a block attribute suffix. */
export function writeRichBlock(text: string, align?: RichAlign, marks: RichMarks = {}): string {
  const attributes = formatRichAttributes(marks, align);
  return attributes ? `${text} {${attributes}}` : text;
}

/* --------------------------------------------------------------------- CSS --- */

/** The marks as CSS declarations — the one place the browser spelling lives. */
export function richMarksCss(marks: RichMarks): string {
  return [
    marks.color ? `color:${marks.color}` : '',
    marks.font ? `font-family:${richFontStack(marks.font)}` : '',
    marks.size ? `font-size:${marks.size}pt` : '',
    marks.underline ? 'text-decoration:underline' : '',
  ].filter(Boolean).join(';');
}

/** Read marks back out of a `style` attribute — how a `contenteditable`'s own
 *  output is normalised into the vocabulary. */
export function richMarksFromCss(style: string): RichMarks {
  const declaration = (name: string): string => new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(style)?.[1]?.trim() ?? '';
  const marks: RichMarks = {};
  const color = normalizeRichColor(declaration('color'));
  if (color) marks.color = color;
  const font = normalizeRichFont(declaration('font-family'));
  if (font) marks.font = font;
  const rawSize = declaration('font-size');
  const size = /pt\s*$/i.test(rawSize) ? normalizeRichSize(rawSize.replace(/pt\s*$/i, ''))
    : /px\s*$/i.test(rawSize) ? normalizeRichSize(rawSize.replace(/px\s*$/i, ''), 'px')
      : undefined;
  if (size) marks.size = size;
  if (/underline/i.test(declaration('text-decoration')) || /underline/i.test(declaration('text-decoration-line'))) marks.underline = true;
  return marks;
}

/** The alignment in a `style` attribute, if it names one. */
export function richAlignFromCss(style: string): RichAlign | undefined {
  const value = /(?:^|;)\s*text-align\s*:\s*([a-z]+)/i.exec(style)?.[1]?.toLowerCase();
  return value === 'start' ? 'left' : value === 'end' ? 'right' : isRichAlign(value) ? value : undefined;
}

/** `<font size="1..7">` — the legacy scale a browser's own font-size command
 *  still emits — as points. */
export function richSizeFromFontElement(value: string): number | undefined {
  const step = Number.parseInt(value, 10);
  const points = [8, 10, 12, 14, 18, 24, 32][step - 1];
  return points ? normalizeRichSize(points) : undefined;
}
