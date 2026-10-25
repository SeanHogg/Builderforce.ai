/**
 * E5 — the VERIFIED local label (cost lever `e5_verified_local_label`).
 *
 * The transport label says a local turn "succeeded" when the local model served (no
 * throw, a non-empty answer). That teaches the `run.local-success` predictor that a
 * served-but-wrong answer is a success. With the lever on and a verdict supplied, the
 * label is served AND the verdict passed; with no verdict (it never came, or timed out)
 * the transport label stands — today's behaviour.
 *
 * WHERE A BRAIN TURN'S VERDICT COMES FROM. A local answer is settled before anyone has
 * judged it, so the router's record is DEFERRED by turn ({@link createDeferredLocalRecords})
 * and resolved by the first of:
 *   - `retry`       — the next call in the same chat re-sends the SAME user message with
 *                     nothing after it (regenerate / resend): failed;
 *   - `tool_schema` — the next call is the same submit's next tool-loop iteration and a
 *                     tool result for this turn's calls is the agent loop's
 *                     malformed/truncated-arguments refusal (`@builderforce/agent-loop`
 *                     `MALFORMED_CALL_RESULT` / `TRUNCATED_CALL_RESULT`): failed;
 *   - `tool_ok`     — that next iteration carries this turn's tool results, none refused: passed;
 *   - `continued`   — the next call in the chat is a different user message (the person
 *                     moved on rather than retrying): passed;
 *   - `rating`      — a host reports an explicit thumb on the chat's latest reply
 *                     ({@link submitLocalTurnVerdict});
 *   - the timeout   — {@link LOCAL_VERDICT_TIMEOUT_MS}: the transport label.
 * Everything is read on this device from the calls themselves — no model call, no network.
 */

import { MALFORMED_CALL_RESULT, TRUNCATED_CALL_RESULT } from '@builderforce/agent-loop';
import { isCostLeverOn } from '@builderforce/cost-levers';
import type { LocalSuccessOutcome } from '@seanhogg/builderforce-memory-engine';
import { isVolatileTail } from '@seanhogg/builderforce-memory/handoff';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { reportLocalSuccessFailure } from './localSuccessFailure';
import { contentText } from './turnFeatures';

/** What judged a served local answer. */
export type LocalVerdictSource = 'retry' | 'tool_schema' | 'tool_ok' | 'continued' | 'rating';

export interface LocalTurnVerdict {
  passed: boolean;
  source: LocalVerdictSource;
}

/** The engine's outcome plus the optional verifier verdict (E5). */
export interface VerifiedLocalSuccessOutcome extends LocalSuccessOutcome {
  verifier?: LocalTurnVerdict;
}

/** How long a served local turn waits for its verdict before the transport label is recorded. */
export const LOCAL_VERDICT_TIMEOUT_MS = 5 * 60_000;

/** The Brain runs with no env and no tenant, so only a fully-on lever applies. */
export function verifiedLocalLabelOn(): boolean {
  return isCostLeverOn(undefined, 'e5_verified_local_label', null);
}

/**
 * THE label, in the engine's vocabulary: with the lever on, a local `succeeded` whose
 * verdict failed becomes `failed`. Lever off or no verdict: the transport label.
 */
export function labelWithVerdict(outcome: VerifiedLocalSuccessOutcome, leverOn: boolean = verifiedLocalLabelOn()): LocalSuccessOutcome {
  const { verifier, ...engine } = outcome;
  if (leverOn && verifier && !verifier.passed && engine.local === 'succeeded') return { ...engine, local: 'failed' };
  return engine;
}

type CallMessages = { messages: readonly ChatCompletionMessage[] };

/** The request without its per-turn volatile tail (the run's working-memory brief): that
 *  tail is not the submit, and it changes between calls the label must compare. */
function requestOf(call: CallMessages): readonly ChatCompletionMessage[] {
  return call.messages.filter((m) => !isVolatileTail(m));
}

function lastUserIndex(messages: readonly ChatCompletionMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return i;
  return -1;
}

/** The text of the call's latest user message — the submit a turn belongs to. */
export function submitPrompt(call: CallMessages): string {
  const messages = requestOf(call);
  const i = lastUserIndex(messages);
  return i < 0 ? '' : contentText(messages[i]!.content);
}

const REFUSALS = [MALFORMED_CALL_RESULT, TRUNCATED_CALL_RESULT];

/**
 * What the NEXT call in the same chat says about the pending turn whose submit was
 * `pendingPrompt` — see the module comment for the rows.
 */
export function inferVerdict(pendingPrompt: string, next: CallMessages): LocalTurnVerdict {
  const messages = requestOf(next);
  const i = lastUserIndex(messages);
  const prompt = i < 0 ? '' : contentText(messages[i]!.content);
  if (prompt !== pendingPrompt) return { passed: true, source: 'continued' };
  const tail = messages.slice(i + 1);
  if (tail.length === 0) return { passed: false, source: 'retry' };
  // The pending turn's tool calls are the LAST assistant message of the tail; the tool
  // rows after it are their results.
  let lastAssistant = -1;
  for (let j = tail.length - 1; j >= 0; j--) if (tail[j]!.role === 'assistant') { lastAssistant = j; break; }
  const results = tail.slice(lastAssistant + 1).filter((m) => m.role === 'tool');
  const refused = results.some((m) => {
    const text = contentText(m.content);
    return REFUSALS.some((r) => text.includes(r));
  });
  return refused ? { passed: false, source: 'tool_schema' } : { passed: true, source: 'tool_ok' };
}

