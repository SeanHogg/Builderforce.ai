/**
 * project-facts-sync — the on-prem client for the SHARED per-project facts store
 * ([[evermind-learning-architecture]], migration 0276). Beliefs the on-prem agent
 * forms are written to — and recalled from — the SAME `project_facts` store VS Code,
 * the web Brain, and cloud runs use, via the host-key door
 * `/api/agent/projects/:projectId/facts`. Best-effort; never throws.
 *
 * Config shape matches `projectEvermindConfig()` (gateway url + key + host id +
 * project id), so the knowledge loop reuses the one config getter for both.
 */
export interface ProjectFactsSyncConfig {
  gatewayUrl: string;
  apiKey: string;
  agentHostId: number;
  projectId: number;
}

function authHeaders(cfg: ProjectFactsSyncConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.apiKey}`, "X-AgentHost-Id": String(cfg.agentHostId) };
}

/** Write-through a belief to the shared project store (replace-on-write by key). */
export async function pushProjectFact(cfg: ProjectFactsSyncConfig, key: string, content: string): Promise<boolean> {
  if (!key.trim() || !content.trim()) return false;
  try {
    const res = await fetch(`${cfg.gatewayUrl}/api/agent/projects/${cfg.projectId}/facts`, {
      method: "POST",
      headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({ key: key.slice(0, 255), content, source: "onprem" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Recall shared project facts (for prompt injection). Returns [] on any error. */
export async function recallSharedProjectFacts(
  cfg: ProjectFactsSyncConfig,
  query?: string,
  limit = 6,
): Promise<Array<{ key: string; content: string }>> {
  try {
    const qs = new URLSearchParams();
    if (query) qs.set("query", query);
    qs.set("limit", String(limit));
    const res = await fetch(`${cfg.gatewayUrl}/api/agent/projects/${cfg.projectId}/facts?${qs.toString()}`, {
      headers: authHeaders(cfg),
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { facts?: Array<{ key: string; content: string }> };
    return Array.isArray(j.facts) ? j.facts : [];
  } catch {
    return [];
  }
}
