/**
 * Workflow telemetry — lightweight span emitter for orchestrated task execution.
 *
 * Writes newline-delimited JSON spans to .builderforce/telemetry/YYYY-MM-DD.jsonl.
 * Each span captures task start/end times, agent role, workflow context, and
 * any error information — giving operators a queryable audit trail of every
 * agent execution inside a DAG workflow.
 *
 * The JSONL format means operators can inspect it with standard tools:
 *   grep '"kind":"task.fail"' .builderforce/telemetry/2026-03-21.jsonl | jq .
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { logDebug } from "../logger.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

export type SpanKind =
  | "workflow.start"
  | "workflow.complete"
  | "workflow.fail"
  | "task.start"
  | "task.complete"
  | "task.fail";

export type WorkflowSpan = {
  kind: SpanKind;
  workflowId: string;
  taskId?: string;
  agentRole?: string;
  description?: string;
  /** Wall-clock timestamp (ISO 8601) */
  ts: string;
  /** Elapsed milliseconds from task.start → task.complete/fail. Only on end spans. */
  durationMs?: number;
  /** Error message. Only present on *.fail spans. */
  error?: string;
  /** AgentNode instance ID, if known. */
  agentNodeId?: string;
  // ── OTel / cost tracking fields ────────────────────────────────────────
  /** W3C-compatible trace ID (32 hex chars) shared across all spans in a workflow. */
  traceId?: string;
  /** LLM model used in this task (e.g. "claude-sonnet-4-6"). */
  model?: string;
  /** Total input (prompt) tokens consumed by this task. */
  inputTokens?: number;
  /** Total output (completion) tokens consumed by this task. */
  outputTokens?: number;
  /** Estimated cost in USD for this task (input + output tokens at model rates). */
  estimatedCostUsd?: number;
};

/**
 * WorkflowTelemetryService encapsulates all mutable telemetry state.
 * A single instance (exported as `telemetryService`) is shared across the process.
 * Using a class rather than module-level `let` variables makes the state
 * explicit, prevents accidental mutation from other modules, and allows the
 * service to be replaced with a test double in unit tests.
 */
export class WorkflowTelemetryService {
  private projectRoot: string | null = null;
  private agentNodeId: string | null = null;
  private apiUrl: string | null = null;
  private apiKey: string | null = null;
  /**
   * Active trace ID for the current workflow (W3C-compatible, 32 hex chars).
   * Set when a workflow starts, cleared when it ends.
   * Exposed via getActiveTraceId() so HTTP layers can forward it as X-Trace-Id.
   */
  private activeTraceId: string | null = null;
  /**
   * Optional relay hook — called fire-and-forget after each span is appended.
   * Set via setRelayHook() to push real-time workflow/task events to browser
   * clients through the Builderforce WebSocket relay.
   */
  private relayHook: ((event: string, payload: unknown) => void) | null = null;

  /** Returns the active workflow trace ID, or null if no workflow is running. */
  getActiveTraceId(): string | null {
    return this.activeTraceId;
  }

  /**
   * Register (or unregister) a relay hook.
   * The relay service calls this once connected so spans are forwarded as live
   * WebSocket frames to browser clients: workflow.update, task.started, task.completed.
   */
  setRelayHook(fn: ((event: string, payload: unknown) => void) | null): void {
    this.relayHook = fn;
  }

  /**
   * Initialise telemetry. Call once at gateway startup after projectRoot is known.
   * @param opts.projectRoot  Absolute path to the workspace root (.builderForceAgents parent).
   * @param opts.agentNodeId       Optional agentNode instance ID to tag all spans with.
   * @param opts.linkApiUrl   Builderforce.ai base URL for forwarding spans.
   * @param opts.linkApiKey   Builderforce.ai API key for Bearer auth.
   */
  init(opts: {
    projectRoot: string;
    agentNodeId?: string | null;
    linkApiUrl?: string | null;
    linkApiKey?: string | null;
  }): void {
    this.projectRoot = opts.projectRoot;
    this.agentNodeId = opts.agentNodeId ?? null;
    this.apiUrl = opts.linkApiUrl ?? null;
    this.apiKey = opts.linkApiKey ?? null;
  }

