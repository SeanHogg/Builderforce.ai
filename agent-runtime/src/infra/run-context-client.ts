/**
 * run-context-client — the on-prem half of the ONE run-context source.
 *
 * Until this module existed, a self-hosted run was assembled from the workspace and
 * nothing else: `buildEmbeddedSystemPrompt` carried the workspace dir, the skills, the
 * persona + limbic block and the bootstrap files, and NONE of the strategic, PRD,
 * governance, project-memory or lessons context a cloud run has always received. An
 * on-prem agent was therefore working the same ticket with strictly less to go on.
 *
 * The api owns that data, so this fetches the assembled + reconciled
 * `RunContextEnvelope` from the agentHost door
 * (`GET /api/agent/projects/:projectId/run-context`) and renders it with the SHARED
 * `@builderforce/run-context` renderer — the same blocks, the same order, the same words
 * the cloud engine renders in-process. No api internals are imported here; the contract
 * package is the only shared code.
 *
 * DRY: base URL + bearer come from the SAME `readSharedEnvVar` pair every other
 * agent-runtime → api call uses (`personality-event-reporter.ts`,
 * `platform-ticket-tools.ts`, `project-facts-sync.ts`), and the agentHost id from the
 * workspace's `.builderForceAgents/context.yaml`, exactly as `server-startup.ts` reads it.
 *
 * Best-effort by contract: a host that is not linked to a Builderforce workspace, an
 * offline api, or a project with nothing to say all yield `''`, and the run proceeds on
 * its local context alone. Platform context must never be able to fail a local run.
 */
import { renderPlatformContextSection, type RunContextEnvelope } from "@builderforce/run-context";
import { loadProjectContext } from "../builderforce/project-context-store.js";
import { logDebug } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { readSharedEnvVar } from "./env-file.js";

/** How long a run may wait for platform context before proceeding without it. */
const FETCH_TIMEOUT_MS = 8_000;

export interface RunContextRequest {
  /** The workspace the run executes in — where the Builderforce link lives. */
  workspaceDir: string;
  /** The session this context is continuity-scoped to (the delta boundary). */
  sessionKey?: string | undefined;
  /** What the run is about — the recall query for the memory + lessons blocks. */
  query?: string | undefined;
  /** The ticket this run works, when it works one. */
  taskId?: number | undefined;
}

/**
 * Fetch and render the platform context for a run, as ONE markdown section ready to be
 * appended to the embedded system prompt. `''` when unavailable.
 */
export async function fetchRunContextSection(req: RunContextRequest): Promise<string> {
  const envelope = await fetchRunContextEnvelope(req);
  if (!envelope) return "";
  return renderPlatformContextSection(envelope, {
    // The on-prem runner already tells the model exactly which workspace directory it is
    // in and what is on disk; the cloud's repo-binding block would contradict it.
    omit: ["workspace", "prior_changes", "tooling", "capabilities"],
  });
}

/** The raw envelope, for callers that want the blocks rather than the rendered section. */
export async function fetchRunContextEnvelope(
  req: RunContextRequest,
): Promise<RunContextEnvelope | null> {
  const apiKey = readSharedEnvVar("BUILDERFORCE_API_KEY");
  // Not linked to a Builderforce workspace → there is no platform context to fetch.
  if (!apiKey) return null;

  const ctx = await loadProjectContext(req.workspaceDir).catch(() => null);
  const projectId = ctx?.builderforce?.projectId ? Number(ctx.builderforce.projectId) : undefined;
  const agentHostId = ctx?.builderforce?.instanceId;
  if (!projectId || !Number.isFinite(projectId) || !agentHostId) return null;

  const base = normalizeBaseUrl(readSharedEnvVar("BUILDERFORCE_URL") ?? "https://api.builderforce.ai");
  const qs = new URLSearchParams();
  if (req.taskId != null) qs.set("taskId", String(req.taskId));
  if (req.sessionKey) qs.set("scope", `session:${req.sessionKey}`.slice(0, 160));
  if (req.query?.trim()) qs.set("query", req.query.trim().slice(0, 2000));

  try {
    const res = await fetch(`${base}/api/agent/projects/${projectId}/run-context?${qs.toString()}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "X-AgentHost-Id": String(agentHostId),
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      logDebug(`[run-context] fetch returned HTTP ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { envelope?: RunContextEnvelope };
    return body.envelope ?? null;
  } catch (err) {
    logDebug(`[run-context] fetch failed: ${String(err)}`);
    return null;
  }
}
