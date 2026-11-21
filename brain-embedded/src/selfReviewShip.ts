/**
 * SELF-REVIEW SHIP — the loop gate that re-prompts a turn which changed code and ended
 * without even TRYING to ship it under the run's ship policy.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `tickets.from_delta` opens every editor change's ticket in `in_review` (75% on the
 * board): "the code exists but has not landed". In the VS Code extension nobody else can
 * land it: the run is local and holds the only copy of the change. Measured (chat #103):
 * the agent edited, recorded the delta, stopped, and two tickets sat at 75% with the edits
 * uncommitted on disk.
 *
 * WHAT the run does with finished work is the run's SHIP POLICY (PRD 48,
 * `@builderforce/run-guards` `shipPolicy.ts`): the directive (`shipDirective`) and the
 * re-prompt (`shipNudge`) both live there, beside the publish matcher, so the prose and the
 * tool gate cannot disagree. This module keeps only the loop's own facts: did the run try to
 * publish ({@link attemptedPublish}), and is the turn ending with a change the policy says
 * to ship ({@link leftChangeUnshipped}). Enforcement lives in the loop, not only in advice:
 * a directive a model can skim past is exactly how the 75% tickets happened.
 *
 * {@link declinesShipping} is the person's "don't commit" phrase — it SETS the chat's
 * publish hold (`runStore/publishHold.ts`), which narrows the policy; the gate below reads
 * only the policy.
 *
 * Gated on {@link canShipHere} — the host advertised the git publish tools — so the web
 * Brain (no working tree, no git) never sees any of it.
 *
 * Framework-free (strings, Sets, predicates) so it is safe in every bundle.
 */

import { asksForChange } from '@builderforce/agent-stall';
import { publishVerbOf, shipNudge, type ShipPolicy } from '@builderforce/run-guards';
import type { BrainTraceEvent } from './brainTriage';
import { canShipHere } from './localWorkspaceTools';

/**
 * Did this run TRY to publish its work — a commit, a push or a pull request, by tool or
 * raw shell command (`publishVerbOf`)? A branch cleanup is not shipping.
 *
 * Success is deliberately not required. A commit the gate refused, or a push the remote
 * rejected, is a result the model has to REPORT — re-prompting it to ship would only
 * repeat what already failed.
 */
export function attemptedPublish(events: readonly BrainTraceEvent[]): boolean {
  return events.some((e) => {
    if (e.category !== 'tool') return false;
    const verb = publishVerbOf(e.label, e.args);
    return verb != null && verb !== 'cleanup';
  });
}

/**
 * The user told the agent NOT to publish. Narrow on purpose: only an explicit negation
 * of committing / pushing / shipping, or an instruction to keep the change local. A
 * request that merely does not MENTION committing is not a refusal. Read by the publish
 * hold (`runStore/publishHold.ts`), never by the ship gate directly.
 */
const DECLINES_SHIPPING =
  /\b(?:don'?t|do not|never|without)\s+(?:commit|push|ship|merg)\w*|\b(?:no|skip)\s+(?:commit|push)\w*|\b(?:leave|keep)\s+(?:it|them|this|the\s+(?:change|changes|edits?))\s+(?:uncommitted|unstaged|local(?:ly)?)\b/i;

export function declinesShipping(text: string | null | undefined): boolean {
  return DECLINES_SHIPPING.test(unquotedText(text));
}

/**
 * A turn's text without its QUOTED blocks (lines starting with `>`): quoted text is someone else's words being shown
 * — a pasted brief, an earlier ask — never an instruction, so no ship-intent scan reads it (VS Code chat #157440).
 */
export function unquotedText(text: string | null | undefined): string {
  return (text ?? '').split(/\r?\n/).filter((line) => !/^\s*>/.test(line)).join('\n');
}

/** What the loop knows when a turn ends without tool calls. */
export interface UnshippedChangeInput {
  /** A workspace code-change tool succeeded in THIS run. */
  codeChanged: boolean;
  /** Names of the tools this run's host advertised. */
  toolNames: readonly string[];
  /** The user's own request for this run — never a nudge the loop injected. */
  requestText: string | null | undefined;
  /** THIS run's trace events (not an earlier run's — see `brainRunStore.runTrace`). */
  events: readonly BrainTraceEvent[];
  /** The run's ship policy (`BrainRunContext.shipPolicy`) — already narrowed by any hold or sub-agent rule. */
  policy: ShipPolicy;
}

/**
 * Is this turn ending with a code change the agent never attempted to ship?
 *
 * Every condition must hold, so the gate stays quiet whenever stopping is right:
 *  - the run changed code (nothing to ship otherwise);
 *  - this host can commit AND push (the web Brain cannot);
 *  - the user asked for a change (a question answered with a scratch edit is not a
 *    work order to publish);
 *  - the ship policy ships something (`shipNudge` is non-null — not `leave_uncommitted`,
 *    which a hold or a sub-agent's rule also lands on);
 *  - nothing in the run tried to commit, push or open a pull request.
 */
export function leftChangeUnshipped(input: UnshippedChangeInput): boolean {
  return (
    input.codeChanged &&
    canShipHere(input.toolNames) &&
    asksForChange(input.requestText) &&
    shipNudge(input.policy) != null &&
    !attemptedPublish(input.events)
  );
}
