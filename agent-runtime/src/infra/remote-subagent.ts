/**
 * Low-level Builderforce remote-agentNode HTTP helpers.
 *
 * Exports:
 *   - `fetchFleetEntries`   — `GET /api/agentNodes/fleet` (agentNode-authenticated).
 *   - `dispatchToRemoteAgentNode` — `POST /api/agentNodes/:targetId/forward` with HMAC payload.
 *   - `dispatchResultToRemoteAgentNode` — callback path for task results.
 *
 * Higher-level concerns (capability-based routing, auto-target parsing, peer
 * filtering) live in `BuilderforceAgentTransport` (`./agent-transport.ts`),
 * which is the orchestrator's `IAgentTransport` adapter.
 */

import { createHmac } from "node:crypto";
import { logDebug } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

/**
 * HMAC-SHA256 signature of the serialised payload using the agentNode's API key
 * as the shared secret. The receiving Builderforce endpoint should verify this
 * before accepting the dispatch, ensuring only agentNodes with a valid key can
 * forward tasks and that the payload has not been tampered with in transit.
 *
 * Signature covers the exact JSON body bytes that are sent in the request.
 */
function signPayload(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export type RemoteDispatchOptions = {
  /** Base HTTP URL of Builderforce, e.g. "https://api.builderforce.ai" */
  baseUrl: string;
  /** This agentNode's numeric ID (from builderforce.instanceId in context.yaml) */
  myAgentNodeId: string;
  /** Plaintext API key for this agentNode (BUILDERFORCE_API_KEY) */
  apiKey: string;
};

export type RemoteDispatchResult = { status: "accepted" } | { status: "rejected"; error: string };

/** Options for dispatchToRemoteAgentNode. */
export interface RemoteDispatchExtendedOptions {
  correlationId?: string;
  callbackAgentNodeId?: string;
  /** Called with partial result chunks if the remote agentNode streams (X-Stream: true header). */
  onChunk?: (chunk: string) => void;
  /** Timeout in milliseconds. Default: 600000 (10 min). */
  timeoutMs?: number;
}

export type FleetEntry = {
  id: number;
  name: string;
  slug: string;
  online: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  capabilities: string[];
};

/** Fetch the raw agentNode fleet entries for the current tenant. */
export async function fetchFleetEntries(opts: RemoteDispatchOptions): Promise<FleetEntry[]> {
  const url = `${normalizeBaseUrl(opts.baseUrl)}/api/agentNodes/fleet`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        "X-AgentNode-From": opts.myAgentNodeId,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      logDebug(`[remote-subagent] fleet query failed: HTTP ${res.status}`);
      return [];
    }
    const data = (await res.json()) as { fleet: FleetEntry[] };
    return data.fleet;
  } catch (err) {
    logDebug(`[remote-subagent] fleet query error: ${String(err)}`);
    return [];
  }
}

// ── Retry helper ──────────────────────────────────────────────────────────────

const RETRY_DELAYS_MS = [500, 1000, 2000] as const;
const MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Telemetry span helper (fire-and-forget) ──────────────────────────────────

/** Lazily imported telemetry emitter to avoid circular deps. */
let _emitSpan: ((span: Record<string, unknown>) => void) | null | undefined = undefined;

function emitRetrySpan(
  workflowId: string | undefined,
  taskId: string | undefined,
  attempt: number,
  reason: string,
): void {
  // Emit a task.retry span using the workflow-telemetry module if available.
  // We import lazily and cache to avoid circular dependencies.
  if (_emitSpan === undefined) {
    _emitSpan = null; // prevent re-entry during resolution
    import("./workflow-telemetry.js")
      .then((mod) => {
        const m = mod as { emitSpan?: (span: Record<string, unknown>) => void };
        if (typeof m.emitSpan === "function") {
          _emitSpan = m.emitSpan;
        }
      })
      .catch(() => {
        // telemetry module unavailable
      });
    return; // first call: span is skipped; future calls will use the cached fn
  }
  if (!_emitSpan) {
    return;
  }
  try {
    _emitSpan({
      kind: "task.retry",
      workflowId,
      taskId,
      ts: new Date().toISOString(),
      error: reason,
      durationMs: attempt * 500,
      agentRole: `retry-attempt-${attempt}`,
    });
  } catch {
    // telemetry is best-effort
  }
}

/**
 * Dispatch a task payload to a remote agentNode.
 * Authenticates as the source agentNode and forwards to the target agentNode.
 *
 * Retries up to 3 times with exponential backoff (500ms, 1000ms, 2000ms)
 * on network errors or 5xx responses. Supports optional chunk streaming
 * via the onChunk callback when the remote agentNode responds with X-Stream: true.
 */
