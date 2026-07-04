/**
 * project-evermind-sync — the on-prem producer for concurrent project learning
 * ([[evermind-learning-architecture]]).
 *
 * After a run, the on-prem agent contributes what it learned back to the single
 * writer (the coordinator DO on the gateway) via the UNIFIED `/learn-text` door —
 * the SAME door the cloud finalize and the IDE post to. It just hands over the
 * run's TEXT; the coordinator adapts the base on it and merges the delta IN ITS
 * ALARM, so no surface (on-prem/cloud/IDE) runs training on its own critical path
 * and there is ONE learning mechanism across all three.
 *
 * Best-effort and OFF unless fully configured (gateway url + key + host id +
 * project id) — a mis/under-configured runtime is a silent no-op, never a crash.
 */
export interface ProjectEvermindSyncConfig {
  gatewayUrl: string;
  apiKey: string;
  agentHostId: number;
  projectId: number;
  /** Max characters of run text sent in one contribution. Default 8000. */
  maxChars?: number;
}

export interface ContributeResult {
  ok: boolean;
  /** Why nothing was pushed (skipped/failed), when applicable. */
  reason?: string;
  /** The base head version the coordinator queued the text against, when known. */
  version?: number;
}

function authHeaders(cfg: ProjectEvermindSyncConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.apiKey}`, "X-AgentHost-Id": String(cfg.agentHostId) };
}

/**
 * Contribute a run's text to the project's Evermind via the coordinator's
 * `/learn-text` door (host-key authenticated). The coordinator gates seeded/frozen
 * and does the adapt+diff+merge itself; this is a cheap POST. Never throws.
 */
export async function contributeProjectEvermindFromText(
  cfg: ProjectEvermindSyncConfig,
  text: string,
  prompt?: string,
): Promise<ContributeResult> {
  const trimmed = (text ?? "").trim();
  if (trimmed.length < 20) return { ok: false, reason: "text too short" };
  const promptTrimmed = (prompt ?? "").trim();
  try {
    const res = await fetch(`${cfg.gatewayUrl}/api/agent/projects/${cfg.projectId}/evermind/learn-text`, {
      method: "POST",
      headers: { ...authHeaders(cfg), "Content-Type": "application/json" },
      body: JSON.stringify({
        text: trimmed.slice(0, cfg.maxChars ?? 8000),
        ...(promptTrimmed ? { prompt: promptTrimmed.slice(0, cfg.maxChars ?? 8000) } : {}),
        weight: trimmed.length,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, reason: typeof body["error"] === "string" ? (body["error"] as string) : `learn-text ${res.status}` };
    return { ok: true, ...(typeof body["baseVersion"] === "number" ? { version: body["baseVersion"] as number } : {}) };
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
}
