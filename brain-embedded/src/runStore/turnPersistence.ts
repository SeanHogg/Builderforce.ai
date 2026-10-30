/**
 * How a run's TURNS become durable — the provenance a persisted reply carries, the one
 * canonical text shape every persisted model reply takes, each step row, and what a
 * user Stop cut off (the live turn it was streaming, kept once the run unwinds).
 */

import { MID_TURN_META_KEY, stepRow, splitVendorReasoning, canonicalReasoningText } from '@builderforce/agent-loop';
import type { StreamChatResult, StreamHandlers } from '../streamChatCompletion';
import type { BrainTraceEvent } from '../brainTriage';
import { asProvenanceAccount, withProvenanceMetadata } from '../provenance';
import { STOPPED_TURN_STEP, stoppedTurnMetadata } from '../stoppedTurn';
import type { RunCell, StoppedTurn } from './runCell';
import { nowIso, pushTrace, recordAppended } from './runCells';
import type { BrainRunPersistence } from './runTypes';

/**
 * Build the provenance metadata for a persisted assistant turn from the stream
 * result — the resolved model + which account served it (`x-builderforce-account`,
 * captured as `result.account`).
 *
 * The MODEL alone is enough to record. An older gateway (or a CORS setup that
 * doesn't expose the account header) reports no account, and requiring one used to
 * throw away the model with it — leaving a turn with no attribution at all, which
 * is exactly when a user asking "why is this answer so bad?" needs it most.
 * Shared by both the mid-run narration and the final-answer persist so the chip
 * shows on every durable turn.
 */
export function provenanceMetadata(result: StreamChatResult, requested?: string, base?: Record<string, unknown>): string | undefined {
  const model = result.resolvedModel;
  if (!model) return withProvenanceMetadata(null, base);
  const account = asProvenanceAccount(result.account);
  // Persist requested≠actual so a copied transcript can stamp failover on the assistant
  // heading itself — not only in the aggregate diagnostics. Does not fix Grok tool
  // calling; production API must still include the Responses adapter deploy.
  const asked = requested && requested !== 'default' && requested !== model ? requested : undefined;
  return withProvenanceMetadata({
    model,
    ...(account ? { account } : {}),
    ...(asked ? { requestedModel: asked } : {}),
  }, base);
}

/**
 * Commit what a turn SAID before its tool calls (or before a re-prompt) as its own
 * durable assistant block, so the next turn's stream cannot erase what the user just
 * read. Empty (pure tool-call) turns persist nothing.
 *
 * The block is marked mid-turn (`MID_TURN_META_KEY`): it is persisted through the same
 * path as the final answer, and the server's learn-on-persist gate trained the project
 * Evermind on every one of them — "Let me check if X is imported:" became a learned
 * exemplar, one head version per step. The mark keeps it out of the learn batch; the
 * run's final answer is the only assistant text it contributes.
 */
export async function persistMidTurnText(
  chatId: number,
  c: RunCell,
  persistence: BrainRunPersistence,
  result: StreamChatResult,
  requested?: string,
): Promise<void> {
  const text = canonicalTurnText(result.text);
  if (!text) return;
  const metadata = provenanceMetadata(result, requested, { [MID_TURN_META_KEY]: true });
  const [msg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: text, ...(metadata ? { metadata } : {}) }]);
  recordAppended(c, msg);
}

/**
 * A turn's text in the CANONICAL reasoning shape: one closed `<think>` block, then the
 * answer.
 *
 * Every site in this module that persists model text goes through it. The loop used to
 * store whatever the vendor emitted, and that is how a whole reply — a question the run
 * was blocked on — reached the transcript inside an UNCLOSED block: every reader
 * downstream needs the closing tag to recognise reasoning, so without it the scratchpad
 * IS the message as far as the transcript, the answer cache and Evermind learning are
 * concerned. Normalizing at the point of persistence means nothing later depends on a
 * model closing its own tag.
 *
 * A reasoning-only turn stays reasoning-only — the block is simply closed. The
 * transcript decides what to show for one of those, and only it can: whether the reply
 * is stranded depends on whether the RUN is over (see `strandedReplyKey`).
 */
export function canonicalTurnText(text: string): string {
  const { content, reasoning } = splitVendorReasoning({ content: text });
  return canonicalReasoningText(content, reasoning);
}

