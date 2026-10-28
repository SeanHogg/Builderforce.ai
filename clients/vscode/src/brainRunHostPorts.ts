/**
 * The editor-bound ports behind the host-owned Brain run — the ONLY place the run
 * host meets `vscode`. Everything here is the same primitive the native chat
 * participant already uses (tool catalog, model route, Brain persistence, Evermind
 * hooks, session notes), assembled once so the webview's run and the participant's
 * run are the same run on a different surface.
 */

import * as vscode from "vscode";
import { getGlobalRunState, getRunSnapshot, isRunning, type BrainStreamFn, type ModelFallbackEvent } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey, postRunOutcome } from "./gateway";
import { fetchRunContextSection, projectEvermindHooks } from "./bfApi";
import { localBrainApplication } from "./localFirstStore";
import { editorRunSettings } from "./editorRunSettings";
import { deviceLedgerPorts } from "./runUsageLedgerPorts";
import { auditToolCatalog } from "./auditToolCatalog";
import { brainToolCatalog } from "./brainToolCatalog";
import { localWindowProbes, resolveModelRoute, routeStream } from "./modelRouting";
import { refreshPendingChanges } from "./gitChanges";
import { editorRunSetupPorts } from "./runSetupPorts";
import { recordEditorRunEnd } from "./editorRunEnd";
import { boundServerIds } from "./sessionChats";
import { recentActivitySection, RUN_GROUNDING_BUDGET_MS, stableGroundingWithin } from "./grounding";
import { setLocalChatRuns } from "./attention";
import { createBrainRunHost, type BrainRunHost } from "./brainRunHost";
import { gateStarts } from "./hostStartGate";
import { changeSetIdentityForHostRun, recordChangeSetAroundRun } from "./runChangeSets";
import { installRunRecovery } from "./installRunRecovery";
import { createHostRunLifecycle } from "./hostRunLifecycle";
import { installLocalDomainTools, type DomainToolRequest } from "./installLocalDomainTools";
import { classifyLocalDomainTool, type LocalDomainToolName } from "./localDomainTools";
import { platformPolicy } from "./platformPolicy";
import type { ToolDef } from "./fileTools";
import type { LocalFirstStore } from "@builderforce/local-first";
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

/**
 * The BuilderForce output channel. Imported lazily for the same reason
 * `projectState` is below: `errorReporter` pulls `vscode` (and an EventEmitter) into
 * the module graph of every suite that mocks it away.
 */
function hostLog(line: string): void {
  void import("./errorReporter")
    .then(({ logLine }) => logLine(line))
    .catch((error: unknown) => console.warn(line, error));
}

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
}

/**
 * Explicit synchronize grant only. A missing or throwing policy is a denial,
 * so a domain tool writes the local store instead of calling the platform.
 */
