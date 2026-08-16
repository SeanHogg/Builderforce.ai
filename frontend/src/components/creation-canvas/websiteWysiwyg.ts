/**
 * The canvas editor's view of an authored website.
 *
 * The SHAPE, the section vocabulary, the parser and every block-level operation live in
 * `@builderforce/creation-canvas-contract` (`website.ts`) because the site publisher
 * renders the same object to static HTML in a Worker where React does not exist. This
 * module is deliberately thin: it re-exports that contract so existing imports keep
 * working, and adds only what is specific to editing a `CreationNodeData` node — the
 * patch shape the canvas writes back.
 */

import {
  activeWebsitePage,
  deleteWebsiteSection,
  duplicateWebsiteSection,
  insertWebsiteSection,
  moveWebsiteSection,
  websitePagesFrom,
  type SectionAddress,
  type WebsitePage,
  type WebsiteSectionKind,
} from '@builderforce/creation-canvas-contract';
import type { CreationNodeData } from './types';

export {
  WEBSITE_ADDABLE_SECTION_KINDS,
  WEBSITE_MAX_PAGES,
  WEBSITE_MAX_SECTIONS,
  WEBSITE_SECTION_KINDS,
  WEBSITE_THEME_STYLES,
  activeWebsitePage,
  authoredWebsiteProblem,
  isWebsiteSectionKind,
  websiteHeroFrom,
  websitePagesFrom,
  websiteSectionCapabilities,
  websiteThemeFrom,
} from '@builderforce/creation-canvas-contract';

export type {
  SectionAddress,
  WebsitePage,
  WebsiteSection,
  WebsiteSectionItem,
  WebsiteSectionKind,
  WebsiteTheme,
  WebsiteThemeStyle,
} from '@builderforce/creation-canvas-contract';

/** Keep the simple inspector controls editing the rendered hero, not stale legacy fields. */
export function patchWebsiteHero(data: CreationNodeData, patch: Partial<CreationNodeData>): Partial<CreationNodeData> {
  const pages = websitePagesFrom(data);
  if (!pages.length) return patch;
  const pageIndex = Math.max(0, pages.findIndex((page) => page.id === data.activeWebsitePageId));
  const page = pages[pageIndex] || pages[0]!;
  const heroIndex = page.sections.findIndex((section) => section.kind === 'hero');
  if (heroIndex < 0) return patch;
  const hero = page.sections[heroIndex]!;
  const nextHero = {
    ...hero,
    ...(typeof patch.websiteHeadline === 'string' ? { heading: patch.websiteHeadline } : {}),
    ...(typeof patch.websiteBody === 'string' ? { body: patch.websiteBody } : {}),
    ...(typeof patch.websiteCta === 'string' ? { cta: patch.websiteCta } : {}),
  };
  const nextPages = pages.map((candidate, index) => index === pageIndex
    ? { ...candidate, sections: candidate.sections.map((section, sectionIndex) => sectionIndex === heroIndex ? nextHero : section) }
    : candidate);
  return { ...patch, pages: nextPages };
}

/**
 * The structural edits, expressed as the canvas's own patch.
 *
 * ONE wrapper rather than four, because every block operation writes back exactly the
 * same way — `{ pages }` — and a component that assembled that patch itself would be a
 * fifth place the write shape could drift. The operation names stay the contract's;
 * this only decides that a no-op operation produces a no-op patch, so an edit the
 * document refuses never bumps the canvas revision or marks the board dirty.
 */
export type WebsiteStructuralEdit =
  | { op: 'insert'; kind: WebsiteSectionKind; afterSectionId?: string }
  | { op: 'move'; sectionId: string; direction: 'up' | 'down' }
  | { op: 'delete'; sectionId: string }
  | { op: 'duplicate'; sectionId: string };

export function applyWebsiteEdit(
  data: CreationNodeData,
  edit: WebsiteStructuralEdit,
): Partial<CreationNodeData> | null {
  const pages = websitePagesFrom(data);
  if (!pages.length) return null;
  const activePageId = data.activeWebsitePageId;
  const address = (sectionId: string): SectionAddress => ({ sectionId });

  const next: WebsitePage[] = edit.op === 'insert'
    ? insertWebsiteSection(pages, edit.kind, {
        activePageId,
        ...(edit.afterSectionId ? { afterSectionId: edit.afterSectionId } : {}),
      })
    : edit.op === 'move'
      ? moveWebsiteSection(pages, address(edit.sectionId), edit.direction, activePageId)
      : edit.op === 'delete'
        ? deleteWebsiteSection(pages, address(edit.sectionId), activePageId)
        : duplicateWebsiteSection(pages, address(edit.sectionId), activePageId);

  // Reference equality IS the refusal signal: every operation returns its input
  // unchanged when it cannot apply, so this is the one check that keeps a refused
  // edit from travelling on as a write.
  return next === pages ? null : { pages: next };
}
