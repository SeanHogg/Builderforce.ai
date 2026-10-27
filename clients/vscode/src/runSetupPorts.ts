/**
 * The editor's run-SETUP ports (PRD 35 E2 / E3 / E7) and the run-settle release — what
 * `brainRunHostPorts.ts` spreads into the host's ports, kept here so that module does not
 * grow with every pre-turn part:
 *
 *   - `defaultRepo`: the run's default checkout when the open folder holds several;
 *   - `contextPack`: the task context pack, built before turn 1 with no model call, with
 *     the deterministic pre-search hits appended (`contextPack/preSearchSource.ts`);
 *   - `answerWithoutModel`: "where is X defined?" answered from the symbol index;
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
import { buildContextPack, CONTEXT_PACK_DEADLINE_MS } from "./contextPack/buildContextPack";
import { preSearchBlock, whereDefinedAnswer, withPreSearch } from "./contextPack/preSearchSource";
import { requestSymbolLookup } from "./contextPack/requestSymbols";
import { workspaceSymbolIndex } from "./workspaceSymbols";
import { byoPreflight } from "./contextPack/byoPreflight";
import { killRunJobs } from "./localShellJobs";
import { logLine } from "./errorReporter";

export function editorRunSetupPorts(
  secrets: vscode.SecretStorage,
  workspaceRoot: () => string,
): Required<Pick<BrainRunHostPorts, "defaultRepo" | "contextPack" | "answerWithoutModel" | "modelPreflight" | "settleRun">> {
  return {
    defaultRepo: (input) => resolveRunDefaultRepo({
      root: workspaceRoot(),
      isCheckout,
      listCheckouts,
      originUrl: (dir) => runGit(dir, "remote get-url origin"),
      parseRemote: parseRemoteUrl,
      projectRepos: (projectId) => listProjectRepositories(secrets, projectId),
    }, input),
    contextPack: (input) => {
      const root = workspaceRoot();
      // ONE look-up of the request's symbols per run, read by the pack's areas and the hits.
      const symbols = root ? requestSymbolLookup(workspaceSymbolIndex(root)) : undefined;
      return withPreSearch(
        buildContextPack(secrets, { root, ...input, ...(symbols ? { symbols } : {}) }),
        preSearchBlock(root, input.request, CONTEXT_PACK_DEADLINE_MS, symbols ? { symbols } : {}),
      );
    },
    answerWithoutModel: (request) => whereDefinedAnswer(workspaceRoot(), request, CONTEXT_PACK_DEADLINE_MS),
    modelPreflight: () => byoPreflight(secrets),
    settleRun: (runKey) => {
      void killRunJobs(runKey).catch((e: unknown) => logLine(`[run ${runKey}] background jobs not all stopped: ${e instanceof Error ? e.message : String(e)}`));
    },
  };
}
