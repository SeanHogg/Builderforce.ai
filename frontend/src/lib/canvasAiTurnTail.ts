/**
 * What a Creation Canvas turn RETURNS once its tool loop has stopped without settling on
 * an answer of its own.
 *
 * Split out of `creationCanvasAi.ts`, which runs the loop. Pure: the loop's final facts
 * in, the user-facing string out, plus whether that string is something the model said
 * (so Evermind may learn from it) or a runtime notice (so the surface keeps it out of
 * the transcript — see `onUnanswered` on the runner's options).
 */

import type { CanvasNotices } from '@/lib/canvasNotices';
import { WORDS_PER_DRAFT_PAGE, incompleteDocumentAnswer } from '@/lib/canvasTurnOutcome';

/** Why a turn's returned string is a runtime notice rather than an answer. */
export interface CanvasUnansweredOutcome {
  reason: 'no-answer' | 'command-not-executed' | 'tool-error';
  detail?: string;
}

/** How the tail resolved: the string, whether it is learnable model output, and — for a
 *  runtime notice — why the turn went unanswered. */
export interface CanvasTurnTail {
  answer: string;
  /** True when the answer is model output (or a sentence about real board work) and
   *  belongs on the Evermind learn path; false for a runtime notice. */
  learn: boolean;
  unanswered?: CanvasUnansweredOutcome;
}

/** The loop's state at the moment it stopped. */
export interface CanvasTurnTailFacts {
  notices: CanvasNotices;
  /** The page-count shortfall notice, when the turn drafted fewer words than asked for. */
  documentShortfall: string | null;
  /** The model's trailing text with any copied speaker label removed — empty when there
   *  was none, or when it only echoed an earlier reply. */
  trailingAnswer: string;
  /** The most recent real thing the model said this turn (see the runner). */
  lastSpokenAnswer: string;
  lastToolError: string;
  canvasChanged: boolean;
  /** The loop stopped on a `failed` rung — the turn was abandoned, not finished. */
  abandonedMidTurn: boolean;
  /** Round-trips abandoned because the provider went silent. */
  stalledStreams: number;
  /** The step cap stopped the model. */
  stepsExhausted: boolean;
  buildTurn: boolean;
  buildAuthored: boolean;
  mutationRequested: boolean;
  /** Replaces an answer CLAIMING a canvas change nobody made (`unverifiedCreationClaim`). */
  verify: (answer: string) => string;
}

/**
 * The page-count notice for a document turn that authored fewer words than the pages it
 * was asked for, or null when there is no page request or it was met.
 */
export function documentShortfallAnswer(
  notices: CanvasNotices,
  requestedPages: number | null,
  documentWords: number | null,
  documentWordCountExact: boolean,
): string | null {
  if (requestedPages == null || documentWords == null) return null;
  if (documentWords >= requestedPages * WORDS_PER_DRAFT_PAGE) return null;
  return incompleteDocumentAnswer(notices, requestedPages, documentWords, documentWordCountExact);
}

/** Decide what a turn that stopped without settling returns. */
export function composeTurnTail(facts: CanvasTurnTailFacts): CanvasTurnTail {
  const { notices } = facts;
  if (facts.documentShortfall !== null) return { answer: facts.documentShortfall, learn: true };
  if (facts.trailingAnswer) return { answer: facts.verify(facts.trailingAnswer), learn: true };
  // The board changed and the model never got to say so. Two cases, two sentences: the
  // loop ran out of steps mid-work (a build that needs another turn to finish), or it
  // simply ended on a tool call.
  //
  // `stepsExhausted` alone is NOT the discriminator, and reading it as one is a
  // regression this line already shipped once. Exhausted means "the cap stopped the
  // model", which is equally true of a turn that authored everything it was asked for
  // on its LAST step — and `stepsExhausted` then tells a user holding a finished
  // website and its comparison document that the work is half-done and to say
  // "continue". `buildTurn` is the case the notice was written for and says so in its
  // own docstring (see MAX_CANVAS_BUILD_TURNS): a workspace is written one file per
  // step, so hitting the cap there really does mean a part-written app. Everywhere
  // else, a changed board at the cap is a delivered board.
  // A build turn that only provisioned the workspace is neither: the board holds the
  // starter template, so "added to the canvas" would misreport it.
  if (facts.canvasChanged) {
    // ABANDONED, not finished: the provider went silent (or the model looped) with no
    // model left to take over, part-way through work that had already touched the board.
    // Measured (session `local-6d36899d`, ui 2026.10.31): a build wrote `index.html`, then
    // stalled, and "I added the requested content" sat above a "Hello World!" preview.
    // A runtime notice, so it stays out of the transcript like `providerStalled`.
    if (facts.abandonedMidTurn) {
      return {
        answer: notices.stoppedPartway,
        learn: false,
        unanswered: { reason: 'no-answer', detail: facts.stalledStreams ? 'provider-stalled' : 'model-looped' },
      };
    }
    if (facts.stepsExhausted && facts.buildTurn) return { answer: notices.stepsExhausted, learn: true };
    return { answer: facts.buildTurn && !facts.buildAuthored ? notices.buildNotAuthored : notices.addedToCanvas, learn: true };
  }
  // From here down the string is a RUNTIME NOTICE, not something the model said. The
  // caller is told so it can record it as a failed turn instead of writing it into the
  // transcript as an assistant reply for the next turn to copy.
  // A tool that FAILED still outranks prose: the error names what blocked the turn and
  // what would clear it, which the model's own narration routinely gets wrong.
  if (facts.lastToolError) {
    return {
      answer: notices.toolError(facts.lastToolError),
      learn: false,
      unanswered: { reason: 'tool-error', detail: facts.lastToolError },
    };
  }
  // Otherwise: an answer the model gave earlier in this turn is NOT a runtime notice, and
  // the fact that it never reached canvas_add_object does not make it worthless — for a
  // drafting request it IS the deliverable. Deliver it (still subject to the
  // unverified-creation check, which replaces an answer CLAIMING a canvas change nobody
  // made) rather than discarding the user's result in favour of a dead end.
  if (facts.lastSpokenAnswer) {
    const checked = facts.verify(facts.lastSpokenAnswer);
    return { answer: checked === facts.lastSpokenAnswer ? notices.answeredWithoutCanvasChange(checked) : checked, learn: true };
  }
  // A turn that ran out of PROVIDERS is not a turn that had nothing to say. Reporting it
  // as "no answer" blames the request, so the user rewrites a prompt that was fine.
  if (facts.stalledStreams) {
    return { answer: notices.providerStalled, learn: false, unanswered: { reason: 'no-answer', detail: 'provider-stalled' } };
  }
  return {
    answer: notices.noAnswer,
    learn: false,
    unanswered: { reason: facts.mutationRequested ? 'command-not-executed' : 'no-answer' },
  };
}
