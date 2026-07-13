// -----------------------------------------------------------------------
// BuilderForce.ai API client — shared use across frontend and VS Code webview.
// -----------------------------------------------------------------------

import { toFileLike } from 'openapi_typescript-fetch';

export const base = '/api'; // shared base to resolve /api/specs/:id, etc.

// Helper to attach headers (Bearer token, etc.) from the app.
export const attachHeaders = (headers: HeadersInit = {}): HeadersInit => {
  return { ...headers };
};

export const request = async <R>(url: string, options?: RequestInit): Promise<R> => {
  const response = await fetch(`${base}${url}`, {
    ...options,
    headers: attachHeaders(options?.headers),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unable to parse error response');
    // Provide context for developer ergonomics.
    throw new Error(`API request failed: ${response.status} ${response.statusText}\n${text}`);
  }

  return response.json();
};

// -----------------------------------------------------------------------
// Authentication / API keys
// -----------------------------------------------------------------------

export type AgentKind = 'cloud' | 'agentHost' | 'workforce' | 'registered' | 'faas';

export type CredentialKind = 'github' | 'github-bearer' | 'openai' | 'cohere' | 'anthropic' | 'github-webhook' | 'cloud' | 'fakedb';

export type CredentialType = 'credentials' | 'connections' | 'webhooks';

export interface ProjectCredential {
  id: number;
  credentialKind: CredentialKind;
  project: number;
  created_at: string;
  updated_at: string;
}

export interface Connection {
  id: number;
  connectionKind: CredentialKind;
  name: string;
  createdBy: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Webhook {
  id: number;
  webhookKind: CredentialKind;
  name: string;
  createdBy: string;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export type OwnerKind = 'Reviewer' | 'Owner' | 'Assignee';

export interface User {
  userRef: string;
  name: string;
  email?: string;
  role: string;
  provider: string | null;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  owner: number;
  type: string;
}

export interface ProjectAgent {
  agentRef: string;
  role: string;
  agents?: { id: number; assignedToProject: boolean }[];
  kind: AgentKind;
}

// -----------------------------------------------------------------------
// Specs, PRDs, and related data (FR1–FR5)
// -----------------------------------------------------------------------

export type SpecStatus = 'draft' | 'ready' | 'in_progress' | 'complete';

export interface Spec {
  id: number;
  projectId: number;
  task_id: number | null;
  goal: string;
  prd: string;
  kind: 'prd' | 'architecture' | 'task-list';
  status: SpecStatus;
  tenantId: number;
  spec: string | null; // Signature/timestamp if available
  userId: string;
  createdAt: string;
}

export interface CapabilitySection {
  id: string;
  name: string;
  description: string | null;
  requirements: CapabilityRequirement[];
  subSections?: CapabilitySection[];
}

export interface CapabilityRequirement {
  requirementId: string;
  title: string;
  description: string | null;
  status: RequirementStatus;
  relatedTasks?: number[];
}

export type RequirementStatus = 'draft' | 'ready' | 'started' | 'done';

// Hierarchical view for the Capabilities graph (FR2).
export interface CapabilityNode {
  id: string;
  label: string;
  description: string | null;
  type: CapabilityType;
  specId: number | null;
  parent: string | null;
  children: string[];
  status: CapabilityStatus;
  relatedTasks: number[]; // flat mapping for drill-down
  tags: string[];
}

export type CapabilityType = 'domain' | 'layer' | 'feature' | 'component' | 'task';

export type CapabilityStatus = 'draft' | 'ready' | 'in_progress' | 'done';

// Relationships for graph rendering (directed edge).
export interface CapabilityRelation {
  from: string;
  to: string;
  label: string | null;
  kind: RelationKind;
  specId: number;
}

export type RelationKind = 'flow' | 'dependency' | 'composition' | 'conformance';

// Rollup response from /api/capabilities/:id/drill.
export interface CapabilityRollup {
  spec: Spec;
  metrics: CapabilityMetrics;
  sections: CapabilitySection[];
  nodes: CapabilityNode[];
  relationships: CapabilityRelation[];
}

export interface CapabilityMetrics {
  promptCount: number;
  userScopeCount: number;
  userCapabilityCount: number;
  scheduleCount: number;
  scheduleScopeCount: number;
  runtimeCount: number;
  modelCount: number;
  maxPromptSize: number | null;
  avgPromptSize: number;
  maxModelContext: number | null;
  maxScheduleTimeout: number | null;
  avgDurationMs: number;
}

/** Response from GET /api/capabilities?projectId=123 (nodes + summary tags). */
export interface CapabilitiesListResponse {
  nodes: CapabilityNode[];
  tags: string[];
}

/**
 * TypeScript export for testing the type without depending on the fetch runtime.
 */
export type CapabilitiesApi = {
  /**
   * List capabilities for a project (caps list).
   * @param projectId required — return only nodes and tags tied to this projectId.
   */
  list: (projectId: number) => Promise<CapabilitiesListResponse>;
};

/** stub_health(s) hook exports for future FR5 hooks to wire in. */
export const stub_health = (..._args: unknown[]): Record<string, unknown> => ({});

// Export formats supported (FR4).
export type ExportFormat = 'png' | 'pdf' | 'json';

// Parameters for /api/capabilities/export.
export interface ExportOptions {
  format: ExportFormat;
  includeMetrics: boolean;
  includeSource: boolean;
  fontSizePx: number;
  formatDate: boolean;
}

// -----------------------------------------------------------------------
// Specs API — minimal CRUD (FR1)
// -----------------------------------------------------------------------

export const specsApi = {
  list: (projectId: number) =>
    request<{ specs: Spec[] }>(`/specs?projectId=${projectId}`).then((r) => r.specs),

  get: (id: number) => request<{ spec: Spec }>(`/specs/${id}`).then((r) => r.spec),

  create: (body: { projectId: number; task_id: number | null; goal: string; prd: string; kind?: string; status?: string }) =>
    request<{ spec: Spec }>(`/specs`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.spec),

  update: (id: number, body: { goal?: string; prd?: string; status?: string; kind?: string }) =>
    request<{ spec: Spec }>(`/specs/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.spec),

  delete: (id: number) => request<{ ok: boolean }>(`/specs/${id}`, { method: 'DELETE' }),
};

// -----------------------------------------------------------------------
// Capabilities API — FR1, FR2, FR5
// -----------------------------------------------------------------------

/** Fetch a rollup capability for a spec: overview navigation nodes+edges + drill target (sections+related tasks).
 * GET /api/capabilities/:id (id = specId)
 */
export interface CapabilitiesListResponse {
  nodes: CapabilityNode[];
  tags: string[];
}

export const capabilitiesApi = {
  /** GET /api/capabilities?projectId=123 returns a cached, filtered set of nodes that make sense to compromise into a graph. */
  list: (projectId: number) =>
    request<CapabilitiesListResponse>(`/capabilities?projectId=${projectId}`).then((r) => r),

  /**
   * GET /api/capabilities/:id/drill (id = specId)
   * Returns a CapabilityRollup per spec: spec + metrics + hierarchical sections + nodes + relationships for graph rendering.
   */
  drill: (id: number) =>
    request<CapabilityRollup>(`/capabilities/${id}/drill`).then((r) => r),

  export: (id: number, options: ExportOptions) =>
    // Content-Type: multipart/form-data; export content is returned as a Blob.
    fetch(`${base}/capabilities/${id}/export`, {
      method: 'POST',
      headers: { ...attachHeaders(), 'Content-Type': 'multipart/form-data' },
      body: toFileLike(opts, 'options.json').then((o) => {
        const fd = new FormData();
        fd.append('options', o);
        return fd;
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Export failed: ${res.status}`);
        if (!res.body) throw new Error('No response body');
        return res.blob();
      }),
};

// -----------------------------------------------------------------------
// PRDs API (legacy wrapper using specsApi) — optional backup route.
// -----------------------------------------------------------------------

/** Optionally exported alias for legacy PRDs API (FR3 rollup shard). */
export const prdsApi = {
  list: (projectId: number) => specsApi.list(projectId),
  get: (id: number) => specsApi.get(id),
  create: (body: { projectId: number; goal: string; prd: string; status?: string }) =>
    specsApi.create({ ...body, kind: 'prd', status: body.status ?? 'draft' }),
  update: (id: number, body: { goal?: string; prd?: string; status?: string }) => specsApi.update(id, body),
  delete: (id: number) => specsApi.delete(id),
};

// -----------------------------------------------------------------------
// Agents (projects & tasks)
// -----------------------------------------------------------------------

export const projectAgents = {
  list: (projectId: number) =>
    request<{ agents: ProjectAgent[] }>(`/project-agents?projectId=${projectId}`).then((r) => r.agents),

  add: (body: { projectId: number; agentKind: AgentKind; agentRef: string; name: string; role?: string }) =>
    request<{ agent: ProjectAgent }>(`/project-agents`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.agent),

  remove: (agentRef: string) =>
    request<{ ok: boolean }>(`/project-agents/${agentRef}`, { method: 'DELETE' }),
};

export const taskAgents = {
  list: (taskId: number) =>
    request<{ agents: ProjectAgent[] }>(`/task-agents?taskId=${taskId}`).then((r) => r.agents),

  add: (body: { taskId: number; agentKind: AgentKind; agentRef: string; name: string; role?: string }) =>
    request<{ agent: ProjectAgent }>(`/task-agents`, {
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.agent),

  remove: (taskId: number, agentRef: string) =>
    request<{ ok: boolean }>(`/task-agents`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId, agentRef }),
    }),
};

