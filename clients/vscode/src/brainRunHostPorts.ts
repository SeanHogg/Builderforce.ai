/**
 * The editor-bound ports behind the host-owned Brain run — the ONLY place the run
 * host meets `vscode`. Everything here is the same primitive the native chat
 * participant already uses (tool catalog, model route, Brain persistence, Evermind
 * hooks, session notes), assembled once so the webview's run and the participant's
 * run are the same run on a different surface.
 */

import * as vscode from "vscode";
import { attachEvermindLearn, type BrainMessage, type BrainStreamFn } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey, postRunOutcome } from "./gateway";
import { fetchRunContextSection, postBrainMessages, projectEvermindHooks } from "./bfApi";
import { scopeTenantId } from "./outboxStorage";
import { auditToolCatalog } from "./auditToolCatalog";
import { brainToolCatalog } from "./brainToolCatalog";
import { localWindowProbes, resolveModelRoute, routeStream } from "./modelRouting";
import { refreshPendingChanges } from "./gitChanges";
import { appendSessionNote } from "./sessionNotes";
import { setLocalChatRuns } from "./attention";
import { createBrainRunHost, type BrainRunHost } from "./brainRunHost";
import { resolveRunPolicyGates } from "./policyGates";
import { editorRunDirectives } from "./hooks/editorDirectives";
import { withWorkspaceStaleness } from "./memoryStaleness";

/** The Sessions-tree overlay source for host-owned runs (one bucket, not per panel). */
const RUNS_SOURCE = "brain-host";

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
  // ONE model route for this host: the run's own turns and any sub-agent it delegates
  // to resolve it the same way, so a child can never end up on a different model (or a
  // stale credential) than the parent that spawned it.
  const streamForRoute = async (): Promise<BrainStreamFn> =>
    routeStream(await resolveModelRoute(secrets), await getApiKey(secrets));
  return createBrainRunHost({
    // The run's sub-agent controls and Stop come from the RUN (only it knows its key, its
    // chat and its depth), so they are passed straight through rather than rebuilt here.
    tools: async (projectId, children, signal, opts) => {
      const tools = await brainToolCatalog(secrets, workspaceRoot() || undefined, projectId, children, signal, opts);
      return opts.audit && projectId != null ? auditToolCatalog(secrets, tools, projectId, opts.audit) : tools;
    },
    workspaceRoot,
    // Resolved per run, not once: an explicit pick, the project's Evermind pin or an
    // on-device route can all change between turns, and a local credential can expire.
    stream: streamForRoute,
    // Memoized in `localModels`, so asking per window decision costs nothing while
    // nothing changed — the routing seam's probe, the one the local-first route reads.
    localProbes: localWindowProbes,
    persistence: {
      // `opts.scope` arrives on a queued step batch (the step outbox): it is sent AS the
      // tenant it was queued for, or not at all.
      async sendMessages(chatId, messages, opts?: { scope?: string }): Promise<BrainMessage[]> {
        const r = await postBrainMessages(secrets, chatId, messages, { asTenant: scopeTenantId(opts?.scope) });
        // Say which failure it was. "Sign in again" is advice a person can only act on
        // when signing in is the problem; for a dropped connection it sends them to fix
        // something that was never broken, and hides the reason the turn was lost.
        if (!r.ok) {
          // The status rides along so the step outbox can tell a refusal (4xx: dropped)
          // from a connection that was not there (kept and replayed).
          throw Object.assign(
            new Error(
              r.signedOut
                ? "Could not save the turn — sign in again and retry."
                : `Could not save the turn — ${r.reason}`,
            ),
            r.status !== undefined ? { status: r.status } : {},
          );
        }
        // The server's truthful learn-gate outcome rides on the assistant turn(s) so
        // the run renders a learn step — or an explained skip — exactly as the web does.
        return attachEvermindLearn(r.messages, r.evermindLearn);
      },
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
}
