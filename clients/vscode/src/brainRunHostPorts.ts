/**
 * The editor-bound ports behind the host-owned Brain run — the ONLY place the run
 * host meets `vscode`. Everything here is the same primitive the native chat
 * participant already uses (tool catalog, model route, Brain persistence, Evermind
 * hooks, session notes), assembled once so the webview's run and the participant's
 * run are the same run on a different surface.
 */

import * as vscode from "vscode";
import { attachEvermindLearn, type BrainMessage } from "@seanhogg/builderforce-brain-embedded";
import { getApiKey } from "./gateway";
import { fetchRunContextSection, postBrainMessages, projectEvermindHooks } from "./bfApi";
import { brainToolCatalog } from "./brainToolCatalog";
import { resolveModelRoute, routeStream } from "./modelRouting";
import { refreshPendingChanges } from "./gitChanges";
import { appendSessionNote } from "./sessionNotes";
import { setLocalChatRuns } from "./attention";
import { createBrainRunHost, type BrainRunHost } from "./brainRunHost";
import { resolveRunPolicyGates } from "./policyGates";

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
  return createBrainRunHost({
    tools: (projectId) => brainToolCatalog(secrets, workspaceRoot() || undefined, projectId),
    workspaceRoot,
    // Resolved per run, not once: an explicit pick, the project's Evermind pin or an
    // on-device route can all change between turns, and a local credential can expire.
    stream: async () => routeStream(await resolveModelRoute(secrets), await getApiKey(secrets)),
    persistence: {
      async sendMessages(chatId, messages): Promise<BrainMessage[]> {
        const r = await postBrainMessages(secrets, chatId, messages);
        if (!r) throw new Error("Could not save the turn — sign in again and retry.");
        // The server's truthful learn-gate outcome rides on the assistant turn(s) so
        // the run renders a learn step — or an explained skip — exactly as the web does.
        return attachEvermindLearn(r.messages, r.evermindLearn);
      },
    },
    evermind: (projectId) => projectEvermindHooks(secrets, projectId),
    // The ONE api `ContextSource` the native participant and the cloud engine read.
    // Continuity-scoped to the chat (a real server chat only — an unlinked run has a
    // negative id and no history to measure a delta against).
    runContext: (projectId, chatId, query) =>
      fetchRunContextSection(secrets, projectId, { ...(chatId > 0 ? { scope: `chat:${chatId}` } : {}), query }),
    // The tenant's effective governance gates — the one resolver both editor
    // surfaces share, so a gate holds in the panel exactly as in the participant.
    policyGates: (projectId) => resolveRunPolicyGates(secrets, projectId),
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
