/**
 * The directives a run's system prompt carries for what its SURFACE can do, folded in ONCE by its preamble (`runPreamble.ts`): the
 * conversation's mode (work or chat), the run's ship policy and publish hold (PRD 48), the Studio's preview review and the tool work
 * of the chat's earlier turns. Pure over the request and the transcript; it records the run's hold and ship policy on the cell and
 * leaves its own trace steps.
 */

import { classifyRequest } from '@builderforce/agent-stall';
import { shipDirective, shipSourceLabel } from '@builderforce/run-guards';
import { chatModeDirective, type ChatMode } from '../chatMode';
import { turnOptimizationDirective } from '../turnOptimization';
import { canChangeCodeHere, canReviewInPreview, canShipHere } from '../localWorkspaceTools';
import { previewReviewDirective } from '../previewReview';
import { ticketToolVocabulary } from '../ticketToolVocabulary';
import { latestUserText } from './convoText';
import { attemptedPublishWhileHeld, publishHold } from './publishHold';
import { runShipPolicy } from './runShipPolicy';
import type { RunCell } from './runCell';
import { nowIso, pushTrace } from './runCells';
import type { BrainRunRequest } from './runTypes';
import type { ChatCompletionMessage } from '../streamChatCompletion';

/** What the folded directives leave for the rest of the preamble. */
export interface FoldedDirectives {
  systemPrompt: string;
  /** The Studio's preview-review contract, when the run carries it. */
  previewReview: string | null;
  /** The chat's publish hold, when the person set one. */
  hold: ReturnType<typeof publishHold>;
}

export function foldRunDirectives(
  c: RunCell,
  convo: ChatCompletionMessage[],
  req: BrainRunRequest,
  runMode: ChatMode,
  serverChatId: number | null,
  catalogToolNames: readonly string[],
  opening: string,
): FoldedDirectives {
  let systemPrompt = opening;
  // Bind this run to the conversation's MODE (migration 0409).
  //
  // WORK: tell the model its chatId, that work it identifies or code it changes must
  // become a ticket LINKED to this chat, and that it must dispatch an agent to run it.
  // This is the enabler the chat-scoped + from_delta tools need — without the id they
  // are advertised but the model has no chatId to pass.
  //
  // CHAT: answer the question; do not mint board work as a side effect of answering.
  //
  // Injected here (with the guaranteed-resolved id) so it rides BOTH the web Brain and
  // the VS Code webview Brain, mirroring the server-side @agent reply loop
  // (BrainService.agentReply). `chatMode` is optional and defaults to WORK so any host
  // that has not adopted the mode yet keeps the behaviour it shipped with.
  // WORK mode's ordering depends on what THIS surface can do: an IDE run holding the
  // workspace tools should make a small change itself rather than hire a cloud agent to
  // make it, while a web run (no file tools) can only ever get code changed by
  // dispatching. Derived from the run's own advertised tools, so no host declares its
  // capability separately — and a host that gains or loses the file tools stays
  // consistent with the post-run backstop, which reads the same set.
  const canEditHere = canChangeCodeHere(catalogToolNames);
  systemPrompt = `${systemPrompt}\n\n${chatModeDirective(runMode, serverChatId, { canEditHere, canDelegate: catalogToolNames.includes('spawn_agent'), canFanOut: catalogToolNames.includes('spawn_agents'), roster: req.chatRoster, ticketTools: ticketToolVocabulary(catalogToolNames) })}\n\n${turnOptimizationDirective()}`;
  // A session that can commit AND push holds the only copy of its change — nobody else
  // will review or land it — so it is told what to do with it: the run's SHIP POLICY
  // (PRD 48). Rides both modes: it only binds a turn that changes code.
  const canShip = canShipHere(catalogToolNames);
  // The chat's PUBLISH HOLD (incident #56886): derived once per run from the transcript's
  // PERSON turns, so a hold the person set survives a follow-up turn that drops the
  // phrase, and a child run (seeded from the root's transcript) reads the SAME hold its
  // owner set — it can never lift it.
  const hold = publishHold(convo);
  c.publishHold = hold;
  // The SHIP POLICY (`runShipPolicy.ts`): a sub-agent ships nothing, its owner ships once
  // after verifying the fan-out; otherwise the host's policy (the project's setting) or the
  // default. A chat hold narrows either to uncommitted.
  c.shipPolicy = runShipPolicy(req, hold);
  if (canShip) {
    // A QUESTION ships nothing (fix brief W2, chat #168571): the ONE classifier reads
    // the user's own ask, so a paste full of change verbs never arms a commit policy
    // on a question. The policy itself is untouched — it only binds a turn that
    // changes code — but the trace says what this run will actually do.
    const questionRun = classifyRequest(latestUserText(convo)).intent === 'question';
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'run.ship_policy',
      args: { mode: questionRun ? 'n/a' : c.shipPolicy.mode, source: c.shipPolicy.source, merge: c.shipPolicy.merge, review: c.shipPolicy.review, ...(hold ? { setByMessage: hold.messageNumber } : {}) },
      result: questionRun ? 'Ship policy: n/a (question).' : `Ship policy: ${c.shipPolicy.mode} (${shipSourceLabel(c.shipPolicy)}).`,
    });
  }
  if (hold && attemptedPublishWhileHeld(hold, c.trace)) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'run.publish_hold_refused',
      args: { setByMessage: hold.messageNumber },
      result: `Publish hold is ON (set by user message #${hold.messageNumber}). A prior run still tried to commit/push — the tool gate now refuses these until the user explicitly asks to ship.`,
    });
  }
  if (canShip) {
    systemPrompt = `${systemPrompt}\n\n${shipDirective(c.shipPolicy, { chatId: serverChatId })}`;
  }
  // The Studio's twin: its change lives in a preview no one else can reach, so the
  // session reviews it there and the reviewed tickets close (see `previewReview.ts`).
  const previewReview = canReviewInPreview(catalogToolNames) ? previewReviewDirective(serverChatId, ticketToolVocabulary(catalogToolNames)) : null;
  if (previewReview) systemPrompt = `${systemPrompt}\n\n${previewReview}`;
  // The tool work of this chat's earlier turns, which a transcript seeded from history
  // does not carry — so "continue" builds on what was read instead of reading it again.
  if (c.priorResearch) systemPrompt = `${systemPrompt}\n\n${c.priorResearch}`;
  return { systemPrompt, previewReview, hold };
}
