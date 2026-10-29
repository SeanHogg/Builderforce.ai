/**
 * Where a knowledge chip goes on the WEB (PRD 38 §3.1): an **Open in graph** or **Choose a
 * folder to review** chip under a PreFetch answer (`@builderforce/knowledge-browser`'s
 * port) opens the project's canvas on its `knowledge` surface — focused on the chip's refs,
 * or on the view's review launcher. Rovr routes the same intent to its Knowledge tab.
 *
 * The URL contract itself (`?surface=knowledge&kgFocus=…&kgReview=1`, its parameter names,
 * its cap) is owned by `@builderforce/agent-tools/prefetch` (`knowledgeSurfaceLink`), which
 * on-prem writes with and this reads with. The project route forwards the intent to the
 * board it opens (`ProjectCanvasRedirect`), and the knowledge surface reads it once on
 * mount (`CanvasKnowledgeSurface`). Pure.
 */

import { knowledgeSurfaceQuery } from '@builderforce/agent-tools/prefetch';
import { knowledgeChipIntent, type KnowledgeChipIntent } from '@builderforce/knowledge-browser';

/** The canvas's knowledge surface for `projectId`, opened on `intent`. */
export function knowledgeSurfaceHref(projectId: number, intent: Pick<KnowledgeChipIntent, 'focus' | 'review'>): string {
  return `/projects/${projectId}?${knowledgeSurfaceQuery(intent.focus, intent.review)}`;
}

/** Where a PreFetch chip navigates on the web; undefined when it is not a knowledge chip or there is no project. */
export function webChipHref(chip: { command: string; args?: Record<string, unknown> }, projectId: number | null): string | undefined {
  const intent = knowledgeChipIntent(chip);
  return intent && projectId != null ? knowledgeSurfaceHref(projectId, intent) : undefined;
}
