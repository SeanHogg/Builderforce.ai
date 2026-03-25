/**
 * Shared OpenAPI contract types between CoderClaw and Builderforce.ai (P4-4).
 *
 * These types form the single source of truth for the CoderClaw ↔ Builderforce
 * HTTP interface.  CoderClaw imports the equivalent declarations from
 * `src/infra/api-contract.ts` (which re-declares the same types locally so
 * the claw does not take a runtime dependency on this package).
 *
 * NOTE: Plain TypeScript interfaces are used here (no Zod runtime dependency)
 * because Cloudflare Workers bundle size is a concern.  If Zod is already a
 * dependency, validators can be layered on top of these type definitions.
 */

// ── CoderClaw → Builderforce ──────────────────────────────────────────────────

/** POST /api/claws — register a CoderClaw instance with Builderforce. */
export interface ClawRegistration {
  /** Proposed instance name (human-readable). */
  name: string;
  /** Workspace directory on the claw's host machine. */
  workspaceDirectory?: string;
  /** Gateway port the local HTTP server is listening on. Default: 18789. */
  gatewayPort?: number;
  /** Publicly reachable tunnel URL (if Cloudflare Tunnel / ngrok is active). */
  tunnelUrl?: string;
  /** Capabilities this claw supports, e.g. ["chat","tasks","relay","remote-dispatch"]. */
  capabilities?: string[];
  /** Machine profile for diagnostics. */
  machineProfile?: Record<string, unknown>;
}

/** PATCH /api/claws/:id/heartbeat — keep lastSeenAt fresh. */
export interface HeartbeatPayload {
  /** Current capability list (may change at runtime). */
  capabilities?: string[];
  /** Updated machine profile. */
  machineProfile?: Record<string, unknown>;
}

/** POST /api/claws/:id/forward — dispatch a task to a remote claw. */
export interface RemoteTaskPayload {
  type: 'remote.task';
  /** Natural-language task description. */
  task: string;
  /** Originating claw's numeric ID (as string). */
  fromClawId: string;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Correlation ID for result routing. */
  correlationId?: string;
  /** Claw ID that should receive the result callback. */
  callbackClawId?: string;
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
  /** Originating claw ID (as string). */
  clawId?: string;
  /** Retry attempt number (only on kind === "task.retry"). */
  attempt?: number;
}

/** PUT /api/claws/:id/directories/sync — sync .coderClaw/ files to Builderforce. */
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

// ── Builderforce → CoderClaw (relay messages) ─────────────────────────────────

/** Relay message: assign a task to this specific claw. */
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

/** Relay message: broadcast a task to all online claws. */
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

/** An entry in the claw fleet listing. */
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

/** POST /api/teams/memory — store a memory entry from a claw. */
export interface TeamMemoryEntry {
  id?: string;
  tenantId?: number;
  clawId: string;
  runId: string;
  summary: string;
  tags?: string[];
  timestamp: string;
  createdAt?: string;
}

// ── Context bundle (P4-2) ─────────────────────────────────────────────────────

/** GET /api/claws/:id/context-bundle — response shape. */
export interface ContextBundleResponse {
  clawId: number;
  files: Array<{
    path: string;
    content: string;
    sha256: string;
  }>;
  syncedAt: string | null;
}

// ── OpenAPI document helpers ──────────────────────────────────────────────────

export const OPENAPI_VERSION = '3.1.0';
export const OPENAPI_TITLE = 'Builderforce CoderClaw API';
export const OPENAPI_DESCRIPTION =
  'Shared contract between CoderClaw instances and the Builderforce.ai platform.';
