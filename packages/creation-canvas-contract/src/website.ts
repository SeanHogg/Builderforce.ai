/**
 * The authored website — the shape a `website` (or `prototype`) canvas object carries,
 * the ONE parser that normalises it, and the block-level operations that edit it.
 *
 * ── WHY THIS MOVED INTO THE CONTRACT ─────────────────────────────────────────────
 * This shape has TWO consumers that cannot share a renderer: the canvas editor draws it
 * as React on the `site` surface, and the site publisher renders it to static HTML in a
 * Worker with no React at all. Left in the frontend, the second consumer would have had
 * to restate the section vocabulary — and a vocabulary stated twice is one that drifts,
 * so a page the creator can author becomes a page the publisher silently drops.
 *
 * What is shared is therefore everything EXCEPT the pixels: the kinds, the parse, and the
 * mutations. Each renderer owns only its own output.
 *
 * ── WHY THE OPERATIONS LIVE HERE AND NOT IN THE EDITOR ───────────────────────────
 * "Insert a section" is a rule about the DOCUMENT, not about a click. Written in the
 * component it would be reachable only by a mouse, so Brain adding a section and a person
 * adding a section would take different paths to the same array and only one of them would
 * be bounded by the caps below. They are pure functions over `pages` for that reason:
 * same answer whoever calls them, and trivially testable without mounting anything.
 *
 * Every operation is TOTAL — an out-of-range index, an unknown kind or a missing page
 * returns the input unchanged rather than throwing. The caller is a UI event handler and
 * an agent turn; neither has anywhere useful to put an exception, and a refused edit that
 * leaves the document intact is the failure mode this vocabulary exists to guarantee.
 */

import {
  CANVAS_VIEWPORT_CAPTURE_HEIGHTS,
  CANVAS_VIEWPORT_WIDTHS,
  canvasViewport,
  type CanvasViewport,
} from './viewport';

/** The declared section vocabulary. A section kind is a VALUE, never a new shape. */
export const WEBSITE_SECTION_KINDS = ['hero', 'features', 'content', 'stats', 'testimonial', 'cta'] as const;

export type WebsiteSectionKind = (typeof WEBSITE_SECTION_KINDS)[number];

/** Section kinds a person may add from the editor.
 *
 *  `hero` is absent deliberately: it is the page's masthead, `websiteHeroFrom` resolves
 *  exactly one, and a second would make "the hero" ambiguous for every reader of it —
 *  the card preview, the marketplace tile and the published `<title>`. Removing the last
 *  hero is refused for the same reason. */
export const WEBSITE_ADDABLE_SECTION_KINDS = WEBSITE_SECTION_KINDS.filter((kind) => kind !== 'hero');

/** Caps. Shared with the parser so an authored document and an edited one agree. */
export const WEBSITE_MAX_PAGES = 8;
export const WEBSITE_MAX_SECTIONS = 12;

export interface WebsiteSectionItem {
  title?: string;
  body?: string;
  value?: string;
  label?: string;
}

export interface WebsiteSection {
  id: string;
  kind: WebsiteSectionKind;
  eyebrow?: string;
  heading?: string;
  body?: string;
  cta?: string;
  secondaryCta?: string;
  items?: WebsiteSectionItem[];
  quote?: string;
  author?: string;
}

export interface WebsitePage {
  id: string;
  name: string;
  path: string;
  sections: WebsiteSection[];
}

export interface WebsiteTheme {
  style: WebsiteThemeStyle;
  background?: string;
  foreground?: string;
  accent?: string;
}

export const WEBSITE_THEME_STYLES = ['editorial', 'bold', 'minimal', 'soft', 'technical'] as const;
export type WebsiteThemeStyle = (typeof WEBSITE_THEME_STYLES)[number];

const SECTION_KINDS = new Set<WebsiteSectionKind>(WEBSITE_SECTION_KINDS);
const THEME_STYLES = new Set<WebsiteThemeStyle>(WEBSITE_THEME_STYLES);

export function isWebsiteSectionKind(value: unknown): value is WebsiteSectionKind {
  return typeof value === 'string' && SECTION_KINDS.has(value as WebsiteSectionKind);
}

