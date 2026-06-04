/**
 * BuilderForceAgents-side API contract types for the BuilderForceAgents ↔ Builderforce interface (P4-4).
 *
 * This file re-declares the same types that live in Builderforce's
 * `src/openapi/schema.ts` — no runtime import of the server package is needed.
 * Both sides must be kept in sync; the Builderforce OpenAPI document at
 * `GET /api/openapi.json` is the authoritative specification.
 */

// ── BuilderForceAgents → Builderforce ──────────────────────────────────────────────────

/** POST /api/agentNodes — register a BuilderForceAgents instance with Builderforce. */
export interface AgentNodeRegistration {
  name: string;
  workspaceDirectory?: string;
  gatewayPort?: number;
  tunnelUrl?: string;
  capabilities?: string[];
  machineProfile?: Record<string, unknown>;
}

/** PATCH /api/agentNodes/:id/heartbeat — keep lastSeenAt fresh. */
export interface HeartbeatPayload {
  capabilities?: string[];
  machineProfile?: Record<string, unknown>;
}

/** POST /api/agentNodes/:id/forward — dispatch a task to a remote agentNode. */
export interface RemoteTaskPayload {
  type: "remote.task";
  task: string;
  fromAgentNodeId: string;
  timestamp: string;
  correlationId?: string;
  callbackAgentNodeId?: string;
  callbackBaseUrl?: string;
}

/** POST /api/telemetry/spans — a single workflow telemetry span. */
export interface TelemetrySpan {
  kind: string;
  workflowId?: string;
  taskId?: string;
  agentRole?: string;
  description?: string;
  ts?: string;
  durationMs?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  error?: string;
  traceId?: string;
  agentNodeId?: string;
  attempt?: number;
}

/** PUT /api/agentNodes/:id/directories/sync — .builderforce/ sync payload. */
export interface DirectorySyncPayload {
  projectId?: number;
  absPath: string;
  status: "synced" | "error";
  metadata?: {
    source?: string;
    workspaceDir?: string;
    fileCount?: number;
    triggeredBy?: "startup" | "manual" | "api";
  };
  files: Array<{
    relPath: string;
    content: string;
    contentHash: string;
    sizeBytes: number;
  }>;
}

// ── Builderforce → BuilderForceAgents (relay messages) ─────────────────────────────────

export interface TaskAssignMessage {
  type: "task.assign";
  task: { title: string; description?: string };
  executionId?: number;
  taskId?: number;
  artifacts?: { skills?: string[]; personas?: string[]; content?: string[] };
}

export interface TaskBroadcastMessage {
  type: "task.broadcast";
  task: { title: string; description?: string };
  executionId?: number;
  taskId?: number;
  artifacts?: { skills?: string[]; personas?: string[]; content?: string[] };
}

export interface ApprovalDecisionMessage {
  type: "approval.decision";
  approvalId: string;
  status: string;
}

// ── Shared ────────────────────────────────────────────────────────────────────

export interface FleetEntry {
  id: number;
  name: string;
  slug: string;
  online: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  capabilities: string[];
}

export interface WorkflowGraphNode {
  id: string;
  label: string;
  role: string;
  status: "pending" | "running" | "completed" | "failed";
  durationMs?: number;
  model?: string;
  estimatedCostUsd?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowGraphEdge {
  from: string;
  to: string;
}

export interface WorkflowGraph {
  workflowId: string;
  status: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

// ── Team memory (P4-5) ────────────────────────────────────────────────────────

export interface TeamMemoryEntry {
  id?: string;
  tenantId?: number;
  agentNodeId: string;
  runId: string;
  summary: string;
  tags?: string[];
  timestamp: string;
  createdAt?: string;
}

// ── Context bundle (P4-2) ─────────────────────────────────────────────────────

export interface ContextBundleResponse {
  agentNodeId: number;
  files: Array<{
    path: string;
    content: string;
    sha256: string;
  }>;
  syncedAt: string | null;
}
