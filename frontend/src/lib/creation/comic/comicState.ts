/**
 * The comic object's authored state: pages of panels, panels of art and lettering,
 * and — optionally — branches that turn a linear comic into a choose-your-path one.
 * It lives on the object as `data.comicPages` (with the page size in `comicWidth` /
 * `comicHeight`) and round-trips as JSON.
 *
 * Coordinates are FRACTIONS (0..1) of the thing that contains them — a panel of its
 * page, a bubble of its panel — so the same state draws at any size: the card, the
 * reader and the 1200 px export all read it unchanged.
 *
 * Everything here is pure. Mutators return a new state and leave untouched pages and
 * panels reference-equal.
 */

export const COMIC_SCHEMA_VERSION = 1;
export const DEFAULT_COMIC_WIDTH = 800;
export const DEFAULT_COMIC_HEIGHT = 1200;
/** Space between panels and around the page, as a fraction of the page width. */
export const COMIC_GUTTER = 0.03;

export type ComicBubbleKind = 'speech' | 'thought' | 'caption';
export type ComicLayoutId = 'single' | 'stacked' | 'headline' | 'grid';

export interface ComicBubble {
  id: string;
  kind: ComicBubbleKind;
  /** Centre of the bubble, as a fraction of its panel. */
  x: number;
  y: number;
  text: string;
}

export interface ComicPanel {
  id: string;
  /** Position and size as fractions of the page. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** An https: image (uploaded art) or, for a guest, a complete data: image; null leaves the panel empty. */
  imageUrl: string | null;
  /** The stored art was unusable (a truncated or malformed data URL), so the panel shows "image missing". Never written back. */
  imageMissing?: boolean;
  bubbles: ComicBubble[];
}

export interface ComicBranch {
  id: string;
  label: string;
  targetPageId: string;
  flagsToSet: string[];
}

export interface ComicPage {
  id: string;
  panels: ComicPanel[];
  /** Empty means the reader falls through to the next page by order. */
  branches: ComicBranch[];
}

export interface ComicState {
  schemaVersion: number;
  width: number;
  height: number;
  pages: ComicPage[];
}

export const COMIC_LAYOUTS: readonly ComicLayoutId[] = ['single', 'stacked', 'headline', 'grid'];

