/**
 * The editor's run-SETUP ports (PRD 35 E2 / E3 / E7) and the run-settle release — what
 * `brainRunHostPorts.ts` spreads into the host's ports, kept here so that module does not
 * grow with every pre-turn part:
 *
 *   - `defaultRepo`: the run's default checkout when the open folder holds several;
 *   - `contextPack`: the task context pack, built before turn 1 with no model call;
 *   - `modelPreflight`: the BYO health check, said on the banner before any work;
 *   - `settleRun`: a settled run's background shell jobs are killed (`localShellJobs.ts`).
 */

import type * as vscode from "vscode";
import type { BrainRunHostPorts } from "./brainRunHostContract";
import { runGit } from "./gitApi";
import { parseRemoteUrl } from "./gitContext";
import { isCheckout, listCheckouts } from "./workspaceCheckouts";
import { resolveRunDefaultRepo } from "./runDefaultRepo";
import { listProjectRepositories } from "./projectRepositories";
import { buildContextPack } from "./contextPack/buildContextPack";
import { byoPreflight } from "./contextPack/byoPreflight";
import { killRunJobs } from "./localShellJobs";
import { logLine } from "./errorReporter";

export function editorRunSetupPorts(
  secrets: vscode.SecretStorage,
  workspaceRoot: () => string,
): Required<Pick<BrainRunHostPorts, "defaultRepo" | "contextPack" | "modelPreflight" | "settleRun">> {
  return {
    defaultRepo: (input) => resolveRunDefaultRepo({
      root: workspaceRoot(),
      isCheckout,
      listCheckouts,
      originUrl: (dir) => runGit(dir, "remote get-url origin"),
      parseRemote: parseRemoteUrl,
      projectRepos: (projectId) => listProjectRepositories(secrets, projectId),
    }, input),
    contextPack: (input) => buildContextPack(secrets, { root: workspaceRoot(), ...input }),
    modelPreflight: () => byoPreflight(secrets),
    settleRun: (runKey) => {
      void killRunJobs(runKey).catch((e: unknown) => logLine(`[run ${runKey}] background jobs not all stopped: ${e instanceof Error ? e.message : String(e)}`));
    },
  };
}
