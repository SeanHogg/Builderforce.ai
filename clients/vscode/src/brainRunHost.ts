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
  isRunning,
  nextFallbackModel,
  queueRunSteering,
  resolveRunConfirm,
  runAbortSignal,
  startRun,
  stopRun,
  subscribeRun,
  subscribeRunStore,
  type BrainRunOutcome,
  type BrainRunPersistence,
  type BrainStreamFn,
  type EvermindRunHooks,
} from "@seanhogg/builderforce-brain-embedded";
import type { ToolDef } from "./fileTools";
import { approvalRequestFor, createNativeRunTool, nativeNeedsConfirm, nativeToolSpecs, type NativeRunLabels } from "./nativeBrainRun";
import type { PolicyGate } from "./policy";
import { withRunPreamble } from "./runPreamble";
import type { RunDirectives } from "./hooks/runHooks";
import { SessionNotes, type RunActivity } from "./sessionNotes";
import { createChildRuns } from "./childRuns";
import { syncMessageFor, type RunHostMessage, type RunSink, type SinkEntry, type WebviewRunStart } from "./brainRunHostProtocol";
import { childControls, directionText, type ChildControls, type ChildOwner } from "./childRunSpawner";
import { createChildRunHost, ownerOf, type RunSpec } from "./childRunHost";
import { createChildApprovalRelay, type ChildApprover } from "./childApprovalRelay";

export { syncMessageFor } from "./brainRunHostProtocol";
export type { RunHostMessage, RunSink, RunSyncMessage, RunToolMessage, SinkEntry, WebviewRunStart } from "./brainRunHostProtocol";

/** The top-level owner's name, as the chat shows it (a brand, not translated). */
export const OWNER_NAME = "BuilderForce";

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
  /**
   * Local file tools + cognition + the gateway's platform catalog, for a project.
   *
   * `children` is THIS run's handle on its sub-agents and `signal` its Stop — built here
   * (not by the port) because only the run knows who it is: its key, its chat, its depth.
   */
  tools(projectId: number | undefined, children: ChildControls, signal: () => AbortSignal | undefined, opts: { memory: boolean }): Promise<readonly ToolDef[]>;
  /** Workspace root the local tools resolve against; '' when no folder is open. */
  workspaceRoot(): string;
  /** The transport-bound streamer for the CURRENT route (gateway or on-device). */
  stream(): Promise<BrainStreamFn>;
  /** Where the loop persists its turns — the same Brain store the panel reads. */
  persistence: BrainRunPersistence;
  /** Project-Evermind hooks for a project (recall, memory-first answer, cache), tiered on
   *  the chat when it is a server chat. */
  evermind(projectId: number, chatId: number): EvermindRunHooks | undefined;
  /**
   * The api-assembled platform context for this turn — strategy / PRD / governance /
   * the project's durable memory (facts) / prior Evermind lessons — rendered as a
   * system-prompt section, or '' when there is none. Fetched once per run at loop
   * start with the user's request as the recall query. This is the block the native
   * participant already carried and the webview run did not: without it a run in the
   * panel started every task with no memory of what earlier runs had learned.
   */
  runContext?(projectId: number, chatId: number, query: string): Promise<string>;
  /**
   * The tenant's effective governance gates for a run — the same compiled rows the
   * cloud and on-prem loops enforce. Resolved once per run at loop start; a throw
   * refuses the run (fail-closed, as the server is). Omitted ⇒ no gates.
   */
  policyGates?(projectId: number | undefined): Promise<readonly PolicyGate[]>;
  /**
   * The workspace's committed rules + hooks (`.builderforce/rules.md`, `hooks.json`) for
   * ONE run — fresh per run, since the hooks hold the run's state. A sub-agent asks with
   * `subagent` and gets the tool hooks only. Omitted ⇒ none.
   */
  directives?(scope: "run" | "subagent"): Promise<RunDirectives | undefined>;
  labels: Pick<NativeRunLabels, "blockedByPolicy">;
  /** A chat gained a turn — refresh the Sessions tree. */
  onChatsChanged?(): void;
  /** A tool call finished (local or platform) — refresh what it may have changed. */
  onToolRun?(info: ToolRunInfo): void;
  /** The set of live runs changed — feed the Sessions tree's status overlay. */
  onRunsChanged?(state: { running: number[]; awaiting: number[] }): void;
  /** A run finished with local activity — write its `.builderforce/` note. */
  sessionNote?(chatId: number, activity: RunActivity): Promise<void> | void;
  /** Report a settled code-changing run's outcome to learned routing. Best-effort. */
  reportOutcome?(outcome: BrainRunOutcome): Promise<unknown>;
}

