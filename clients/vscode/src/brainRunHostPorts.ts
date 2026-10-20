/**
 * The editor-bound ports behind the host-owned Brain run — the ONLY place the run
 * host meets `vscode`. Everything here is the same primitive the native chat
 * participant already uses (tool catalog, model route, Brain persistence, Evermind
 * hooks, session notes), assembled once so the webview's run and the participant's
 * run are the same run on a different surface.
 */

import * as vscode from "vscode";
import { getRunSnapshot, isRunning, type BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey, postRunOutcome } from "./gateway";
import { fetchRunContextSection, projectEvermindHooks, rememberProjectFact } from "./bfApi";
import { localBrainApplication } from "./localFirstStore";
import { auditToolCatalog } from "./auditToolCatalog";
import { brainToolCatalog } from "./brainToolCatalog";
import { localWindowProbes, resolveModelRoute, routeComplete, routeStream } from "./modelRouting";
import { refreshPendingChanges } from "./gitChanges";
import { appendSessionNote } from "./sessionNotes";
import { commitLearnedFacts, MEMORY_COMMIT_SYSTEM, readChangedExcerpt } from "./memoryCommit";
import { setLocalChatRuns } from "./attention";
import { createBrainRunHost, type BrainRunHost } from "./brainRunHost";
import { changeSetIdentityForHostRun, recordChangeSetAroundRun } from "./runChangeSets";
import { installRunRecovery } from "./installRunRecovery";
import { createHostRunLifecycle } from "./hostRunLifecycle";
import { installLocalDomainTools, type DomainToolRequest } from "./installLocalDomainTools";
import { classifyLocalDomainTool, type LocalDomainToolName } from "./localDomainTools";
import { platformPolicy } from "./platformPolicy";
import type { ToolDef } from "./fileTools";
import type { LocalFirstStore } from "@builderforce/local-first";
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
  // installHostDomainTools is intentionally deferred to the tool-dispatch path
  // (lazy on purpose: localBrainApplication mints the device id only after
  // globalState persists it, so an eager bind at construction would throw
  // local_device_id_required and crash the extension host on first activation).
  const streamForRoute = async (): Promise<BrainStreamFn> =>
    routeStream(await resolveModelRoute(secrets), await getApiKey(secrets));
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
    // How a code-changing run's coder did — so the next run's coder is picked on evidence.
    reportOutcome: (outcome) => postRunOutcome(outcome),
    evermind: (projectId, chatId) => withWorkspaceStaleness(projectEvermindHooks(secrets, projectId, chatId), workspaceRoot() || undefined),
    // The ONE api `ContextSource` the native participant and the cloud engine read.
    // Continuity-scoped to the chat (a real server chat only — an unlinked run has a
    // negative id and no history to measure a delta against).
    runContext: (projectId, chatId, query) =>
      fetchRunContextSection(secrets, projectId, { ...(chatId > 0 ? { scope: `chat:${chatId}` } : {}), query }),
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
    onRunsChanged: (state) => setLocalChatRuns(RUNS_SOURCE, state),
    sessionNote: async (chatId, activity) => {
      const root = workspaceRoot();
      if (!root) return;
      await appendSessionNote(root, { sessionKey: `chat-${chatId}`, activity });
      // A run that changed files leaves with what it learned written down, instead of
      // depending on the model having chosen to call `remember_fact`. Best-effort like
      // the note above it: a gateway or facts failure costs the commit, not the run.
      const changed = [...(activity.created ?? []), ...(activity.edited ?? [])];
      if (changed.length === 0) return;
      try {
        // Imported here, not at the top: `projectState` builds a `vscode.EventEmitter`
        // on load, which pulls `vscode` into this module's graph for every suite that
        // mocks it away.
        const { getSelectedProject } = await import("./projectState");
        const project = getSelectedProject();
        if (!project) return;
        const excerpt = await readChangedExcerpt(root, changed);
        await commitLearnedFacts(
          {
            changed,
            tools: activity.tools,
            excerpt,
            // The same ask the session note summarises — a fact with no task is a guess.
            ...(activity.prompt ? { prompt: activity.prompt } : {}),
          },
          {
            complete: async (user) =>
              routeComplete(await resolveModelRoute(secrets), secrets, [
                { role: "system", content: MEMORY_COMMIT_SYSTEM },
                { role: "user", content: user },
              ]),
            remember: (key, content) => rememberProjectFact(secrets, project.id, key, content),
          },
        );
      } catch {
        /* best-effort, like the note above it */
      }
    },
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
  // Baseline before the turn, immutable change set after it. A duplicate start while
  // the chat is already running is a no-op in the host — don't finalize that, or the
  // live run's edits would be claimed twice, and don't journal a start that will never
  // finish. No upload, no apply to another checkout.
  // Sub-agents start through the host's internal start, not this wrapper.
  return {
    ...host,
    start(payload) {
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
        () => host.start(payload),
      );
    },
    dispose() {
      detachLifecycle();
      host.dispose();
    },
  };
}
