/**
 * HOST-OWNED Brain runs for the webview panel.
 *
 * The chat's agent loop used to execute inside the webview's JavaScript. That process
 * is disposable: closing the tab destroys it, and with it any run in flight — a user
 * who closed the chat to look at a file lost the run that was editing it. The loop
 * now executes HERE, in the extension host, which lives as long as the editor does.
 * The panel is a VIEW of that run: it starts one, watches it, and can be closed and
 * reopened while the run carries on.
 *
 * This module owns no `vscode` runtime import (types only, through the ports), for
 * the same reason `nativeBrainRun.ts` does not: everything between "the webview asked
 * for a run" and "the webview was told what happened" is deterministic once the
 * gateway is scripted, and is tested that way in `brainRunHost.test.ts`.
 *
 * Contract with the webview (see `webview/src/hostRunDriver.ts`):
 *   - `run.start` carries a {@link WebviewRunStart} — the SERIALIZABLE half of a
 *     `BrainRunRequest`. The functions (stream, tools, persistence, memory) are the
 *     host's own, assembled from the same primitives the native chat participant uses.
 *   - Every change of the run store is relayed as `run.sync` (snapshot + a trace
 *     DELTA), so the webview's store mirrors this one via `applyRemoteRun`.
 *   - `run.settled` / `run.failed` close the webview's awaited start.
 *   - `run.tool` announces a finished tool call, so the panel can refresh what a
 *     platform write changed.
 */

import {
  clearRunError,
  getGlobalRunState,
  getRunSnapshot,
  isFailedToolResult,
  nextFallbackModel,
  resolveRunConfirm,
  startRun,
  stopRun,
  subscribeRun,
  subscribeRunStore,
  type BrainRunPersistence,
  type BrainRunSnapshot,
  type BrainStreamFn,
  type BrainTraceEvent,
  type ChatCompletionMessage,
  type ChatMode,
  type ContentPart,
  type DirectedRecipient,
  type EvermindRunHooks,
  type ModelFallbackSurface,
  type ReasoningIntent,
} from "@seanhogg/builderforce-brain-embedded";
import type { ToolDef } from "./fileTools";
import { createNativeRunTool, nativeNeedsConfirm, nativeToolSpecs, type NativeRunLabels } from "./nativeBrainRun";
import { SessionNotes, type RunActivity } from "./sessionNotes";

/** The serializable half of a `BrainRunRequest`, as the webview posts it. */
export interface WebviewRunStart {
  chatId: number;
  systemPrompt: string;
  model?: string;
  modelStrict?: boolean;
  routingMode?: "auto" | "byo_pool";
  maxTokens?: number;
  reasoning?: ReasoningIntent;
  seed?: ChatCompletionMessage[];
  userTurn?: string | ContentPart[];
  projectId?: number | null;
  chatMode?: ChatMode;
  maxIterations?: number;
  /** The invited agent this turn answers AS (a directed turn run here, with the
   *  workspace tools, rather than by the server); assistant turns are attributed to it. */
  authoredBy?: DirectedRecipient;
  /** The panel's Auto-mode switch at start; `setAutoApprove` follows it live. */
  autoApprove: boolean;
  /** Whether this chat's project memory is switched on (recall + learn). */
  evermind: boolean;
  /** The picker's model surface, so the stall failover keeps ONE ordering function. */
  modelSurface?: ModelFallbackSurface | null;
}

