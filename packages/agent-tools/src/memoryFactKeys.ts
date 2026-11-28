import { CONSOLIDATED_KEY_PREFIX } from "@seanhogg/builderforce-memory/working";

/** Reserved namespaces for durable facts written by platform features. */
export const MEMORY_FACT_PREFIX = {
  codemap: CONSOLIDATED_KEY_PREFIX,
  runOutcome: "run-outcome:",
  team: "team:",
} as const;

export function runOutcomeMemoryKey(
  scope: { projectId?: number | null; ticketId?: number | null },
  runId: string | number,
): string {
  const owner = scope.ticketId != null ? `ticket-${scope.ticketId}`
    : scope.projectId != null ? `project-${scope.projectId}`
    : "run";
  const id = String(runId).trim().slice(0, 120) || "run";
  return `${MEMORY_FACT_PREFIX.runOutcome}${owner}:${id}`;
}

export function teamMemoryKey(agentHostId: string, runId: string): string {
  return `${MEMORY_FACT_PREFIX.team}${agentHostId}:${runId}`;
}

export function parseTeamMemoryKey(key: string): { agentHostId: string; runId: string } {
  const [, agentHostId = "", ...run] = key.split(":");
  return { agentHostId, runId: run.join(":") };
}
