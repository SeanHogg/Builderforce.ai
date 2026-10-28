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
  gatewayModelWindows,
  getGlobalRunState,
  getRunSnapshot,
  isFailedToolResult,
  isRunning,
  nextFallbackModel,
  resolveRunConfirm,
  runAbortSignal,
  startRun,
  subscribeRunStore,
  type BrainRunOutcome,
  type BrainStreamFn,
  type RunEndOutcome,
} from "@seanhogg/builderforce-brain-embedded";
import type { ToolDef } from "./fileTools";
import { approvalRequestFor, createNativeRunTool, nativeNeedsConfirm, nativeToolSpecs } from "./nativeBrainRun";
import { withRunPreamble } from "./runPreamble";
import { replaceWorkspaceMap } from "./idePersona";
import { RunKnowledgeRecorder, recordingOnly } from "@builderforce/agent-tools";
import { createChildRuns } from "./childRuns";
import { createRunRelay } from "./runRelay";
import { childControls } from "./childRunSpawner";
import { createChildRunHost, ownerOf, type RunSpec } from "./childRunHost";
import { createChildApprovalRelay } from "./childApprovalRelay";
import { createRunWatches } from "./runWatches";
import { OWNER_NAME, type BrainRunHost, type BrainRunHostPorts, type RunNoteOptions, type ToolRunInfo } from "./brainRunHostContract";
import { runContextFields, startRunRepo } from "./runSetup";
import { runRequestFields } from "./stageModels";
import { createRunSteer } from "./runSteer";

export { syncMessageFor } from "./brainRunHostProtocol";
export type { RunHostMessage, RunSink, RunSyncMessage, RunToolMessage, SinkEntry, WebviewRunStart } from "./brainRunHostProtocol";
export { OWNER_NAME } from "./brainRunHostContract";
export type { BrainRunHost, BrainRunHostPorts, RunContextPack, RunNoteOptions, ToolRunInfo } from "./brainRunHostContract";

/** The user's ask, whether the panel sent a string or multimodal parts. */
function askedText(turn: RunSpec["userTurn"]): string | undefined {
  if (typeof turn === "string") {
    const asked = turn.replace(/\s+/g, " ").trim();
    return asked || undefined;
  }
  if (!Array.isArray(turn)) return undefined;
  const parts: string[] = [];
  for (const part of turn) {
    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
      parts.push(part.text);
    }
  }
  const asked = parts.join(" ").replace(/\s+/g, " ").trim();
  return asked || undefined;
}