/**
 * A `content` section whose body is real markup — a model-authored `<form>` plus its
 * `<script>` — rather than prose. Both renderers (the React editor and the static
 * publisher) need the SAME answer to "is this HTML or text", or one would sandbox a
 * section the other prints as an escaped paragraph.
 */
export function isMarkupSectionBody(section: Pick<WebsiteSection, 'kind' | 'body'>): boolean {
  return section.kind === 'content' && typeof section.body === 'string' && /<[a-z][^>]*>/i.test(section.body);
}

/**
 * Sandbox for a `content` section's own markup. `allow-scripts` without
 * `allow-same-origin` — same rule as `CANVAS_APP_FRAME_SANDBOX` / `GAME_FRAME_SANDBOX` —
 * because this is model-authored HTML from a free-text brief and must never reach this
 * page's cookies, storage or DOM. `allow-forms` is additional to those two: a generated
 * site's whole point is often a form, and a sandboxed frame refuses form submission by
 * default unless granted.
 */
export const WEBSITE_CONTENT_FRAME_SANDBOX = 'allow-scripts allow-forms';

function text(value: unknown, max = 2_000): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}

function slug(value: string, fallback: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || fallback;
}

function websiteItems(value: unknown): WebsiteSection['items'] {
  if (!Array.isArray(value)) return undefined;
  const items = value.slice(0, 8).flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const item = {
      title: text(record.title, 160), body: text(record.body, 600),
      value: text(record.value, 80), label: text(record.label, 160),
    };
    return Object.values(item).some(Boolean) ? [item] : [];
  });
  return items.length ? items : undefined;
}

/** A `content` body sometimes carries a whole `<form>` plus its `<script>` rather than a
 *  paragraph — the prose cap below would truncate mid-tag and hand the sandboxed frame
 *  broken markup. `content` alone gets the wider cap; every other kind stays a caption. */
const WEBSITE_MARKUP_BODY_MAX = 20_000;

export function websiteSection(value: unknown, index: number): WebsiteSection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isWebsiteSectionKind(record.kind)) return null;
  const kind = record.kind;
  const section: WebsiteSection = {
    id: text(record.id, 100) || `${kind}-${index + 1}`,
    kind,
    eyebrow: text(record.eyebrow, 160), heading: text(record.heading, 240),
    body: text(record.body, kind === 'content' ? WEBSITE_MARKUP_BODY_MAX : 2_000),
    cta: text(record.cta, 120), secondaryCta: text(record.secondaryCta, 120),
    items: websiteItems(record.items), quote: text(record.quote, 1_000), author: text(record.author, 200),
  };
  const hasContent = Object.entries(section).some(([key, item]) => !['id', 'kind'].includes(key) && item != null);
  return hasContent ? section : null;
}

/** Normalize the authored website contract before it reaches ANY renderer. */
export function websitePagesFrom(data: Record<string, unknown>): WebsitePage[] {
  if (!Array.isArray(data.pages)) return [];
  return data.pages.slice(0, WEBSITE_MAX_PAGES).flatMap((value, pageIndex) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const record = value as Record<string, unknown>;
    const name = text(record.name, 100);
    const sections = Array.isArray(record.sections)
      ? record.sections.slice(0, WEBSITE_MAX_SECTIONS).map(websiteSection).filter((section): section is WebsiteSection => section != null)
      : [];
    if (!name || !sections.length) return [];
    const id = text(record.id, 100) || slug(name, `page-${pageIndex + 1}`);
    return [{ id, name, path: text(record.path, 160) || (pageIndex === 0 ? '/' : `/${slug(name, id)}`), sections }];
  });
}

export function websiteThemeFrom(data: Record<string, unknown>): WebsiteTheme {
  const record = data.websiteTheme && typeof data.websiteTheme === 'object' && !Array.isArray(data.websiteTheme)
    ? data.websiteTheme as Record<string, unknown> : {};
  const style = THEME_STYLES.has(record.style as WebsiteThemeStyle) ? record.style as WebsiteThemeStyle : 'editorial';
  return {
    style,
    background: text(record.background, 32), foreground: text(record.foreground, 32),
    accent: text(record.accent, 32) || text(data.websiteAccent, 32),
  };
}