// -----------------------------------------------------------------------
// Tasks
// -----------------------------------------------------------------------

export interface Ticket {
  id: number;
  projectId: number;
  title: string;
  description: string;
  status: string;
  priority: string | null;
  dueDate: string | null;
  taskType: string | null;
  parentTaskId: number | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
  archived: boolean;
}

export interface ProjectTickets {
  projectId: number;
  tickets: Ticket[];
}

// -----------------------------------------------------------------------
// Workflows
// -----------------------------------------------------------------------

export interface Workflow {
  id: string;
  name: string;
  status: string;
  type: string;
  project: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowGraph {
  workflowId: string;
  status: string;
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export const workflows = {
  list: (params?: { status?: string; workflowType?: string; agentHostId?: number; projectId?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.workflowType) q.set('workflowType', params.workflowType);
    if (params?.agentHostId != null) q.set('agentHostId', String(params.agentHostId));
    if (params?.projectId != null) q.set('projectId', String(params.projectId));
    const query = q.toString();
    return request<{ workflows: Workflow[] }>(
      `/workflows${query ? `?${query}` : ''}`
    ).then((r) => r.workflows);
  },
  get: (id: string) => request<Workflow>(`/workflows/${id}`),
  getGraph: (id: string) => request<WorkflowGraph>(`/workflows/${id}/graph`),
};

// -----------------------------------------------------------------------
// Evermind BUILD-step node kinds — a client-side SUPERSET of the server's node
// kinds. Each string equals an engine workflow step `type` (see
// `@seanhogg/builderforce-memory` steps.ts), so a build graph compiles 1:1 to a
// `WorkflowConfig` and runs IN-BROWSER via `runWorkflow` (see lib/evermindBuild.ts)
// — it is NOT dispatched through the server agentic orchestrator. The graph still
// persists as opaque JSON through the normal save endpoints; the server union
// (api/src/domain/workflowGraph.ts) intentionally does NOT list these.
export type EvermindBuildKind =
  | 'train-tokenizer'
  | 'dataset-quality'
  | 'train-model'
  | 'convergence'
  | 'evaluate'
  | 'generate-check'
  | 'benchmark'
  | 'roundtrip'
  | 'export'
  | 'distill-corpus'
  | 'code-parse-check'
  | 'code-eval'
  | 'code-benchmark';

export type WorkflowNodeKind =
  | 'trigger'
  | 'agent'
  | 'llm'
  | 'mcp'
  | 'memory'
  | 'knowledge'
  | 'train'
  | 'transform'
  | 'filter'
  | 'branch'
  | 'output'
  | EvermindBuildKind;

export interface WorkflowDefNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  position: { x: number; y: number };
  config: Record<string, unknown>;
}

export interface WorkflowDefEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDefinitionGraph {
  nodes: WorkflowDefNode[];
  edges: WorkflowDefEdge[];
}

export type WorkflowRuntime = 'host' | 'cloud';

/**
 * Where a workflow runs: a self-hosted agentHost OR a builderforce cloud agent.
 */
export interface WorkflowRunTarget {
  runtime: WorkflowRuntime;
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
}

/** The run targets a workflow can execute on (for the builder's selector). */
export interface WorkflowRunTargets {
  hosts: Array<{ id: number; name: string; status: string }>;
}

/** Flow definition endpoint: return graph + flags and punch. */
export interface FlowDefGraph extends WorkflowDefinitionGraph {
  typedBy: opinionated;
  genCode: boolean; // Should generator walk branch.Type.to_text recursively?
}

/** External integration sync summaries for PRD rollup. */

export interface PRDRollupSyncSummary {
  specId: number;
  goal: string;
  status: SpecStatus;
  syncedBranch?: string | null;
  lastSyncedAt?: string | null;
}

export interface PRDRollupGitSync {
  specId: number;
  specification: string;
  rolledUpPrd?: string | null;
}

// -----------------------------------------------------------------------
// Brain chat trace
// -----------------------------------------------------------------------

/** A persisted run-trace row as returned by GET /api/brain/chats/:id/trace. */
export interface BrainChatTraceRow {
  id: number;
  turnSeq: number | null;
  kind: string;
  label: string | null;
  argsJson: string | null;
  resultJson: string | null;
  isError: boolean;
  durationMs: number | null;
  ttftMs: number | null;
  createdAt: string;
}

/** A run-trace event to persist via POST /api/brain/chats/:id/trace. */
export interface BrainChatTraceEventInput {
  kind: string;
  label?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  ttftMs?: number;
  turnSeq?: number;
}

/** Per-chat client cache for the persisted trace GET (cleared on append). */
const brainTraceCache = new Map<number, BrainChatTraceRow[]>();

/** A work-item kind a chat can be tied to (planning spine + roadmap + spec + gap). */
export type TicketKind = 'portfolio' | 'objective' | 'initiative' | 'roadmap' | 'spec' | 'epic' | 'gap' | 'task';

/** A chat ↔ ticket link with a live health summary. */
export interface ChatTicketLink {
  linkId: number;
  kind: TicketKind;
  ref: string;
  label: string;
  status: string;
  progressPct: number;
  done: number;
  total: number;
  exists: boolean;
  linkType: 'linked' | 'created';
  createdBy: string | null;
  createdAt: string;
}

/** A chat that references a ticket (lineage row). */
export interface LinkedChatRef {
  chatId: number;
  title: string;
  linkType: 'linked' | 'created';
  projectId: number | null;
  createdAt: string;
  updatedAt: string;
  isArchived: boolean;
  mergedIntoChatId: number | null;
}

/** A human member of a chat (shared access / audience, migration 0288). */
export interface ChatMemberInfo {
  id: number;
  userId: string | null;
  name: string;
  email: string;
  status: string;
  role: string;
}

/** An agent invited into a chat (an agent_assignments row, scope='chat'). */
export interface ChatAgentAssignment {
  id: number;
  agentRef: string;
  chatId: number;
  role: string;
  scope: string;
  createdAt: string;
}