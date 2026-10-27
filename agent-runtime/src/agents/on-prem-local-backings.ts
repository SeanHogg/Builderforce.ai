/**
 * The catalog-time local backings for one on-prem run — resolved ONCE per run by every
 * caller that builds the coding tools (`attempt.ts`, `compact.ts`, the system-prompt
 * report), so the three can never disagree about which local tools a run has:
 *
 *   - `semantic` — `repo_map` (and, with Builderforce Desktop, `semantic_search` /
 *     `read_compressed`) — `on-prem-semantic.ts`;
 *   - `research` — `local_research`, present only while a local model answers —
 *     `local-research/on-prem-research-model.ts`.
 */

import type { LocalResearchCapability, RepoSemanticCapability } from "@builderforce/agent-tools";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { onDeviceCostLeverOn } from "../infra/cost-levers.js";
import { resolveOnPremResearch } from "./local-research/on-prem-research-model.js";
import { resolveOnPremSemantic } from "./on-prem-semantic.js";
import { logDebug } from "../logger.js";

export interface OnPremLocalBackings {
  semantic: RepoSemanticCapability;
  research?: LocalResearchCapability;
}

export async function resolveOnPremLocalBackings(params: {
  workspaceRoot: string;
  config?: BuilderForceAgentsConfig;
  /** C4 override. Absent = the on-device lever (`onDeviceCostLeverOn("c4_adaptive_context")`),
   *  decided HERE so every caller (attempt, compaction, system-prompt report) agrees. */
  adaptive?: boolean;
}): Promise<OnPremLocalBackings> {
  const adaptive = params.adaptive ?? onDeviceCostLeverOn("c4_adaptive_context");
  const [semantic, research] = await Promise.all([
    resolveOnPremSemantic(params.workspaceRoot, { adaptive }),
    resolveOnPremResearch(params.workspaceRoot, params.config).catch((err: unknown) => { logDebug(`local_research unavailable: ${String(err)}`); return undefined; }),
  ]);
  return { semantic, ...(research ? { research } : {}) };
}
