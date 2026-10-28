/**
 * ONE review job, wherever it runs: the shared review composition
 * (`@builderforce/agent-tools/knowledge` `planKnowledgeReview` / `runKnowledgeReview` — the
 * ONE pack list, the forced manifest, the budget), the same the editor and on-prem run.
 * The browser runs it in a Web Worker (`knowledgeReview.worker.ts`) with every port
 * proxied back to the page; without a Worker it runs here, in-thread, unchanged.
 */

import type {
  DirectorySource, JudgementPort, KnowledgeStore, ReviewPlan, ReviewProgress, ReviewReport,
} from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { planKnowledgeReview, runKnowledgeReview } from '@builderforce/agent-tools/knowledge';

export interface ReviewJob {
  mode: 'plan' | 'review';
  force: boolean;
  /** Judged sections per review before the chip asks again (PRD 38 §8.2). */
  modelCalls: number;
}

export interface ReviewPorts {
  source: DirectorySource;
  store: KnowledgeStore;
  judgement?: JudgementPort;
  manifest: IngestManifest;
}

export function runReviewJob(job: ReviewJob & { mode: 'plan' }, ports: ReviewPorts): Promise<ReviewPlan>;
export function runReviewJob(
  job: ReviewJob & { mode: 'review' }, ports: ReviewPorts, onProgress?: (p: ReviewProgress) => void, signal?: AbortSignal,
): Promise<ReviewReport>;
export function runReviewJob(
  job: ReviewJob, ports: ReviewPorts, onProgress?: (p: ReviewProgress) => void, signal?: AbortSignal,
): Promise<ReviewPlan | ReviewReport>;
export async function runReviewJob(
  job: ReviewJob, ports: ReviewPorts, onProgress?: (p: ReviewProgress) => void, signal?: AbortSignal,
): Promise<ReviewPlan | ReviewReport> {
  const shared = { source: ports.source, store: ports.store, manifest: ports.manifest, ...(ports.judgement ? { judgement: ports.judgement } : {}) };
  if (job.mode === 'plan') return planKnowledgeReview(shared, { force: job.force });
  return runKnowledgeReview(shared, {
    force: job.force,
    modelCalls: job.modelCalls,
    ...(signal ? { signal } : {}),
    ...(onProgress ? { onProgress } : {}),
  });
}