export async function dispatchToRemoteAgentNode(
  opts: RemoteDispatchOptions,
  targetAgentNodeId: string,
  task: string,
  options?: RemoteDispatchExtendedOptions | { correlationId?: string; callbackAgentNodeId?: string },
): Promise<RemoteDispatchResult> {
  const extOpts = options as RemoteDispatchExtendedOptions | undefined;
  // API key moved to Authorization header; payload is HMAC-signed so the
  // receiving endpoint can verify both the caller's identity and that the
  // task body has not been tampered with in transit.
  const url = `${normalizeBaseUrl(opts.baseUrl)}/api/agentNodes/${targetAgentNodeId}/forward`;

  const payload: Record<string, unknown> = {
    type: "remote.task",
    task,
    fromAgentNodeId: opts.myAgentNodeId,
    timestamp: new Date().toISOString(),
    ...(extOpts?.correlationId ? { correlationId: extOpts.correlationId } : {}),
    ...(extOpts?.callbackAgentNodeId ? { callbackAgentNodeId: extOpts.callbackAgentNodeId } : {}),
    ...(extOpts?.correlationId ? { callbackBaseUrl: opts.baseUrl } : {}),
  };
  const body = JSON.stringify(payload);
  const signature = signPayload(body, opts.apiKey);

  logDebug(`[remote-subagent] dispatching to agentNode ${targetAgentNodeId}: ${task.slice(0, 80)}…`);

  let lastError: string = "unknown error";

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delayMs = RETRY_DELAYS_MS[attempt - 1] ?? 2000;
      logDebug(`[remote-subagent] retry attempt ${attempt + 1}/${MAX_ATTEMPTS} after ${delayMs}ms`);
      emitRetrySpan(undefined, undefined, attempt, lastError);
      await sleep(delayMs);
    }

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.apiKey}`,
          "X-AgentNode-From": opts.myAgentNodeId,
          // SHA-256 HMAC of the exact body bytes — receiver should verify before accepting
          "X-AgentNode-Signature": `sha256=${signature}`,
        },
        body,
        signal: AbortSignal.timeout(extOpts?.timeoutMs ?? 30_000),
      });

      // Retry on 5xx server errors
      if (res.status >= 500) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      if (!res.ok) {
        const errBody = await res.text();
        return { status: "rejected", error: `HTTP ${res.status}: ${errBody}` };
      }

      // Streaming support: if X-Stream header present, pipe chunks to onChunk callback
      if (res.headers.get("X-Stream") === "true" && extOpts?.onChunk && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          extOpts.onChunk(decoder.decode(value, { stream: true }));
        }
        return { status: "accepted" };
      }

      const data = (await res.json()) as { ok?: boolean; delivered?: boolean; error?: string };
      if (data.ok && data.delivered) {
        logDebug(`[remote-subagent] task delivered to agentNode ${targetAgentNodeId}`);
        return { status: "accepted" };
      }

      return {
        status: "rejected",
        error: data.error ?? "target agentNode reported delivery failure",
      };
    } catch (err) {
      lastError = String(err);
      // Network errors are retryable
      if (attempt < MAX_ATTEMPTS - 1) {
        continue;
      }
    }
  }

  return { status: "rejected", error: lastError };
}

/**
 * Send a task result back to the originating agentNode.
 * Called by the target agentNode after completing a remote task.
 */
export async function dispatchResultToRemoteAgentNode(
  opts: RemoteDispatchOptions,
  callbackAgentNodeId: string,
  correlationId: string,
  result: string,
): Promise<void> {
  const url = `${normalizeBaseUrl(opts.baseUrl)}/api/agentNodes/${callbackAgentNodeId}/forward`;
  const payload = {
    type: "remote.task.result",
    correlationId,
    result,
    fromAgentNodeId: opts.myAgentNodeId,
    timestamp: new Date().toISOString(),
  };
  const body = JSON.stringify(payload);
  const signature = signPayload(body, opts.apiKey);
  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${opts.apiKey}`,
        "X-AgentNode-From": opts.myAgentNodeId,
        "X-AgentNode-Signature": `sha256=${signature}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    logDebug(
      `[remote-subagent] result dispatched to callback agentNode ${callbackAgentNodeId} (correlation=${correlationId})`,
    );
  } catch (err) {
    logDebug(`[remote-subagent] result dispatch failed: ${String(err)}`);
  }
}
