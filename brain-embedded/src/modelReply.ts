/**
 * What counts as something the MODEL said to the user, out of a persisted transcript.
 *
 * An assistant-role row is not always a reply: a run step (`role:'tool'`), a server
 * activity line, and a consolidation marker (a "Consolidate" summary, or a run's
 * auto-compaction note persisted mid-run) all sit in the same list. Every reader that
 * asks "what did the model answer last" — retry, the newest-reply actions, triage claim
 * detectors, a child's result — uses this one predicate, so none of them mistakes a note
 * for an answer.
 */

import { isConsolidationMarker } from '@seanhogg/builderforce-memory/working';
import { isActivityMessage } from './chatActivity';
import { isStepMessage } from './types';

export function isModelReply(m: { role: string; metadata?: string | null }): boolean {
  return m.role === 'assistant' && !isStepMessage(m) && !isConsolidationMarker(m) && !isActivityMessage(m);
}