/**
 * The page a reader is looking at: the one the object says is active, else the first.
 * Shared so the card preview, the surface, the hero resolver and the publisher cannot
 * disagree about which page is "the" page.
 */
export function activeWebsitePage(pages: WebsitePage[], activeId?: unknown): WebsitePage | null {
  if (!pages.length) return null;
  return pages.find((page) => page.id === activeId) ?? pages[0] ?? null;
}

/**
 * The "BEFORE" — a dated photograph of the live page this design replaces.
 *
 * ── WHY A SITE OBJECT OWNS ITS OWN BEFORE ────────────────────────────────────────
 * A redesign is not a document, it is a CLAIM: this is better than that. The claim is
 * unreadable without the thing being replaced, and the canvas had nowhere to put it —
 * so "show me a before and after" produced an after, alone, and an apology (measured
 * 2026-08-19, ui 2026.8.60; see `api/src/application/web/webScreenshot.ts`).
 *
 * It lives ON the website object rather than as a loose `image` object beside it because
 * the pairing has to survive everything the object survives: a save, a duplicate, an
 * export, a marketplace listing, a share link. Two unrelated objects that a person once
 * arranged side by side are one drag away from no longer being a comparison, and nothing
 * downstream can tell that the image was ever the "before" of that particular site.
 *
 * ── WHY IT IS A CAPTURE AND NOT A URL ────────────────────────────────────────────
 * Framing the old site live would make the comparison self-erasing: the moment the
 * redesign ships, the "before" becomes the "after" and the board silently starts showing
 * two copies of the same page. Most real sites refuse third-party framing anyway. Hence
 * `capturedAt` — a before without a date is a picture, not evidence.
 */
export interface WebsiteBeforeCapture {
  /** The live page these pixels are of. */
  url: string;
  /** `data:image/…` or an https image URL. */
  imageUrl: string;
  capturedAt: string;
  /** The width the page was laid out at, so the comparison frames both halves alike. */
  viewport: CanvasViewport;
  width: number;
  height: number;
}

/**
 * Read an object's before-capture, or null when it has none.
 *
 * TOTAL and defensive for the same reason every parser in this module is: the fields may
 * arrive from a model patch, and a half-authored capture must read as "no comparison yet"
 * rather than rendering a broken image beside a finished design.
 */
export function websiteBeforeFrom(data: Record<string, unknown>): WebsiteBeforeCapture | null {
  const url = text(data.beforeUrl, 2_000);
  const imageUrl = typeof data.beforeImageUrl === 'string' ? data.beforeImageUrl.trim() : '';
  if (!url || !imageUrl) return null;
  const viewport = canvasViewport(data.beforeViewport);
  return {
    url,
    imageUrl,
    capturedAt: text(data.beforeCapturedAt, 40) ?? '',
    viewport,
    width: Number(data.beforeWidth) || CANVAS_VIEWPORT_WIDTHS[viewport],
    height: Number(data.beforeHeight) || CANVAS_VIEWPORT_CAPTURE_HEIGHTS[viewport],
  };
}

/**
 * The patch that ATTACHES a capture to a site object — one authored shape, so a capture
 * taken by Brain and one taken by a person pressing the button write identical fields.
 */
export function websiteBeforePatch(capture: {
  url: string; imageUrl: string; capturedAt?: string; viewport?: unknown; width?: number; height?: number;
}): Record<string, unknown> {
  const viewport = canvasViewport(capture.viewport);
  return {
    beforeUrl: capture.url,
    beforeImageUrl: capture.imageUrl,
    beforeCapturedAt: capture.capturedAt || new Date().toISOString(),
    beforeViewport: viewport,
    beforeWidth: capture.width || CANVAS_VIEWPORT_WIDTHS[viewport],
    beforeHeight: capture.height || CANVAS_VIEWPORT_CAPTURE_HEIGHTS[viewport],
  };
}

