/**
 * The model an overflow is folded and retried on.
 *
 * A run that fails over inside an attempt (a stall onto the operator's declared chain) ends the attempt on the FALLBACK model, and
 * that model's window is the one that overflowed. The fold and the retry are for it: compacting against the model the run started
 * on would size the summary for the wrong window, and retrying on it would hand the same transcript to the model that was just left.
 * The attempt reports the model it ended on (`EmbeddedRunAttemptResult.servedModel`); this is the one place that reads it.
 */

import type { Api, Model } from "../../../builderforce/model/types.js";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import { resolveContextWindowTokens } from "../../context-window.js";
import { compactEmbeddedSessionDirect } from "../compact.js";
import type { RunEmbeddedAgentParams } from "./params.js";
import type { EmbeddedRunAttemptResult } from "./types.js";

/** The model a run is on: what an attempt is started with, what an overflow is folded for. */
export interface RunModelSelection {
  provider: string;
  modelId: string;
  model: Model<Api>;
  contextWindowTokens: number;
}

/** The model the next fold and retry are for: the one the attempt ended on, else the one it started on. */
export function modelServing(attempt: Pick<EmbeddedRunAttemptResult, "servedModel">, current: RunModelSelection): RunModelSelection {
  const served = attempt.servedModel;
  if (!served || (served.provider === current.provider && served.id === current.modelId)) return current;
  return { provider: served.provider, modelId: served.id, model: served, contextWindowTokens: resolveContextWindowTokens(served) };
}

export interface OverflowCompaction {
  params: RunEmbeddedAgentParams;
  workspaceDir: string;
  agentDir: string;
  authProfileId: string | undefined;
  serving: RunModelSelection;
  thinkLevel: ThinkLevel;
  /** The attempt's own local backings, so compaction rebuilds the same tools. */
  localBackings: EmbeddedRunAttemptResult["localBackings"];
  diagId: string;
  attempt: number;
  maxAttempts: number;
}

/** Fold the session for the model that was serving when the context overflowed. */
export function compactForOverflow(o: OverflowCompaction) {
  const { params } = o;
  return compactEmbeddedSessionDirect({
    sessionId: params.sessionId,
    sessionKey: params.sessionKey,
    messageChannel: params.messageChannel,
    messageProvider: params.messageProvider,
    agentAccountId: params.agentAccountId,
    authProfileId: o.authProfileId,
    sessionFile: params.sessionFile,
    workspaceDir: o.workspaceDir,
    agentDir: o.agentDir,
    config: params.config,
    skillsSnapshot: params.skillsSnapshot,
    senderIsOwner: params.senderIsOwner,
    provider: o.serving.provider,
    model: o.serving.modelId,
    runId: params.runId,
    thinkLevel: o.thinkLevel,
    reasoningLevel: params.reasoningLevel,
    bashElevated: params.bashElevated,
    extraSystemPrompt: params.extraSystemPrompt,
    ownerNumbers: params.ownerNumbers,
    trigger: "overflow",
    ...(o.localBackings ? { localBackings: o.localBackings } : {}),
    diagId: o.diagId,
    attempt: o.attempt,
    maxAttempts: o.maxAttempts,
  });
}
