/**
 * Shared OpenAPI contract types between BuilderForce Agents and Builderforce.ai (P4-4).
 *
 * These types form the single source of truth for the BuilderForce Agents ↔ Builderforce
 * HTTP interface.  BuilderForce Agents imports the equivalent declarations from
 * `src/infra/api-contract.ts` (which re-declares the same types locally so
 * the agentHost does not take a runtime dependency on this package).
 *
 * NOTE: Plain TypeScript interfaces are used here (no Zod runtime dependency)
 * because Cloudflare Workers bundle size is a concern.  If Zod is already a
 * dependency, validators can be layered on top of these type definitions.
 */

// ── BuilderForce Agents → Builderforce ──────────────────────────────────────────────────

/** POST /api/agent-hosts — register a BuilderForce Agents instance with Builderforce. */
export interface AgentHostRegistration {
  /** Proposed instance name (human-readable). */
  name: string;
  /** Workspace directory on the agentHost's host machine. */
  workspaceDirectory?: string;
  /** Gateway port the local HTTP server is listening on. Default: 18789. */
  gatewayPort?: number;
  /** Publicly reachable tunnel URL (if Cloudflare Tunnel / ngrok is active). */
  tunnelUrl?: string;
  /** Capabilities this agentHost supports, e.g. ["chat","tasks","relay","remote-dispatch"]. */
  capabilities?: string[];
  /** Machine profile for diagnostics. */
  machineProfile?: Record<string, unknown>;
}

/** PATCH /api/agent-hosts/:id/heartbeat — keep lastSeenAt fresh. */
export interface HeartbeatPayload {
  /** Current capability list (may change at runtime). */
  capabilities?: string[];
  /** Updated machine profile. */
  machineProfile?: Record<string, unknown>;
}

/** POST /api/agent-hosts/:id/forward — dispatch a task to a remote agentHost. */
export interface RemoteTaskPayload {
  type: 'remote.task';
  /** Natural-language task description. */
  task: string;
  /** Originating agentHost's numeric ID (as string). */
  fromAgentHostId: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Correlation ID for result routing. */
  correlationId?: string;
  /** AgentHost ID that should receive the result callback. */
  callbackAgentHostId?: string;
  /** Base URL of the originating Builderforce instance. */
  callbackBaseUrl?: string;
}

/** POST /api/telemetry/spans — ingest a batch of workflow telemetry spans. */
export interface TelemetrySpan {
  /** Span kind (e.g. "workflow.start", "task.start", "task.end", "task.error", "task.retry"). */
  kind: string;
  workflowId?: string;
  taskId?: string;
  agentRole?: string;
  description?: string;
  /** ISO-8601 timestamp. */
  ts?: string;
  durationMs?: number;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  error?: string;
  /** Trace ID for correlating spans across a distributed workflow. */
  traceId?: string;
  /** Originating agentHost ID (as string). */
  agentHostId?: string;
  /** Retry attempt number (only on kind === "task.retry"). */
  attempt?: number;
}

/** PUT /api/agent-hosts/:id/directories/sync — sync .builderforce/ files to Builderforce. */
export interface DirectorySyncPayload {
  projectId?: number;
  absPath: string;
  status: 'synced' | 'error';
  metadata?: {
    source?: string;
    workspaceDir?: string;
    fileCount?: number;
    triggeredBy?: 'startup' | 'manual' | 'api';
  };
  files: Array<{
    relPath: string;
    content: string;
    contentHash: string;
    sizeBytes: number;
  }>;
}

// ── Builderforce → BuilderForce Agents (relay messages) ─────────────────────────────────

/** Relay message: assign a task to this specific agentHost. */
export interface TaskAssignMessage {
  type: 'task.assign';
  task: {
    title: string;
    description?: string;
  };
  executionId?: number;
  taskId?: number;
  artifacts?: {
    skills?: string[];
    personas?: string[];
    content?: string[];
  };
}

/** Relay message: broadcast a task to all online agentHosts. */
export interface TaskBroadcastMessage {
  type: 'task.broadcast';
  task: {
    title: string;
    description?: string;
  };
  executionId?: number;
  taskId?: number;
  artifacts?: {
    skills?: string[];
    personas?: string[];
    content?: string[];
  };
}

/** Relay message: manager approved or rejected a pending approval request. */
export interface ApprovalDecisionMessage {
  type: 'approval.decision';
  approvalId: string;
  /** 'approved' | 'rejected' */
  status: string;
}

// ── Shared ────────────────────────────────────────────────────────────────────

/** An entry in the agentHost fleet listing. */
export interface FleetEntry {
  id: number;
  name: string;
  slug: string;
  online: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  capabilities: string[];
}

/** A node in the workflow dependency graph (P4-1). */
export interface WorkflowGraphNode {
  id: string;
  /** Task description, truncated to 80 chars. */
  label: string;
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  durationMs?: number;
  model?: string;
  estimatedCostUsd?: number;
  startedAt?: string;
  completedAt?: string;
}

/** A directed edge in the workflow dependency graph (P4-1). */
export interface WorkflowGraphEdge {
  /** taskId of the dependency (source). */
  from: string;
  /** taskId of the dependent task (destination). */
  to: string;
}

/** The full workflow dependency graph response. */
export interface WorkflowGraph {
  workflowId: string;
  status: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

// ── Team memory (P4-5) ────────────────────────────────────────────────────────

/** POST /api/teams/memory — store a memory entry from a agentHost. */
export interface TeamMemoryEntry {
  id?: string;
  tenantId?: number;
  agentHostId: string;
  runId: string;
  summary: string;
  tags?: string[];
  timestamp: string;
  createdAt?: string;
}

// ── Context bundle (P4-2) ─────────────────────────────────────────────────────

/** GET /api/agent-hosts/:id/context-bundle — response shape. */
export interface ContextBundleResponse {
  agentHostId: number;
  files: Array<{
    path: string;
    content: string;
    sha256: string;
  }>;
  syncedAt: string | null;
}

// ── OpenAPI document helpers ──────────────────────────────────────────────────

export const OPENAPI_VERSION = '3.1.0';
export const OPENAPI_TITLE = 'BuilderForce Agents API';
export const OPENAPI_DESCRIPTION =
  'Shared contract between BuilderForce Agents instances and the Builderforce.ai platform.';
