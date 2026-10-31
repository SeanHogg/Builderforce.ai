/**
 * The gates a prose-ended turn must clear before it is the run's answer, as DATA: when each holds, the nudge that sends the
 * turn back, the trace it leaves, and which flag records that it was spent. ONE definition, read by the Brain's own
 * final-answer hook (`finalAnswerHook.ts`) and by the agent's delivery ledger (`run/brainDelivery.ts`), so the two engines
 * cannot drift on what "sent back" means. The workspace stop hook is asynchronous and bounded by round, so it stays with its
 * callers (`stopHooks.ts`).
 */

import { undelegatedRequestNudge } from '../delegationRequest';
import { isRestatedReply, restatedReplyNudge } from '../restatedReply';
import { leftChangeUnreviewed, unreviewedChangeNudge } from '../previewReview';
import { leftChangeUnshipped, unshippedChangeNudge } from '../selfReviewShip';
import { runLeftDelegationUndone } from './earlyDelegation';
import { runTrace } from './runCells';
import type { RunLoopContext } from './runLoopContext';

export interface DeliveryGate {
  /** The ladder counter key. */
  id: string;
  /** A changed run that is sent back continues on the review model, not the author. */
  entersVerify: boolean;
  /** Does the gate hold for a final reply `text`? Includes "not already spent". */
  applies(text: string): boolean;
  /** What the model is told when the turn is sent back. */
  nudge(): string;
  /** The durable trace step: its label, its extra args and the sentence triage reads. */
  trace: { label: string; result: string; args(): Record<string, unknown> };
  /** The gate was spent. */
  spend(): void;
}

/** The ship, review, delegation and restated-reply gates, in the order they are asked. */
export function deliveryGates(run: RunLoopContext): DeliveryGate[] {
  const { c, catalogToolNames, userRequest, priorReply } = run;
  const facts = () => ({ codeChanged: c.codeChanged, toolNames: catalogToolNames, requestText: userRequest, events: runTrace(c) });
  const files = () => ({ files: c.touchedFiles.slice(0, 20) });
  return [
    {
      // The turn CHANGED code and is ending without having even tried to ship it. In a local session that change has no other
      // reviewer. Quiet when the user said not to commit, when a commit/push/PR was attempted, and on a host that cannot commit.
      id: 'brain.ship',
      entersVerify: true,
      applies: () => !run.shipRecoveryUsed && leftChangeUnshipped(facts()),
      nudge: unshippedChangeNudge,
      trace: { label: 'loop.recover_unshipped_change', args: files, result: "Run changed code and ended without committing or pushing it — re-prompted to verify, self-review and ship (this local session is the change's only reviewer)." },
      spend: () => { run.shipRecoveryUsed = true; },
    },
    {
      // The Studio's twin: the turn CHANGED the app and is ending without having inspected the preview and recorded a review.
      id: 'brain.review',
      entersVerify: true,
      applies: () => !run.reviewRecoveryUsed && leftChangeUnreviewed(facts()),
      nudge: unreviewedChangeNudge,
      trace: { label: 'loop.recover_unreviewed_change', args: files, result: "Run changed the app and ended without inspecting the preview and recording a review — re-prompted to verify and review (this Studio session is the change's only reviewer)." },
      spend: () => { run.reviewRecoveryUsed = true; },
    },
    {
      // The user asked for SUB-AGENTS and the run is ending in prose without having started one. The `ask_user` twin is in
      // `turnToolCalls.ts`; both spend the one recovery.
      id: 'brain.delegate',
      entersVerify: false,
      applies: () => !run.delegationRecoveryUsed && runLeftDelegationUndone(run),
      nudge: () => undelegatedRequestNudge(catalogToolNames),
      trace: { label: 'loop.recover_undelegated_request', args: () => ({ via: 'reply' }), result: 'The user asked for sub-agents and the run ended without starting one — re-prompted to spawn them locally.' },
      spend: () => { run.delegationRecoveryUsed = true; },
    },
    {
      // The reply is the previous turn's status again: sent back once to act on the next unfinished item instead.
      id: 'brain.restate',
      entersVerify: false,
      applies: (text) => !run.restateRecoveryUsed && isRestatedReply(text, priorReply),
      nudge: restatedReplyNudge,
      trace: { label: 'loop.recover_restated_reply', args: () => ({}), result: "Final reply repeated the previous turn's answer — re-prompted to act on the next unfinished item instead of restating it." },
      spend: () => { run.restateRecoveryUsed = true; },
    },
  ];
}