export interface BrainRunHost {
  /** Run one turn. Resolves when the loop has settled (like `startRun`). */
  start(payload: WebviewRunStart): Promise<void>;
  stop(chatId: number): void;
  confirm(chatId: number, ok: boolean): void;
  clearError(chatId: number): void;
  /**
   * The Auto-mode switch moved for ONE chat — the one whose panel it was flipped in.
   *
   * Deliberately per-chat, and the reason is the whole point of runs living out here:
   * several chats execute AT ONCE, and closing or switching away from a tab no longer
   * stops the work behind it. While this applied to every live run, "turn Auto on so
   * this refactor stops asking me" also silently answered YES to whatever a DIFFERENT
   * chat happened to be parked on — a delete, a push, a base-branch commit — in a tab
   * the user was not even looking at. A switch in one conversation must not approve an
   * action in another.
   *
   * Also called when a panel BINDS to a chat, not only when the switch is toggled: in
   * reuse mode one panel moves between chats, so a chat parked on a confirm must be
   * answered the moment the user comes back to it with Auto already on — otherwise the
   * per-chat scoping would strand exactly the run the user returned to unblock.
   */
  setAutoApprove(chatId: number, on: boolean): void;
  /** Put the person's words in front of a RUNNING run's next turn — the chat's own run
   *  (instead of queueing behind it) or one of its sub-agents. */
  steer(runKey: number, text: string): void;
  /**
   * Sub-agent controls for a run this host did NOT start — the native chat participant.
   * Its children run here, as ordinary runs; it cannot be woken (its turn belongs to the
   * editor's chat view), so their reports wait in its inbox for its next turn. With
   * `approve`, its children's write prompts are asked through it (the native view cannot
   * render a run cell's confirm).
   */
  childControls(owner: ChildOwner, base: Omit<WebviewRunStart, "chatId">, approve?: ChildApprover): ChildControls;
  /** Watch the runs from a panel. The panel is brought up to date immediately. */
  attach(sink: RunSink): () => void;
  dispose(): void;
}

