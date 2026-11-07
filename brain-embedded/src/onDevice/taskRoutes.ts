/**
 * Which adapter answers which task, in order — DATA, not branches (PRD 42 · B2). A new
 * browser API or a demoted task kind is a row here plus (at most) an adapter. `pageEngine`
 * is the tail: the page's bfi / WebLLM engines through the page fetch shim.
 *
 * `translate` has NO generic-model fallback: a small chat model's translation is not good
 * enough to show unlabelled. `detectLanguage` never asks a chat model either: its tail is
 * the deterministic `heuristicLanguage` (en / de / es / fr / zh), so it works without any
 * model on browsers lacking `LanguageDetector`.
 */

import type { AdapterId } from '../builtInAi/taskSession';
import type { OnDeviceTaskKind } from './onDeviceTasks';

export const ON_DEVICE_TASK_ROUTES: Readonly<Record<OnDeviceTaskKind, readonly AdapterId[]>> = {
  summarize: ['summarizer', 'prompt', 'pageEngine'],
  rewrite: ['rewriter', 'prompt', 'pageEngine'],
  write: ['writer', 'prompt', 'pageEngine'],
  proofread: ['proofreader', 'prompt', 'pageEngine'],
  detectLanguage: ['languageDetector', 'pageEngine'], // the tail is the deterministic heuristic, not a model
  translate: ['translator'],
  json: ['prompt', 'pageEngine'],
};

/** Past this many leaf chunks a transcript is not summarized on the device (B3). */
export const MAX_SUMMARY_CHUNKS = 8;

/** A chunk fills at most this share of the input window (B3). */
export const CHUNK_BUDGET_SHARE = 0.8;