const newId = (prefix: string): string => `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

type Cell = readonly [x: number, y: number, w: number, h: number];

/** Panel rectangles for a layout, as fractions of the page, gutters included. */
export function layoutCells(layout: ComicLayoutId, pageWidth = DEFAULT_COMIC_WIDTH, pageHeight = DEFAULT_COMIC_HEIGHT): Cell[] {
  const gx = COMIC_GUTTER;
  const gy = (COMIC_GUTTER * pageWidth) / pageHeight;
  const innerW = 1 - gx * 2;
  const innerH = 1 - gy * 2;
  const halfW = (innerW - gx) / 2;
  const halfH = (innerH - gy) / 2;
  switch (layout) {
    case 'single': return [[gx, gy, innerW, innerH]];
    case 'stacked': return [[gx, gy, innerW, halfH], [gx, gy * 2 + halfH, innerW, halfH]];
    case 'headline': return [[gx, gy, innerW, halfH], [gx, gy * 2 + halfH, halfW, halfH], [gx * 2 + halfW, gy * 2 + halfH, halfW, halfH]];
    case 'grid': return [
      [gx, gy, halfW, halfH], [gx * 2 + halfW, gy, halfW, halfH],
      [gx, gy * 2 + halfH, halfW, halfH], [gx * 2 + halfW, gy * 2 + halfH, halfW, halfH],
    ];
  }
}

function panelsForLayout(layout: ComicLayoutId, state: Pick<ComicState, 'width' | 'height'>, previous: readonly ComicPanel[] = []): ComicPanel[] {
  return layoutCells(layout, state.width, state.height).map(([x, y, w, h], index) => ({
    // A relayout keeps the art and lettering already placed, by position in reading order.
    id: previous[index]?.id ?? newId('panel'),
    x, y, w, h,
    imageUrl: previous[index]?.imageUrl ?? null,
    bubbles: previous[index]?.bubbles ?? [],
  }));
}

/** Which layout a page's panels match, or null once they have been hand-placed. */
export function layoutOf(page: ComicPage, state: Pick<ComicState, 'width' | 'height'>): ComicLayoutId | null {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  return COMIC_LAYOUTS.find((layout) => {
    const cells = layoutCells(layout, state.width, state.height);
    return cells.length === page.panels.length && cells.every(([x, y, w, h], i) => {
      const panel = page.panels[i]!;
      return near(panel.x, x) && near(panel.y, y) && near(panel.w, w) && near(panel.h, h);
    });
  }) ?? null;
}

export function createComicPage(state: Pick<ComicState, 'width' | 'height'>, layout: ComicLayoutId = 'headline'): ComicPage {
  return { id: newId('page'), panels: panelsForLayout(layout, state), branches: [] };
}

export function createBlankComicState(): ComicState {
  const size = { width: DEFAULT_COMIC_WIDTH, height: DEFAULT_COMIC_HEIGHT };
  return { schemaVersion: COMIC_SCHEMA_VERSION, ...size, pages: [createComicPage(size)] };
}

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const DATA_IMAGE = /^data:image\/(png|jpe?g|gif|webp|avif);base64,([A-Za-z0-9+/]+={0,2})$/i;

/** The bytes at the end of a base64 payload (the last 16 chars decode to at most 12). */
function tailBytes(payload: string): Uint8Array | null {
  try {
    const binary = atob(payload.slice(-16));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch { return null; }
}

/**
 * A data URL that decodes AND ends the way its format ends. A model-facing patch cuts
 * strings at 40k characters, which leaves a well-formed-looking prefix of a picture; the
 * base64 length check alone cannot see that (40 000 is a multiple of 4), so the check is
 * on the format's own trailer: PNG `IEND`, JPEG `FFD9`, GIF `3B`, WebP's RIFF length.
 */
export function isCompleteImageDataUrl(value: string): boolean {
  const match = DATA_IMAGE.exec(value);
  if (!match) return false;
  const payload = match[2]!;
  if (payload.length < 16 || payload.length % 4 !== 0) return false;
  const tail = tailBytes(payload);
  if (!tail) return false;
  const type = match[1]!.toLowerCase();
  const endsWith = (bytes: number[]): boolean => bytes.every((byte, i) => tail[tail.length - bytes.length + i] === byte);
  if (type === 'png') return endsWith([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
  if (type === 'jpg' || type === 'jpeg') return tail.slice(-6).some((byte, i, last) => byte === 0xff && last[i + 1] === 0xd9);
  if (type === 'gif') return tail[tail.length - 1] === 0x3b;
  if (type === 'webp') {
    const header = atob(payload.slice(0, 16));
    const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
    const total = (payload.length / 4) * 3 - padding;
    const declared = header.charCodeAt(4) | (header.charCodeAt(5) << 8) | (header.charCodeAt(6) << 16) | (header.charCodeAt(7) << 24);
    return header.startsWith('RIFF') && declared + 8 === total;
  }
  return true;
}

const isImageUrl = (value: unknown): value is string =>
  typeof value === 'string' && (/^https:\/\//i.test(value) || isCompleteImageDataUrl(value));
/** Whatever is stored on the object, made into a state the editor can trust. */
export function readComicState(pages: unknown, width?: unknown, height?: unknown): ComicState {
  const size = {
    width: typeof width === 'number' && width >= 100 && width <= 4000 ? Math.round(width) : DEFAULT_COMIC_WIDTH,
    height: typeof height === 'number' && height >= 100 && height <= 6000 ? Math.round(height) : DEFAULT_COMIC_HEIGHT,
  };
  const readPages: ComicPage[] = Array.isArray(pages)
    ? pages.flatMap((entry): ComicPage[] => {
      if (!entry || typeof entry !== 'object') return [];
      const raw = entry as Record<string, unknown>;
      const panels = Array.isArray(raw.panels) ? raw.panels.flatMap((p): ComicPanel[] => {
        if (!p || typeof p !== 'object') return [];
        const panel = p as Record<string, unknown>;
        const bubbles = Array.isArray(panel.bubbles) ? panel.bubbles.flatMap((b): ComicBubble[] => {
          if (!b || typeof b !== 'object') return [];
          const bubble = b as Record<string, unknown>;
          return [{
            id: text(bubble.id, 64) || newId('bubble'),
            kind: bubble.kind === 'thought' || bubble.kind === 'caption' ? bubble.kind : 'speech',
            x: clamp01(bubble.x, 0.5), y: clamp01(bubble.y, 0.2),
            text: text(bubble.text, 500),
          }];
        }) : [];
        const w = Math.max(0.05, clamp01(panel.w, 0.5));
        const h = Math.max(0.05, clamp01(panel.h, 0.5));
        return [{
          id: text(panel.id, 64) || newId('panel'),
          x: Math.min(clamp01(panel.x, 0), 1 - w), y: Math.min(clamp01(panel.y, 0), 1 - h), w, h,
          imageUrl: isImageUrl(panel.imageUrl) ? panel.imageUrl : null,
          // Something was stored but it is not usable art (e.g. a truncated data URL).
          ...(typeof panel.imageUrl === 'string' && panel.imageUrl !== '' && !isImageUrl(panel.imageUrl) ? { imageMissing: true } : {}),
          bubbles,
        }];
      }) : [];
      const branches = Array.isArray(raw.branches) ? raw.branches.flatMap((b): ComicBranch[] => {
        if (!b || typeof b !== 'object') return [];
        const branch = b as Record<string, unknown>;
        return [{
          id: text(branch.id, 64) || newId('branch'),
          label: text(branch.label, 120),
          targetPageId: text(branch.targetPageId, 64),
          flagsToSet: Array.isArray(branch.flagsToSet) ? branch.flagsToSet.filter((f): f is string => typeof f === 'string').map((f) => f.slice(0, 40)).slice(0, 20) : [],
        }];
      }) : [];
      return [{ id: text(raw.id, 64) || newId('page'), panels, branches }];
    })
    : [];
  if (!readPages.length) return { ...createBlankComicState(), ...size };
  return { schemaVersion: COMIC_SCHEMA_VERSION, ...size, pages: readPages };
}

function mapPage(state: ComicState, pageId: string, change: (page: ComicPage) => ComicPage): ComicState {
  return { ...state, pages: state.pages.map((page) => page.id === pageId ? change(page) : page) };
}

export function addComicPage(state: ComicState, layout: ComicLayoutId = 'headline', afterPageId?: string): { state: ComicState; pageId: string } {
  const page = createComicPage(state, layout);
  const index = afterPageId ? state.pages.findIndex((p) => p.id === afterPageId) : -1;
  const pages = [...state.pages];
  pages.splice(index === -1 ? pages.length : index + 1, 0, page);
  return { state: { ...state, pages }, pageId: page.id };
}

/** Remove a page (the last cannot go) and any branch that pointed at it. */
export function removeComicPage(state: ComicState, pageId: string): { state: ComicState; selectedId: string } {
  const index = state.pages.findIndex((p) => p.id === pageId);
  if (state.pages.length <= 1 || index === -1) return { state, selectedId: pageId };
  const pages = state.pages.filter((p) => p.id !== pageId).map((page) =>
    page.branches.some((b) => b.targetPageId === pageId)
      ? { ...page, branches: page.branches.filter((b) => b.targetPageId !== pageId) }
      : page);
  return { state: { ...state, pages }, selectedId: pages[Math.max(0, index - 1)]!.id };
}

export function moveComicPage(state: ComicState, pageId: string, destIndex: number): ComicState {
  const index = state.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return state;
  const target = Math.max(0, Math.min(state.pages.length - 1, destIndex));
  if (target === index) return state;
  const pages = [...state.pages];
  const [moved] = pages.splice(index, 1);
  pages.splice(target, 0, moved!);
  return { ...state, pages };
}

export function setComicLayout(state: ComicState, pageId: string, layout: ComicLayoutId): ComicState {
  return mapPage(state, pageId, (page) => ({ ...page, panels: panelsForLayout(layout, state, page.panels) }));
}

export function updateComicPanel(state: ComicState, pageId: string, panelId: string, patch: Partial<Pick<ComicPanel, 'imageUrl'>>): ComicState {
  return mapPage(state, pageId, (page) => ({ ...page, panels: page.panels.map((p) => p.id === panelId ? { ...p, ...patch } : p) }));
}

export function addComicBubble(state: ComicState, pageId: string, panelId: string, kind: ComicBubbleKind = 'speech'): { state: ComicState; bubbleId: string } {
  const bubble: ComicBubble = { id: newId('bubble'), kind, x: 0.5, y: kind === 'caption' ? 0.1 : 0.25, text: '' };
  return {
    state: mapPage(state, pageId, (page) => ({
      ...page, panels: page.panels.map((p) => p.id === panelId ? { ...p, bubbles: [...p.bubbles, bubble] } : p),
    })),
    bubbleId: bubble.id,
  };
}

export function updateComicBubble(state: ComicState, pageId: string, panelId: string, bubbleId: string, patch: Partial<Omit<ComicBubble, 'id'>>): ComicState {
  const next = { ...patch };
  if (next.x !== undefined) next.x = clamp01(next.x, 0.5);
  if (next.y !== undefined) next.y = clamp01(next.y, 0.5);
  return mapPage(state, pageId, (page) => ({
    ...page,
    panels: page.panels.map((p) => p.id === panelId ? { ...p, bubbles: p.bubbles.map((b) => b.id === bubbleId ? { ...b, ...next } : b) } : p),
  }));
}

export function removeComicBubble(state: ComicState, pageId: string, panelId: string, bubbleId: string): ComicState {
  return mapPage(state, pageId, (page) => ({
    ...page, panels: page.panels.map((p) => p.id === panelId ? { ...p, bubbles: p.bubbles.filter((b) => b.id !== bubbleId) } : p),
  }));
}

export function addComicBranch(state: ComicState, pageId: string): ComicState {
  const index = state.pages.findIndex((p) => p.id === pageId);
  const target = state.pages[index + 1] ?? state.pages[0];
  const branch: ComicBranch = { id: newId('branch'), label: '', targetPageId: target?.id ?? pageId, flagsToSet: [] };
  return mapPage(state, pageId, (page) => ({ ...page, branches: [...page.branches, branch] }));
}

export function updateComicBranch(state: ComicState, pageId: string, branchId: string, patch: Partial<Omit<ComicBranch, 'id'>>): ComicState {
  return mapPage(state, pageId, (page) => ({ ...page, branches: page.branches.map((b) => b.id === branchId ? { ...b, ...patch } : b) }));
}

export function removeComicBranch(state: ComicState, pageId: string, branchId: string): ComicState {
  return mapPage(state, pageId, (page) => ({ ...page, branches: page.branches.filter((b) => b.id !== branchId) }));
}

/** True once any page offers a choice — the comic is then read as a path, not a scroll. */
export function isInteractiveComic(state: ComicState): boolean {
  return state.pages.some((page) => page.branches.length > 0);
}

/**
 * Where the reader goes from `page`: the chosen branch's target, or — when the page has
 * no branches — the next page by order. Null at the end. A branch whose target no longer
 * exists is skipped rather than followed.
 */
export function nextComicPageId(state: ComicState, pageId: string, branchId?: string): string | null {
  const index = state.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return null;
  const page = state.pages[index]!;
  if (page.branches.length) {
    const chosen = page.branches.find((b) => b.id === branchId);
    return chosen && state.pages.some((p) => p.id === chosen.targetPageId) ? chosen.targetPageId : null;
  }
  return state.pages[index + 1]?.id ?? null;
}
