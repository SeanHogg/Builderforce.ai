/**
 * The "all models failed" summary `runWithModelFallback` throws when more than one candidate was tried, and what a text classifier may
 * read of it.
 *
 * The summary's message joins every attempt, so a governance refusal's text (it names the tenant's gates by their authored ids, and a
 * gate id can read like anything: `prompt-limit`, `compaction-window`) sits in the middle of it, and its `cause` is only the LAST
 * error. Two things follow, and this module settles both from the STRUCTURED `code` of each attempt, never by reading text:
 *
 *   - `classifiableText` is, when any attempt was a governance refusal, the raw error text of the attempts that were NOT (a refused
 *     attempt says nothing about why the run failed, so no overflow / compaction / transient-HTTP classifier is asked about it). Raw
 *     (not "provider/model: ...") because the transient-HTTP check reads a LEADING status code, so a 502 followed by a refused CLI
 *     fallback reads as the transient 502 it was. A chain with NO refusal is read exactly as before, from the whole message.
 *   - `allRefused` is true only when EVERY attempt was refused. Then the run's failure is the governance refusal and no classifier
 *     applies; a mixed run is an ordinary failure of the attempts that really ran, whichever order they ran in.
 */
import { GOVERNANCE_REFUSAL_CODE } from "./failover-error.js";

/** What the summary needs to know of an attempt. */
export type SummarizedAttempt = { error: string; code?: string };

export class FallbackSummaryError extends Error {
  /** What a classifier may read: see the header ("" when every attempt was refused). */
  readonly classifiableText: string;
  /** Every attempt was a governance refusal. */
  readonly allRefused: boolean;

  constructor(message: string, params: { classifiableText: string; allRefused: boolean; cause?: Error }) {
    super(message, { cause: params.cause });
    this.classifiableText = params.classifiableText;
    this.allRefused = params.allRefused;
  }
}

const isRefusal = (attempt: SummarizedAttempt): boolean => attempt.code === GOVERNANCE_REFUSAL_CODE;

/** The error `runWithModelFallback` throws once every candidate failed (or was skipped). */
export function buildFallbackSummaryError<A extends SummarizedAttempt>(params: {
  attempts: A[];
  /** Used for the count when no attempt ran (every candidate skipped). */
  candidateCount: number;
  label: string;
  formatAttempt: (attempt: A) => string;
  cause: unknown;
}): FallbackSummaryError {
  const { attempts } = params;
  const summary = attempts.length > 0 ? attempts.map(params.formatAttempt).join(" | ") : "unknown";
  const message = `All ${params.label} failed (${attempts.length || params.candidateCount}): ${summary}`;
  return new FallbackSummaryError(message, {
    classifiableText: attempts.some(isRefusal)
      ? attempts
          .filter((attempt) => !isRefusal(attempt) && attempt.error.trim())
          .map((attempt) => attempt.error)
          .join(" | ")
      : message,
    allRefused: attempts.length > 0 && attempts.every(isRefusal),
    cause: params.cause instanceof Error ? params.cause : undefined,
  });
}

/**
 * The text a classifier (or a sanitiser) may read for `err`: a fallback summary's classifiable text, otherwise `message` as it is. The
 * summary is found down the cause chain, as `isGovernanceRefusal` walks it, so a wrapped summary is read the same way.
 */
export function classifiableFailureText(err: unknown, message: string): string {
  for (let e: unknown = err, depth = 0; e instanceof Error && depth < 5; e = e.cause, depth += 1) {
    if (e instanceof FallbackSummaryError) return e.classifiableText;
  }
  return message;
}