/** Where a deferred turn's label is finally written (the router's `record`). */
export type RecordLocalOutcome = (ref: string, outcome: LocalSuccessOutcome) => Promise<void>;

export interface DeferredLocalTurn {
  /** The chat the turn belongs to (`chat:<id>`). */
  conversation: string;
  /** Its submit's user text ({@link submitPrompt}). */
  prompt: string;
  ref: string;
  /** The transport-labelled outcome. */
  outcome: LocalSuccessOutcome;
  record: RecordLocalOutcome;
}

export interface DeferredLocalRecords {
  /** Hold `turn` for its verdict; returns its turn id. An older pending turn of the same chat is recorded first, with its transport label. */
  defer(turn: DeferredLocalTurn): string;
  /** Resolve turn `turnId` with `verdict`. False when it is no longer pending. */
  verdict(turnId: string, verdict: LocalTurnVerdict): boolean;
  /** Resolve the chat's pending turn, if any, from the next call it makes. */
  observe(conversation: string, next: CallMessages): void;
  /** Resolve the chat's pending (latest) turn with an explicit verdict. */
  verdictForConversation(conversation: string, verdict: LocalTurnVerdict): boolean;
  /** Turns waiting for a verdict (diagnostics/tests). */
  pending(): number;
}

interface Pending extends DeferredLocalTurn {
  turnId: string;
  timer: ReturnType<typeof setTimeout>;
}

export interface DeferredLocalRecordsOptions {
  timeoutMs?: number;
  /** Lever override (tests). */
  leverOn?: () => boolean;
}

export function createDeferredLocalRecords(opts: DeferredLocalRecordsOptions = {}): DeferredLocalRecords {
  const timeoutMs = opts.timeoutMs ?? LOCAL_VERDICT_TIMEOUT_MS;
  const leverOn = opts.leverOn ?? verifiedLocalLabelOn;
  const byTurn = new Map<string, Pending>();
  const byConversation = new Map<string, string>();
  let seq = 0;

  function finish(p: Pending, verdict: LocalTurnVerdict | undefined): void {
    clearTimeout(p.timer);
    byTurn.delete(p.turnId);
    if (byConversation.get(p.conversation) === p.turnId) byConversation.delete(p.conversation);
    const outcome = labelWithVerdict(verdict ? { ...p.outcome, verifier: verdict } : p.outcome, leverOn());
    // `record` reports its own failures; this guards a record port that rejects anyway.
    p.record(p.ref, outcome).catch((e: unknown) => reportLocalSuccessFailure('record', e));
  }

  function resolveTurn(turnId: string | undefined, verdict: LocalTurnVerdict | undefined): boolean {
    const p = turnId ? byTurn.get(turnId) : undefined;
    if (!p) return false;
    finish(p, verdict);
    return true;
  }

  return {
    defer(turn) {
      resolveTurn(byConversation.get(turn.conversation), undefined);
      const turnId = `${turn.conversation}#${++seq}`;
      const timer = setTimeout(() => resolveTurn(turnId, undefined), timeoutMs);
      byTurn.set(turnId, { ...turn, turnId, timer });
      byConversation.set(turn.conversation, turnId);
      return turnId;
    },
    verdict: (turnId, verdict) => resolveTurn(turnId, verdict),
    observe(conversation, next) {
      const turnId = byConversation.get(conversation);
      const p = turnId ? byTurn.get(turnId) : undefined;
      if (p) finish(p, inferVerdict(p.prompt, next));
    },
    verdictForConversation: (conversation, verdict) => resolveTurn(byConversation.get(conversation), verdict),
    pending: () => byTurn.size,
  };
}

/** This page's one registry — a host builds its stream per turn, so the pending turn must outlive it. */
export const deferredLocalRecords: DeferredLocalRecords = createDeferredLocalRecords();

/** The chat key a call is deferred under, or null when the call names no chat (it records
 *  at once). The run's own key first — on a local-first host the metadata's chat is the
 *  SERVER chat (or absent), while a verdict names the chat the person is looking at. */
export function conversationKeyOf(call: { conversationKey?: number; metadata?: { chatId?: number } }): string | null {
  const chatId = call.conversationKey ?? call.metadata?.chatId;
  return typeof chatId === 'number' && Number.isFinite(chatId) ? `chat:${chatId}` : null;
}

/**
 * An explicit verdict on chat `chatId`'s latest local reply (a host's thumbs-down /
 * thumbs-up). A no-op when that reply is not waiting — recorded already, or not local.
 */
export function submitLocalTurnVerdict(chatId: number, passed: boolean): boolean {
  return deferredLocalRecords.verdictForConversation(`chat:${chatId}`, { passed, source: 'rating' });
}