  /**
   * Generic span emitter for callers that construct spans directly (e.g. remote-subagent
   * retry telemetry). Accepts a plain record so callers that import dynamically do not
   * need to depend on the WorkflowSpan type.
   */
  emitSpan(span: Record<string, unknown>): void {
    void this.appendSpan(span as WorkflowSpan);
  }

  emitWorkflowStart(workflowId: string, description?: string): void {
    this.activeTraceId = crypto.randomBytes(16).toString("hex");
    void this.appendSpan({
      kind: "workflow.start",
      workflowId,
      description,
      ts: new Date().toISOString(),
      agentNodeId: this.agentNodeId ?? undefined,
      traceId: this.activeTraceId,
    });
  }

  emitWorkflowEnd(workflowId: string, failed: boolean): void {
    void this.appendSpan({
      kind: failed ? "workflow.fail" : "workflow.complete",
      workflowId,
      ts: new Date().toISOString(),
      agentNodeId: this.agentNodeId ?? undefined,
      traceId: this.activeTraceId ?? undefined,
    });
    this.activeTraceId = null;
  }

  emitTaskStart(workflowId: string, taskId: string, agentRole: string, description: string): void {
    void this.appendSpan({
      kind: "task.start",
      workflowId,
      taskId,
      agentRole,
      description,
      ts: new Date().toISOString(),
      agentNodeId: this.agentNodeId ?? undefined,
      traceId: this.activeTraceId ?? undefined,
    });
  }

  emitTaskEnd(
    workflowId: string,
    taskId: string,
    agentRole: string,
    startedAt: Date,
    error?: string,
    metrics?: {
      model?: string;
      inputTokens?: number;
      outputTokens?: number;
      estimatedCostUsd?: number;
    },
  ): void {
    const durationMs = Date.now() - startedAt.getTime();
    void this.appendSpan({
      kind: error !== undefined ? "task.fail" : "task.complete",
      workflowId,
      taskId,
      agentRole,
      ts: new Date().toISOString(),
      durationMs,
      error,
      agentNodeId: this.agentNodeId ?? undefined,
      traceId: this.activeTraceId ?? undefined,
      model: metrics?.model,
      inputTokens: metrics?.inputTokens,
      outputTokens: metrics?.outputTokens,
      estimatedCostUsd: metrics?.estimatedCostUsd,
    });
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async appendSpan(span: WorkflowSpan): Promise<void> {
    if (!this.projectRoot) {
      return;
    }

    this.syncToBuilderforce(span);
    this.forwardToOtelProxy(span);

    const relayEvent = this.spanToRelayEvent(span.kind);
    if (this.relayHook && relayEvent) {
      try {
        this.relayHook(relayEvent, span);
      } catch {
        // relay hook errors must never block telemetry writes
      }
    }

    try {
      const dir = path.join(this.projectRoot, ".builderForceAgents", "telemetry");
      await fs.mkdir(dir, { recursive: true });
      const date = new Date().toISOString().slice(0, 10);
      const file = path.join(dir, `${date}.jsonl`);
      await fs.appendFile(file, JSON.stringify(span) + "\n", "utf8");
    } catch (err) {
      logDebug(`[telemetry] failed to write span: ${String(err)}`);
    }
  }

  /**
   * Fire-and-forget: forward a span to Builderforce.ai workflow API.
   * Maps WorkflowSpan kinds to the appropriate REST calls:
   *   workflow.start    → POST  /api/workflows          (upsert; status=running)
   *   workflow.complete → POST  /api/workflows          (upsert; status=completed)
   *   workflow.fail     → POST  /api/workflows          (upsert; status=failed)
   *   task.start        → POST  /api/workflows/:wfId/tasks  (create with status=running)
   *   task.complete     → PATCH /api/workflows/:wfId/tasks/:tid  (status=completed)
   *   task.fail         → PATCH /api/workflows/:wfId/tasks/:tid  (status=failed)
   */
  private syncToBuilderforce(span: WorkflowSpan): void {
    if (!this.apiUrl || !this.apiKey || !this.agentNodeId) {
      return;
    }

    const base = normalizeBaseUrl(this.apiUrl);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      "X-AgentNode-Id": this.agentNodeId,
    };
    if (span.traceId) {
      headers["X-Trace-Id"] = span.traceId;
    }

    const doFetch = (url: string, method: string, body: unknown) =>
      fetch(url, { method, headers, body: JSON.stringify(body) }).catch((err) =>
        logDebug(`[telemetry] builderforce sync failed (${span.kind}): ${String(err)}`),
      );

    switch (span.kind) {
      case "workflow.start":
        void doFetch(`${base}/api/workflows`, "POST", {
          id: span.workflowId,
          status: "running",
          description: span.description,
        });
        break;
      case "workflow.complete":
        void doFetch(`${base}/api/workflows`, "POST", {
          id: span.workflowId,
          status: "completed",
        });
        break;
      case "workflow.fail":
        void doFetch(`${base}/api/workflows`, "POST", {
          id: span.workflowId,
          status: "failed",
        });
        break;
      case "task.start":
        void doFetch(`${base}/api/workflows/${span.workflowId}/tasks`, "POST", {
          id: span.taskId,
          agentRole: span.agentRole ?? "agent",
          description: span.description ?? "",
          status: "running",
          startedAt: span.ts,
        });
        break;
      case "task.complete":
        void doFetch(`${base}/api/workflows/${span.workflowId}/tasks/${span.taskId}`, "PATCH", {
          status: "completed",
          completedAt: span.ts,
        });
        break;
      case "task.fail":
        void doFetch(`${base}/api/workflows/${span.workflowId}/tasks/${span.taskId}`, "PATCH", {
          status: "failed",
          error: span.error,
          completedAt: span.ts,
        });
        break;
    }
  }

