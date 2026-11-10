/**
 * The HTTP client for the three governance rule-audit endpoints (PRD 08 §4.2 steps 1 + 4;
 * api/src/presentation/routes/governanceRuleAuditRoutes.ts):
 *
 *   GET  /api/governance/rules/resolve?projectId&repoRef
 *   POST /api/governance/audits                 → { runId }
 *   POST /api/governance/audits/:id/findings    (closes the run)
 *
 * Reachability/auth follows the sibling platform tools: `BUILDERFORCE_API_KEY` (Bearer) +
 * `BUILDERFORCE_AGENT_NODE_ID` (`X-AgentHost-Id`) against `BUILDERFORCE_URL`
 * (default `https://api.builderforce.ai`).
 */

import { readSharedEnvVar } from "../../../infra/env-file.js";
import type {
  GovernanceAuditOptions,
  GovernanceAuditSummary,
  GovernanceFinding,
  GovernanceGateResult,
  GovernancePackApplied,
  GovernanceRule,
  ResolvedRuleset,
} from "./types.js";

export interface GovernanceAuditStart {
  projectId?: string;
  repoRef?: string;
  ref?: string;
  trigger: "manual" | "agent_pr" | "schedule";
}

export interface GovernanceAuditFinalize {
  findings: GovernanceFinding[];
  summary: GovernanceAuditSummary;
  gateResult: GovernanceGateResult;
  rulesetHash?: string;
  packsApplied?: GovernancePackApplied[];
}

/** The seam the pipeline talks through — stubbed in tests. */
export interface GovernanceApiClient {
  resolveRuleset(opts: Pick<GovernanceAuditOptions, "projectId" | "repoRef">): Promise<ResolvedRuleset>;
  startAudit(input: GovernanceAuditStart): Promise<{ runId: string }>;
  finalizeAudit(runId: string, body: GovernanceAuditFinalize): Promise<void>;
}

export interface GovernanceApiConfig {
  baseUrl?: string;
  apiKey?: string;
  agentNodeId?: string;
  fetchImpl?: typeof fetch;
}

/** True when the runtime holds the API key the governance endpoints require. */
export function hasGovernanceApiCredentials(): boolean {
  return Boolean(readSharedEnvVar("BUILDERFORCE_API_KEY"));
}

export function createGovernanceApiClient(config: GovernanceApiConfig = {}): GovernanceApiClient {
  const baseUrl = (config.baseUrl ?? readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai").replace(
    /\/+$/,
    "",
  );
  const apiKey = config.apiKey ?? readSharedEnvVar("BUILDERFORCE_API_KEY");
  const agentNodeId = config.agentNodeId ?? readSharedEnvVar("BUILDERFORCE_AGENT_NODE_ID");
  const fetchImpl = config.fetchImpl ?? fetch;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (agentNodeId) headers["X-AgentHost-Id"] = agentNodeId;

  const post = async (pathname: string, body: unknown, what: string): Promise<Response> => {
    const res = await fetchImpl(`${baseUrl}${pathname}`, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status}`);
    return res;
  };

  return {
    async resolveRuleset(opts) {
      const url = new URL(`${baseUrl}/api/governance/rules/resolve`);
      if (opts.projectId) url.searchParams.set("projectId", opts.projectId);
      if (opts.repoRef) url.searchParams.set("repoRef", opts.repoRef);
      const res = await fetchImpl(url, { headers });
      if (!res.ok) throw new Error(`rules/resolve failed: HTTP ${res.status}`);
      const data = (await res.json()) as Partial<ResolvedRuleset> & { rules?: unknown };
      const rules = Array.isArray(data.rules) ? (data.rules as GovernanceRule[]) : [];
      return { rulesetHash: data.rulesetHash, packsApplied: data.packsApplied, rules };
    },

    async startAudit(input) {
      const res = await post("/api/governance/audits", input, "audits start");
      const started = (await res.json()) as { runId?: string };
      if (!started.runId) throw new Error("audits start returned no runId");
      return { runId: started.runId };
    },

    async finalizeAudit(runId, body) {
      await post(`/api/governance/audits/${encodeURIComponent(runId)}/findings`, body, "findings post");
    },
  };
}
