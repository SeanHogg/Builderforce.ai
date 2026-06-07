/**
 * Builderforce transport adapter
 *
 * Connects BuilderForceAgents's orchestration engine to Builderforce (api.builderforce.ai)
 * over its HTTP runtime API. Both sides share the same transport abstraction
 * contract, so BuilderForceAgents can delegate task execution to Builderforce.
 * seamlessly — local agents and remote Builderforce agents are interchangeable.
 *
 * Builderforce API surface used here:
 *   POST   /api/runtime/executions
 *   GET    /api/runtime/executions/{id}
 *   POST   /api/runtime/executions/{id}/cancel
 *   GET    /api/agents
 *   GET    /api/skills
 */

import type {
  AgentInfo,
  BuilderforceConfig,
  SkillInfo,
  TaskState,
  TaskSubmitRequest,
  TaskStatus,
  TaskUpdateEvent,
  TransportAdapter,
} from "./types.js";

// ---------------------------------------------------------------------------
// Builderforce API response shapes (runtime executions)
// ---------------------------------------------------------------------------

type BuilderforceExecutionStatus =
  | "pending"
  | "submitted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

type BuilderforceExecutionResponse = {
  id: number;
  taskId: number;
  agentId: number | null;
  agentNodeId: number | null;
  tenantId: number;
  submittedBy: string;
  sessionId: string | null;
  status: BuilderforceExecutionStatus;
  payload: string | null;
  result: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type BuilderforceAgentResponse = {
  agent_type: string;
  name: string;
  description?: string | null;
  available: boolean;
  capabilities?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

type BuilderforceSkillResponse = {
  skill_id: string;
  name: string;
  description?: string | null;
  required_permissions?: string[] | null;
  metadata?: Record<string, unknown> | null;
};

type BuilderforceSkillsEnvelope = {
  skills: BuilderforceSkillResponse[];
};

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Transport adapter that delegates execution to a Builderforce node.
 *
 * Usage:
 * ```ts
 * import { BuilderforceTransportAdapter } from "./transport/builderforce-adapter.js";
 * import { BuilderForceAgentsRuntime } from "./transport/runtime.js";
 *
 * const adapter = new BuilderforceTransportAdapter({ baseUrl: "http://localhost:8000" });
 * await adapter.connect();               // creates a session on the Builderforce node
 * const runtime = new BuilderForceAgentsRuntime(adapter, "remote-enabled");
 * ```
 */
export class BuilderforceTransportAdapter implements TransportAdapter {
  private readonly baseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly authToken: string | undefined;
  private readonly agentNodeId: number | undefined;
  private readonly userId: string | undefined;
  private readonly deviceId: string | undefined;

  constructor(config: BuilderforceConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.pollIntervalMs = config.pollIntervalMs ?? 1000;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.authToken = config.authToken;
    this.agentNodeId = config.agentNodeId;
    this.userId = config.userId;
    this.deviceId = config.deviceId;
  }

  /**
   * Runtime API is stateless for this adapter; connect() is a no-op kept for
   * backward compatibility with callers that eagerly connect adapters.
   */
  async connect(): Promise<void> {
    return;
  }

  // -------------------------------------------------------------------------
  // TransportAdapter implementation
  // -------------------------------------------------------------------------

  async submitTask(request: TaskSubmitRequest): Promise<TaskState> {
    const taskId = this.resolveTaskId(request);
    const body = {
      taskId,
      agentId: this.parseAgentId(request.agentId),
      agentNodeId: this.agentNodeId,
      sessionId: request.sessionId,
      payload: request.input,
    };

    const raw = await this.post<BuilderforceExecutionResponse>(
      `${this.baseUrl}/api/runtime/executions`,
      body,
    );
    return this.toTaskStateFromExecution(raw, request);
  }

  async *streamTaskUpdates(taskId: string): AsyncIterableIterator<TaskUpdateEvent> {
    // Builderforce exposes polling; WebSocket streaming may be added later.
    // We poll until the task reaches a terminal state.
    const terminal = new Set<TaskStatus>(["completed", "failed", "cancelled"]);
    let last: TaskStatus = "pending";

    while (true) {
      await sleep(this.pollIntervalMs);

      const raw = await this.post<BuilderforceExecutionResponse>(
        `${this.baseUrl}/api/runtime/executions/${encodeURIComponent(taskId)}`,
        null,
        "GET",
      );
      const mappedState = this.mapExecutionStatus(raw.status);

      if (mappedState !== last) {
        last = mappedState;
        yield {
          taskId,
          status: mappedState,
          timestamp: new Date(),
          message: raw.errorMessage ?? undefined,
          progress: mappedState === "completed" ? 100 : undefined,
        };
      }

      if (terminal.has(mappedState)) {
        break;
      }
    }
  }

  async queryTaskState(taskId: string): Promise<TaskState | null> {
    try {
      const raw = await this.post<BuilderforceExecutionResponse>(
        `${this.baseUrl}/api/runtime/executions/${encodeURIComponent(taskId)}`,
        null,
        "GET",
      );
      return this.toTaskStateFromExecution(raw);
    } catch {
      return null;
    }
  }

  /**
   * Request the next queued task from the link server. Returns null if none
   * are currently ready. The returned object is intentionally minimal; the
   * caller (e.g. an external worker loop) can decide how to act on it.
   */
  async fetchNextQueuedTask(): Promise<TaskState | null> {
    try {
      const res = await this.post<{
        task: { id: string; status?: string; projectId?: string; priority?: string } | null;
      }>(`${this.baseUrl}/api/tasks/next`, null, "POST");
      if (!res || !res.task) {
        return null;
      }
      const t = res.task;
      return {
        id: t.id,
        status: (t.status as TaskStatus) ?? "pending",
        progress: 0,
        description: `Task ${t.id}`,
        createdAt: new Date(),
        metadata: { projectId: t.projectId, priority: t.priority },
        sessionId: undefined,
      };
    } catch {
      return null;
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    try {
      const result = await this.post<BuilderforceExecutionResponse>(
        `${this.baseUrl}/api/runtime/executions/${encodeURIComponent(taskId)}/cancel`,
        {},
      );
      return this.mapExecutionStatus(result.status) === "cancelled";
    } catch {
      return false;
    }
  }

  async listAgents(): Promise<AgentInfo[]> {
    const params = new URLSearchParams();
    if (this.userId) {
      params.set("user_id", this.userId);
    }
    if (this.deviceId) {
      params.set("device_id", this.deviceId);
    }
    const agents = await this.post<BuilderforceAgentResponse[]>(
      `${this.baseUrl}/api/agents${params.size > 0 ? `?${params}` : ""}`,
      null,
      "GET",
    );
    return agents.map((a) => ({
      id: a.agent_type,
      name: a.name,
      description: a.description ?? a.agent_type,
      capabilities: a.capabilities ?? [],
      model: undefined,
      thinking: undefined,
    }));
  }

  async listSkills(): Promise<SkillInfo[]> {
    const params = new URLSearchParams();
    if (this.userId) {
      params.set("user_id", this.userId);
    }
    if (this.deviceId) {
      params.set("device_id", this.deviceId);
    }

    // Prefer the agentNode-scoped skills endpoint when we know our agentNode id.
    const endpoint =
      this.agentNodeId != null
        ? `${this.baseUrl}/api/agent-hosts/${this.agentNodeId}/skills`
        : `${this.baseUrl}/api/skills`;

    const response = await this.post<BuilderforceSkillResponse[] | BuilderforceSkillsEnvelope>(
      `${endpoint}${params.size > 0 ? `?${params}` : ""}`,
      null,
      "GET",
    );
    const skills = Array.isArray(response) ? response : response.skills;
    return skills.map((s) => ({
      id: s.skill_id,
      name: s.name,
      description: s.description ?? s.skill_id,
      version: "1.0.0",
      enabled: true,
    }));
  }

  async close(): Promise<void> {
    return;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /** Minimal HTTP helper — uses Node 22+ built-in fetch, no extra deps. */
  private async post<T>(url: string, body: unknown, method: "POST" | "GET" = "POST"): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.authToken) {
      headers.Authorization = `Bearer ${this.authToken}`;
    }
    if (this.agentNodeId != null) {
      headers["X-AgentHost-Id"] = String(this.agentNodeId);
    }

    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    if (method === "POST" && body !== null) {
      init.body = JSON.stringify(body);
    }

    const response = await fetch(url, init);

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Builderforce ${method} ${url} → ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private mapExecutionStatus(status: BuilderforceExecutionStatus): TaskStatus {
    switch (status) {
      case "submitted":
        return "pending";
      default:
        return status;
    }
  }

  private resolveTaskId(request: TaskSubmitRequest): number {
    const candidate = request.metadata?.taskId;
    const value =
      typeof candidate === "number"
        ? candidate
        : typeof candidate === "string"
          ? Number(candidate)
          : NaN;

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        "BuilderforceTransportAdapter requires metadata.taskId (numeric) for /api/runtime/executions",
      );
    }
    return value;
  }

  private parseAgentId(agentId: string | undefined): number | undefined {
    if (!agentId) {
      return undefined;
    }
    const numeric = Number(agentId);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  /** Map a Builderforce execution response to BuilderForceAgents's TaskState. */
  private toTaskStateFromExecution(
    raw: BuilderforceExecutionResponse,
    req?: TaskSubmitRequest,
  ): TaskState {
    const mappedStatus = this.mapExecutionStatus(raw.status);
    return {
      id: String(raw.id),
      status: mappedStatus,
      agentId: req?.agentId,
      description: req?.description ?? `Execution ${raw.id}`,
      sessionId: raw.sessionId ?? req?.sessionId,
      parentTaskId: req?.parentTaskId,
      createdAt: new Date(raw.createdAt),
      startedAt: raw.startedAt ? new Date(raw.startedAt) : undefined,
      completedAt: raw.completedAt ? new Date(raw.completedAt) : undefined,
      output: raw.result ?? undefined,
      error: raw.errorMessage ?? undefined,
      progress: mappedStatus === "completed" ? 100 : undefined,
      metadata: {
        taskId: raw.taskId,
        agentNodeId: raw.agentNodeId,
        tenantId: raw.tenantId,
        submittedBy: raw.submittedBy,
        sessionId: raw.sessionId,
      },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
