/**
 * The host↔panel wire for host-owned runs (see `brainRunHost.ts`): what the webview posts
 * to start a run, and what the host relays back — the snapshot deltas, tool announcements,
 * settles, and a chat's live sub-agents.
 */

import {
  getRunSnapshot,
  type BrainRunSnapshot,
  type BrainTraceEvent,
  type ChatCompletionMessage,
  type ChatMode,
  type ContentPart,
  type ModelFallbackSurface,
  type ReasoningIntent,
} from "@seanhogg/builderforce-brain-embedded";
import type { ChildView } from "./childRuns";

/** The serializable half of a `BrainRunRequest`, as the webview posts it. */
export interface WebviewRunStart {
  chatId: number;
  audit?: { auditId: string; runId: string };
  systemPrompt: string;
  model?: string;
  modelStrict?: boolean;
  routingMode?: "auto" | "byo_pool";
  maxTokens?: number;
  reasoning?: ReasoningIntent;
  seed?: ChatCompletionMessage[];
  /** Earlier turns' tool work, as a system-prompt block — see `BrainRunRequest.priorResearch`. */
  priorResearch?: string | null;
  userTurn?: string | ContentPart[];
  projectId?: number | null;
  chatMode?: ChatMode;
  /** The panel's Auto-mode switch at start; `setAutoApprove` follows it live. */
  autoApprove: boolean;
  /** Whether this chat's project memory is switched on (recall + learn). */
  evermind: boolean;
  /** The picker's model surface, so the stall failover keeps ONE ordering function. */
  modelSurface?: ModelFallbackSurface | null;
}

/** One relayed change of a run — the snapshot, plus only the trace events and the
 *  streamed text not yet sent. */
export interface RunSyncMessage {
  type: "run.sync";
  chatId: number;
  snapshot: Omit<BrainRunSnapshot, "trace" | "streamingText">;
  /** Index the delta continues from; 0 with a full trace when the sink must resync. */
  traceFrom: number;
  trace: BrainTraceEvent[];
  /** Offset the streamed text continues from; 0 with the whole text when the sink must resync. */
  textFrom: number;
  text: string;
}

export interface RunToolMessage {
  type: "run.tool";
  chatId: number;
  name: string;
  mutating: boolean;
  remote: boolean;
  ok: boolean;
}

export type RunHostMessage =
  | RunSyncMessage
  | RunToolMessage
  | { type: "run.settled"; chatId: number }
  | { type: "run.failed"; chatId: number; error: string }
  /** How many tools this run's model may call — the diagnostics report's count. */
  | { type: "run.tools"; chatId: number; count: number }
  /** A chat's LIVE sub-agents — each is a run of its own, mirrored by its run key. */
  | { type: "run.children"; chatId: number; children: ChildView[] }
  /** Hybrid's pick (`from`) failed and the turn was answered with Auto — the panel shows
   *  the one-line notice for this chat. */
  | { type: "run.modelFallback"; chatId: number; from: string };

/** A webview panel watching the runs — anything that can be posted to. */
export interface RunSink {
  post(message: RunHostMessage): void;
}

/** Per-sink bookkeeping for the deltas: what was last sent for each chat. */
export interface SinkEntry {
  sink: RunSink;
  sent: Map<number, { len: number; first: BrainTraceEvent | undefined; text?: string }>;
}

/**
 * The relay message for one chat, to one sink. The trace is shipped as a DELTA: the
 * store appends in place and trims from the head only past its bound, so the events
 * after the last sent index are new unless the head moved (or the sink is new) — in
 * which case the whole bounded trace is resent from 0.
 *
 * The streamed text is a delta too: a reply only grows within a turn, and resending all
 * of it on every frame made a long reply O(n²) bytes through the host. It continues from
 * what was sent when the text still starts with it; a new turn (the text reset) resends.
 */
export function syncMessageFor(entry: SinkEntry, chatId: number): RunSyncMessage {
  const snapshot = getRunSnapshot(chatId);
  const trace = snapshot.trace;
  const last = entry.sent.get(chatId);
  const continues = last !== undefined && last.len <= trace.length && (last.len === 0 || trace[0] === last.first);
  const traceFrom = continues ? last.len : 0;
  const text = snapshot.streamingText;
  const textFrom = last?.text !== undefined && text.startsWith(last.text) ? last.text.length : 0;
  entry.sent.set(chatId, { len: trace.length, first: trace[0], text });
  const { trace: _omit, streamingText: _text, ...rest } = snapshot;
  return { type: "run.sync", chatId, snapshot: rest, traceFrom, trace: trace.slice(traceFrom), textFrom, text: text.slice(textFrom) };
}
