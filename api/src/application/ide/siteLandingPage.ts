/**
 * The creator's own shop window — a `website` canvas object rendered to a static
 * document and published with the app it sells.
 *
 * ── THE DECISION THIS IMPLEMENTS ─────────────────────────────────────────────────
 * Two shop windows, one product: the marketplace listing sells the app inside the
 * marketplace, and this sells it in the creator's own brand on their own address.
 * A visitor who is not yet a user of the app is served THIS; a signed-in user is
 * served the app. One fork, in `tryServeHostedSite`, reading one rule.
 *
 * ── WHY THE RENDERER LIVES IN THE CONTRACT, NOT HERE ─────────────────────────────
 * The canvas draws this same object as React on the `site` surface, and the canvas
 * `app` surface (`canvasApp.ts`) draws it a THIRD way — inlined beside a board's
 * `code` objects so a website-plus-backend pair runs as one preview. Three callers
 * that cannot share a framework (this one is a Worker with no React; `canvasApp.ts`
 * is a browser lib with no server) but must agree on every pixel, or a section kind
 * one of them forgets is a page the others show. `renderWebsiteDocument` in
 * `@builderforce/creation-canvas-contract` is that one renderer; this module supplies
 * only what is specific to PUBLISHING it — the door back into the signed-in app, and
 * where the resulting document lives in a release.
 */

import { and, eq } from 'drizzle-orm';
import {
  escapeHtml,
  renderWebsiteDocument,
  websitePagesFrom,
  websiteThemeFrom,
  type WebsitePage,
  type WebsiteTheme,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { ENTER_APP_PARAM } from './siteVisitor';
import {
  creationSessionObjects,
  creationSessionProjectLinks,
  SESSION_PROJECT_LINK_APP,
} from '../../infrastructure/database/schema';

export { escapeHtml };

/**
 * Where the landing document lives inside a release's own version prefix.
 *
 * Inside the version prefix rather than beside it so a rollback restores the landing
 * page and the build it shipped with as one pair — the whole point of publishing them
 * together. The leading `__` matches the reserved `/__api/` convention, and
 * `publishStaticSite` refuses an uploaded asset at this exact path so a build can never
 * claim it.
 */
export const SITE_LANDING_KEY = '__landing.html';

export interface LandingSource {
  /** The canvas object the document was rendered from — stored on the site so the
   *  next publish re-renders the SAME object rather than re-guessing. */
  objectId: string;
  html: string;
}

/**
 * The app's door, seen from the shop window.
 *
 * The app lives at the site root and the fork claims the site root, so every way into
 * the product carries the opt-out parameter — otherwise a visitor who presses "Open
 * the app" is handed the landing page again and the shop window has no exit.
 */
export const ENTER_APP_HREF = `/?${ENTER_APP_PARAM}=1`;

export interface RenderLandingInput {
  pages: WebsitePage[];
  theme: WebsiteTheme;
  /** The site's own name, shown in the nav. */
  brand: string;
  /** Where "Open the app" goes. Always a path on this same site. */
  enterPath?: string;
  /** Label for the button that leaves the shop window and enters the product. */
  enterLabel?: string;
  activePageId?: unknown;
}

/**
 * Render the authored website to ONE self-contained HTML document, with the shop
 * window's own door back into the signed-in app — the framing `renderWebsiteDocument`
 * does not supply on its own, because the canvas `app` surface has no such door.
 */
export function renderLandingPage(input: RenderLandingInput): string | null {
  return renderWebsiteDocument(input.pages, input.theme, {
    brand: input.brand,
    enterPath: input.enterPath ?? ENTER_APP_HREF,
    enterLabel: input.enterLabel ?? 'Open the app',
    activePageId: input.activePageId,
  });
}

/**
 * Find the `website` object that IS this project's landing page, and render it.
 *
 * ── WHY THIS RESOLVES RATHER THAN ASKS ───────────────────────────────────────────
 * The creator does not pick a landing page from a list — under the "project IS the app"
 * decision the board that became the project already holds the `website` card they
 * authored, so a picker would be asking them to choose between one option and nothing.
 * `preferObjectId` is honoured when the site already recorded a choice, which is what
 * keeps a republish rendering the SAME card after they add a second one.
 *
 * Returns null when the project has no app session or no publishable website object —
 * a site with no landing page is served exactly as it is today.
 */
export async function landingPageForProject(
  db: Db,
  projectId: number,
  options: { brand: string; preferObjectId?: string | null; enterLabel?: string },
): Promise<LandingSource | null> {
  // ONE round trip: the app link and its website objects, joined. A separate
  // "find the session, then find its objects" pair would be two awaits on the
  // publish path for a question with a single answer.
  const rows = await db
    .select({ objectId: creationSessionObjects.id, canvasData: creationSessionObjects.canvasData })
    .from(creationSessionProjectLinks)
    .innerJoin(creationSessionObjects, eq(creationSessionObjects.sessionId, creationSessionProjectLinks.sessionId))
    .where(and(
      eq(creationSessionProjectLinks.projectId, projectId),
      eq(creationSessionProjectLinks.linkKind, SESSION_PROJECT_LINK_APP),
      eq(creationSessionObjects.kind, 'website'),
    ))
    .orderBy(creationSessionObjects.createdAt)
    .limit(WEBSITE_OBJECT_SCAN_LIMIT);
  if (!rows.length) return null;

  const chosen = (options.preferObjectId && rows.find((row) => row.objectId === options.preferObjectId)) || rows[0]!;
  const data = (chosen.canvasData ?? {}) as Record<string, unknown>;
  const html = renderLandingPage({
    pages: websitePagesFrom(data),
    theme: websiteThemeFrom(data),
    brand: options.brand,
    activePageId: data.activeWebsitePageId,
    ...(options.enterLabel ? { enterLabel: options.enterLabel } : {}),
  });
  return html ? { objectId: chosen.objectId, html } : null;
}

/** Bounded because a board can hold many cards and only one can be the shop window;
 *  scanning every `website` object on a large board to pick the first is wasted work. */
const WEBSITE_OBJECT_SCAN_LIMIT = 10;
