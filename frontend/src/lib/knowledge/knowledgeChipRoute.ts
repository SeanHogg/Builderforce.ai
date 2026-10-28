/**
 * Where a knowledge chip goes on the WEB (PRD 38 §3.1): an **Open in graph** or **Choose a
 * folder to review** chip under a PreFetch answer (`@builderforce/knowledge-browser`'s
 * port) opens the project's canvas on its `knowledge` surface — focused on the chip's refs,
 * or on the view's review launcher. Rovr routes the same intent to its Knowledge tab.
 *
 * The intent rides the URL (`/projects/:id?surface=knowledge&kgFocus=…&kgReview=1`):
 * the project route forwards it to the board it opens (`ProjectCanvasRedirect`), and the
 * knowledge surface reads it once on mount (`CanvasKnowledgeSurface`). Pure.
 */

import { knowledgeChipIntent, type KnowledgeChipIntent } from '@builderforce/knowledge-browser';

/** The refs to focus, as a JSON array (one param survives every redirect unchanged). */
export const KNOWLEDGE_FOCUS_PARAM = 'kgFocus';
/** Present (`1`) ⇒ open on the review launcher. */
export const KNOWLEDGE_REVIEW_PARAM = 'kgReview';
/** Every param the project redirect forwards to the board. */
export const KNOWLEDGE_INTENT_PARAMS = [KNOWLEDGE_FOCUS_PARAM, KNOWLEDGE_REVIEW_PARAM] as const;
/** Refs a URL carries at most (a chip focuses ≤ 50; a URL stays short). */
export const MAX_URL_FOCUS = 20;

/** The canvas's knowledge surface for `projectId`, opened on `intent`. */
export function knowledgeSurfaceHref(projectId: number, intent: Pick<KnowledgeChipIntent, 'focus' | 'review'>): string {
  const query = new URLSearchParams({ surface: 'knowledge' });
  const focus = intent.focus.slice(0, MAX_URL_FOCUS);
  if (focus.length > 0) query.set(KNOWLEDGE_FOCUS_PARAM, JSON.stringify(focus));
  if (intent.review) query.set(KNOWLEDGE_REVIEW_PARAM, '1');
  return `/projects/${projectId}?${query.toString()}`;
}

/** The intent a board URL carries (none ⇒ no focus, no launcher). */
export function knowledgeIntentFromSearch(search: string): { focus: string[]; review: boolean } {
  const query = new URLSearchParams(search);
  let focus: string[] = [];
  try {
    const parsed = JSON.parse(query.get(KNOWLEDGE_FOCUS_PARAM) ?? '[]') as unknown;
    if (Array.isArray(parsed)) focus = parsed.filter((f): f is string => typeof f === 'string').slice(0, MAX_URL_FOCUS);
  } catch {
    focus = []; // A hand-edited param is no focus, never a broken board.
  }
  return { focus, review: query.get(KNOWLEDGE_REVIEW_PARAM) === '1' };
}

/** Where a PreFetch chip navigates on the web; undefined when it is not a knowledge chip or there is no project. */
export function webChipHref(chip: { command: string; args?: Record<string, unknown> }, projectId: number | null): string | undefined {
  const intent = knowledgeChipIntent(chip);
  return intent && projectId != null ? knowledgeSurfaceHref(projectId, intent) : undefined;
}
