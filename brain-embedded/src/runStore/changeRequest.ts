/**
 * What the Brain tells the agent about a run's CHANGE: the facts its progress rules read, which only the surface holds (PRD 35 §4 WS4).
 * The rules themselves — analysis ends, coding changes something, a circling run is forced, a stalled run finishes — are the agent's
 * (`@builderforce/agent-run` `policy/guards/forced`); `run/brainProgressPorts.ts` hands them these as `ProgressFacts`.
 *
 * Only a run asked to CHANGE something is budgeted: a question answered after thirty reads is an answer, and must not be turned into
 * tickets or edits.
 */

import { classifyRequest } from '@builderforce/agent-stall';
import { HAND_OFF_TOOL } from '../planHandoff';
import type { BrainRunContext } from './brainRunContext';

/** Is `text`, in a run of `mode`, a request to CHANGE something — the only kind any progress rule forces, and the only kind the chat's
 *  asks ledger carries. The ONE classifier decides (`classifyRequest`): a question — even one whose paste is full of change verbs — is
 *  never budgeted, and a bare continuation resumes change work. */
export function isChangeRequest(mode: string | undefined, text: string): boolean {
  return mode !== 'chat' && classifyRequest(text).intent === 'change';
}

/** Is this run asked to CHANGE something (see {@link isChangeRequest}). */
export function budgeted(run: Pick<BrainRunContext, 'metadata' | 'userRequest'>): boolean {
  return isChangeRequest(run.metadata.mode, run.userRequest);
}

/**
 * Has the run made its change — edited code itself or handed it to coders? An INLINE hand-off started no coder: the run itself
 * takes every task, so it has made no progress until it edits (VS Code chat #165961: the coder after an inline hand-off read for
 * nine turns, was exempt from the change budget and the stalled-finish deferral, and finished with no edit).
 */
export function progressed(run: Pick<BrainRunContext, 'c' | 'usedTools' | 'handOffInline'>): boolean {
  return run.c.codeChanged || (run.usedTools.has(HAND_OFF_TOOL) && run.handOffInline !== true);
}
