/**
 * governance_audit tool (PRD 08 §4.2) — the thin pi (`AnyAgentTool`) wrapper. Shape
 * follows `memory-tool.ts`: the body lives in the pi-free `governance-audit/` modules
 * (types · walker · matchers · prefilter · api-client · pipeline), so any other tool
 * surface delegates to the SAME pipeline.
 *
 * Registered in `agents/builderforce-tools.ts`; present only when the runtime holds a
 * `BUILDERFORCE_API_KEY` (the ruleset cannot be resolved without it).
 */

import { Type } from "@sinclair/typebox";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readStringArrayParam, readStringParam } from "./common.js";
import { hasGovernanceApiCredentials, type GovernanceApiClient } from "./governance-audit/api-client.js";
import { runGovernanceAudit } from "./governance-audit/pipeline.js";
import type { GovernanceAssessor, GovernanceAuditOptions } from "./governance-audit/types.js";

const GovernanceAuditSchema = Type.Object({
  repoRef: Type.Optional(Type.String()),
  ref: Type.Optional(Type.String()),
  projectId: Type.Optional(Type.String()),
  packIds: Type.Optional(Type.Array(Type.String())),
  dryRun: Type.Optional(Type.Boolean()),
});

function readDryRun(params: Record<string, unknown>): boolean | undefined {
  const raw = params["dryRun"];
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "true") return true;
    if (v === "false") return false;
  }
  return undefined;
}

export function createGovernanceAuditTool(options: {
  workspaceDir?: string;
  assess?: GovernanceAssessor;
  /** Injected API seam (tests / embedded hosts); its presence bypasses the API-key gate. */
  client?: GovernanceApiClient;
}): AnyAgentTool | null {
  // No API key → the ruleset cannot be resolved; omit the tool (memory-tool's null-when-unavailable pattern).
  if (!options.client && !hasGovernanceApiCredentials()) {
    return null;
  }
  return {
    label: "Governance Audit",
    name: "governance_audit",
    description:
      "Audit the working tree against the resolved governance policy ruleset (PRD 08): resolves DB policy packs + in-repo .builderforce/policies overrides, runs deterministic regex/secret/path/dependency/glob pre-filters, triages candidates and returns { runId, summary, gateResult, findings, ruleErrors }. A BLOCKER finding (or a blocker rule that failed to compile) gates auto-merge. Use dryRun to resolve and pre-filter without recording a run.",
    parameters: GovernanceAuditSchema,
    execute: async (_toolCallId, params) => {
      const repoRef = readStringParam(params, "repoRef");
      const ref = readStringParam(params, "ref");
      const projectId = readStringParam(params, "projectId");
      const packIds = readStringArrayParam(params, "packIds");
      const dryRun = readDryRun(params);
      const opts: GovernanceAuditOptions = {
        ...(repoRef ? { repoRef } : {}),
        ...(ref ? { ref } : {}),
        ...(projectId ? { projectId } : {}),
        ...(packIds ? { packIds } : {}),
        ...(dryRun !== undefined ? { dryRun } : {}),
      };
      return jsonResult(
        await runGovernanceAudit(
          { workspaceDir: options.workspaceDir, assess: options.assess, client: options.client },
          opts,
        ),
      );
    },
  };
}
