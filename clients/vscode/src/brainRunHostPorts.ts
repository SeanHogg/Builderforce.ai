/**
 * The editor-bound ports behind the host-owned Brain run — the ONLY place the run
 * host meets `vscode`. Everything here is the same primitive the native chat
 * participant already uses (tool catalog, model route, Brain persistence, Evermind
 * hooks, session notes), assembled once so the webview's run and the participant's
 * run are the same run on a different surface.
 */

import * as vscode from "vscode";
import { isRunning, type BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey, postRunOutcome } from "./gateway";
import { fetchRunContextSection, projectEvermindHooks } from "./bfApi";
import { localBrainApplication } from "./localFirstStore";
import { auditToolCatalog } from "./auditToolCatalog";
import { brainToolCatalog } from "./brainToolCatalog";
import { localWindowProbes, resolveModelRoute, routeStream } from "./modelRouting";
import { refreshPendingChanges } from "./gitChanges";
import { appendSessionNote } from "./sessionNotes";
import { setLocalChatRuns } from "./attention";
import { createBrainRunHost, type BrainRunHost } from "./brainRunHost";
import { changeSetIdentityForHostRun, recordChangeSetAroundRun } from "./runChangeSets";
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

function workspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
}

export function createVsCodeRunHost(ctx: vscode.ExtensionContext, hooks: VsCodeRunHostHooks): BrainRunHost {
  const { secrets } = ctx;
  const local = localBrainApplication(ctx);
  const streamForRoute = async (): Promise<BrainStreamFn> =>
    routeStream(await resolveModelRoute(secrets), await getApiKey(secrets));
  const host = createBrainRunHost({
    tools: async (projectId, children, signal, opts) => {
      const tools = await brainToolCatalog(secrets, workspaceRoot() || undefined, projectId, children, signal, opts);
      return opts.audit && projectId != null ? auditToolCatalog(secrets, tools, projectId, opts.audit) : tools;
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
    },
  });
  // Baseline before the turn, immutable change set after it. A duplicate start while
  // the chat is already running is a no-op in the host — don't finalize that, or the
  // live run's edits would be claimed twice. No upload, no apply to another checkout.
  // Sub-agents start through the host's internal start, not this wrapper.
  return {
    ...host,
    start(payload) {
      const { runId, author } = changeSetIdentityForHostRun(payload, () => crypto.randomUUID());
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
  };
}