/** One relayed change of a run — the snapshot, plus only the trace events not yet sent. */
export interface RunSyncMessage {
  type: "run.sync";
  chatId: number;
  snapshot: Omit<BrainRunSnapshot, "trace">;
  /** Index the delta continues from; 0 with a full trace when the sink must resync. */
  traceFrom: number;
  trace: BrainTraceEvent[];
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
  | { type: "run.tools"; chatId: number; count: number };

/** A webview panel watching the runs — anything that can be posted to. */
export interface RunSink {
  post(message: RunHostMessage): void;
}

export interface ToolRunInfo {
  chatId: number;
  name: string;
  args: Record<string, unknown>;
  mutating: boolean;
  remote: boolean;
  ok: boolean;
}

/** What the editor supplies to a run; every member is host-side, none needs the panel. */
export interface BrainRunHostPorts {
  /** Local file tools + cognition + the gateway's platform catalog, for a project. */
  tools(projectId: number | undefined): Promise<readonly ToolDef[]>;
  /** Workspace root the local tools resolve against; '' when no folder is open. */
  workspaceRoot(): string;
  /** The transport-bound streamer for the CURRENT route (gateway or on-device). */
  stream(): Promise<BrainStreamFn>;
  /** Where the loop persists its turns — the same Brain store the panel reads. */
  persistence: BrainRunPersistence;
  /** Project-Evermind hooks for a project (recall, memory-first answer, cache). */
  evermind(projectId: number): EvermindRunHooks | undefined;
  labels: Pick<NativeRunLabels, "blockedByPolicy">;
  /** A chat gained a turn — refresh the Sessions tree. */
  onChatsChanged?(): void;
  /** A tool call finished (local or platform) — refresh what it may have changed. */
  onToolRun?(info: ToolRunInfo): void;
  /** The set of live runs changed — feed the Sessions tree's status overlay. */
  onRunsChanged?(state: { running: number[]; awaiting: number[] }): void;
  /** A run finished with local activity — write its `.builderforce/` note. */
  sessionNote?(chatId: number, activity: RunActivity): Promise<void> | void;
}

export interface BrainRunHost {
  /** Run one turn. Resolves when the loop has settled (like `startRun`). */
  start(payload: WebviewRunStart): Promise<void>;
  stop(chatId: number): void;
  confirm(chatId: number, ok: boolean): void;
  clearError(chatId: number): void;
  /** The panel's Auto-mode switch moved. Panel-global, so it applies to every live run. */
  setAutoApprove(on: boolean): void;
  /** Watch the runs from a panel. The panel is brought up to date immediately. */
  attach(sink: RunSink): () => void;
  dispose(): void;
}

/** Per-sink bookkeeping for the trace delta: what was last sent for each chat. */
export interface SinkEntry {
  sink: RunSink;
  sent: Map<number, { len: number; first: BrainTraceEvent | undefined }>;
}

function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The relay message for one chat, to one sink. The trace is shipped as a DELTA: the
 * store appends in place and trims from the head only past its bound, so the events
 * after the last sent index are new unless the head moved (or the sink is new) — in
 * which case the whole bounded trace is resent from 0.
 */
export function syncMessageFor(entry: SinkEntry, chatId: number): RunSyncMessage {
  const snapshot = getRunSnapshot(chatId);
  const trace = snapshot.trace;
  const last = entry.sent.get(chatId);
  const continues = last !== undefined && last.len <= trace.length && (last.len === 0 || trace[0] === last.first);
  const traceFrom = continues ? last.len : 0;
  entry.sent.set(chatId, { len: trace.length, first: trace[0] });
  const { trace: _omit, ...rest } = snapshot;
  return { type: "run.sync", chatId, snapshot: rest, traceFrom, trace: trace.slice(traceFrom) };
}

export function createBrainRunHost(ports: BrainRunHostPorts): BrainRunHost {
  const sinks = new Set<SinkEntry>();
  /** Chats this host has run — the ones a newly attached panel is brought up to date on. */
  const known = new Set<number>();
  const watched = new Set<number>();
  const notes = new Map<number, SessionNotes>();
  /** Live per-run gate flags; `needsConfirm` reads them so a switch flipped mid-run
   *  takes effect on the NEXT call instead of after the run (the shared gate's rule). */
  const flags = new Map<number, { autoApprove: boolean }>();

  const broadcast = (message: RunHostMessage): void => {
    for (const entry of sinks) entry.sink.post(message);
  };
  const broadcastSync = (chatId: number): void => {
    for (const entry of sinks) entry.sink.post(syncMessageFor(entry, chatId));
  };
  const watch = (chatId: number): void => {
    if (watched.has(chatId)) return;
    watched.add(chatId);
    subscribeRun(chatId, () => broadcastSync(chatId));
  };
  const offStore = subscribeRunStore(() => ports.onRunsChanged?.(getGlobalRunState()));

  const notesFor = (chatId: number): SessionNotes => {
    let n = notes.get(chatId);
    if (!n) {
      n = new SessionNotes();
      notes.set(chatId, n);
    }
    return n;
  };

  const flushNote = async (chatId: number): Promise<void> => {
    const n = notes.get(chatId);
    if (!n || n.isEmpty) return;
    notes.delete(chatId);
    try {
      await ports.sessionNote?.(chatId, n.activity);
    } catch {
      /* a note is best-effort — never a run failure */
    }
  };

  const run = async (p: WebviewRunStart): Promise<void> => {
    const { chatId } = p;
    known.add(chatId);
    watch(chatId);
    const flag = { autoApprove: p.autoApprove };
    flags.set(chatId, flag);
    const root = ports.workspaceRoot();
    const projectId = p.projectId ?? undefined;
    const defs = await ports.tools(projectId);
    broadcast({ type: "run.tools", chatId, count: defs.length });
    const native = createNativeRunTool({
      defs,
      root,
      events: { onToolStart: () => undefined, onToolResult: () => undefined },
      labels: ports.labels,
    });
    const runTool = async (name: string, args: unknown): Promise<unknown> => {
      const out = await native(name, args);
      const def = defs.find((d) => d.name === name);
      if (def) {
        const ok = !isFailedToolResult(out);
        const record = argsRecord(args);
        // Feed the knowledge loop on SUCCESS only — a note claiming a file was written
        // when the write threw would ground every later run on a lie.
        if (ok && !def.remote) notesFor(chatId).record(name, record);
        const info: ToolRunInfo = { chatId, name, args: record, mutating: def.mutating, remote: !!def.remote, ok };
        ports.onToolRun?.(info);
        broadcast({ type: "run.tool", chatId, name, mutating: def.mutating, remote: !!def.remote, ok });
      }
      return out;
    };
    // The gate reads the LIVE flag: `nativeNeedsConfirm` is the one predicate every
    // host surface shares, re-bound per call so a mid-run switch is honoured.
    const needsConfirm = (req: { name: string; args: unknown }): boolean =>
      nativeNeedsConfirm(defs, flag.autoApprove ? "acceptEdits" : "ask", undefined)(req);
    const stream = await ports.stream();
    const surface = p.modelSurface ?? null;
    try {
      await startRun(chatId, {
        resolvedSystemPrompt: p.systemPrompt,
        tools: nativeToolSpecs(defs),
        ...(p.model ? { model: p.model } : {}),
        ...(p.modelStrict != null ? { modelStrict: p.modelStrict } : {}),
        ...(p.routingMode ? { routingMode: p.routingMode } : {}),
        ...(p.modelStrict ? {} : { pickFallbackModel: (tried: readonly string[]) => nextFallbackModel(surface, tried) }),
        ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
        ...(p.reasoning ? { reasoning: p.reasoning } : {}),
        runTool,
        needsConfirm,
        stream,
        persistence: ports.persistence,
        onActivity: () => ports.onChatsChanged?.(),
        ...(p.evermind && projectId != null ? { evermind: ports.evermind(projectId) } : {}),
        ...(p.seed ? { seed: p.seed } : {}),
        ...(p.userTurn != null ? { userTurn: p.userTurn } : {}),
        projectId: p.projectId ?? null,
        ...(p.chatMode ? { chatMode: p.chatMode } : {}),
        ...(p.maxIterations ? { maxIterations: p.maxIterations } : {}),
        ...(p.authoredBy ? { authoredBy: p.authoredBy } : {}),
      });
    } finally {
      flags.delete(chatId);
      await flushNote(chatId);
    }
  };

  return {
    async start(payload) {
      try {
        await run(payload);
        broadcast({ type: "run.settled", chatId: payload.chatId });
      } catch (e) {
        // The loop reports its own failures on the run cell; this is the rarer case of
        // the run never starting (the tool catalog or transport could not be built).
        broadcast({ type: "run.failed", chatId: payload.chatId, error: e instanceof Error ? e.message : String(e) });
      }
    },
    stop: (chatId) => stopRun(chatId),
    confirm: (chatId, ok) => resolveRunConfirm(chatId, ok),
    clearError: (chatId) => clearRunError(chatId),
    setAutoApprove(on) {
      for (const flag of flags.values()) flag.autoApprove = on;
      // Flipping it ON answers the question the loop is currently paused on — the
      // same shortcut the panel's switch always took.
      if (on) for (const chatId of flags.keys()) resolveRunConfirm(chatId, true);
    },
    attach(sink) {
      const entry: SinkEntry = { sink, sent: new Map() };
      sinks.add(entry);
      for (const chatId of known) sink.post(syncMessageFor(entry, chatId));
      return () => {
        sinks.delete(entry);
      };
    },
    dispose() {
      offStore();
      sinks.clear();
    },
  };
}
