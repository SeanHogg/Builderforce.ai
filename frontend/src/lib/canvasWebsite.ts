/**
 * A `website` / `prototype` object as the DOCUMENT it actually is.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The canvas drew authored sites twice, from two different sources of truth. The
 * publisher and the `app` runtime rendered the real thing through
 * `renderWebsiteDocument` — a self-contained page with its own palette, its own type
 * scale and its own responsive rules. The BOARD drew a hand-built React approximation of
 * that page instead: `.wysiwygHero`, `.wysiwygFeatures`, decorative blocks standing in
 * for artwork, and a type scale of 6–9px chosen to look like a thumbnail. Two renderers
 * of one artifact is the drift this canvas keeps extracting primitives to stop, and here
 * it had already produced three visible defects — the card showed a page the visitor will
 * never see, that page was styled by the app's own tokens and flipped with the app's own
 * light/dark theme, and the sections the document renders in full (a features grid, a
 * stats band, an embedded markup block) arrived as a heading and a line of prose.
 *
 * So the object has ONE rendering, and this is where a canvas node is turned into it.
 * `canvasApp.ts` composes it with the board's loose `code` cards; the card and the `site`
 * surface frame it directly.
 */

import {
  WEBSITE_CONTENT_FRAME_SANDBOX,
  renderWebsiteDocument,
  websitePagesFrom,
  websiteThemeFrom,
} from '@builderforce/creation-canvas-contract';

/**
 * The sandbox a preview frame runs the document under.
 *
 * `allow-scripts` for the document's own page switcher — the ONE script it adds itself —
 * and `allow-forms` so an authored form still behaves like a form. Never
 * `allow-same-origin`: with `allow-scripts` the pair lets the frame reach this page's
 * cookies, storage and session token and drop its own sandbox, which together are
 * equivalent to no sandbox at all. It is the same rule `CANVAS_APP_FRAME_SANDBOX` and
 * `GAME_FRAME_SANDBOX` follow, and the same capability set the document already uses for
 * the markup blocks it embeds inside itself — so it is that constant, not a fourth copy.
 */
export const CANVAS_WEBSITE_FRAME_SANDBOX = WEBSITE_CONTENT_FRAME_SANDBOX;

/**
 * What a framed preview posts back when the reader clicks the document's own page nav.
 *
 * The nav lives inside the frame, so without this the board could never learn which page
 * is open and the card would disagree with the full-size surface about it — which is the
 * one thing a person switches surfaces to check.
 */
export const CANVAS_WEBSITE_PAGE_MESSAGE = 'builderforce:canvas-website-page';

export interface CanvasWebsiteDocumentOptions {
  /**
   * Which mode to paint in. Previews pin it (see `WebsiteDocumentOptions.colorScheme`):
   * a card that followed the board's theme would be showing the author a page their
   * visitors may never see. `'auto'` is the published site's answer, not a preview's.
   */
  colorScheme?: 'auto' | 'light' | 'dark';
  /** Report page switches back to the embedder. Only a frame the board can write from. */
  reportPageChanges?: boolean;
}

/** The page id a `{ tag, pageId }` message carries, or null when it is not one of ours. */
export function canvasWebsitePageMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const message = payload as { tag?: unknown; pageId?: unknown };
  if (message.tag !== CANVAS_WEBSITE_PAGE_MESSAGE) return null;
  return typeof message.pageId === 'string' && message.pageId ? message.pageId : null;
}

/**
 * The object rendered to one self-contained document, or null when it holds no page yet.
 *
 * Null is the honest answer for a site the author has only named: `renderWebsiteDocument`
 * refuses to produce an empty shell, and a caller that framed one anyway would replace a
 * legible "here is your headline, add a section" with a blank white rectangle.
 */
export function canvasWebsiteDocument(
  data: { [key: string]: unknown },
  options: CanvasWebsiteDocumentOptions = {},
): string | null {
  const pages = websitePagesFrom(data);
  if (!pages.length) return null;
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  return renderWebsiteDocument(pages, websiteThemeFrom(data), {
    // No `enterPath`: a preview has no shop-window door to open — that framing belongs to
    // the PUBLISHED site (`siteLandingPage.ts`), never to a board's own preview.
    brand: title || 'Site',
    activePageId: data.activeWebsitePageId,
    colorScheme: options.colorScheme ?? 'light',
    ...(options.reportPageChanges ? { pageMessageTag: CANVAS_WEBSITE_PAGE_MESSAGE } : {}),
  });
}
