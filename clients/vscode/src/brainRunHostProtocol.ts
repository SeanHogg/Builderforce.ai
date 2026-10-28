/**
 * The host↔panel wire for host-owned runs (see `brainRunHost.ts`): what the webview posts
 * to start a run, and what the host relays back — the snapshot deltas, tool announcements,
 * settles, and a chat's live sub-agents.
 */

import {
  getRunSnapshot,
  type BrainMessage,
  type BrainRunSnapshot,
  type BrainTraceEvent,
  type ChatCompletionMessage,
  type ChatMode,
  type ContentPart,
  type ModelFallbackSurface,
  type ReasoningIntent,
} from "@seanhogg/builderforce-brain-embedded";
import type { ChildView } from "./childRuns";
import { listDelta, sentOf, type SentList } from "./listDelta";

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
  /** The persisted ids behind `seed` and `userTurn` — see `BrainRunRequest.seedIds`. */
  seedIds?: number[];
  userTurnMessageId?: number;
  projectId?: number | null;
  chatMode?: ChatMode;
  /** The panel's Auto-mode switch at start; `setAutoApprove` follows it live. */
  autoApprove: boolean;
  /** Whether this chat's project memory is switched on (recall + learn). */
  evermind: boolean;
  /** The picker's model surface, so the stall failover keeps ONE ordering function. */
  modelSurface?: ModelFallbackSurface | null;
}

/** One relayed change of a run — the snapshot, plus only the trace events, appended
 *  messages and streamed text not yet sent (`listDelta.ts`). */
export interface RunSyncMessage {
  type: "run.sync";
  chatId: number;
  snapshot: Omit<BrainRunSnapshot, "trace" | "streamingText" | "appended"> & {
    /** A DELTA, like `trace`: the messages after `appendedFrom` (all of them when 0). */
    appended: BrainMessage[];
  };
  appendedDrop: number;
  appendedFrom: number;
  /** Events the sink drops from the head of its trace — the store trimmed its bound. */
  traceDrop: number;
  /** How many of the sink's events (after the drop) the delta continues from; 0 with a
   *  full trace when the sink must resync. */
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

/** Per-sink bookkeeping for the deltas: what was last sent for each chat — the trace's
 *  {@link SentList} at the top level, the appended messages' beside it. */
export interface SinkEntry {
  sink: RunSink;
  sent: Map<number, SentList<BrainTraceEvent> & { text?: string; appended?: SentList<BrainMessage> }>;
}

/**
 * The relay message for one chat, to one sink. The trace and the appended messages are
 * shipped as DELTAS (`listDelta.ts`): the store appends in place and trims from the head
 * only past its bound, so a frame carries the trim and the new items — never the whole
 * bounded list again unless the sink is new or the list was replaced.
 *
 * The streamed text is a delta too: a reply only grows within a turn, and resending all
 * of it on every frame made a long reply O(n²) bytes through the host. It continues from
 * what was sent when the text still starts with it; a new turn (the text reset) resends.
 */
export function syncMessageFor(entry: SinkEntry, chatId: number): RunSyncMessage {
  const snapshot = getRunSnapshot(chatId);
  const last = entry.sent.get(chatId);
  const trace = listDelta(snapshot.trace, last);
  const appended = listDelta(snapshot.appended, last?.appended);
  const text = snapshot.streamingText;
  const textFrom = last?.text !== undefined && text.startsWith(last.text) ? last.text.length : 0;
  entry.sent.set(chatId, { ...sentOf(snapshot.trace), text, appended: sentOf(snapshot.appended) });
  const { trace: _omit, streamingText: _text, ...rest } = snapshot;
  return {
    type: "run.sync",
    chatId,
    snapshot: { ...rest, appended: appended.items },
    appendedDrop: appended.drop,
    appendedFrom: appended.from,
    traceDrop: trace.drop,
    traceFrom: trace.from,
    trace: trace.items,
    textFrom,
    text: text.slice(textFrom),
  };
}