export function websiteHeroFrom(data: Record<string, unknown>): { heading: string; body: string; cta: string } {
  const page = activeWebsitePage(websitePagesFrom(data), data.activeWebsitePageId);
  const hero = page?.sections.find((section) => section.kind === 'hero');
  return {
    heading: hero?.heading || text(data.websiteHeadline, 240) || '',
    body: hero?.body || text(data.websiteBody) || '',
    cta: hero?.cta || text(data.websiteCta, 120) || '',
  };
}

/** AI-created sites must carry a real WYSIWYG experience, not a titled shell. */
export function authoredWebsiteProblem(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Website fields are required.';
  const fields = value as Record<string, unknown>;
  const pages = websitePagesFrom(fields);
  if (!pages.length) return 'Author fields.pages as WYSIWYG pages with name, path, and renderable sections.';
  const sections = pages.flatMap((page) => page.sections);
  if (!sections.some((section) => section.kind === 'hero' && section.heading && section.body && section.cta)) {
    return 'The WYSIWYG site needs an authored hero section with heading, body, and cta.';
  }
  if (sections.length < 2) return 'The WYSIWYG site needs at least one authored section beyond its hero.';
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════════════
   BLOCK-LEVEL OPERATIONS
   Pure functions over `pages`. Each returns a NEW array, or the input unchanged when
   the operation cannot apply — see the header for why refusal beats throwing here.
   ═══════════════════════════════════════════════════════════════════════════════════ */

export interface SectionAddress {
  /** Which page. Falls back to the active page, then the first, when absent. */
  pageId?: string;
  /** Which section within it, by its own id. */
  sectionId: string;
}

/** Seed content for a newly inserted section, per kind.
 *
 *  A section inserted EMPTY is dropped by `websiteSection` on the very next parse
 *  (it keeps only sections with content), so an "Add" that inserts nothing would read
 *  to the creator as a button that does nothing. Each kind therefore arrives with the
 *  fields its renderer draws, filled with placeholder copy the creator overwrites. */
const SECTION_SEEDS: Record<WebsiteSectionKind, Omit<WebsiteSection, 'id' | 'kind'>> = {
  hero: { heading: 'Headline', body: 'One sentence on what this does.', cta: 'Get started' },
  features: {
    heading: 'What you get',
    items: [{ title: 'First', body: 'What it does.' }, { title: 'Second', body: 'What it does.' }],
  },
  content: { heading: 'About', body: 'Say more here.' },
  stats: { items: [{ value: '0', label: 'Add a number' }, { value: '0', label: 'And another' }] },
  testimonial: { quote: 'What somebody said about this.', author: 'Their name' },
  cta: { heading: 'Ready?', cta: 'Get started' },
};

function pageIndexFor(pages: WebsitePage[], pageId: string | undefined, activeId?: unknown): number {
  if (pageId) {
    const explicit = pages.findIndex((page) => page.id === pageId);
    if (explicit >= 0) return explicit;
  }
  const active = pages.findIndex((page) => page.id === activeId);
  return active >= 0 ? active : 0;
}

/** Give a new section an id nothing else on the page holds. */
function freshSectionId(page: WebsitePage, kind: WebsiteSectionKind): string {
  const taken = new Set(page.sections.map((section) => section.id));
  for (let n = page.sections.length + 1; ; n += 1) {
    const candidate = `${kind}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function replacePage(pages: WebsitePage[], index: number, sections: WebsiteSection[]): WebsitePage[] {
  return pages.map((page, at) => (at === index ? { ...page, sections } : page));
}

/**
 * Insert a section of `kind` after `afterSectionId` (or at the end).
 * Refused when the kind is not addable or the page is already at its cap.
 */
export function insertWebsiteSection(
  pages: WebsitePage[],
  kind: WebsiteSectionKind,
  options: { pageId?: string; activePageId?: unknown; afterSectionId?: string } = {},
): WebsitePage[] {
  if (!isWebsiteSectionKind(kind) || kind === 'hero') return pages;
  const index = pageIndexFor(pages, options.pageId, options.activePageId);
  const page = pages[index];
  if (!page || page.sections.length >= WEBSITE_MAX_SECTIONS) return pages;

  const section: WebsiteSection = { id: freshSectionId(page, kind), kind, ...SECTION_SEEDS[kind] };
  const at = options.afterSectionId
    ? page.sections.findIndex((candidate) => candidate.id === options.afterSectionId)
    : -1;
  const sections = [...page.sections];
  sections.splice(at >= 0 ? at + 1 : sections.length, 0, section);
  return replacePage(pages, index, sections);
}

/** Move a section one slot up or down. A move off either end is a no-op, not a wrap. */
export function moveWebsiteSection(
  pages: WebsitePage[],
  address: SectionAddress,
  direction: 'up' | 'down',
  activePageId?: unknown,
): WebsitePage[] {
  const index = pageIndexFor(pages, address.pageId, activePageId);
  const page = pages[index];
  if (!page) return pages;
  const from = page.sections.findIndex((section) => section.id === address.sectionId);
  if (from < 0) return pages;
  const to = direction === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= page.sections.length) return pages;

  const sections = [...page.sections];
  const [moved] = sections.splice(from, 1);
  if (!moved) return pages;
  sections.splice(to, 0, moved);
  return replacePage(pages, index, sections);
}

/**
 * Delete a section. Refused for the page's last remaining section and for its hero —
 * a page that parses to zero sections is dropped entirely by `websitePagesFrom`, so
 * deleting the last one would delete the page as a side effect of editing it.
 */
export function deleteWebsiteSection(
  pages: WebsitePage[],
  address: SectionAddress,
  activePageId?: unknown,
): WebsitePage[] {
  const index = pageIndexFor(pages, address.pageId, activePageId);
  const page = pages[index];
  if (!page || page.sections.length <= 1) return pages;
  const target = page.sections.find((section) => section.id === address.sectionId);
  if (!target || target.kind === 'hero') return pages;
  return replacePage(pages, index, page.sections.filter((section) => section.id !== address.sectionId));
}

/** Duplicate a section directly below itself, with a fresh id. */
export function duplicateWebsiteSection(
  pages: WebsitePage[],
  address: SectionAddress,
  activePageId?: unknown,
): WebsitePage[] {
  const index = pageIndexFor(pages, address.pageId, activePageId);
  const page = pages[index];
  if (!page || page.sections.length >= WEBSITE_MAX_SECTIONS) return pages;
  const at = page.sections.findIndex((section) => section.id === address.sectionId);
  const source = page.sections[at];
  if (!source || source.kind === 'hero') return pages;

  const sections = [...page.sections];
  sections.splice(at + 1, 0, { ...source, id: freshSectionId(page, source.kind) });
  return replacePage(pages, index, sections);
}

/** Edit one section's own fields. Its `id` and `kind` are not patchable — changing
 *  either is an insert plus a delete, and both of those already exist. */
export function patchWebsiteSection(
  pages: WebsitePage[],
  address: SectionAddress,
  patch: Partial<Omit<WebsiteSection, 'id' | 'kind'>>,
  activePageId?: unknown,
): WebsitePage[] {
  const index = pageIndexFor(pages, address.pageId, activePageId);
  const page = pages[index];
  if (!page) return pages;
  const at = page.sections.findIndex((section) => section.id === address.sectionId);
  const target = page.sections[at];
  if (!target) return pages;
  return replacePage(
    pages,
    index,
    page.sections.map((section, slot) => (slot === at ? { ...section, ...patch } : section)),
  );
}

/** Whether each operation is available for this section, so a consumer never
 *  re-derives the rules above to decide what to disable. */
export function websiteSectionCapabilities(
  page: WebsitePage | null,
  sectionId: string,
): { canMoveUp: boolean; canMoveDown: boolean; canDelete: boolean; canDuplicate: boolean } {
  const none = { canMoveUp: false, canMoveDown: false, canDelete: false, canDuplicate: false };
  if (!page) return none;
  const at = page.sections.findIndex((section) => section.id === sectionId);
  const section = page.sections[at];
  if (!section) return none;
  const structural = section.kind !== 'hero';
  return {
    canMoveUp: at > 0,
    canMoveDown: at >= 0 && at < page.sections.length - 1,
    canDelete: structural && page.sections.length > 1,
    canDuplicate: structural && page.sections.length < WEBSITE_MAX_SECTIONS,
  };
}
