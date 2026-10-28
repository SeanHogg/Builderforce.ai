/**
 * The page ⇄ review-worker messages. The worker owns the COMPUTE (walk, parse, extract,
 * resolve); the page owns every PORT — the directory (VFS, FileList, a folder handle,
 * Drive), the authenticated knowledge client and the IndexedDB manifest — because none of
 * them can cross into a Worker. The worker reaches a port with a `call`; the page answers
 * with a `reply`. Everything that crosses is structured-cloneable (an AbortSignal is not,
 * so a judgement request crosses without one and abort crosses as its own message).
 */

import type { ReviewProgress } from '@seanhogg/builderforce-memory/knowledge';
import type { ReviewJob } from './reviewJob';

export type ReviewPortName = 'source' | 'store' | 'judgement' | 'manifest';

export interface ReviewStart {
  type: 'start';
  job: ReviewJob;
  source: { rootId: string; title: string };
  hasJudgement: boolean;
}

export type ToReviewWorker =
  | ReviewStart
  | { type: 'reply'; id: number; ok: true; value: unknown }
  | { type: 'reply'; id: number; ok: false; error: string }
  | { type: 'abort' };

export type FromReviewWorker =
  | { type: 'call'; id: number; port: ReviewPortName; method: string; args: unknown[] }
  | { type: 'progress'; progress: ReviewProgress }
  | { type: 'result'; value: unknown }
  | { type: 'error'; error: string };

/** `source.list()` is an async iterable; across the boundary it is one array. */
export const LIST_ALL = 'listAll';
