/**
 * Durable personality-event reporter for on-prem (embedded) runs.
 *
 * The embedded runner emits an in-process `personality` observability event
 * (see agents/embedded-runner/run/attempt.ts) but that event is ephemeral —
 * unlike the cloud engine, a self-hosted run left NO durable personality-usage
 * history. This module fire-and-forgets that same application to the api's
 * durable producer seam `POST /api/personality/events`, so the Workforce
 * Personality-Usage panel reflects on-prem runs at parity with cloud.
 *
 * DRY: reuses the SAME base-URL + bearer resolution every other agent-runtime →
 * api call uses (`readSharedEnvVar` BUILDERFORCE_URL / BUILDERFORCE_API_KEY —
 * see platform-ticket-tools.ts, node-orchestration-tools.ts, hired-agents-sync.ts).
 * Best-effort: any error (including a non-2xx) is swallowed at debug; a reporting
 * failure NEVER affects the run.
 */
import { logDebug } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { readSharedEnvVar } from "./env-file.js";

/** Body of POST /api/personality/events (mirrors the api route contract). */
export type PersonalityEventReport = {
  /** REQUIRED — the ide_agents.id the run is executing as. */
  agentRef: string;
  executionId?: number | null;
  runId?: string | null;
  sessionKey?: string | null;
  profileSource?: string;
  personaIds?: string[];
  directivesSummary?: string;
  directiveCount?: number;
  thinkLevel?: string | null;
  reasoningLevel?: string | null;
  temperature?: number | null;
};

/**
 * Persist one personality application to the durable spine. Fire-and-forget:
 * resolves the gateway base + bearer from the shared env, POSTs, and returns
 * without surfacing errors. No-ops (never throws) when the run has no ide_agents
 * ref or this host is not linked to Builderforce.
 */
export async function reportPersonalityEvent(report: PersonalityEventReport): Promise<void> {
  const agentRef = report.agentRef?.trim();
  // No ide_agents.id → there is no durable agent row to attach to (the endpoint
  // 400s on a missing agentRef and 404s on an unknown one). Skip cleanly.
  if (!agentRef) return;
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  // Not linked to a Builderforce workspace → nowhere durable to write. Skip.
  if (!apiKey) return;
  const base = normalizeBaseUrl(readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai");
  try {
    const res = await fetch(`${base}/api/personality/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ ...report, agentRef }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      logDebug(`[personality-event] durable report returned HTTP ${res.status}`);
    }
  } catch (err) {
    logDebug(`[personality-event] durable report failed: ${String(err)}`);
  }
}
