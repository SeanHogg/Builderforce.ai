/**
 * The running line of a review, react-free so the status pill's pure functions (and their tests)
 * can say it without pulling the ReviewProgress card (and React) in.
 */

import type { ReviewProgress as ReviewProgressEvent } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphLabels } from './labels';
import { fillTemplate } from './labels';

/** The running line: "{phase} · {done} of {total}", or the planning words before the first progress arrives. The card and the status pill both say it. */
export function reviewProgressText(labels: KnowledgeGraphLabels, p: ReviewProgressEvent | undefined): string {
    return p ? fillTemplate(labels.reviewProgress, { phase: labels.phases[p.phase], done: p.done, total: p.total }) : labels.reviewPlanning;
}
