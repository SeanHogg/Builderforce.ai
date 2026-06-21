/**
 * WorkflowTrigger — fire a Builderforce workflow/spec run from the CLI.
 *
 * This is the CLI/CI side of the same loop the {@link ./workflow-poller.ts}
 * services (host pulls work via `/api/workflows/claim`). A CI pipeline POSTs a
 * trigger here; the portal enqueues the run and a agentHost claims + executes it.
 *
 * Auth mirrors the poller: Bearer API key + `X-AgentHost-Id` header. No new HTTP
 * layer — plain `fetch`, same as the rest of `infra/`.
 */

import { logDebug } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

export type WorkflowTriggerOptions = {
  baseUrl: string;
  /** AgentHost id — used for the X-AgentHost-Id auth header. */
  agentNodeId: string;
  apiKey: string;
};

export type WorkflowTriggerRequest = {
  /** Workflow name or id to trigger (e.g. a saved visual workflow or a spec). */
  workflow: string;
  /** Optional free-text description/goal forwarded to the run. */
  description?: string;
  /** Optional structured inputs passed to the workflow. */
  inputs?: Record<string, unknown>;
};

export type WorkflowTriggerResult = {
  ok: boolean;
  /** HTTP status (0 when the request never completed). */
  status: number;
  /** Triggered run id when the API returned one. */
  runId?: string;
  /** Raw parsed JSON body, when available. */
  body?: unknown;
  /** Error message when `ok` is false. */
  error?: string;
};

/**
 * POST a workflow trigger to Builderforce. Never throws — returns a result whose
 * `ok` flag the CLI maps to an exit code so CI can gate on it.
 */
export async function triggerWorkflow(
  opts: WorkflowTriggerOptions,
  req: WorkflowTriggerRequest,
): Promise<WorkflowTriggerResult> {
  const url = `${normalizeBaseUrl(opts.baseUrl)}/api/workflows/trigger`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "X-AgentHost-Id": opts.agentNodeId,
      },
      body: JSON.stringify({
        workflow: req.workflow,
        ...(req.description ? { description: req.description } : {}),
        ...(req.inputs ? { inputs: req.inputs } : {}),
      }),
      signal: AbortSignal.timeout(20_000),
    });

    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = undefined;
    }

    if (!res.ok) {
      const detail =
        body && typeof body === "object" && "error" in body
          ? String((body as { error: unknown }).error)
          : `HTTP ${res.status}`;
      logDebug(`[workflow-trigger] failed: ${detail}`);
      return { ok: false, status: res.status, body, error: detail };
    }

    const runId =
      body && typeof body === "object" && "runId" in body
        ? String((body as { runId: unknown }).runId)
        : body && typeof body === "object" && "id" in body
          ? String((body as { id: unknown }).id)
          : undefined;

    return { ok: true, status: res.status, runId, body };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logDebug(`[workflow-trigger] error: ${error}`);
    return { ok: false, status: 0, error };
  }
}
