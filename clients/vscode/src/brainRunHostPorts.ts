/**
 * The editor-bound ports behind the host-owned Brain run — the ONLY place the run
 * host meets `vscode`. Everything here is the same primitive the native chat
 * participant already uses (tool catalog, model route, Brain persistence, Evermind
 * hooks, session notes), assembled once so the webview's run and the participant's
 * run are the same run on a different surface.
 */

import * as vscode from "vscode";
import { getGlobalRunState, getRunSnapshot, isRunning, type BrainStreamFn, type ModelFallbackEvent, utilityUsageObserver } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey, postRunOutcome } from "./gateway";
import { fetchRunContextSection, projectEvermindHooks } from "./bfApi";
import { localBrainApplication } from "./localFirstStore";
import { hostLog } from "./hostLog";
import { editorRunSettings } from "./editorRunSettings";
import { deviceLedgerPorts } from "./runUsageLedgerPorts";
import { auditToolCatalog } from "./auditToolCatalog";
import { brainToolCatalog } from "./brainToolCatalog";
import { localWindowProbes, onDeviceTasks, onDeviceTasksObserving, resolveModelRoute, routeStream } from "./modelRouting";
import { refreshPendingChanges } from "./gitChanges";
import { editorRunSetupPorts } from "./runSetupPorts";
import { recordEditorRunEnd } from "./editorRunEnd";
import { boundServerIds } from "./sessionChats";
import { recentActivitySection, RUN_GROUNDING_BUDGET_MS, stableGroundingWithin } from "./grounding";
import { setLocalChatRuns } from "./attention";
import { createInterruptedRuns } from "./interruptedRunsView";
import { createBrainRunHost, type BrainRunHost } from "./brainRunHost";
import { gateStarts } from "./hostStartGate";
import { changeSetIdentityForHostRun, recordChangeSetAroundRun } from "./runChangeSets";
import { installRunRecovery } from "./installRunRecovery";
import { createHostRunLifecycle } from "./hostRunLifecycle";
import { installLocalDomainTools, type DomainToolRequest } from "./installLocalDomainTools";
import { routeToLocalDomainTools } from "./localDomainToolRouting";
import { ticketServerIdLookup } from "./localTicketIdBridge";
import type { ToolDef } from "./fileTools";
import { changeTouches, type LocalFirstStore } from "@builderforce/local-first";
import type { LocalModelsConfig } from "./localModels";
import { resolveRunPolicyGates } from "./policyGates";
import { editorRunDirectives } from "./hooks/editorDirectives";
import { withWorkspaceStaleness } from "./memoryStaleness";

/** The Sessions-tree overlay source for host-owned runs (one bucket, not per panel). */
const RUNS_SOURCE = "brain-host";

/** Same key `localFirstStore` mints. Read it; never mint a second device id here. */
const LOCAL_DEVICE_KEY = "builderforce.localDeviceId";

export interface VsCodeRunHostHooks {
  /** A chat gained a turn — refresh the Sessions sidebar. */
  onChatsChanged(): void;
  /** A platform (catalog) write happened — refresh Project & Tasks. */
  onPlatformWrite(toolName: string): void;
  /**
   * The local-model settings (PreFetch tier 3), supplied by the composition root
   * (`extension.ts` passes `gateway.getLocalModelsConfig`) so this module's import graph
   * never reaches `gateway` for them. Absent, tier 3 is skipped.
   */
  localModels?: () => LocalModelsConfig;
}

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
}

/**
 * Bind the adapter to this host's store. Idempotent, and LAZY on purpose:
 * `localBrainApplication` mints the device id and only then persists it, so at
 * host-construction time a fresh install has none yet and an eager bind would
 * throw `local_device_id_required` and take the whole extension host down.
 * By the time a tool request is dispatched the id is durable.
 */
function installHostDomainTools(ctx: vscode.ExtensionContext, store: LocalFirstStore): void {
  const deviceId = ctx.globalState.get<string>(LOCAL_DEVICE_KEY);
  if (typeof deviceId !== "string" || deviceId.length === 0) return;
  installLocalDomainTools(ctx, { localFirstStore: store, localDeviceId: deviceId });
}

/**
 * The ONE call on the tool-dispatch path. It writes the local repository and queues
 * the store's sync event; it never reaches bfApi.
 */
function runInstalledDomainTool(ctx: vscode.ExtensionContext, request: DomainToolRequest) {
  return installLocalDomainTools(ctx).execute(request);
}

/**
 * Project and ticket tools are the installed adapter ALWAYS — signed in or not, sync
 * granted or not (`localDomainToolRouting.ts` says why): the write lands on this
 * device and the batched sync carries it to the account. `chatClientId` is the run's
 * local chat, stamped onto a created ticket.
 */