function domainToolPolicyAllows(): boolean {
  try {
    return platformPolicy().allows("synchronize") === true;
  } catch {
    return false;
  }
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
 * The ONE call on the tool-dispatch path. A denial writes the local repository
 * and queues the store's sync event; it never reaches bfApi.
 */
function runInstalledDomainTool(ctx: vscode.ExtensionContext, request: DomainToolRequest) {
  return installLocalDomainTools(ctx).execute(request);
}

/**
 * Only names the landed library actually implements. `memory-recall` is
 * deliberately absent: `classifyLocalDomainTool` answers "unknown" for it, so
 * advertising it would offer the model a tool that always throws
 * `unknown_domain_tool`. Adding one means adding its repository write first.
 */
const LOCAL_DOMAIN_TOOL_SPECS: readonly (Omit<ToolDef, "execute" | "name"> & {
  name: LocalDomainToolName;
})[] = [
  {
    name: "project-create",
    description:
      "Create a project in the local repository when the platform is denied. Writes locally and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Project name." },
        key: { type: "string", description: "Optional stable project key." },
        status: { type: "string", description: "Optional project status." },
      },
      required: ["name"],
    },
    mutating: true,
  },
  {
    name: "project-update",
    description:
      "Patch a locally stored project when the platform is denied. Writes locally and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local project id to patch." },
        name: { type: "string", description: "New project name." },
        key: { type: "string", description: "New stable project key." },
        status: { type: "string", description: "New project status." },
      },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "project-archive",
    description:
      "Archive a locally stored project when the platform is denied. Writes a local tombstone and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Local project id to archive." } },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "ticket-create",
    description:
      "Create a ticket in the local repository when the platform is denied. Writes locally and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Local project id the ticket belongs to." },
        title: { type: "string", description: "Ticket title." },
        description: { type: "string", description: "Optional ticket description." },
        status: { type: "string", description: "Optional ticket status." },
        priority: { type: "string", description: "Optional ticket priority." },
        parentTicketId: { type: "string", description: "Optional local parent ticket id." },
      },
      required: ["projectId", "title"],
    },
    mutating: true,
  },
  {
    name: "ticket-update",
    description:
      "Patch a locally stored ticket when the platform is denied. Writes locally and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local ticket id to patch." },
        title: { type: "string", description: "New ticket title." },
        description: { type: "string", description: "New ticket description." },
        priority: { type: "string", description: "New ticket priority." },
        assignedUserId: { type: "string", description: "New assignee." },
      },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "ticket-move",
    description:
      "Change the status of a locally stored ticket when the platform is denied. Writes locally and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local ticket id to move." },
        status: { type: "string", description: "New ticket status." },
      },
      required: ["id", "status"],
    },
    mutating: true,
  },
  {
    name: "ticket-archive",
    description:
      "Archive or restore a locally stored ticket when the platform is denied. Writes locally and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Local ticket id to archive." },
        archived: { type: "boolean", description: "False restores an archived ticket." },
      },
      required: ["id"],
    },
    mutating: true,
  },
  {
    name: "ticket-delete",
    description:
      "Delete a locally stored ticket when the platform is denied. Writes a local tombstone and queues the store's sync event. Does not call the platform.",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "Local ticket id to delete." } },
      required: ["id"],
    },
    mutating: true,
  },
];

/**
 * When synchronize is denied, a supported domain tool is the installed adapter:
 * it writes `store` and the create journal event is the sync handoff. An allowed
 * platform keeps the catalog executor. A non-domain tool is never replaced.
 */
function routeDeniedDomainTools(
  ctx: vscode.ExtensionContext,
  store: LocalFirstStore,
  tools: readonly ToolDef[],
): readonly ToolDef[] {
  installHostDomainTools(ctx, store);
  if (domainToolPolicyAllows()) return tools;
  const localExecute = (name: LocalDomainToolName): ToolDef["execute"] => async (args) => {
    const request: DomainToolRequest = {
      tool: name,
      args,
    };
    const outcome = await runInstalledDomainTool(ctx, request);
    return JSON.stringify(outcome);
  };
  // A catalog entry is a domain tool only if the landed classifier says so; a
  // name that merely looks like one is never repointed at the local writer.
  const routed = tools.map((tool) =>
    classifyLocalDomainTool(tool.name) === "local"
      ? { ...tool, remote: false, execute: localExecute(tool.name as LocalDomainToolName) }
      : tool,
  );
  const present = new Set(routed.map((tool) => tool.name));
  const added = LOCAL_DOMAIN_TOOL_SPECS.filter((spec) => !present.has(spec.name)).map(
    (spec): ToolDef => ({ ...spec, execute: localExecute(spec.name) }),
  );
  return added.length === 0 ? routed : [...routed, ...added];
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
      return routeDeniedDomainTools(ctx, local.store, catalog);
    },
    workspaceRoot,
    stream: streamForRoute,
    localProbes: localWindowProbes,
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
  const lifecycle = createHostRunLifecycle({
    recovery,
    snapshot: (chatId) => getRunSnapshot(chatId),
    log: hostLog,
  });
  const detachLifecycle = host.attach(lifecycle.sink);
  // A commit while chats run may have bound one of them (the run's own bind, a sync
  // receipt, an adopt): re-read the bound ids. Commits are per message or model call.
  const offBindings = local.store.subscribe(() => {
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
