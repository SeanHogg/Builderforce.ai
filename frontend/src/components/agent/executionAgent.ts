import type { AgentHost } from '@/lib/builderforceApi';

/** Already-translated fallbacks for an agent that has no display name of its own. */
export interface ExecutionAgentLabels {
  /** A self-hosted host whose row is not in the loaded list. */
  host: (id: number) => string;
  /** A run with no pinned cloud agent — the gateway-default bucket. */
  defaultCloud: string;
  /** A pinned cloud agent whose name is not in the loaded list. */
  cloud: string;
}

/** The cloud agent that ran a specific execution — read from that execution's own
 *  persisted payload, so each run's logs/triage are scoped to the agent that
 *  ACTUALLY ran it (not the task's current `assignedAgentRef`, which later runs
 *  overwrite). Returns undefined for host runs / default runs with no pinned ref. */
export function execCloudAgentRef(payload: unknown): string | undefined {
  if (typeof payload !== 'string' || !payload) return undefined;
  try {
    const p = JSON.parse(payload) as { cloudAgentRef?: unknown };
    return typeof p.cloudAgentRef === 'string' && p.cloudAgentRef.trim() ? p.cloudAgentRef.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Display name of the agent that ran a SPECIFIC execution — a self-hosted host,
 *  a named cloud agent, or the gateway-default bucket. Read from the execution's
 *  OWN fields (`agentHostId` / `cloudAgentRef`, stamped at dispatch), so it always
 *  reflects who actually ran THAT run — never the task's current assignment, which
 *  a later run overwrites. Shared by the execution header and the chip tooltips. */
export function executionAgentName(
  e: { agentHostId?: number | null; cloudAgentRef?: string | null; payload?: unknown } | null | undefined,
  agentHosts: AgentHost[],
  cloudAgentNames: Map<string, string>,
  labels: ExecutionAgentLabels,
): string {
  const hostId = e?.agentHostId;
  if (hostId != null) return agentHosts.find((h) => h.id === hostId)?.name ?? labels.host(hostId);
  const ref = e?.cloudAgentRef ?? execCloudAgentRef(e?.payload);
  if (!ref) return labels.defaultCloud;
  return cloudAgentNames.get(ref) ?? labels.cloud;
}
