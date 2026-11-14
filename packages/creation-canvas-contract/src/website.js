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
import { CANVAS_VIEWPORT_CAPTURE_HEIGHTS, CANVAS_VIEWPORT_WIDTHS, canvasViewport, } from './viewport';
/** The declared section vocabulary. A section kind is a VALUE, never a new shape. */
export const WEBSITE_SECTION_KINDS = ['hero', 'features', 'content', 'stats', 'testimonial', 'cta'];
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
export const WEBSITE_THEME_STYLES = ['editorial', 'bold', 'minimal', 'soft', 'technical'];
const SECTION_KINDS = new Set(WEBSITE_SECTION_KINDS);
const THEME_STYLES = new Set(WEBSITE_THEME_STYLES);
export function isWebsiteSectionKind(value) {
    return typeof value === 'string' && SECTION_KINDS.has(value);
}
/**
 * A `content` section whose body is real markup — a model-authored `<form>` plus its
 * `<script>` — rather than prose. Both renderers (the React editor and the static
 * publisher) need the SAME answer to "is this HTML or text", or one would sandbox a
 * section the other prints as an escaped paragraph.
 */
export function isMarkupSectionBody(section) {
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
function text(value, max = 2_000) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
}
function slug(value, fallback) {
    const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return normalized || fallback;
}
function websiteItems(value) {
    if (!Array.isArray(value))
        return undefined;
    const items = value.slice(0, 8).flatMap((entry) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
            return [];
        const record = entry;
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
export function websiteSection(value, index) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    if (!isWebsiteSectionKind(record.kind))
        return null;
    const kind = record.kind;
    const section = {
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
export function websitePagesFrom(data) {
    if (!Array.isArray(data.pages))
        return [];
    return data.pages.slice(0, WEBSITE_MAX_PAGES).flatMap((value, pageIndex) => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return [];
        const record = value;
        const name = text(record.name, 100);
        const sections = Array.isArray(record.sections)
            ? record.sections.slice(0, WEBSITE_MAX_SECTIONS).map(websiteSection).filter((section) => section != null)
            : [];
        if (!name || !sections.length)
            return [];
        const id = text(record.id, 100) || slug(name, `page-${pageIndex + 1}`);
        return [{ id, name, path: text(record.path, 160) || (pageIndex === 0 ? '/' : `/${slug(name, id)}`), sections }];
    });
}
export function websiteThemeFrom(data) {
    const record = data.websiteTheme && typeof data.websiteTheme === 'object' && !Array.isArray(data.websiteTheme)
        ? data.websiteTheme : {};
    const style = THEME_STYLES.has(record.style) ? record.style : 'editorial';
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
export function activeWebsitePage(pages, activeId) {
    if (!pages.length)
        return null;
    return pages.find((page) => page.id === activeId) ?? pages[0] ?? null;
}
/**
 * Read an object's before-capture, or null when it has none.
 *
 * TOTAL and defensive for the same reason every parser in this module is: the fields may
 * arrive from a model patch, and a half-authored capture must read as "no comparison yet"
 * rather than rendering a broken image beside a finished design.
 */
export function websiteBeforeFrom(data) {
    const url = text(data.beforeUrl, 2_000);
    const imageUrl = typeof data.beforeImageUrl === 'string' ? data.beforeImageUrl.trim() : '';
    if (!url || !imageUrl)
        return null;
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
export function websiteBeforePatch(capture) {
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
export function websiteHeroFrom(data) {
    const page = activeWebsitePage(websitePagesFrom(data), data.activeWebsitePageId);
    const hero = page?.sections.find((section) => section.kind === 'hero');
    return {
        heading: hero?.heading || text(data.websiteHeadline, 240) || '',
        body: hero?.body || text(data.websiteBody) || '',
        cta: hero?.cta || text(data.websiteCta, 120) || '',
    };
}
/** AI-created sites must carry a real WYSIWYG experience, not a titled shell. */
export function authoredWebsiteProblem(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return 'Website fields are required.';
    const fields = value;
    const pages = websitePagesFrom(fields);
    if (!pages.length)
        return 'Author fields.pages as WYSIWYG pages with name, path, and renderable sections.';
    const sections = pages.flatMap((page) => page.sections);
    if (!sections.some((section) => section.kind === 'hero' && section.heading && section.body && section.cta)) {
        return 'The WYSIWYG site needs an authored hero section with heading, body, and cta.';
    }
    if (sections.length < 2)
        return 'The WYSIWYG site needs at least one authored section beyond its hero.';
    return null;
}
/** Seed content for a newly inserted section, per kind.
 *
 *  A section inserted EMPTY is dropped by `websiteSection` on the very next parse
 *  (it keeps only sections with content), so an "Add" that inserts nothing would read
 *  to the creator as a button that does nothing. Each kind therefore arrives with the
 *  fields its renderer draws, filled with placeholder copy the creator overwrites. */
const SECTION_SEEDS = {
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
function pageIndexFor(pages, pageId, activeId) {
    if (pageId) {
        const explicit = pages.findIndex((page) => page.id === pageId);
        if (explicit >= 0)
            return explicit;
    }
    const active = pages.findIndex((page) => page.id === activeId);
    return active >= 0 ? active : 0;
}
/** Give a new section an id nothing else on the page holds. */
function freshSectionId(page, kind) {
    const taken = new Set(page.sections.map((section) => section.id));
    for (let n = page.sections.length + 1;; n += 1) {
        const candidate = `${kind}-${n}`;
        if (!taken.has(candidate))
            return candidate;
    }
}
function replacePage(pages, index, sections) {
    return pages.map((page, at) => (at === index ? { ...page, sections } : page));
}
/**
 * Insert a section of `kind` after `afterSectionId` (or at the end).
 * Refused when the kind is not addable or the page is already at its cap.
 */
export function insertWebsiteSection(pages, kind, options = {}) {
    if (!isWebsiteSectionKind(kind) || kind === 'hero')
        return pages;
    const index = pageIndexFor(pages, options.pageId, options.activePageId);
    const page = pages[index];
    if (!page || page.sections.length >= WEBSITE_MAX_SECTIONS)
        return pages;
    const section = { id: freshSectionId(page, kind), kind, ...SECTION_SEEDS[kind] };
    const at = options.afterSectionId
        ? page.sections.findIndex((candidate) => candidate.id === options.afterSectionId)
        : -1;
    const sections = [...page.sections];
    sections.splice(at >= 0 ? at + 1 : sections.length, 0, section);
    return replacePage(pages, index, sections);
}
/** Move a section one slot up or down. A move off either end is a no-op, not a wrap. */
export function moveWebsiteSection(pages, address, direction, activePageId) {
    const index = pageIndexFor(pages, address.pageId, activePageId);
    const page = pages[index];
    if (!page)
        return pages;
    const from = page.sections.findIndex((section) => section.id === address.sectionId);
    if (from < 0)
        return pages;
    const to = direction === 'up' ? from - 1 : from + 1;
    if (to < 0 || to >= page.sections.length)
        return pages;
    const sections = [...page.sections];
    const [moved] = sections.splice(from, 1);
    if (!moved)
        return pages;
    sections.splice(to, 0, moved);
    return replacePage(pages, index, sections);
}
/**
 * Delete a section. Refused for the page's last remaining section and for its hero —
 * a page that parses to zero sections is dropped entirely by `websitePagesFrom`, so
 * deleting the last one would delete the page as a side effect of editing it.
 */
export function deleteWebsiteSection(pages, address, activePageId) {
    const index = pageIndexFor(pages, address.pageId, activePageId);
    const page = pages[index];
    if (!page || page.sections.length <= 1)
        return pages;
    const target = page.sections.find((section) => section.id === address.sectionId);
    if (!target || target.kind === 'hero')
        return pages;
    return replacePage(pages, index, page.sections.filter((section) => section.id !== address.sectionId));
}
/** Duplicate a section directly below itself, with a fresh id. */
export function duplicateWebsiteSection(pages, address, activePageId) {
    const index = pageIndexFor(pages, address.pageId, activePageId);
    const page = pages[index];
    if (!page || page.sections.length >= WEBSITE_MAX_SECTIONS)
        return pages;
    const at = page.sections.findIndex((section) => section.id === address.sectionId);
    const source = page.sections[at];
    if (!source || source.kind === 'hero')
        return pages;
    const sections = [...page.sections];
    sections.splice(at + 1, 0, { ...source, id: freshSectionId(page, source.kind) });
    return replacePage(pages, index, sections);
}
/** Edit one section's own fields. Its `id` and `kind` are not patchable — changing
 *  either is an insert plus a delete, and both of those already exist. */
export function patchWebsiteSection(pages, address, patch, activePageId) {
    const index = pageIndexFor(pages, address.pageId, activePageId);
    const page = pages[index];
    if (!page)
        return pages;
    const at = page.sections.findIndex((section) => section.id === address.sectionId);
    const target = page.sections[at];
    if (!target)
        return pages;
    return replacePage(pages, index, page.sections.map((section, slot) => (slot === at ? { ...section, ...patch } : section)));
}
/** Whether each operation is available for this section, so a consumer never
 *  re-derives the rules above to decide what to disable. */
export function websiteSectionCapabilities(page, sectionId) {
    const none = { canMoveUp: false, canMoveDown: false, canDelete: false, canDuplicate: false };
    if (!page)
        return none;
    const at = page.sections.findIndex((section) => section.id === sectionId);
    const section = page.sections[at];
    if (!section)
        return none;
    const structural = section.kind !== 'hero';
    return {
        canMoveUp: at > 0,
        canMoveDown: at >= 0 && at < page.sections.length - 1,
        canDelete: structural && page.sections.length > 1,
        canDuplicate: structural && page.sections.length < WEBSITE_MAX_SECTIONS,
    };
}
//# sourceMappingURL=website.js.map