/**
 * Persist a step DURABLY so it survives a reload — the in-memory `trace` alone
 * vanishes on remount, which is why steps used to disappear from a reopened chat.
 * Reached ONLY through {@link RunCell.persistStep} (i.e. every {@link pushTrace} of a
 * live run): these rows are the single durable store of a run's steps. Sends are
 * batched by `stepOutbox.ts`.
 * Stored as a `role:'tool'` message whose metadata carries the step payload
 * (`{ kind:'step', ... }`); the timeline reconstructs the node from it (see
 * timelineModel.buildSettledTimeline) and the triage diagnostics reconstruct the
 * trace event from it (see persistedSteps.traceWithPersistedSteps).
 *
 * The DIAGNOSTICS scalars ride along verbatim: the pre-trim `resultBytes` and the
 * `truncated` flag on a tool step (so the "which tool flooded the window" signal
 * isn't lost to the 4 KB result cap), built by the shared `stepRow` (agent-loop) so
 * the server's addressed-agent reply writes the identical row, and `usage` / `finishReason` /
 * `textChars` on an `llm` turn. Without them a reloaded chat's diagnostics could
 * only report a byte floor and no tokens at all.
 *
 * Deliberately NOT recorded into the live message list (no recordAppended): the live
 * view already shows the step from `trace`, and the seed builders exclude `role:'tool'`
 * so a persisted step never re-enters the model transcript (an orphaned tool message
 * 400s strict vendors). Fire-and-forget — durability must never block or fail the run.
 */
export function persistStep(chatId: number, persistence: BrainRunPersistence, ev: BrainTraceEvent): void {
  void persistence.sendMessages(chatId, [stepRow(ev)]).catch(() => {
    /* best-effort durability — the live trace already showed the step */
  });
}

/** What a Stop cuts off: the live completion's text and model, and the step recording it. */
export function stoppedTurnOf(c: RunCell): StoppedTurn {
  const live = c.liveTurn;
  const text = live ? c.streamingText : '';
  const model = live?.model;
  const result = !live
    ? 'Stopped by user.'
    : model
      ? `Stopped by user while ${model} was streaming (${text.length} chars kept).`
      : `Stopped by user before the gateway named the model (${text.length} chars kept).`;
  return {
    text,
    source: { ...live },
    event: {
      ts: nowIso(),
      category: 'message',
      label: STOPPED_TURN_STEP,
      ...(model ? { args: { model } } : {}),
      ...(live ? { textChars: text.length } : {}),
      result,
    },
  };
}

/**
 * Persist what a Stop cut off, once the run has unwound: the step (so a reopened chat's
 * report still names the model) and, when the model had written anything, the partial
 * reply itself — marked, so the timeline says it was stopped and no seed replays it.
 */
export async function keepStoppedTurn(chatId: number, c: RunCell, persistence: BrainRunPersistence, still: () => boolean = () => true): Promise<void> {
  const stopped = c.stoppedTurn;
  c.stoppedTurn = null;
  if (!stopped) return;
  const text = canonicalTurnText(stopped.text);
  if (!text) return;
  const [msg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: text, metadata: stoppedTurnMetadata(stopped.source) }]);
  // Late (the settle stopped waiting): saved, but never spliced into a newer turn's view.
  if (msg && still()) recordAppended(c, msg);
}

/** Run one completion as the turn in flight, so a Stop mid-stream knows what it cut off. */
export async function asLiveTurn<T>(c: RunCell, complete: () => Promise<T>): Promise<T> {
  c.liveTurn = {};
  try {
    return await complete();
  } finally {
    c.liveTurn = null;
  }
}

/** `onModel` for the live turn: record the serving model the moment the gateway names it. */
export function liveTurnModel(c: RunCell): NonNullable<StreamHandlers['onModel']> {
  return (model, account) => {
    if (c.liveTurn) c.liveTurn = { model, account };
  };
}

/** `onConnectRetry` for a turn: say on the timeline that the run is waiting on the network. */
export function connectRetryStep(c: RunCell, step: number): NonNullable<StreamHandlers['onConnectRetry']> {
  return (attempt, delayMs, reason) => {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'llm.connect_retry',
      args: { step, attempt },
      result: `Could not reach BuilderForce (${reason}). Trying again in ${Math.round(delayMs / 1000)}s — nothing was sent, so nothing is repeated.`,
    });
  };
}
