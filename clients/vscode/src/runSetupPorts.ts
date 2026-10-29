/**
 * The editor's run-SETUP ports (PRD 35 E2 / E3 / E7) and the run-settle release — what
 * `brainRunHostPorts.ts` spreads into the host's ports, kept here so that module does not
 * grow with every pre-turn part:
 *
 *   - `defaultRepo`: the run's default checkout when the open folder holds several;
 *   - `contextPack`: the task context pack, built before turn 1 with no model call, with
 *     the deterministic pre-search hits appended (`contextPack/preSearchSource.ts`);
 *   - `prefetch`: the deterministic-first PreFetch port (`prefetch/vscodePrefetchPort.ts`) —
 *     "where is X defined?" answered from the symbol index, and every registry row after it;
 *   - `modelPreflight`: the BYO health check, said on the banner before any work;
 *   - `settleRun`: a settled run's background shell jobs are killed (`localShellJobs.ts`).
 */

import type * as vscode from "vscode";
import type { BrainRunHostPorts } from "./brainRunHostContract";
import type { NativeBrainRunOptions } from "./nativeRunTypes";
import { runContextFields, startRunRepo } from "./runSetup";
import { runGit } from "./gitApi";
import { parseRemoteUrl } from "./gitContext";
import { isCheckout, listCheckouts } from "./workspaceCheckouts";
import { resolveRunDefaultRepo } from "./runDefaultRepo";
import { listProjectRepositories } from "./projectRepositories";
import { buildContextPack, CONTEXT_PACK_DEADLINE_MS } from "./contextPack/buildContextPack";
import { preSearchOnce, withPreSearch } from "./contextPack/preSearchSource";
import type { CalibrationMemento } from "./prefetch/vscodePrefetchPort";
import type { LocalModelsConfig } from "./localModels";
import { editorPrefetchPort } from "./prefetch/editorPrefetchPort";
import { editorKnowledgeRowsHost } from "./knowledge/knowledgeRows";
import { requestSymbolLookup } from "./contextPack/requestSymbols";
import { workspaceSymbolIndex } from "./workspaceSymbols";
import { byoPreflight } from "./contextPack/byoPreflight";
import { killRunJobs } from "./localShellJobs";
import { logLine } from "./errorReporter";

export function editorRunSetupPorts(
  secrets: vscode.SecretStorage,
  workspaceRoot: () => string,
  globalState: CalibrationMemento,
  localModels?: () => LocalModelsConfig,
  /** The person's own words, when the turn carries more than them (a `#file` reference inlined into it). */
  ownWords?: string,
): Required<Pick<BrainRunHostPorts, "defaultRepo" | "contextPack" | "prefetch" | "modelPreflight" | "settleRun">> {
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
        preSearchOnce(root, input.request, CONTEXT_PACK_DEADLINE_MS, symbols ? { symbols } : {}),
      );
    },
    prefetch: editorPrefetchPort(workspaceRoot, globalState, {
      knowledge: editorKnowledgeRowsHost(secrets),
      ...(localModels ? { localModels } : {}),
      ...(ownWords !== undefined ? { ownWords } : {}),
    }),
    modelPreflight: () => byoPreflight(secrets),
    settleRun: (runKey) => {
      void killRunJobs(runKey).catch((e: unknown) => logLine(`[run ${runKey}] background jobs not all stopped: ${e instanceof Error ? e.message : String(e)}`));
    },
  };
}

/**
 * The native chat participant's whole run SETUP in one call (PRD 35 E2 / E3 / E7): the
 * panel's run host's ports and functions - the task context pack with the pre-search hits in
 * it, the BYO preflight, the run's default checkout, the PreFetch gate (asked of the person's
 * own words, not the turn with its inlined references) and the run-settle release - shaped
 * as the fields `runNativeBrain` takes. Nothing here is the participant's own; it is the host's
 * setup, assembled for a headless run.
 */
export function nativeRunSetup(
  secrets: vscode.SecretStorage,
  workspaceRoot: () => string,
  globalState: CalibrationMemento,
  localModels: (() => LocalModelsConfig) | undefined,
  input: { projectId?: number; serverChatId: number | null; request: string; memory: boolean },
): Pick<NativeBrainRunOptions, "runContext" | "defaultRepo" | "repoReady" | "settleRun" | "prefetch"> {
  const setup = editorRunSetupPorts(secrets, workspaceRoot, globalState, localModels, input.request);
  const repo = startRunRepo(setup, { ...(input.projectId != null ? { projectId: input.projectId } : {}), request: input.request });
  const { turnContext, recallHint, servedReads, modelPreflight } = runContextFields(setup, { ...input, child: false });
  return {
    runContext: {
      ...(turnContext ? { turnContext } : {}),
      ...(recallHint ? { recallHint } : {}),
      ...(servedReads ? { servedReads } : {}),
      ...(modelPreflight ? { modelPreflight } : {}),
    },
    defaultRepo: repo.current,
    repoReady: repo.ready,
    settleRun: setup.settleRun,
    prefetch: setup.prefetch,
  };
}