function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function createBrainRunHost(ports: BrainRunHostPorts): BrainRunHost {
  const relay = createRunRelay();
  const notes = new Map<number, RunKnowledgeRecorder>();
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

  const { broadcast } = relay;
  /** The runs this host relays: subscribed while live, the recent ones replayed to a new panel. */
  const watches = createRunWatches(
    (chatId) => {
      relay.sync(chatId);
      approvals.changed(chatId);
    },
    relay.forget,
  );
  const offStore = subscribeRunStore(() => ports.onRunsChanged?.(getGlobalRunState()));

  const notesFor = (chatId: number): RunKnowledgeRecorder => {
    let n = notes.get(chatId);
    if (!n) {
      n = new RunKnowledgeRecorder();
      notes.set(chatId, n);
    }
    return n;
  };

  const flushNote = async (runKey: number, chatId: number, opts: RunNoteOptions): Promise<void> => {
    const n = notes.get(runKey);
    // Dropped even when empty: a recorder per key that never noted anything is still a recorder.
    notes.delete(runKey);
    if (!n || n.isEmpty) return;
    try {
      await ports.sessionNote?.(chatId, n, opts);
    } catch {
      /* a note is best-effort — never a run failure */
    }
  };

  /** The server chat a run lives in — its owner's, for a sub-agent. */
  const chatOf = (p: RunSpec): number => p.child?.lineage.rootChatId ?? p.chatId;
  const announce = (chatId: number): void => broadcast({ type: "run.children", chatId, children: registry.viewsIn(chatId) });
  /** Chats with a turn being set up or run by THIS host — claimed before the async setup. */
  const active = new Set<number>();
  /** The claimed keys whose loop has not ENDED yet — before it starts, a steer is heard at turn 1. */
  const settingUp = new Set<number>();

  /**
   * ONE run entry for every run: a chat's turn, a sub-agent (its key is its own, its
   * chat is its owner's), and an idle owner woken by a child's report.
   */
  const run = async (p: RunSpec): Promise<void> => {
    const key = p.chatId;
    watches.watch(key);
    // Already running (a second tab, a double submit): the live run owns this key.
    // Returning before the setup keeps a no-op start from deleting the live run's Auto
    // flag on the way out.
    if (active.has(key) || isRunning(key)) return;
    active.add(key);
    settingUp.add(key);
    // What a child derives from and a wake restarts with; the turn's own seed, research and
    // message are never reused (a wake passes the next turn), so they are not kept.
    const { seed: _seed, priorResearch: _prior, userTurn: _turn, seedIds: _ids, userTurnMessageId: _turnId, ...kept } = p;
    specs.set(key, kept);
    try {
      await runTurn(p);
    } finally {
      active.delete(key);
      settingUp.delete(key);
      // Settled: stop pinning its cell. Before `afterRun`, whose wake re-watches the key.
      watches.release(key);
      // What the run held outside the loop (its background jobs) dies with it.
      ports.settleRun?.(key);
      // A child's report that arrived as this run was ending is heard now…
      childHost.afterRun(key);
      // …and so is what the person typed as it ended (unless they stopped it).
      steering.settled(key);
    }
  };

  const runTurn = async (p: RunSpec): Promise<void> => {
    const key = p.chatId;
    const chatId = chatOf(p);
    const flag = { autoApprove: p.autoApprove };
    flags.set(key, flag);
    const root = ports.workspaceRoot();
    const asked = askedText(p.userTurn);
    if (asked) notesFor(key).setPrompt(asked);
    const projectId = p.projectId ?? undefined;
    // E3: the run's default checkout, resolved ONCE and in parallel with the setup below;
    // a tool call waits for it (the port bounds itself), a failure means "none".
    const repo = startRunRepo(ports, { ...(projectId != null ? { projectId } : {}), ...(asked ? { request: asked } : {}) });
    // Governance FIRST: an unreadable policy throws here and the run never starts.
    const gates = (await ports.policyGates?.(projectId)) ?? [];
    const directives = await ports.directives?.(p.child ? "subagent" : "run");
    const systemPrompt = ports.grounding ? replaceWorkspaceMap(p.systemPrompt, await ports.grounding()) : p.systemPrompt;

    // What a finished tool call means to this host — the knowledge loop, the Changes
    // view and the panel's feed. A sub-agent's calls are its own run's, read the same way.
    const recordToolRun = (def: ToolDef, record: Record<string, unknown>, out: unknown): void => {
      const ok = !isFailedToolResult(out);
      const name = def.name;
      // The knowledge record itself is kept by the loop (`knowledge` below, successes
      // only), so the per-turn ledger and this run's note + code map are ONE record.
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
    const defs = await ports.tools(projectId, children, () => runAbortSignal(key), { memory: p.evermind, ...(p.audit ? { audit: p.audit } : {}) });
    broadcast({ type: "run.tools", chatId: key, count: defs.length });
    const native = createNativeRunTool({
      defs,
      root,
      ...(gates.length ? { gates } : {}),
      ...(directives ? { hooks: directives.hooks } : {}),
      events: { onToolStart: () => undefined, onToolResult: () => undefined },
      labels: ports.labels,
      defaultRepo: repo.current,
      // The run owns the background jobs its calls start; they die when it settles.
      runKey: key,
    });
    // `signal` is the call's Stop (the run's, or the step's when a steer may interrupt it).
    const runTool = async (name: string, args: unknown, signal?: AbortSignal): Promise<unknown> => {
      const def = defs.find((d) => d.name === name);
      await repo.ready;
      // Every other call is lent the RUN's Stop, so Stop reaches every tool.
      const out = await native(name, args, signal ?? runAbortSignal(key));
      if (def) recordToolRun(def, argsRecord(args), out);
      return out;
    };
    // The gate reads the LIVE flag: `nativeNeedsConfirm` is the one predicate every
    // host surface shares, re-bound per call so a mid-run switch is honoured.
    const needsConfirm = (req: { name: string; args: unknown }): boolean =>
      nativeNeedsConfirm(defs, flag.autoApprove ? "acceptEdits" : "ask", gates)(req);
    approvals.describeWith(key, (name, args) => approvalRequestFor(defs, gates, name, args));
    // A sub-agent's turns are routed for ITS role (explore / code / verify), not its owner's.
    // A Hybrid pick that failed and was answered with Auto is announced to THIS chat's
    // panel, which shows the one-line notice — a fallback is never silent.
    const transport = await ports.stream((event) => broadcast({ type: "run.modelFallback", chatId: key, from: event.from }));
    const role = p.child?.role;
    const routed: BrainStreamFn = role ? (opts, handlers) => transport({ ...opts, role }, handlers) : transport;
    const stream: BrainStreamFn = ports.recordUsage
      ? ports.recordUsage(routed, { chatId, runKey: key, ...(p.chatMode ? { mode: p.chatMode } : {}) })
      : routed;
    // The run's chat OFF this machine (PRD 36) — bound now when signed in. Without the
    // port the chat id is itself a server chat (and is what the server calls name).
    const identity = ports.chatIdentity ? await ports.chatIdentity(chatId) : undefined;
    const serverChatId = identity ? identity.serverChatId : chatId;
    const surface = p.modelSurface ?? null;
    // Stage models, pipeline routing and the USD cap (`editorRunSettings.ts`); a sub-agent
    // takes only the cap — its model is `modelForChildRun`'s and it is never routed.
    const runSettings = runRequestFields(await ports.runSettings?.(), { child: !!p.child });
    try {
      // Gates render as binding directives ahead of the host prompt, then the workspace's
      // rules — the one preamble the native participant shares.
      await startRun(key, {
        resolvedSystemPrompt: withRunPreamble(systemPrompt, { gates, rules: directives?.rules }),
        // Only this workspace's tools feed the run's record: a remote platform call acted
        // elsewhere, and must not land in the workspace's note or code map.
        knowledge: recordingOnly(notesFor(key), (name) => !defs.find((d) => d.name === name)?.remote),
        tools: nativeToolSpecs(defs),
        ...(p.model ? { model: p.model } : {}),
        ...(p.modelStrict != null ? { modelStrict: p.modelStrict } : {}),
        ...(p.routingMode ? { routingMode: p.routingMode } : {}),
        ...(p.modelStrict ? {} : { pickFallbackModel: (tried: readonly string[]) => nextFallbackModel(surface, tried) }),
        // The surface's connected-account windows and the live on-device runtimes: a
        // failover onto a smaller model (cloud or local) is packed for it.
        windowSources: {
          cloud: gatewayModelWindows(surface),
          ...(ports.localProbes ? { probes: ports.localProbes } : {}),
        },
        ...(p.maxTokens ? { maxTokens: p.maxTokens } : {}),
        ...(p.reasoning ? { reasoning: p.reasoning } : {}),
        runTool,
        needsConfirm,
        stream,
        persistence: ports.persistence,
        onActivity: () => ports.onChatsChanged?.(),
        ...(identity ? { serverChatId: identity.serverChatId, ...(identity.clientChatId ? { clientChatId: identity.clientChatId } : {}) } : {}),
        ...(p.evermind && projectId != null ? { evermind: ports.evermind(projectId, serverChatId) } : {}),
        // Project memory + platform context and the task context pack (PRD 35 E2), so the
        // run starts from what the project already knows instead of rediscovering it with
        // tool calls; and the BYO preflight (E7), said before turn 1 (`runSetup.ts`).
        ...runContextFields(ports, {
          ...(projectId != null ? { projectId } : {}),
          serverChatId,
          request: asked ?? "",
          memory: p.evermind,
          child: !!p.child,
        }),
        ...(p.seed ? { seed: p.seed } : {}),
        ...(p.priorResearch ? { priorResearch: p.priorResearch } : {}),
        ...(p.userTurn != null ? { userTurn: p.userTurn } : {}),
        ...(p.seedIds ? { seedIds: p.seedIds } : {}),
        ...(p.userTurnMessageId != null ? { userTurnMessageId: p.userTurnMessageId } : {}),
        projectId: p.projectId ?? null,
        ...(p.chatMode ? { chatMode: p.chatMode } : {}),
        ...(ports.reportOutcome ? { reportOutcome: (o: BrainRunOutcome) => ports.reportOutcome!(o) } : {}),
        ...(p.child ? { lineage: p.child.lineage } : {}),
        ...runSettings,
        ...(ports.recordRunOutcome ? { recordRunOutcome: (end: { runId: string; outcome: RunEndOutcome }) => ports.recordRunOutcome!({ chatId }, end) } : {}),
        ...(directives ? { onStop: directives.hooks.onStop } : {}),
      });
    } finally {
      // The loop has ended: a steer from here on is sent on once the run has settled.
      settingUp.delete(key);
      flags.delete(key);
      approvals.forget(key);
      await flushNote(key, chatId, { memory: p.evermind, ...(projectId != null ? { projectId } : {}) });
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
    // `builderforce.models.subagent` — what a sub-agent codes on unless its owner's pick is strict.
    ...(ports.runSettings ? { subagentModel: async () => (await ports.runSettings!()).subagentModel } : {}),
    start,
    isBusy: (key) => active.has(key) || isRunning(key),
    autoApproveOf,
    persistence: ports.persistence,
    announce,
  });
  const steering = createRunSteer({
    registry,
    childHost,
    isBusy: (key) => active.has(key) || isRunning(key),
    isSettingUp: (key) => settingUp.has(key),
    ownerName: OWNER_NAME,
  });

  return {
    start,
    // A sub-agent's Stop is its own run's Stop, marked as on purpose so it reports
    // "stopped" rather than "failed".
    stop: (runKey) => steering.stop(runKey),
    confirm: (runKey, ok) => resolveRunConfirm(runKey, ok),
    // A settled run is no longer subscribed, so its cleared error is relayed here.
    clearError: (runKey) => {
      clearRunError(runKey);
      relay.sync(runKey);
    },
    // The person's words at a run — steer, stop, or its next turn (`runSteer.ts`).
    steer: (runKey, text, attachments) => steering.steer(runKey, text, attachments),
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
    resync: (runKey) => relay.resync(runKey),
    attach(sink) {
      const known = watches.known();
      const detach = relay.attach(sink, known);
      for (const chatId of known) if (chatId > 0) sink.post({ type: "run.children", chatId, children: registry.viewsIn(chatId) });
      return detach;
    },
    dispose() {
      offStore();
      watches.dispose();
      relay.dispose();
    },
  };
}
