/**
 * knowledge/reviewDirectoryArgs.ts — the arguments of ONE memory `reviewDirectory` call, shared by the
 * single pass, pass 1 (`mechanical`) and pass 2 (`only`) of a review (PRD 41 A10). Pure: ports and options in, args out.
 */

import type { KnowledgePack, ReviewArgs } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_JUDGEMENT_TIMEOUT_MS, judgementWithTimeout } from './judgement.js';
import type { KnowledgeReviewOptions, KnowledgeReviewPorts } from './reviewRunner.js';

export function directoryArgs(
    ports: KnowledgeReviewPorts, opts: KnowledgeReviewOptions, packs: KnowledgePack[],
    progress: KnowledgeReviewOptions['onProgress'], defaultModelCalls: number,
    extra: Pick<ReviewArgs, 'mechanical' | 'only'> = {},
): ReviewArgs {
    return {
        source: ports.source,
        store: ports.store,
        packs,
        manifest: ports.manifest,
        // A per-request timeout so a stalled engine cannot hang the whole review at `judge`:
        // the affected sections stay unjudged and a later run judges them again. The wrapper
        // lives here (not in memory's `reviewDirectory`), so the ONE review pipeline is unchanged.
        ...(ports.judgement ? { judgement: judgementWithTimeout(ports.judgement, opts.judgementTimeoutMs ?? defaultJudgementTimeoutMs) } : {}),
        ...(ports.similar ? { similar: ports.similar } : {}),
        ...(opts.plan ? { plan: opts.plan } : {}),
        ...(opts.force ? { force: true } : {}),
        // The model-call ceiling stays with a file budget too: judging is bounded by files AND by calls.
        budget: { modelCalls: opts.modelCalls ?? defaultModelCalls, ms: Number.POSITIVE_INFINITY },
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(progress ? { onProgress: progress } : {}),
        ...(opts.onStep ? { onStep: opts.onStep } : {}),
        ...(opts.extractPool ? { extractPool: opts.extractPool } : {}),
        ...(opts.deferRead ? { deferRead: true } : {}),
        ...(opts.readAhead !== undefined ? { readAhead: opts.readAhead } : {}),
        ...(opts.timeouts ? { timeouts: opts.timeouts } : {}),
        ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
        ...(opts.judgeConcurrency !== undefined ? { judgeConcurrency: opts.judgeConcurrency } : {}),
        ...(opts.maxModelCalls !== undefined ? { maxModelCalls: opts.maxModelCalls } : {}),
        ...extra,
    };
}
