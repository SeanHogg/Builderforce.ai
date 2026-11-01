/**
 * What kind of failure ended an agent turn, read from the error that escaped `runWithModelFallback`.
 *
 * A governance refusal is decided by its structured code, before any text classifier reads it: it names gates by their authored ids
 * (a gate called `prompt-limit` is not a context overflow). After a fallback chain the classifiers read only the attempts that were
 * not refused (`classifiableFailureText`), and a chain in which EVERY attempt was refused is a refusal (`isGovernanceRefusal`).
 */
import { isGovernanceRefusal } from "../../agents/cli-runner/governance.js";
import {
  isCompactionFailureError,
  isLikelyContextOverflowError,
  isTransientHttpError,
  sanitizeUserFacingText,
} from "../../agents/embedded-helpers.js";
import { classifiableFailureText } from "../../agents/fallback-summary.js";

export type AgentFailureKind = {
  isContextOverflow: boolean;
  isCompactionFailure: boolean;
  isSessionCorruption: boolean;
  isRoleOrderingError: boolean;
  isTransientHttp: boolean;
};

/**
 * The failure text shown to the person. A transient HTTP failure is sanitised for display, and what is sanitised is the text a
 * classifier may read: the sanitiser rewrites by pattern ("payment required" becomes the billing notice), so it must never be handed a
 * governance gate id that happens to contain one. Every other failure is shown as it is.
 */
export function shownFailureMessage(err: unknown, message: string, isTransientHttp: boolean): string {
  return isTransientHttp ? sanitizeUserFacingText(classifiableFailureText(err, message), { errorContext: true }) : message;
}

export function classifyAgentFailure(err: unknown, message: string): AgentFailureKind {
  const text = classifiableFailureText(err, message);
  const classify = (test: (text: string) => boolean): boolean => !isGovernanceRefusal(err) && test(text);
  return {
    isContextOverflow: classify(isLikelyContextOverflowError),
    isCompactionFailure: classify(isCompactionFailureError),
    isSessionCorruption: classify((t) => /function call turn comes immediately after/i.test(t)),
    isRoleOrderingError: classify((t) => /incorrect role information|roles must alternate/i.test(t)),
    isTransientHttp: classify(isTransientHttpError),
  };
}