  /** Forward span to Builderforce OTel ingest endpoint (fire-and-forget). */
  private forwardToOtelProxy(span: WorkflowSpan): void {
    if (!this.apiUrl || !this.apiKey || !this.agentNodeId) {
      return;
    }
    const agentNodeIdNum = parseInt(this.agentNodeId, 10);
    if (Number.isNaN(agentNodeIdNum)) {
      return;
    }

    const base = normalizeBaseUrl(this.apiUrl);
    fetch(`${base}/api/telemetry/spans?agentNodeId=${agentNodeIdNum}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...(span.traceId ? { "X-Trace-Id": span.traceId } : {}),
      },
      body: JSON.stringify([span]),
    }).catch((err) => logDebug(`[telemetry] otel proxy forward failed: ${String(err)}`));
  }

  private spanToRelayEvent(kind: SpanKind): string | null {
    switch (kind) {
      case "workflow.start":
      case "workflow.complete":
      case "workflow.fail":
        return "workflow.update";
      case "task.start":
        return "task.started";
      case "task.complete":
      case "task.fail":
        return "task.completed";
      default:
        return null;
    }
  }
}

/** Process-wide singleton. Use the module-level shims below to interact with it. */
export const telemetryService = new WorkflowTelemetryService();

// ── Module-level shims (backward-compatible API) ──────────────────────────────
// These delegate to the singleton so existing callers (builderforce-relay.ts,
// orchestrator-ports-adapter.ts, remote-subagent.ts) need no changes.

export function getActiveTraceId(): string | null {
  return telemetryService.getActiveTraceId();
}

export function setRelayHook(fn: ((event: string, payload: unknown) => void) | null): void {
  telemetryService.setRelayHook(fn);
}

export function initTelemetry(opts: {
  projectRoot: string;
  agentNodeId?: string | null;
  linkApiUrl?: string | null;
  linkApiKey?: string | null;
}): void {
  telemetryService.init(opts);
}

export function emitSpan(span: Record<string, unknown>): void {
  telemetryService.emitSpan(span);
}

export function emitWorkflowStart(workflowId: string, description?: string): void {
  telemetryService.emitWorkflowStart(workflowId, description);
}

export function emitWorkflowEnd(workflowId: string, failed: boolean): void {
  telemetryService.emitWorkflowEnd(workflowId, failed);
}

export function emitTaskStart(
  workflowId: string,
  taskId: string,
  agentRole: string,
  description: string,
): void {
  telemetryService.emitTaskStart(workflowId, taskId, agentRole, description);
}

export function emitTaskEnd(
  workflowId: string,
  taskId: string,
  agentRole: string,
  startedAt: Date,
  error?: string,
  metrics?: {
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number;
  },
): void {
  telemetryService.emitTaskEnd(workflowId, taskId, agentRole, startedAt, error, metrics);
}