function routeDomainToolsLocal(
  ctx: vscode.ExtensionContext,
  store: LocalFirstStore,
  tools: readonly ToolDef[],
  chatClientId?: string,
): readonly ToolDef[] {
  installHostDomainTools(ctx, store);
  return routeToLocalDomainTools(tools, (request) => runInstalledDomainTool(ctx, request), chatClientId, ticketServerIdLookup(store));
}

export function createVsCodeRunHost(ctx: vscode.ExtensionContext, hooks: VsCodeRunHostHooks): BrainRunHost {
  const { secrets } = ctx;
  const local = localBrainApplication(ctx);
  // Runs are keyed by LOCAL chat id; the tree lists SERVER chats, so each report carries
  // the bound server ids (latest report wins — the lookups are async). The run store
  // fires on every streamed token, and each id lookup reads the local store, so only a
  // change of the run set looks them up — or, forced, a commit that may have bound a
  // live chat (a bind, a sync receipt) while the set stayed the same.
  let runsReport = 0;
  let runsKey: string | undefined;
  const sortedIds = (ids: readonly number[]): string => [...ids].sort((a, b) => a - b).join(",");
  const reportRuns = (state: { running: number[]; awaiting: number[] }, force = false): void => {
    // Sorted: the run store lists cells in LRU order, which moves without the set changing.
    const key = `${sortedIds(state.running)}|${sortedIds(state.awaiting)}`;
    if (!force && key === runsKey) return;
    runsKey = key;
    const report = ++runsReport;
    void boundServerIds(local.identity, [...state.running, ...state.awaiting]).then((serverIds) => {
      if (report === runsReport) setLocalChatRuns(RUNS_SOURCE, state, serverIds);
    });
  };
  // installHostDomainTools is intentionally deferred to the tool-dispatch path
  // (lazy on purpose: localBrainApplication mints the device id only after
  // globalState persists it, so an eager bind at construction would throw
  // local_device_id_required and crash the extension host on first activation).
  const streamForRoute = async (onFallback?: (event: ModelFallbackEvent) => void): Promise<BrainStreamFn> =>
    routeStream(await resolveModelRoute(secrets, { turn: true }), await getApiKey(secrets), onFallback);
  const host = createBrainRunHost({
    tools: async (projectId, children, signal, opts) => {
      const tools = await brainToolCatalog(secrets, workspaceRoot() || undefined, projectId, children, signal, opts);
      const catalog = opts.audit && projectId != null ? auditToolCatalog(secrets, tools, projectId, opts.audit) : tools;
      return routeDomainToolsLocal(ctx, local.store, catalog, opts.chatIdentity?.clientChatId);
    },
    workspaceRoot,
    stream: streamForRoute,
    localProbes: localWindowProbes,
    onDeviceTasks,
    // Each served task call is a `utility` row in the run's chat (the same ledger as its model calls).
    onDeviceTasksFor: (run) => onDeviceTasksObserving(utilityUsageObserver(local.usage, run, (error) => hostLog(`[usage ledger] utility write failed: ${String(error)}`))),
    persistence: {
      sendMessages: (chatId, messages) => local.persistence.sendMessages(chatId, messages),
    },
    // PRD 36: the panel's chats are LOCAL — their ids never leave the machine. A run binds
    // its chat on sign-in (title + project only) and names the bound server chat, or none.
    chatIdentity: async (chatId) => {
      const [serverChatId, clientChatId] = await Promise.all([
        local.identity.bind(chatId).catch((error: unknown) => {
          hostLog(`[chat identity] bind failed for local chat ${chatId}: ${String(error)}`);
          return undefined;
        }),
        local.identity.clientIdFor(chatId),
      ]);
      return { serverChatId: serverChatId ?? null, ...(clientChatId ? { clientChatId } : {}) };
    },
    // Stage models, pipeline routing and the USD cap — read per run (`editorRunSettings.ts`).
    runSettings: () => editorRunSettings(secrets),
    // The chat's usage ledger on this device: every call, the outcome, an avoided call.
    ...deviceLedgerPorts(local.usage, hostLog),
    // How a code-changing run's coder did — so the next run's coder is picked on evidence.
    reportOutcome: (outcome) => postRunOutcome(outcome),
    reportRunRecord: (record) => postRunOutcome(record),
    evermind: (projectId, serverChatId) => withWorkspaceStaleness(projectEvermindHooks(secrets, projectId, serverChatId), workspaceRoot() || undefined),
    // The ONE api `ContextSource` the native participant and the cloud engine read.
    // Continuity-scoped to the conversation's server chat — an unbound chat has no
    // history there to measure a delta against.
    runContext: (projectId, serverChatId, query) =>
      fetchRunContextSection(secrets, projectId, { ...(serverChatId != null ? { scope: `chat:${serverChatId}` } : {}), query }),
    // The tenant's effective governance gates — the one resolver both editor
    // surfaces share, so a gate holds in the panel exactly as in the participant.
    policyGates: (projectId) => resolveRunPolicyGates(secrets, projectId),
    // The workspace's committed `.builderforce/` rules + hooks — the same assembly the
    // native participant uses.
    directives: (scope) => editorRunDirectives(ctx.workspaceState, workspaceRoot(), scope),
    labels: {
      blockedByPolicy: (reason: string) => vscode.l10n.t("Blocked by a governance gate: {0}", reason),
    },
    onChatsChanged: () => hooks.onChatsChanged(),
    onToolRun: ({ name, mutating, remote, ok }) => {
      if (!ok || !mutating) return;
      if (remote) {
        hooks.onPlatformWrite(name);
        return;
      }
      // The tools write through `node:fs`, which raises no text-document event, so
      // nothing else would tell the Changes view that the working tree just moved. The
      // file is NOT opened in the editor — edits land on disk and stay out of the way.
      refreshPendingChanges();
    },
    onRunsChanged: (state) => reportRuns(state),
    // The note, then (Memory on) the code map + learned facts — the one run-end step the
    // native chat participant shares.
    sessionNote: (chatId, run, opts) =>
      recordEditorRunEnd(secrets, workspaceRoot(), `chat-${chatId}`, run, opts, { ledger: local.usage, chatId, runKey: chatId, identity: local.identity }),
    // Fresh per run: the notes of the run that just finished, not the panel's copy.
    recentActivity: () => recentActivitySection(workspaceRoot() || undefined),
    // Bounded like the panel's init: a run never waits on a cold definition index's
    // whole-workspace parse; the runs after it lands get the memoised index. Late, it
    // hands back nothing, so the prompt keeps the (possibly fuller) map it already has.
    grounding: () => stableGroundingWithin(workspaceRoot() || undefined, RUN_GROUNDING_BUDGET_MS, { late: "nothing" }),
    // PRD 35 E2 / E3 / E7: default checkout, context pack, BYO preflight; and a settled
    // run's background jobs die with it.
    ...editorRunSetupPorts(secrets, workspaceRoot, ctx.globalState, hooks.localModels),
  });
  // G22: the run journal. Start, step checkpoints and the TERMINAL status come from the
  // host's own run events (a sink on the host), so a finished run is never rewritten to
  // `interrupted` by the next activation. What the previous host left in flight is
  // surfaced in the log once recovery has run.
  const recovery = installRunRecovery(ctx, { onError: (error) => hostLog(`[run journal] start failed: ${String(error)}`) });
  void recovery.recovered.then((runs) => {
    for (const run of runs) {
      hostLog(`[run journal] interrupted by the previous editor session: ${run.runId}${run.record.payload.chatId ? ` (chat ${run.record.payload.chatId})` : ""}`);
    }
  });
  // The run list's "Interrupted" rows: host state, re-sent to every panel that attaches.
  const interrupted = createInterruptedRuns({ recovery, log: hostLog });
  const lifecycle = createHostRunLifecycle({
    recovery,
    snapshot: (chatId) => getRunSnapshot(chatId),
    log: hostLog,
  });
  const detachLifecycle = host.attach(lifecycle.sink);
  // A commit while chats run may have bound one of them (the run's own bind, a sync
  // receipt, an adopt): re-read the bound ids. Commits are per message or model call, so
  // only one that touched a mapping or a chat row (or whose change is unknown) is worth the read.
  const offBindings = local.store.subscribe((change) => {
    if (change && !change.syncState && !changeTouches(change, "chat")) return;
    if (runsKey !== undefined && runsKey !== "|") reportRuns(getGlobalRunState(), true);
  });
  // Baseline before the turn, immutable change set after it. A duplicate start while
  // the chat is already running is a no-op in the host — don't finalize that, or the
  // live run's edits would be claimed twice, and don't journal a start that will never
  // finish. No upload, no apply to another checkout.
  // Sub-agents start through the host's internal start, not this wrapper. A Stop during the
  // baseline capture is held until the host has claimed the chat (`hostStartGate.ts`).
  return {
    ...host,
    attach: (sink) => {
      const offRuns = host.attach(sink);
      const offInterrupted = interrupted.attach(sink);
      return () => { offRuns(); offInterrupted(); };
    },
    acknowledgeInterrupted: interrupted.acknowledge,
    ...gateStarts(host, (payload, start) => {
      const { runId, author } = changeSetIdentityForHostRun(payload, () => crypto.randomUUID());
      if (!isRunning(payload.chatId)) lifecycle.started(payload.chatId, runId);
      return recordChangeSetAroundRun(
        {
          store: local.store,
          deviceId: () => ctx.globalState.get<string>(LOCAL_DEVICE_KEY) ?? "",
          runId,
          author,
          stillRunning: () => isRunning(payload.chatId),
        },
        start,
      );
    }),
    dispose() {
      offBindings();
      detachLifecycle();
      host.dispose();
    },
  };
}