function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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
  /** The spec each run key was last started with — what a child derives from and what an
   *  idle owner is woken with. */
  const specs = new Map<number, RunSpec>();
  /** Every live sub-agent, by the chat it lives in. */
  const registry = createChildRuns();
  const approvals = createChildApprovalRelay({
    registry,
    pendingOf: (key) => getRunSnapshot(key).pendingConfirm,
    resolve: resolveRunConfirm,
  });

  const broadcast = (message: RunHostMessage): void => {
    for (const entry of sinks) entry.sink.post(message);
  };
  const broadcastSync = (chatId: number): void => {
    for (const entry of sinks) entry.sink.post(syncMessageFor(entry, chatId));
  };
  const watch = (chatId: number): void => {
    if (watched.has(chatId)) return;
    watched.add(chatId);
    subscribeRun(chatId, () => {
      broadcastSync(chatId);
      approvals.changed(chatId);
    });
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

  const flushNote = async (runKey: number, chatId: number): Promise<void> => {
    const n = notes.get(runKey);
    if (!n || n.isEmpty) return;
    notes.delete(runKey);
    try {
      await ports.sessionNote?.(chatId, n.activity);
    } catch {
      /* a note is best-effort — never a run failure */
    }
  };

  /** The server chat a run lives in — its owner's, for a sub-agent. */
  const chatOf = (p: RunSpec): number => p.child?.lineage.rootChatId ?? p.chatId;
  const announce = (chatId: number): void => broadcast({ type: "run.children", chatId, children: registry.viewsIn(chatId) });
  /** Chats with a turn being set up or run by THIS host — claimed before the async setup. */
  const active = new Set<number>();

  /**
   * ONE run entry for every run: a chat's turn, a sub-agent (its key is its own, its
   * chat is its owner's), and an idle owner woken by a child's report.
   */
  const run = async (p: RunSpec): Promise<void> => {
    const key = p.chatId;
    known.add(key);
    watch(key);
    // Already running (a second tab, a double submit): the live run owns this key.
    // Returning before the setup keeps a no-op start from deleting the live run's Auto
    // flag on the way out.
    if (active.has(key) || isRunning(key)) return;
    active.add(key);
    specs.set(key, p);
    try {
      await runTurn(p);
    } finally {
      active.delete(key);
      // A child's report that arrived as this run was ending is heard now.
      childHost.afterRun(key);
    }
  };

  const runTurn = async (p: RunSpec): Promise<void> => {
    const key = p.chatId;
    const chatId = chatOf(p);
    const flag = { autoApprove: p.autoApprove };
    flags.set(key, flag);
    const root = ports.workspaceRoot();
    const projectId = p.projectId ?? undefined;
    // Governance FIRST: an unreadable policy throws here and the run never starts.
    const gates = (await ports.policyGates?.(projectId)) ?? [];
    const directives = await ports.directives?.(p.child ? "subagent" : "run");

    // What a finished tool call means to this host — the knowledge loop, the Changes
    // view and the panel's feed. A sub-agent's calls are its own run's, read the same way.
    const recordToolRun = (def: ToolDef, record: Record<string, unknown>, out: unknown): void => {
      const ok = !isFailedToolResult(out);
      const name = def.name;
      // Feed the knowledge loop on SUCCESS only — a note claiming a file was written
      // when the write threw would ground every later run on a lie.
      if (ok && !def.remote) notesFor(key).record(name, record);
      const info: ToolRunInfo = { chatId, name, args: record, mutating: def.mutating, remote: !!def.remote, ok };
      ports.onToolRun?.(info);
      broadcast({ type: "run.tool", chatId, name, mutating: def.mutating, remote: !!def.remote, ok });
    };

    // THIS run's sub-agents — and, for a sub-agent, its own (the pointer nests). Read at
    // call time: the run's abort controller is created by `startRun`, after this catalog.
    const children = childControls(childHost, ownerOf(p, OWNER_NAME));
    // A sub-agent is a clone of its owner: the same catalog, built the same way.
    // The chat's Memory switch (`p.evermind`) gates the memory TOOLS as well as the
    // loop's recall: "off" must mean the run neither reads nor writes project memory.
    const defs = await ports.tools(projectId, children, () => runAbortSignal(key), { memory: p.evermind });
    broadcast({ type: "run.tools", chatId: key, count: defs.length });
    const native = createNativeRunTool({
      defs,
      root,
      ...(gates.length ? { gates } : {}),
      ...(directives ? { hooks: directives.hooks } : {}),
      events: { onToolStart: () => undefined, onToolResult: () => undefined },
      labels: ports.labels,
    });
    const runTool = async (name: string, args: unknown): Promise<unknown> => {
      const def = defs.find((d) => d.name === name);
      const out = await native(name, args);
      if (def) recordToolRun(def, argsRecord(args), out);
      return out;
    };
    // The gate reads the LIVE flag: `nativeNeedsConfirm` is the one predicate every
    // host surface shares, re-bound per call so a mid-run switch is honoured.
    const needsConfirm = (req: { name: string; args: unknown }): boolean =>
      nativeNeedsConfirm(defs, flag.autoApprove ? "acceptEdits" : "ask", gates)(req);
    approvals.describeWith(key, (name, args) => approvalRequestFor(defs, gates, name, args));
    // A sub-agent's turns are routed for ITS role (explore / code / verify), not its owner's.
    const transport = await ports.stream();
    const role = p.child?.role;
    const stream: BrainStreamFn = role ? (opts, handlers) => transport({ ...opts, role }, handlers) : transport;
    const surface = p.modelSurface ?? null;
    try {
      // Gates render as binding directives ahead of the host prompt, then the workspace's
      // rules — the one preamble the native participant shares.
      await startRun(key, {
        resolvedSystemPrompt: withRunPreamble(p.systemPrompt, { gates, rules: directives?.rules }),
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
        ...(p.evermind && projectId != null ? { evermind: ports.evermind(projectId, chatId) } : {}),
        // Project memory + platform context, appended to the system prompt by the loop
        // (the same seam the limbic block uses) so the webview run starts from what the
        // project already knows instead of rediscovering it with tool calls.
        ...(projectId != null && ports.runContext
          ? { augmentSystemPrompt: (text: string) => ports.runContext!(projectId, chatId, text) }
          : {}),
        ...(p.seed ? { seed: p.seed } : {}),
        ...(p.priorResearch ? { priorResearch: p.priorResearch } : {}),
        ...(p.userTurn != null ? { userTurn: p.userTurn } : {}),
        projectId: p.projectId ?? null,
        ...(p.chatMode ? { chatMode: p.chatMode } : {}),
        ...(ports.reportOutcome ? { reportOutcome: (o: BrainRunOutcome) => ports.reportOutcome!(o) } : {}),
        ...(p.child ? { lineage: p.child.lineage } : {}),
        ...(directives ? { onStop: directives.hooks.onStop } : {}),
      });
    } finally {
      flags.delete(key);
      approvals.forget(key);
      await flushNote(key, chatId);
      // The workspace's runEnd hooks — after the run, never holding its settle.
      void directives?.hooks.onRunEnd();
    }
  };

  const start = async (payload: RunSpec): Promise<void> => {
    try {
      await run(payload);
      broadcast({ type: "run.settled", chatId: payload.chatId });
    } catch (e) {
      // The loop reports its own failures on the run cell; this is the rarer case of
      // the run never starting (the tool catalog or transport could not be built).
      broadcast({ type: "run.failed", chatId: payload.chatId, error: e instanceof Error ? e.message : String(e) });
    }
  };

  /** The Auto switch of a chat right now: its live run's, else the one it last ran with. */
  const autoApproveOf = (chatId: number): boolean => flags.get(chatId)?.autoApprove ?? specs.get(chatId)?.autoApprove ?? false;

  const childHost = createChildRunHost({
    registry,
    specOf: (key) => specs.get(key),
    start,
    isBusy: (key) => active.has(key) || isRunning(key),
    autoApproveOf,
    persistence: ports.persistence,
    announce,
  });

  return {
    start,
    // A sub-agent's Stop is its own run's Stop, marked as on purpose so it reports
    // "stopped" rather than "failed".
    stop: (runKey) => childHost.stop(runKey),
    confirm: (runKey, ok) => resolveRunConfirm(runKey, ok),
    clearError: (runKey) => clearRunError(runKey),
    steer(runKey, text) {
      if (!isRunning(runKey) || !text.trim()) return;
      const lineage = registry.lineageOf(runKey);
      // A sub-agent hears it as direction from its owner; the chat's own run hears the
      // person directly. Either way it is in front of the run's NEXT turn, not after it.
      queueRunSteering(runKey, lineage ? directionText(lineage.ownerName, text) : text);
      // A run sitting in `wait_agents` would otherwise hear this only once every child
      // settled; the wait gives way and the next turn answers.
      registry.interrupt(runKey);
      childHost.postDirection(lineage?.rootChatId ?? runKey, "person", lineage?.ownerName ?? OWNER_NAME, lineage?.agent ?? null, text);
    },
    childControls(owner, base, approve) {
      // Registered so a child can derive from it; never woken — its turns are the editor's.
      specs.set(owner.key, { ...base, chatId: owner.key, wakeable: false });
      if (approve) approvals.register(owner.rootChatId, approve);
      return childControls(childHost, owner);
    },
    setAutoApprove(chatId, on) {
      // Remembered for the next run, a wake, and any child started later.
      const last = specs.get(chatId);
      if (last) specs.set(chatId, { ...last, autoApprove: on });
      // The switch covers the whole conversation: the chat's run AND its live sub-agents.
      for (const key of [chatId, ...registry.viewsIn(chatId).map((c) => c.key)]) {
        const flag = flags.get(key);
        // No live run for this key: nothing to move.
        if (!flag) continue;
        flag.autoApprove = on;
        // Flipping it ON answers the question THIS run is paused on — the same shortcut
        // the panel's switch always took, aimed at one conversation.
        if (on) resolveRunConfirm(key, true);
      }
    },
    attach(sink) {
      const entry: SinkEntry = { sink, sent: new Map() };
      sinks.add(entry);
      for (const chatId of known) sink.post(syncMessageFor(entry, chatId));
      for (const chatId of known) if (chatId > 0) sink.post({ type: "run.children", chatId, children: registry.viewsIn(chatId) });
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
