/**
 * The editor's `ReviewRunsPort` (PRD 41 A8): the Run panel's live record, history and Stop,
 * answered by the extension host over the knowledge bridge (`src/knowledge/knowledgeProtocol.ts`).
 * Pure over the same transport as the rest of the source. (A Retry is a review request, not an op here.)
 */

import type { ReviewRunsPort, ReviewRunSummary, StoredReviewRun } from '@builderforce/knowledge-graph-view';
import type { KnowledgeTransport } from './hostKnowledgeGraphSource';

export function hostReviewRuns(t: KnowledgeTransport): ReviewRunsPort {
  return {
    // The host posts a run record on the stream of the review that writes it, whoever started that review.
    subscribe: (cb) => t.onEvent((e) => { if (e.type === 'run') cb(e.run as StoredReviewRun); }),
    list: (rootId) => t.call<ReviewRunSummary[]>({ op: 'runs', rootId }),
    get: (runId) => t.call<StoredReviewRun | null>({ op: 'runRecord', runId }),
    async stop(runId) {
      await t.call({ op: 'stopRun', runId });
    },
  };
}
