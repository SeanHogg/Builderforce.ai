/**
 * API client for api.builderforce.ai app endpoints:
 * Brain (chats, messages), AgentHosts (list, register).
 * Uses tenant JWT from auth.
 */

import {
  AUTH_API_URL,
  checkUnauthorizedAndRedirect,
  getStoredTenantToken,
  getStoredWebToken,
} from './auth';
import { planLimitErrorFromResponse } from './planLimitError';
import { dispatchApiError } from './errors/apiErrorEvent';

/**
 * Surface a non-ok response as the global error toast (so failures like a board
 * move 500 are visible and copyable instead of failing silently) and throw.
 * Shared by request()/webRequest() so both paths report errors identically.
 */
async function throwApiError(res: Response, method: string, path: string): Promise<never> {
  const body = await res.json().catch(() => ({})) as { error?: string; code?: string; details?: unknown };
  const message = body.error || res.statusText || `Request failed (${res.status})`;
  dispatchApiError({
    method: (method || 'GET').toUpperCase(),
    url: `${AUTH_API_URL}${path}`,
    status: res.status,
    code: body.code,
    message,
    details: body.details,
    requestId: res.headers.get('x-request-id') ?? undefined,
  });
  throw new Error(message);
}

function authHeaders(): Record<string, string> {
  const token = getStoredTenantToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function webAuthHeaders(): Record<string, string> {
  const token = getStoredWebToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function webRequest<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = webAuthHeaders();
  const hadToken = !!headers.Authorization;
  const res = await fetch(`${AUTH_API_URL}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers as Record<string, string>) },
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) await throwApiError(res, (opts.method as string) ?? 'GET', path);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const headers = authHeaders();
  const hadToken = !!headers.Authorization;
  const res = await fetch(`${AUTH_API_URL}${path}`, {
    ...opts,
    headers: { ...headers, ...(opts.headers as Record<string, string>) },
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) await throwApiError(res, (opts.method as string) ?? 'GET', path);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Diagnostics & Tools (generic engine)
// ---------------------------------------------------------------------------

import type {
  ToolSummary, ToolDefinition, ToolResult, SavedToolRun, ProjectScore, TenantDiagnosticsRollup,
} from './tools';

export const toolsApi = {
  /** Public — list all free tools. */
  list: (): Promise<ToolSummary[]> =>
    webRequest<{ tools: ToolSummary[] }>('/api/tools').then((r) => r.tools),

  /** Public — a tool's full definition (inputs / questions). */
  get: (id: string): Promise<ToolDefinition> =>
    webRequest<{ tool: ToolDefinition }>(`/api/tools/${encodeURIComponent(id)}`).then((r) => r.tool),

  /** Public — free compute (no account). */
  compute: (id: string, input: Record<string, number>): Promise<ToolResult> =>
    webRequest<{ result: ToolResult }>(`/api/tools/${encodeURIComponent(id)}/compute`, {
      method: 'POST', body: JSON.stringify({ input }),
    }).then((r) => r.result),

  /** Save a self-assessment / calculator run (manager+). Pass projectId to score
   *  the run against a project (feeds its diagnostic rating). */
  save: (id: string, input: Record<string, number>, projectId?: number | null): Promise<SavedToolRun> =>
    request<{ run: SavedToolRun }>(`/api/tools/${encodeURIComponent(id)}/save`, {
      method: 'POST', body: JSON.stringify({ input, kind: 'self', projectId: projectId ?? null }),
    }).then((r) => r.run),

  /** Data-driven ("from your data") result, telemetry-derived (manager+). Optional
   *  projectId scopes it to one project. */
  dataDriven: (id: string, days = 90, projectId?: number | null): Promise<{ result: ToolResult; days: number }> => {
    const q = new URLSearchParams({ days: String(days) });
    if (projectId != null) q.set('projectId', String(projectId));
    return request<{ result: ToolResult; days: number }>(`/api/tools/${encodeURIComponent(id)}/data-driven?${q.toString()}`);
  },

  /** Save a data-driven snapshot (recomputed server-side; manager+). */
  saveData: (id: string, days = 90, projectId?: number | null): Promise<SavedToolRun> =>
    request<{ run: SavedToolRun }>(`/api/tools/${encodeURIComponent(id)}/save`, {
      method: 'POST', body: JSON.stringify({ input: { days }, kind: 'data', projectId: projectId ?? null }),
    }).then((r) => r.run),

  /** Saved run history for a tool (manager+). Optional projectId filter. */
  runs: (id: string, projectId?: number | null): Promise<SavedToolRun[]> => {
    const q = projectId != null ? `?projectId=${projectId}` : '';
    return request<{ runs: SavedToolRun[] }>(`/api/tools/${encodeURIComponent(id)}/runs${q}`).then((r) => r.runs);
  },

  /** A project's diagnostic rating + per-diagnostic latest scores (manager+). */
  projectScore: (projectId: number): Promise<ProjectScore> =>
    request<ProjectScore>(`/api/tools/projects/${projectId}/score`),

  /** Project diagnostic ratings rolled up to the workspace (manager+). */
  rollup: (): Promise<TenantDiagnosticsRollup> =>
    request<TenantDiagnosticsRollup>('/api/tools/rollup'),
};

// ---------------------------------------------------------------------------
// Projects — key availability check
// ---------------------------------------------------------------------------

export async function checkProjectKeyAvailable(key: string, excludeProjectId?: number): Promise<{ available: boolean; key: string }> {
  const params = new URLSearchParams({ key: key.trim().toUpperCase() });
  if (excludeProjectId != null) params.set('excludeId', String(excludeProjectId));
  return request<{ available: boolean; key: string }>(`/api/projects/check-key?${params}`);
}

// ---------------------------------------------------------------------------
// Brain (Brain Storm)
// ---------------------------------------------------------------------------

export interface BrainChat {
  id: number;
  title: string;
  projectId: number | null;
  /** Where the chat was created: 'brainstorm' | 'ide' | 'project'. Tells the page which tools to load. */
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BrainMessage {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
}

export const brain = {
  listChats: (params?: { projectId?: string; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.projectId) q.set('projectId', params.projectId);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    const query = q.toString();
    return request<{ chats: BrainChat[] }>(`/api/brain/chats${query ? `?${query}` : ''}`).then((r) => r.chats);
  },

  createChat: (body: { title?: string; projectId?: number | null }) =>
    request<BrainChat>('/api/brain/chats', { method: 'POST', body: JSON.stringify(body) }),

  getChat: (id: number) => request<BrainChat>(`/api/brain/chats/${id}`),

  updateChat: (id: number, body: { title?: string; projectId?: number | null }) =>
    request<BrainChat>(`/api/brain/chats/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteChat: (id: number) =>
    request<{ archived: boolean }>(`/api/brain/chats/${id}`, { method: 'DELETE' }),

  /** Summarize chat and store summary on the chat. Returns { summary } or { error }. */
  summarizeChat: (chatId: number) =>
    request<{ summary: string } | { error: string }>(`/api/brain/chats/${chatId}/summarize`, { method: 'POST' }),

  getMessages: (chatId: number, limit?: number) => {
    const q = limit != null ? `?limit=${limit}` : '';
    return request<{ messages: BrainMessage[] }>(`/api/brain/chats/${chatId}/messages${q}`).then((r) => r.messages);
  },

  sendMessages: (chatId: number, messages: Array<{ role: string; content: string; metadata?: string }>) =>
    request<{ messages: BrainMessage[] }>(`/api/brain/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
    }).then((r) => r.messages),

  /** Set thumbs up/down on a message. feedback: 'up' | 'down' | null. */
  setMessageFeedback: (messageId: number, feedback: 'up' | 'down' | null) =>
    request<{ ok: boolean }>(`/api/brain/messages/${messageId}/feedback`, {
      method: 'PATCH',
      body: JSON.stringify({ feedback }),
    }),

  /** Upload a file for use as an attachment in chat. Returns key, name, type. */
  upload: async (file: File): Promise<{ key: string; name: string; type: string }> => {
    const token = getStoredTenantToken();
    const hadToken = !!token;
    const form = new FormData();
    form.append('file', file);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${AUTH_API_URL}/api/brain/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    checkUnauthorizedAndRedirect(res, hadToken);
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error || res.statusText || 'Upload failed');
    }
    const data = (await res.json()) as { key: string; name: string; type: string };
    return data;
  },

  /** URL to view/download an uploaded file by key. */
  uploadUrl: (key: string) => `${AUTH_API_URL}/api/brain/uploads/${key}`,

  /**
   * Mint a short-lived signed public URL for an uploaded object so an upstream
   * LLM provider can fetch it (vision). Used only for an image too large to
   * inline as a data URL — see brain-embedded's image prep.
   */
  signedUploadUrl: async (key: string): Promise<string> => {
    const { exp, sig } = await request<{ exp: number; sig: string }>('/api/brain/uploads/sign', {
      method: 'POST',
      body: JSON.stringify({ key }),
    });
    return `${AUTH_API_URL}/api/brain-files/${key}?exp=${exp}&sig=${encodeURIComponent(sig)}`;
  },
};

/** Structured error from the LLM gateway, with the fields callers branch on. */
export type LlmError = Error & { status?: number; code?: string; body?: Record<string, unknown> };

/**
 * Parse a non-OK response from `/llm/v1/chat/completions` into an Error.
 * Single source of truth shared by `llmChat` and `streamChatCompletion`.
 *
 * 402 (plan limit) becomes a `PlanLimitError` so callers can show the upgrade
 * modal. Two other envelope shapes are handled and their structured fields
 * preserved on the Error so callers can branch on `.code` / `.body`:
 *   1. Gateway-side (e.g. plan_token_limit_exceeded, idempotent_replay,
 *      cascade_exhausted): { error: "...message...", code, ...fields }
 *   2. Upstream OpenAI-shaped passthrough: { error: { message, type, code } }
 */
export async function parseLlmError(res: Response): Promise<Error> {
  if (res.status === 402) return planLimitErrorFromResponse(res);
  const body = await res.json().catch(() => ({})) as Record<string, unknown>;
  const errVal = body.error;
  const msg = typeof errVal === 'string'
    ? errVal
    : (errVal && typeof errVal === 'object' && 'message' in errVal
        ? String((errVal as { message?: unknown }).message ?? '')
        : '');
  const err = new Error(msg || res.statusText || 'LLM request failed') as LlmError;
  err.status = res.status;
  err.code = typeof body.code === 'string' ? body.code : undefined;
  err.body = body;
  return err;
}

/** OpenAI-compatible chat completion (uses tenant JWT for billing).
 *  Default model is `openai/gpt-4o-mini` — cheap and fast for ambient calls.
 *  Pass `model` for tasks that need stronger instruction-following (e.g.
 *  structured prompt generation, multi-rule analysis). */
export async function llmChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { temperature?: number; maxTokens?: number; model?: string }
): Promise<{ content: string }> {
  const headers = authHeaders();
  const hadToken = !!headers.Authorization;
  const res = await fetch(`${AUTH_API_URL}/llm/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: options?.model ?? 'openai/gpt-4o-mini',
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (!res.ok) throw await parseLlmError(res);
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  return { content };
}

// ---------------------------------------------------------------------------
// AgentHosts (Workforce / Agent registration)
// ---------------------------------------------------------------------------

export interface AgentHost {
  id: number;
  name: string;
  tenantId: number;
  slug?: string;
  status?: string;
  apiKeyHash?: string;
  /**
   * Canonical liveness from the API: holds a relay connection AND heartbeat is
   * fresh. Prefer this over `connectedAt` for online/offline UI — connectedAt
   * can stay set forever if a host dies without cleanly closing its socket.
   */
  online?: boolean;
  connectedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgentHostRegistration extends AgentHost {
  apiKey: string;
}

export const agentHosts = {
  list: () => request<{ agentHosts: AgentHost[] }>('/api/agent-hosts').then((r) => r.agentHosts),

  register: (name: string) =>
    request<{ agentHost: AgentHost; apiKey: string }>('/api/agent-hosts', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim() }),
    }).then((r) => ({ ...r.agentHost, apiKey: r.apiKey } as AgentHostRegistration)),

  /** Deregister (delete) a remote agentHost. Revokes its API key server-side. */
  deregister: (agentHostId: number) =>
    request<void>(`/api/agent-hosts/${agentHostId}`, { method: 'DELETE' }),

  /** WebSocket URL for agentHost relay (gateway). Pass tenant token via ?token=. */
  wsUrl: (agentHostId: number): string => {
    const base = (AUTH_API_URL || '').replace(/^http/, 'ws');
    const token = getStoredTenantToken();
    return `${base}/api/agent-hosts/${agentHostId}/ws?token=${encodeURIComponent(token || '')}`;
  },

  /** Tool audit events for timeline/observability. */
  toolAuditEvents: (
    agentHostId: number,
    params?: { runId?: string; sessionKey?: string; limit?: number }
  ) => {
    const q = new URLSearchParams();
    if (params?.runId) q.set('runId', params.runId);
    if (params?.sessionKey) q.set('sessionKey', params.sessionKey);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const query = q.toString();
    return request<{ events: ToolAuditEvent[] }>(
      `/api/agent-hosts/${agentHostId}/tool-audit${query ? `?${query}` : ''}`
    ).then((r) => r.events);
  },
};

export interface ToolAuditEvent {
  id: number;
  runId?: string | null;
  sessionKey?: string | null;
  toolCallId?: string | null;
  toolName: string;
  category?: string | null;
  args?: string | null;
  result?: string | null;
  durationMs?: number | null;
  /** Set on cloud-agent telemetry rows — the execution this event belongs to. */
  executionId?: number | null;
  ts: string;
}

/**
 * Cloud agents (ide_agents) — server-side runs via the gateway. Unlike self-hosted
 * hosts they have no relay log stream, but they DO push tool-audit telemetry
 * (migration 0092), so the Observability timeline treats them as first-class.
 */
export interface CloudAgentRef {
  /** ide_agents.id, or the '__default__' sentinel for gateway-default runs. */
  ref: string;
  name: string;
}

export const cloudAgents = {
  /** Cloud agents that have actually run (distinct telemetry refs) — drives the
   *  Observability directory so every cloud run is attributable, incl. default. */
  list: () =>
    request<{ agents: CloudAgentRef[] }>(`/api/runtime/cloud-agents`).then((r) => r.agents),

  /** Tool-audit events for one cloud agent (by ide_agents.id), newest first.
   *  Pass executionId to scope to a single run (precise per-execution telemetry). */
  toolAuditEvents: (ref: string, params?: { limit?: number; executionId?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.executionId != null) q.set('executionId', String(params.executionId));
    const query = q.toString();
    return request<{ events: ToolAuditEvent[] }>(
      `/api/runtime/agents/${encodeURIComponent(ref)}/tool-audit${query ? `?${query}` : ''}`
    ).then((r) => r.events);
  },
};

export interface Workflow {
  id: string;
  agentHostId: number;
  /** Optional project this workflow belongs to (null = tenant-wide). */
  projectId?: number | null;
  specId?: string | null;
  workflowType: string;
  status: string;
  description?: string | null;
  createdAt: string;
  completedAt?: string | null;
  updatedAt: string;
  tasks?: WorkflowTask[];
  /** Enriched by the list endpoint for card display (joins). */
  projectName?: string | null;
  agentHostName?: string | null;
}

export interface WorkflowTask {
  id: string;
  workflowId: string;
  agentRole: string;
  description: string;
  status: string;
  input?: string | null;
  output?: string | null;
  error?: string | null;
  dependsOn?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowGraphNode {
  id: string;
  label: string;
  role: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
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

export const workflows = {
  list: (params?: { status?: string; workflowType?: string; agentHostId?: number; projectId?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.workflowType) q.set('workflowType', params.workflowType);
    if (params?.agentHostId != null) q.set('agentHostId', String(params.agentHostId));
    if (params?.projectId != null) q.set('projectId', String(params.projectId));
    const query = q.toString();
    return request<{ workflows: Workflow[] }>(
      `/api/workflows${query ? `?${query}` : ''}`
    ).then((r) => r.workflows);
  },
  get: (id: string) => request<Workflow>(`/api/workflows/${id}`),
  getGraph: (id: string) => request<WorkflowGraph>(`/api/workflows/${id}/graph`),
};

// ---------------------------------------------------------------------------
// Workflow definitions — the visually-authored agentic workflow graphs produced
// by the builder canvas. Mirrors api/src/domain/workflowGraph.ts (no shared
// package in this repo — keep the two in sync, same as Workflow/WorkflowTask).
// ---------------------------------------------------------------------------

export type WorkflowNodeKind =
  | 'trigger' | 'agent' | 'llm' | 'mcp' | 'memory' | 'knowledge' | 'train'
  | 'transform' | 'filter' | 'branch' | 'output';

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

/** Where a workflow runs: a self-hosted agentHost OR a builderforce cloud agent. */
export interface WorkflowRunTarget {
  runtime: WorkflowRuntime;
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
}

/** The run targets a workflow can execute on (for the builder's selector). */
export interface WorkflowRunTargets {
  hosts: Array<{ id: number; name: string; status: string }>;
  cloudAgents: Array<{ ref: string; name: string }>;
}

/** Persisted run-target columns, surfaced on definition records. */
export interface WorkflowRunTargetFields {
  runTargetRuntime: WorkflowRuntime;
  runTargetAgentHostId: number | null;
  runTargetCloudAgentRef: string | null;
  /** 'project' = runs under the bound project; 'global' = tenant-wide. */
  executionScope: 'project' | 'global';
}

/** Activation state of one materialized trigger (for the builder's inspector). */
export interface WorkflowTriggerInfo {
  nodeId: string;
  triggerType: 'schedule' | 'webhook' | 'rss' | 'inbound-email';
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  webhookUrl: string | null;
  emailAddress: string | null;
  hasSecret: boolean;
}

/** List-row shape (graph omitted for the index). Enriched by the list endpoint
 *  with the bound project + run-target agent so each row reads like a project. */
export interface WorkflowDefinitionSummary {
  id: string;
  name: string;
  description?: string | null;
  /** Bound project (null = tenant-wide / independent). */
  projectId?: number | null;
  projectName?: string | null;
  /** 'project' = scoped to projectId; 'global' = tenant-wide. */
  executionScope?: 'project' | 'global';
  /** Run-target runtime + resolved display name of the assigned agent. */
  runTargetRuntime?: WorkflowRuntime;
  runTargetAgentHostId?: number | null;
  runTargetCloudAgentRef?: string | null;
  agentName?: string | null;
  /** Execution history rollup (live, not cached): total runs + most recent. */
  runCount?: number;
  lastRunStatus?: string | null;
  lastRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Full record incl. the parsed graph + persisted run target. */
export interface WorkflowDefinitionDetail extends WorkflowDefinitionSummary, Partial<WorkflowRunTargetFields> {
  definition: WorkflowDefinitionGraph;
}

/** Project binding accepted on create/update (null = tenant-wide). */
type WorkflowProjectBinding = { projectId?: number | null };

export const workflowDefinitions = {
  list: () =>
    request<{ definitions: WorkflowDefinitionSummary[] }>('/api/workflow-definitions').then((r) => r.definitions),
  get: (id: string) => request<WorkflowDefinitionDetail>(`/api/workflow-definitions/${id}`),
  /** Execution history (runs) for one definition, newest first. */
  runs: (id: string) =>
    request<{ runs: Workflow[] }>(`/api/workflow-definitions/${id}/runs`).then((r) => r.runs),
  /** The targets a workflow can run on: self-hosted agentHosts + cloud agents. */
  runTargets: () => request<WorkflowRunTargets>('/api/workflow-definitions/run-targets'),
  /** Activatable triggers + their activation state (webhook URL, next run, …). */
  triggers: (id: string) =>
    request<{ triggers: WorkflowTriggerInfo[] }>(`/api/workflow-definitions/${id}/triggers`).then((r) => r.triggers),
  create: (body: { name: string; description?: string; definition?: WorkflowDefinitionGraph } & WorkflowProjectBinding & Partial<WorkflowRunTargetFields>) =>
    request<WorkflowDefinitionSummary>('/api/workflow-definitions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (id: string, body: { name?: string; description?: string; definition?: WorkflowDefinitionGraph } & WorkflowProjectBinding & Partial<WorkflowRunTargetFields>) =>
    request<WorkflowDefinitionDetail>(`/api/workflow-definitions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    request<{ ok: boolean }>(`/api/workflow-definitions/${id}`, { method: 'DELETE' }),
  run: (id: string, target: WorkflowRunTarget) =>
    request<{ workflowId: string; taskCount: number }>(`/api/workflow-definitions/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(target),
    }),
  /** Export a definition as YAML text (for download / hand-editing). */
  exportYaml: async (id: string): Promise<string> => {
    const res = await fetch(`${AUTH_API_URL}/api/workflow-definitions/${id}/export`, { headers: authHeaders() });
    if (!res.ok) throw new Error('Export failed');
    return res.text();
  },
  /** Create a definition from a hand-authored YAML/JSON document. */
  importYaml: (name: string, yaml: string) =>
    request<WorkflowDefinitionSummary>('/api/workflow-definitions/import', {
      method: 'POST',
      body: JSON.stringify({ name, yaml }),
    }),
};

/** Tenant default agentHost (for workforce "Set as default"). */
export const tenantDefaultAgentHost = {
  get: (tenantId: number) =>
    request<{ defaultAgentHostId: number | null }>(`/api/tenants/${tenantId}/default-agentHost`).then((r) => r.defaultAgentHostId),
  set: (tenantId: number, agentHostId: number | null) =>
    request<{ defaultAgentHostId: number | null }>(`/api/tenants/${tenantId}/default-agentHost`, {
      method: 'PUT',
      body: JSON.stringify({ agentHostId }),
    }).then((r) => r.defaultAgentHostId),
};

// ---------------------------------------------------------------------------
// Marketplace (skills catalog – public read)
// ---------------------------------------------------------------------------

export interface MarketplaceSkill {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  category: string | null;
  tags: string[] | null;
  version: string | null;
  icon_url: string | null;
  repo_url: string | null;
  downloads: number;
  likes: number;
  created_at: string;
  author_username?: string;
  author_display_name?: string;
  author_avatar_url?: string;
}

/** List published marketplace skills (public, no auth required). */
export async function listMarketplaceSkills(params?: {
  category?: string;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<{ skills: MarketplaceSkill[]; total: number; page: number; limit: number }> {
  const q = new URLSearchParams();
  if (params?.category) q.set('category', params.category);
  if (params?.q) q.set('q', params.q);
  if (params?.page != null) q.set('page', String(params.page));
  if (params?.limit != null) q.set('limit', String(params.limit));
  const query = q.toString();
  const res = await fetch(`${AUTH_API_URL}/marketplace/skills${query ? `?${query}` : ''}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || res.statusText || 'Request failed');
  }
  const data = (await res.json()) as {
    skills: MarketplaceSkill[];
    total: number;
    page: number;
    limit: number;
  };
  return data;
}

// ---------------------------------------------------------------------------
// Artifact assignments (skills, personas, content → tenant/agentHost/project/task/agent)
// ---------------------------------------------------------------------------

export type ArtifactType = 'skill' | 'persona' | 'content';
export type AssignmentScope = 'tenant' | 'host' | 'project' | 'task' | 'agent';

export interface ArtifactAssignment {
  tenantId: number;
  artifactType: ArtifactType;
  artifactSlug: string;
  scope: AssignmentScope;
  scopeId: number;
  assignedBy: string | null;
  config: string | null;
  assignedAt: string;
}

/** An assigned artifact with its display name (null when unpublished / nameless). */
export interface NamedArtifact {
  slug: string;
  name: string | null;
}

/** The capabilities pinned directly to one agent (its agent-scoped assignments). */
export interface AgentManifest {
  skills: NamedArtifact[];
  personas: NamedArtifact[];
  content: NamedArtifact[];
}

/** Psychometric persona catalog + scoring (Pro feature). */
export const psychometric = {
  catalog: () => request<import('./psychometric').PsychometricCatalog>(`/api/personas/psychometric/catalog`),
  score: (answers: Record<string, number>) =>
    request<{ vector: Record<string, number>; source: string }>(`/api/personas/psychometric/score`, {
      method: 'POST',
      body: JSON.stringify({ answers }),
    }),
  import: (vector: Record<string, number>) =>
    request<{ vector: Record<string, number>; source: string }>(`/api/personas/psychometric/import`, {
      method: 'POST',
      body: JSON.stringify({ vector }),
    }),
};

export const artifactAssignments = {
  list: (scope: AssignmentScope, scopeId: number, artifactType?: ArtifactType) => {
    const q = new URLSearchParams({ scope: String(scope), scopeId: String(scopeId) });
    if (artifactType) q.set('artifactType', artifactType);
    return request<{ assignments: ArtifactAssignment[] }>(`/api/artifact-assignments?${q}`).then((r) => r.assignments);
  },

  /** Per-agent assigned-capability manifests for every workforce agent of the tenant,
   *  keyed by the agent's ref (= PublishedAgent.id). Powers the /workforce cards. */
  agentManifests: () =>
    request<{ manifests: Record<string, AgentManifest> }>(`/api/artifact-assignments/agent-manifests`).then((r) => r.manifests),

  assign: (
    artifactType: ArtifactType,
    artifactSlug: string,
    scope: AssignmentScope,
    scopeId: number,
    config?: string
  ) =>
    request<{ ok: boolean }>('/api/artifact-assignments', {
      method: 'POST',
      body: JSON.stringify({ artifactType, artifactSlug, scope, scopeId, config }),
    }),

  unassign: (
    artifactType: ArtifactType,
    artifactSlug: string,
    scope: AssignmentScope,
    scopeId: number
  ) =>
    request<void>(
      `/api/artifact-assignments/${artifactType}/${encodeURIComponent(artifactSlug)}/${scope}/${scopeId}`,
      { method: 'DELETE' }
    ),
};

// ---------------------------------------------------------------------------
// Project agents (agents attached to a project; numeric id scopes per-agent
// skills/personas/content/governance)
// ---------------------------------------------------------------------------

/** An agent attached to a project. `agentRef` points back to its source agent. */
export interface ProjectAgent {
  id: number;
  tenantId: number;
  projectId: number;
  /** 'workforce' → PublishedAgent.id; 'registered' → agents.id (numeric, as string). */
  agentKind: 'workforce' | 'registered';
  agentRef: string;
  name: string;
  role: string;
  governance: string | null;
  addedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export const projectAgents = {
  list: (projectId: number) =>
    request<{ agents: ProjectAgent[] }>(`/api/project-agents?projectId=${projectId}`).then((r) => r.agents),

  add: (body: { projectId: number; agentKind: 'workforce' | 'registered'; agentRef: string; name: string; role?: string }) =>
    request<{ agent: ProjectAgent }>('/api/project-agents', {
      method: 'POST',
      body: JSON.stringify(body),
    }).then((r) => r.agent),

  remove: (id: number) =>
    request<void>(`/api/project-agents/${id}`, { method: 'DELETE' }),

  updateGovernance: (id: number, governance: string) =>
    request<{ agent: ProjectAgent }>(`/api/project-agents/${id}/governance`, {
      method: 'PUT',
      body: JSON.stringify({ governance }),
    }).then((r) => r.agent),
};

// ---------------------------------------------------------------------------
// Registered agents (tenant endpoint agents: claude/openai/ollama/http)
// ---------------------------------------------------------------------------

export interface RegisteredAgent {
  id: number;
  name: string;
  type: string;
  isActive: boolean;
}

export const registeredAgents = {
  list: () => request<RegisteredAgent[]>('/api/agents'),
};

// ---------------------------------------------------------------------------
// Marketplace stats (likes + install counts)
// ---------------------------------------------------------------------------

export interface ArtifactStats {
  likes: number;
  installs: number;
  liked: boolean;
}

export const marketplaceStats = {
  getStats: (type: ArtifactType, slugs: string[]) => {
    if (slugs.length === 0) return Promise.resolve({} as Record<string, ArtifactStats>);
    const q = new URLSearchParams({ type, slugs: slugs.join(',') });
    return request<{ stats: Record<string, ArtifactStats> }>(`/api/marketplace-stats/stats?${q}`).then((r) => r.stats);
  },

  toggleLike: (type: ArtifactType, artifactSlug: string) =>
    request<{ liked: boolean }>('/api/marketplace-stats/like', {
      method: 'POST',
      body: JSON.stringify({ artifactType: type, artifactSlug }),
    }).then((r) => r.liked),
};

// ---------------------------------------------------------------------------
// Tasks (full CRUD + ArtifactAssigner summary)
// ---------------------------------------------------------------------------

/**
 * Canonical default statuses. Tasks may hold any string (a swimlane key) on a
 * configurable board, so `Task.status` is typed `string`; this union is the
 * default vocabulary used for seeding and automation.
 */
export type TaskStatus =
  | 'backlog'
  | 'todo'
  | 'ready'
  | 'in_progress'
  | 'in_review'
  | 'done'
  | 'blocked';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Task {
  id: number;
  projectId: number;
  key: string;
  title: string;
  description: string | null;
  /** Free-form lane key (board column). The canonical defaults are {@link TaskStatus}. */
  status: string;
  priority: TaskPriority;
  /** Fixed type dimension: a plain task or an Epic (planning container with children). */
  taskType: 'task' | 'epic';
  /** Parent Epic's id (null for top-level tasks). Set when grouped under an Epic. */
  parentTaskId: number | null;
  /** sprints.id this task is scheduled into, or null when unscheduled (backlog). */
  sprintId: string | null;
  assignedAgentType: string | null;
  assignedAgentHostId: number | null;
  /** ide_agents.id of the cloud agent working this ticket (agents are assignees). */
  assignedAgentRef: string | null;
  /** Human assignee/owner (users.id). A task is owned by EITHER a human OR an agent. */
  assignedUserId: string | null;
  /** Git branch the agent executes this ticket under (links to the code changes). */
  gitBranch: string | null;
  /** project_repositories.id this task's runs are pinned to (null = auto-resolve). */
  explicitRepoId: string | null;
  githubPrUrl: string | null;
  githubPrNumber: number | null;
  startDate: string | null;
  dueDate: string | null;
  persona: string | null;
  archived: boolean;
  /** Count of linked PRDs (task_specs) — drives the board card's PRD indicator
   *  [1266]. Best-effort from GET /api/tasks; 0/absent where unknown. */
  specCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSummary {
  id: number;
  key?: string;
  title: string;
  projectId: number;
  status?: string;
}

export const tasksApi = {
  list: (projectId?: number, opts?: { includeArchived?: boolean }): Promise<Task[]> => {
    const params = new URLSearchParams();
    if (projectId != null) params.set('project_id', String(projectId));
    // Archived tasks are hidden by default; opt in only where the archive is the
    // subject (e.g. the delete-project dialog counts archived tasks to be purged).
    if (opts?.includeArchived) params.set('include_archived', 'true');
    const q = params.toString();
    return request<{ tasks: Task[] }>(`/api/tasks${q ? `?${q}` : ''}`).then((r) => r.tasks ?? []);
  },

  get: (id: number): Promise<Task> =>
    request<Task>(`/api/tasks/${id}`),

  create: (body: {
    projectId: number;
    title: string;
    description?: string | null;
    priority?: TaskPriority;
    assignedAgentHostId?: number | null;
    /** Cloud agent (ide_agents.id). Mutually exclusive with assignedAgentHostId. */
    assignedAgentRef?: string | null;
    /** Human assignee (users.id). Mutually exclusive with the agent assignees. */
    assignedUserId?: string | null;
    /** Create as an Epic (planning container) rather than a plain task. */
    taskType?: 'task' | 'epic';
    /** Create already nested under an Epic. */
    parentTaskId?: number | null;
    dueDate?: string | null;
  }): Promise<Task> =>
    request<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (
    id: number,
    body: Partial<{
      title: string;
      description: string | null;
      status: string;
      priority: TaskPriority;
      assignedAgentHostId: number | null;
      /** Cloud agent (ide_agents.id). Mutually exclusive with assignedAgentHostId. */
      assignedAgentRef: string | null;
      /** Human assignee (users.id). Mutually exclusive with the agent assignees. */
      assignedUserId: string | null;
      /** Reclassify between a plain task and an Epic. */
      taskType: 'task' | 'epic';
      /** Re-parent under an Epic (planning "drag into Epic"), or null to detach. */
      parentTaskId: number | null;
      /** Schedule into / out of a sprint (planning "drag onto sprint"). null = unscheduled. */
      sprintId: string | null;
      dueDate: string | null;
      archived: boolean;
    }>
  ): Promise<Task> =>
    request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: number): Promise<void> =>
    request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),

  /** An Epic and its direct child tasks (the planning tree). */
  tree: (id: number): Promise<{ epic: Task; children: Task[] }> =>
    request<{ epic: Task; children: Task[] }>(`/api/tasks/${id}/tree`),

  /** Turn a task into an Epic and fan the given children out as child tasks. */
  decompose: (
    id: number,
    children: Array<{
      title: string;
      description?: string | null;
      priority?: TaskPriority;
      assignedUserId?: string | null;
      assignedAgentHostId?: number | null;
      assignedAgentRef?: string | null;
    }>,
  ): Promise<{ epic: Task; children: Task[] }> =>
    request<{ epic: Task; children: Task[] }>(`/api/tasks/${id}/decompose`, {
      method: 'POST',
      body: JSON.stringify({ children }),
    }),

  /** Team members (humans) a task can be assigned to — the human half of the
   *  unified assignee picker (agents come from the run-targets / agent-host APIs). */
  assignees: (): Promise<{ id: string; name: string }[]> =>
    request<{ members: { id: string; name: string }[] }>('/api/tasks/assignees').then(
      (r) => r.members ?? [],
    ),

  /** Move a task to another project ("board"). Re-keys it to the destination's prefix. */
  move: (id: number, projectId: number): Promise<Task> =>
    request<Task>(`/api/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),

  /** All precedence edges in a project (the dependency graph). */
  dependencies: (projectId: number): Promise<DependencyEdge[]> =>
    request<{ dependencies: DependencyEdge[] }>(`/api/tasks/dependencies?project=${projectId}`).then(
      (r) => r.dependencies ?? [],
    ),

  /** Add an edge where `successorTaskId` depends on (is blocked by) `predecessorTaskId`.
   *  Rejects cross-project edges and cycles server-side (400 'would create a dependency cycle').
   *  `depType` defaults to finish_to_start. */
  addDependency: (successorTaskId: number, predecessorTaskId: number, depType?: DepType): Promise<DependencyEdge> =>
    request<DependencyEdge>(`/api/tasks/${successorTaskId}/dependencies`, {
      method: 'POST',
      body: JSON.stringify({ predecessorTaskId, depType }),
    }),

  /** Remove a precedence edge by id. */
  removeDependency: (edgeId: number): Promise<void> =>
    request<void>(`/api/tasks/dependencies/${edgeId}`, { method: 'DELETE' }),
};

/** Dependency edge semantics (mirrors the API's DEP_TYPES). */
export type DepType = 'finish_to_start' | 'start_to_start' | 'finish_to_finish' | 'start_to_finish';

/** A task precedence edge: predecessor must finish before successor can start. */
export interface DependencyEdge {
  id: number;
  projectId: number;
  predecessorTaskId: number;
  successorTaskId: number;
  depType: DepType;
  createdAt: string;
}

/** Runtime executions – submit tasks to agentHosts for agent execution. */
export interface Execution {
  id: number;
  taskId: number;
  status: string;
  agentHostId?: number | null;
  agentId?: number | null;
  /** Cloud agent (ide_agents.id) that ran THIS execution; null for host/default runs.
   *  Used to scope the run's logs/telemetry to the agent that actually ran it. */
  cloudAgentRef?: string | null;
  submittedBy?: string;
  submittedAt?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface AwaitingApprovalExecution {
  status: 'awaiting_approval';
  approvalId: string;
  taskId: number;
  reason: string;
}

export type SubmitExecutionResponse = Execution | AwaitingApprovalExecution;

export function isAwaitingApprovalExecution(
  value: SubmitExecutionResponse
): value is AwaitingApprovalExecution {
  return value.status === 'awaiting_approval';
}

export interface ExecutionTraceToolEvent {
  id: number;
  ts: string;
  toolName: string;
  category?: string;
  durationMs?: number;
  args?: string;
  result?: string;
  runId?: string;
  toolCallId?: string;
}

/** Whether a task's bound repo can actually receive the agent's commits. */
export interface TaskRepoStatus {
  bound: boolean;
  hasCredential: boolean;
  repo?: string;
  base?: string;
  reason?: string;
}

/** One file an agent created/modified/deleted in a task's shared workspace. */
export interface TaskFileChange {
  path: string;
  change: 'created' | 'modified' | 'deleted';
  agent: string;
  executionId: number | null;
  createdAt: string;
}

/**
 * A changed file's current (ticket branch) and base (fork point) contents, read
 * back from the repo so the Changes tab can render the diff in Monaco. `current`
 * is null for a deleted file, `base` is null for a newly created file; both are
 * null (with `bound: false`) when no repo/credential is wired for the task.
 */
export interface TaskFileContent {
  bound: boolean;
  path: string;
  reason?: string;
  branch?: string;
  baseBranch?: string;
  current: string | null;
  base: string | null;
  currentTruncated?: boolean;
  baseTruncated?: boolean;
}

/** One persisted turn of an execution's steering/chat thread (migration 0109). */
export interface ExecutionMessage {
  role: 'user' | 'assistant';
  text: string;
  ts: string;
}

export interface ExecutionTrace {
  execution: Execution;
  trace: {
    source: string;
    usageSnapshots: Array<{ id: number; ts: string; inputTokens: number; outputTokens: number; contextTokens: number }>;
    toolEvents: ExecutionTraceToolEvent[];
    /** Durable steering/chat thread — persisted user steers + assistant replies. */
    messages?: ExecutionMessage[];
  };
}

/** One currently-running (non-terminal) execution in the fleet. */
export interface ActiveRun {
  id: number;
  status: 'pending' | 'submitted' | 'running';
  taskId: number;
  taskTitle: string;
  agentHostId: number | null;
  cloudAgentRef: string | null;
  submittedBy: string;
  startedAt: string | null;
  createdAt: string;
  kind: 'cloud' | 'on-prem';
  elapsedMs: number | null;
}

export interface ActiveRunsResponse {
  active: ActiveRun[];
  /** Cloud agent refs with at least one in-flight run (for the "running" pill). */
  runningCloudRefs: string[];
}

export const runtimeApi = {
  /** Submit a task for execution. Dispatches to assigned agentHost or all connected agentHosts. */
  submitExecution: (body: {
    taskId: number;
    agentHostId?: number | null;
    sessionId?: string;
    payload?: string;
  }): Promise<SubmitExecutionResponse> =>
    request<SubmitExecutionResponse>('/api/runtime/executions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  /** Execution history for a task (newest first). */
  listForTask: (taskId: number): Promise<Execution[]> =>
    request<Execution[]>(`/api/runtime/tasks/${taskId}/executions`),

  /** Ticket-level spend (the finest grain in the ticket → project → account
   *  rollup): total estimated $, tokens, and LLM-call count for this task. */
  taskCost: (taskId: number): Promise<{ estimatedCostUsd: number; totalTokens: number; requests: number }> =>
    request<{ estimatedCostUsd: number; totalTokens: number; requests: number }>(`/api/runtime/tasks/${taskId}/cost`),

  /** Recent executions across the tenant (newest first) — used to surface which
   *  agent is actively running each task on the board. */
  listRecent: (limit = 200): Promise<Execution[]> =>
    request<Execution[]>(`/api/runtime/executions?limit=${limit}`),

  /** Fleet "what's running right now": every non-terminal execution, tagged with
   *  task title, the executing agent, and elapsed time. `runningCloudRefs` lets
   *  the UI mark a cloud agent as actively running. */
  listActive: (): Promise<ActiveRunsResponse> =>
    request<ActiveRunsResponse>(`/api/runtime/active`),

  get: (id: number): Promise<Execution> =>
    request<Execution>(`/api/runtime/executions/${id}`),

  /** Execution + usage snapshots + tool-call audit events. */
  trace: (id: number): Promise<ExecutionTrace> =>
    request<ExecutionTrace>(`/api/runtime/executions/${id}/trace`),

  /** Per-agent file-change traceability for a task's shared ticket workspace. */
  taskFileChanges: (taskId: number): Promise<{ changes: TaskFileChange[] }> =>
    request<{ changes: TaskFileChange[] }>(`/api/runtime/tasks/${taskId}/file-changes`),

  /** Current + base contents of one changed file, for the Changes-tab diff viewer. */
  taskFileContent: (taskId: number, path: string): Promise<TaskFileContent> =>
    request<TaskFileContent>(`/api/runtime/tasks/${taskId}/file-content?path=${encodeURIComponent(path)}`),

  /** Whether the agent can commit code for this task (repo bound + credential). */
  taskRepoStatus: (taskId: number): Promise<TaskRepoStatus> =>
    request<TaskRepoStatus>(`/api/runtime/tasks/${taskId}/repo-status`),

  /** Cancel a running/queued execution. */
  cancel: (id: number): Promise<Execution> =>
    request<Execution>(`/api/runtime/executions/${id}/cancel`, { method: 'POST' }),

  /**
   * Send a direction to an execution from the Output tab. If the run is still
   * live, the executing agent (self-hosted or cloud) receives it as an additional
   * instruction and steers mid-run (`steered: true`). If the run has already
   * settled, this starts a NEW run seeded with the message as its directive and
   * returns the new execution id (`rerun.executionId`) so the UI can follow it.
   * Either way the directive is recorded as a PRD revision server-side.
   */
  postMessage: (id: number, text: string): Promise<{ ok: true; steered?: boolean; rerun?: { executionId: number } }> =>
    request<{ ok: true; steered?: boolean; rerun?: { executionId: number } }>(`/api/runtime/executions/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    }),

  /**
   * WebSocket URL for a single execution's live event stream (status changes,
   * assistant deltas, tool calls, file changes). The tenant JWT is passed as a
   * query param because browsers can't set WS auth headers. Returns null if there
   * is no token yet (caller should fall back to polling).
   */
  streamUrl: (id: number): string | null => {
    const token = getStoredTenantToken();
    if (!token) return null;
    const base = AUTH_API_URL.replace(/^http/, 'ws');
    return `${base}/api/runtime/executions/${id}/stream?token=${encodeURIComponent(token)}`;
  },
};

/** One source bucket in the usage breakdown — CLOUD vs ON-PREM vs WEB. */
export interface UsageByKind {
  kind: 'cloud' | 'on-prem' | 'web';
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  /** Estimated USD (catalog per-token prices — not an authoritative billed amount). */
  estimatedCostUsd: number;
}

export interface DashboardUsage {
  window: string;
  windowStart: string;
  totals: { tokens: number; requests: number; estimatedCostUsd: number };
  byKind: UsageByKind[];
  perModel: Array<{ model: string; totalTokens: number; requests: number; estimatedCostUsd: number }>;
  perAgentHost: Array<{ agentHostId: number | null; totalTokens: number; requests: number }>;
  /** Per-project spend (0103) — cost attributed to each project, rolling up to
   *  the account total in `totals.estimatedCostUsd`. */
  perProject: Array<{ projectId: number | null; projectName: string; totalTokens: number; requests: number; estimatedCostUsd: number }>;
}

export const dashboardApi = {
  /** Token + estimated-cost usage split by source (cloud / on-prem / web). */
  usage: (window: 'today' | 'week' | 'month' = 'week'): Promise<DashboardUsage> =>
    request<DashboardUsage>(`/api/dashboard/usage?window=${window}`),
};

// ---------------------------------------------------------------------------
// Consumption meter — month-to-date usage vs the plan allowance, one entry per
// metered resource (AI tokens, data ingestion, …). All-roles (no MANAGER gate);
// powers the sidebar UsageMeter widget.
// ---------------------------------------------------------------------------

export type MeterKey = 'ai_tokens' | 'ingestion';
export type MeterUnit = 'tokens' | 'bytes';

export interface MeterSnapshot {
  key: MeterKey;
  unit: MeterUnit;
  used: number;
  /** Monthly allowance; -1 = unlimited. */
  limit: number;
  unlimited: boolean;
  /** Amount left this month; -1 when unlimited. */
  remaining: number;
  /** 0–100, clamped; 0 when unlimited. */
  percentUsed: number;
}

export interface ConsumptionSnapshot {
  period: { start: string; resetsAt: string };
  plan: { effective: 'free' | 'pro' | 'teams'; billingStatus: string };
  meters: MeterSnapshot[];
}

export const consumptionApi = {
  /** Month-to-date usage vs the plan allowance for every metered resource. */
  get: (): Promise<ConsumptionSnapshot> => request<ConsumptionSnapshot>('/api/consumption'),
};

// ---------------------------------------------------------------------------
// Workforce members — capability/availability profiles + effectiveness /
// engagement / DORA metrics (humans AND agents). See /api/members.
// ---------------------------------------------------------------------------

export type MemberKind = 'human' | 'cloud_agent' | 'host_agent';

export interface MemberProfile {
  memberKind: MemberKind;
  memberRef: string;
  timezone: string | null;
  workHours: unknown;
  pto: unknown;
  responseSlaHours: number | null;
  weeklyCapacityHours: number | null;
  dailyCapacityPoints: number | null;
  maxConcurrentWip: number | null;
  rampFactor: number | null;
  experienceLevel: 'junior' | 'mid' | 'senior' | 'staff' | 'principal' | null;
  skills: unknown;
  focusAreas: unknown;
  preferredTaskTypes: unknown;
  availabilityStatus: 'available' | 'busy' | 'focus' | 'ooo' | 'on_call';
  availabilityUntil: string | null;
  lastActiveAt: string | null;
  costRateUsdCents: number | null;
  syncSource: 'manual' | 'google_calendar';
}

export interface MemberScorecard {
  memberKind: MemberKind;
  memberRef: string;
  memberName: string;
  assignedCount: number;
  completedCount: number;
  redoCount: number;
  reopenCount: number;
  avgCycleTimeHours: number | null;
  avgPickupLatencyHours: number | null;
  avgIdleAfterDoneHours: number | null;
  boardHygieneScore: number | null;
  engagementScore: number | null;
  effectivenessScore: number | null;
}

export interface DoraRollup {
  windowDays: number;
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
}

export interface AssigneeRecommendation {
  memberKind: MemberKind;
  memberRef: string;
  memberName: string;
  fitScore: number;
  wip: number;
  spareCapacity: number;
  available: boolean;
  skillMatchPct: number | null;
  reasons: string[];
}

export type EngagementLevel = 'inactive' | 'low' | 'moderate' | 'high' | 'very_high';

export interface MemberEngagement {
  userId: string;
  displayName: string;
  role: string;
  score: number;
  level: EngagementLevel;
  breakdown: { activityPts: number; platformPts: number; toolingPts: number; deliveryPts: number };
  signals: { activityEvents: number; platformActions: number; vscodeActive: boolean; completedTasks: number };
  lastVscodeSeenAt: string | null;
}

export const membersApi = {
  /** Every member profile for the tenant (planner-facing). */
  profiles: (): Promise<{ profiles: MemberProfile[] }> =>
    request<{ profiles: MemberProfile[] }>('/api/members/profiles'),

  getProfile: (kind: MemberKind, ref: string): Promise<{ profile: MemberProfile | null }> =>
    request<{ profile: MemberProfile | null }>(`/api/members/${kind}/${encodeURIComponent(ref)}/profile`),

  putProfile: (kind: MemberKind, ref: string, body: Partial<MemberProfile>): Promise<{ profile: MemberProfile }> =>
    request<{ profile: MemberProfile }>(`/api/members/${kind}/${encodeURIComponent(ref)}/profile`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  /** Effectiveness/engagement scorecards for every member over a window (MANAGER+). */
  metrics: (days = 7): Promise<{ windowDays: number; members: MemberScorecard[] }> =>
    request<{ windowDays: number; members: MemberScorecard[] }>(`/api/members/metrics?days=${days}`),

  /** The four DORA metrics for the tenant over a window (MANAGER+). */
  dora: (days = 30): Promise<DoraRollup> =>
    request<DoraRollup>(`/api/members/dora?days=${days}`),

  /** Unified engagement (external activity + platform usage + VS Code + delivery)
   *  per human member over a window (MANAGER+). */
  engagement: (days = 30): Promise<{ windowDays: number; members: MemberEngagement[] }> =>
    request<{ windowDays: number; members: MemberEngagement[] }>(`/api/members/engagement?days=${days}`),

  /** Ranked assignee recommendations for a project (planner consumption). */
  recommend: (projectId: number, skills: string[] = []): Promise<{ recommendations: AssigneeRecommendation[] }> =>
    request<{ recommendations: AssigneeRecommendation[] }>(
      `/api/members/recommend?projectId=${projectId}${skills.length ? `&skills=${encodeURIComponent(skills.join(','))}` : ''}`,
    ),

  /** Overlay a human member's Google Calendar (busy + PTO) onto their profile.
   *  Requires a connected `google_calendar` integration; 409 if none. */
  calendarSync: (kind: MemberKind, ref: string, calendarId?: string): Promise<CalendarSyncResult> =>
    request<CalendarSyncResult>(`/api/members/${kind}/${encodeURIComponent(ref)}/calendar-sync`, {
      method: 'POST',
      body: JSON.stringify({ calendarId }),
    }),
};

export interface CalendarSyncResult {
  ok: boolean;
  message?: string;
  availabilityStatus?: 'available' | 'busy';
  availabilityUntil?: string | null;
  ptoCount?: number;
}

/**
 * BYO LLM provider keys — a tenant stores its own Anthropic key so the gateway
 * proxies BuilderForce-V2 (Claude Agent SDK) model calls with the tenant's key
 * and meters them. The key is write-only: we only ever read which providers are
 * configured, never the secret.
 */
export type LlmProvider = 'anthropic';

/** How a configured provider authenticates: a pasted API key, or a connected
 *  Claude Pro/Max subscription via OAuth. */
export type ProviderAuthType = 'api_key' | 'oauth';
export interface ProviderKeySummary {
  provider: LlmProvider;
  authType: ProviderAuthType;
}

export const providerKeysApi = {
  /** Configured providers + how each authenticates (no secrets returned). */
  list: (): Promise<{ providers: LlmProvider[]; details: ProviderKeySummary[] }> =>
    request<{ providers: LlmProvider[]; details: ProviderKeySummary[] }>('/llm/provider-keys'),

  set: (provider: LlmProvider, apiKey: string): Promise<{ ok: true; provider: LlmProvider }> =>
    request<{ ok: true; provider: LlmProvider }>(`/llm/provider-keys/${provider}`, {
      method: 'PUT',
      body: JSON.stringify({ apiKey }),
    }),

  remove: (provider: LlmProvider): Promise<{ ok: true }> =>
    request<{ ok: true }>(`/llm/provider-keys/${provider}`, { method: 'DELETE' }),

  /** Begin connecting a Claude subscription — returns the Claude.ai authorize URL
   *  the user opens to grant access (PKCE verifier is held server-side). */
  oauthStart: (): Promise<{ authorizeUrl: string; state: string }> =>
    request<{ authorizeUrl: string; state: string }>('/llm/provider-keys/anthropic/oauth/start', {
      method: 'POST',
    }),

  /** Finish connecting a Claude subscription with the `code#state` the user
   *  pasted from Claude.ai's consent page. */
  oauthComplete: (code: string): Promise<{ ok: true; provider: LlmProvider; authType: ProviderAuthType }> =>
    request<{ ok: true; provider: LlmProvider; authType: ProviderAuthType }>(
      '/llm/provider-keys/anthropic/oauth/complete',
      { method: 'POST', body: JSON.stringify({ code }) },
    ),
};

// ---------------------------------------------------------------------------
// Human-in-the-loop requests — approvals, questions, and feedback an agent
// bubbles up for a person. One table/endpoint; `kind` distinguishes them.
// ---------------------------------------------------------------------------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'answered';

/** What the agent is asking a human for. */
export type RequestKind = 'approval' | 'question' | 'feedback';

export interface Approval {
  id: string;
  tenantId: number;
  agentHostId: number | null;
  requestedBy: string | null;
  kind: RequestKind;
  actionType: string;
  description: string;
  metadata: string | null;
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  /** Free-text human answer for question/feedback kinds (status='answered'). */
  responseText: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A resolved approval — adds the run started when a `task.execution` gate is approved. */
export interface ResolvedApproval extends Approval {
  /** The execution auto-started by approving a task.execution gate (else null/absent). */
  startedExecutionId?: number | null;
}

export const approvalsApi = {
  list: (params?: { status?: ApprovalStatus; agentHostId?: number | null }): Promise<Approval[]> => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.agentHostId != null) q.set('agentHostId', String(params.agentHostId));
    const query = q.toString();
    return request<{ approvals: Approval[] }>(`/api/approvals${query ? `?${query}` : ''}`).then((r) => r.approvals ?? []);
  },

  get: (id: string): Promise<Approval> => request<Approval>(`/api/approvals/${id}`),

  /** Approve/reject an action, or answer a question/feedback request with free text.
   *  Approving a `task.execution` gate auto-starts the run and returns its
   *  `startedExecutionId` so the caller can follow the new execution. */
  decide: (
    id: string,
    body: { status: 'approved' | 'rejected' | 'answered'; reviewNote?: string; responseText?: string }
  ): Promise<ResolvedApproval> =>
    request<ResolvedApproval>(`/api/approvals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

/** Canonical PRD status set (0098). */
export type SpecStatus = 'draft' | 'ready' | 'in_progress' | 'complete';

/** Specs/PRDs – project PRD storage. */
export interface Spec {
  id: string;
  projectId: number | null;
  goal: string;
  prd: string | null;
  status: string;
  kind?: string;
  archSpec?: string | null;
  taskList?: string | null;
  /** Set when the spec is returned in a task's linked-PRD list. */
  isPrimary?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export const specsApi = {
  create: (body: {
    projectId?: number | null;
    goal: string;
    prd?: string | null;
    status?: SpecStatus;
    kind?: 'feature' | 'architecture';
  }) =>
    request<Spec>('/api/specs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  list: (projectId?: number | null, kind?: string) => {
    const params = new URLSearchParams();
    if (projectId != null) params.set('projectId', String(projectId));
    if (kind != null) params.set('kind', kind);
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<{ specs: Spec[] }>(`/api/specs${q}`).then((r) => r.specs ?? []);
  },

  get: (id: string) => request<Spec>(`/api/specs/${id}`),

  patch: (id: string, body: { goal?: string; status?: SpecStatus; prd?: string | null }) =>
    request<Spec>(`/api/specs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/specs/${id}`, { method: 'DELETE' }),
};

/** Task ↔ PRD links (many-to-many, 0098). A task references 1..N project PRDs. */
export const taskSpecsApi = {
  /** PRDs linked to a task (primary first). */
  list: (taskId: number) =>
    request<{ specs: Spec[] }>(`/api/tasks/${taskId}/specs`).then((r) => r.specs ?? []),

  /** Attach an existing project PRD to the task. */
  attach: (taskId: number, specId: string, isPrimary = false) =>
    request<{ ok: true }>(`/api/tasks/${taskId}/specs`, {
      method: 'POST',
      body: JSON.stringify({ specId, isPrimary }),
    }),

  /** Detach a PRD from the task. */
  detach: (taskId: number, specId: string) =>
    request<void>(`/api/tasks/${taskId}/specs/${specId}`, { method: 'DELETE' }),

  /** Mark a linked PRD as the task's primary. */
  setPrimary: (taskId: number, specId: string) =>
    request<{ ok: true }>(`/api/tasks/${taskId}/specs/${specId}/primary`, { method: 'POST' }),

  /** Draft + attach a PRD for a PRD-less task. */
  generate: (taskId: number) =>
    request<{ specId: string; prd: string; status: string }>(`/api/tasks/${taskId}/specs/generate`, {
      method: 'POST',
    }),
};

// ---------------------------------------------------------------------------
// Cron Jobs (agentHost-scoped, optionally project-associated)
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  tenantId: number;
  agentHostId: number;
  projectId: number | null;
  projectAgentId: number | null;
  name: string;
  schedule: string;
  taskId: number | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export const cronApi = {
  // projectAgentId: a numeric id scopes to one attached agent; 'none' = project-wide only.
  list: (agentHostId: number, projectId?: number, projectAgentId?: number | 'none'): Promise<CronJob[]> => {
    const params = new URLSearchParams();
    if (projectId != null) params.set('projectId', String(projectId));
    if (projectAgentId != null) params.set('projectAgentId', String(projectAgentId));
    const q = params.toString() ? `?${params.toString()}` : '';
    return request<{ jobs: CronJob[] }>(`/api/agent-hosts/${agentHostId}/cron${q}`).then((r) => r.jobs ?? []);
  },

  create: (agentHostId: number, body: {
    id?: string;
    name: string;
    schedule: string;
    taskId?: number | null;
    projectId?: number | null;
    projectAgentId?: number | null;
    enabled?: boolean;
  }): Promise<CronJob> =>
    request<CronJob>(`/api/agent-hosts/${agentHostId}/cron`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (agentHostId: number, jobId: string, body: Partial<{
    name: string;
    schedule: string;
    taskId: number | null;
    projectId: number | null;
    enabled: boolean;
  }>): Promise<CronJob> =>
    request<CronJob>(`/api/agent-hosts/${agentHostId}/cron/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (agentHostId: number, jobId: string): Promise<void> =>
    request<void>(`/api/agent-hosts/${agentHostId}/cron/${jobId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Canonical agent assignments — assign a tenant-registered agent to any aspect.
// ---------------------------------------------------------------------------

export type AgentAssignmentScope =
  | 'project'
  | 'workflow'
  | 'security'
  | 'swimlane'
  | 'brain'
  | 'global';

export type AgentExecutionScope = 'project' | 'global';

export interface AgentAssignment {
  id: string;
  agentKind: string;
  agentRef: string;
  scope: AgentAssignmentScope;
  scopeId: string | null;
  executionScope: AgentExecutionScope;
  role: string;
}

export const agentAssignmentsApi = {
  list: (scope: AgentAssignmentScope, scopeId?: string | number): Promise<AgentAssignment[]> => {
    const params = new URLSearchParams({ scope });
    if (scopeId != null) params.set('scopeId', String(scopeId));
    return request<{ assignments: AgentAssignment[] }>(`/api/agent-assignments?${params.toString()}`).then(
      (r) => r.assignments ?? [],
    );
  },

  assign: (body: {
    agentKind: string;
    agentRef: string;
    scope: AgentAssignmentScope;
    scopeId?: string | number | null;
    executionScope?: AgentExecutionScope;
    role?: string;
  }): Promise<AgentAssignment> =>
    request<{ assignment: AgentAssignment }>(`/api/agent-assignments`, {
      method: 'POST',
      body: JSON.stringify({ ...body, scopeId: body.scopeId != null ? String(body.scopeId) : null }),
    }).then((r) => r.assignment),

  remove: (id: string): Promise<void> =>
    request<void>(`/api/agent-assignments/${id}`, { method: 'DELETE' }),
};

/** @deprecated Use tasksApi.list for full Task[]; kept for ArtifactAssigner. */
export async function listTasks(projectId?: number): Promise<TaskSummary[]> {
  const list = await tasksApi.list(projectId);
  return list.map((t) => ({
    id: t.id,
    key: t.key,
    title: t.title,
    projectId: t.projectId,
    status: t.status,
  }));
}

// ---------------------------------------------------------------------------
// Chat Sessions (agentHost chat history)
// ---------------------------------------------------------------------------

export interface ChatSession {
  id: string;
  agentHostId: number;
  sessionKey: string;
  projectId: number | null;
  startedAt: string;
  endedAt: string | null;
  msgCount: number;
  lastMsgAt: string | null;
}

export interface ChatMessage {
  id: number;
  sessionId: string;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: string;
}

export const chatSessionsApi = {
  list: (agentHostId: number): Promise<ChatSession[]> => {
    return request<{ sessions: ChatSession[] }>(`/api/chats?agentHostId=${agentHostId}`).then((r) => r.sessions ?? []);
  },

  listAll: (limit = 100): Promise<(ChatSession & { agentHostName?: string })[]> => {
    return request<{ sessions: (ChatSession & { agentHostName?: string })[] }>(`/api/chats?limit=${limit}`).then((r) => r.sessions ?? []);
  },

  getMessages: (sessionId: string, limit = 100): Promise<ChatMessage[]> => {
    return request<{ messages: ChatMessage[] }>(`/api/chats/${sessionId}/messages?limit=${limit}`).then(
      (r) => r.messages ?? []
    );
  },
};

// ---------------------------------------------------------------------------
// Security (tenant member sessions / tokens)
// ---------------------------------------------------------------------------

export interface SecurityUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  mfaEnabled: boolean;
  activeSessions: number;
  activeTokens: number;
}

export interface SecuritySession {
  id: string;
  sessionName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  isActive: boolean;
  revokedAt: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  activeTokens: number;
}

export const securityApi = {
  listUsers: (tenantId: number): Promise<SecurityUser[]> =>
    request<{ users: SecurityUser[] }>(`/api/tenants/${tenantId}/security/users`).then((r) => r.users ?? []),

  getUser: (tenantId: number, userId: string): Promise<{ sessions: SecuritySession[] }> =>
    request<{ sessions: SecuritySession[] }>(`/api/tenants/${tenantId}/security/users/${userId}`),

  revokeSession: (tenantId: number, userId: string, sessionId: string): Promise<void> =>
    request(`/api/tenants/${tenantId}/security/users/${userId}/sessions/${sessionId}/revoke`, { method: 'POST' }).then(() => undefined),

  revokeAllSessions: (tenantId: number, userId: string): Promise<void> =>
    request(`/api/tenants/${tenantId}/security/users/${userId}/sessions/revoke-all`, { method: 'POST' }).then(() => undefined),
};

// ---------------------------------------------------------------------------
// Usage Snapshots (token telemetry from agentHosts)
// ---------------------------------------------------------------------------

export interface UsageSnapshot {
  id: number;
  agentHostId: number;
  sessionKey: string | null;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextWindowMax: number | null;
  compactionCount: number;
  ts: string;
}

export const usageApi = {
  list: (agentHostId: number, limit = 50): Promise<UsageSnapshot[]> =>
    request<{ snapshots: UsageSnapshot[] }>(`/api/agent-hosts/${agentHostId}/usage?limit=${limit}`).then(
      (r) => r.snapshots ?? []
    ),
};

// ---------------------------------------------------------------------------
// AgentHost Workspace (synced directories + files)
// ---------------------------------------------------------------------------

export interface AgentHostDirectory {
  id: number;
  agentHostId: number;
  projectId: number | null;
  absPath: string;
  pathHash: string;
  status: 'pending' | 'synced' | 'error';
  lastSyncedAt: string | null;
  fileCount?: number;
}

export interface AgentHostDirectoryFile {
  id: number;
  directoryId: number;
  relPath: string;
  contentHash: string;
  sizeBytes: number;
  updatedAt: string;
}

export const workspaceApi = {
  listDirectories: (agentHostId: number): Promise<AgentHostDirectory[]> =>
    request<{ directories: AgentHostDirectory[] }>(`/api/agent-hosts/${agentHostId}/directories`).then(
      (r) => r.directories ?? []
    ),

  listFiles: (agentHostId: number, directoryId: number): Promise<AgentHostDirectoryFile[]> =>
    request<{ files: AgentHostDirectoryFile[] }>(
      `/api/agent-hosts/${agentHostId}/directories/${directoryId}/files`
    ).then((r) => r.files ?? []),

  getFileContent: (agentHostId: number, directoryId: number, fileId: number): Promise<{ content: string }> =>
    request<{ content: string }>(`/api/agent-hosts/${agentHostId}/directories/${directoryId}/files/${fileId}/content`),

  triggerSync: (agentHostId: number, directoryId: number): Promise<void> =>
    request<void>(`/api/agent-hosts/${agentHostId}/directories/${directoryId}/sync`, { method: 'POST' }),
};

// ---------------------------------------------------------------------------
// AgentHost Projects (project ↔ agentHost associations)
// ---------------------------------------------------------------------------

export interface AgentHostProject {
  agentHostId: number;
  projectId: number;
  role: string | null;
  project?: {
    id: number;
    name: string;
    description: string | null;
    status: string;
  };
}

export const agentHostProjectsApi = {
  list: (agentHostId: number): Promise<AgentHostProject[]> =>
    request<{ projects: AgentHostProject[] }>(`/api/agent-hosts/${agentHostId}/projects`).then((r) => r.projects ?? []),

  assign: (agentHostId: number, projectId: number, role?: string): Promise<void> =>
    request<void>(`/api/agent-hosts/${agentHostId}/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  unassign: (agentHostId: number, projectId: number): Promise<void> =>
    request<void>(`/api/agent-hosts/${agentHostId}/projects/${projectId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// AgentHost Channels (multi-channel messaging integrations)
// ---------------------------------------------------------------------------

export type ChannelPlatform =
  | 'whatsapp'
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'google_chat'
  | 'signal'
  | 'teams'
  | 'webhook';

export interface AgentHostChannel {
  id: string;
  agentHostId: number;
  platform: ChannelPlatform;
  name: string;
  config: string | null; // JSON config (webhook URL, token, etc.)
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const channelsApi = {
  list: (agentHostId: number): Promise<AgentHostChannel[]> =>
    request<{ channels: AgentHostChannel[] }>(`/api/agent-hosts/${agentHostId}/channels`).then((r) => r.channels ?? []),

  create: (
    agentHostId: number,
    body: { platform: ChannelPlatform; name: string; config?: string; enabled?: boolean }
  ): Promise<AgentHostChannel> =>
    request<AgentHostChannel>(`/api/agent-hosts/${agentHostId}/channels`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (
    agentHostId: number,
    channelId: string,
    body: Partial<{ name: string; config: string; enabled: boolean }>
  ): Promise<AgentHostChannel> =>
    request<AgentHostChannel>(`/api/agent-hosts/${agentHostId}/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (agentHostId: number, channelId: string): Promise<void> =>
    request<void>(`/api/agent-hosts/${agentHostId}/channels/${channelId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// AgentHost Skills (tenant + agentHost-scoped skill assignments)
// ---------------------------------------------------------------------------

export interface AgentHostSkillAssignment {
  id: number;
  agentHostId: number | null;
  tenantId: number;
  skillSlug: string;
  scope: 'tenant' | 'host';
  assignedBy: string | null;
  assignedAt: string;
  skill?: {
    name: string;
    description: string | null;
    category: string | null;
    version: string | null;
    icon_url: string | null;
  };
}

export const agentHostSkillsApi = {
  list: (agentHostId: number): Promise<AgentHostSkillAssignment[]> => {
    const q = new URLSearchParams({ agentHostId: String(agentHostId) });
    return request<{ assignments: AgentHostSkillAssignment[] }>(`/api/skill-assignments?${q}`).then(
      (r) => r.assignments ?? []
    );
  },

  assignToAgentHost: (agentHostId: number, skillSlug: string): Promise<void> =>
    request<void>(`/api/skill-assignments/agentHost/${agentHostId}`, {
      method: 'POST',
      body: JSON.stringify({ skillSlug }),
    }),

  revoke: (assignmentId: number): Promise<void> =>
    request<void>(`/api/skill-assignments/${assignmentId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// LLM Proxy: usage + health (GAP-04)
// ---------------------------------------------------------------------------

export interface LlmUsageStats {
  totalRequests: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  byModel: Array<{ model: string; requests: number; tokens: number }>;
  period: string;
}

/** Mirrors `api/src/application/llm/vendors/types.ts:VendorId`. */
export type VendorId = 'openrouter' | 'cerebras' | 'ollama' | 'nvidia';

/** Mirrors `api/src/application/llm/vendors/types.ts:AiCapability`. */
export type AiCapability = 'tools' | 'structured_output' | 'vision' | 'ocr';

/** Per-model status returned by `/llm/v1/health` and `/llm/v1/models` (configured branch). */
export interface LlmModelStatus {
  model: string;
  preferred: boolean;
  available: boolean;
  /** Epoch ms when the per-model cooldown lifts. Absent when no per-model cooldown. */
  cooldownUntil?: number;
  /** Epoch ms when the per-vendor cooldown lifts. Set when an upstream is wholesale-cooled. */
  vendorCooledUntil?: number;
  /** Whether the vendor's API key is bound in this environment. False → model is unservable. */
  keyBound?: boolean;
  vendor: VendorId;
  /** Shape capabilities — `vision`/`ocr` flag image & PDF reading; `tools`/`structured_output`
   *  flag tool-calling & json_schema support. Drives capability-aware model pickers. */
  capabilities?: AiCapability[];
}

export interface LlmHealthResponse {
  status: string;
  free: LlmModelStatus[];
  pro: LlmModelStatus[];
  timestamp: string;
}

type EffectivePlanLabel = 'free' | 'pro' | 'teams';

/** Union response for `/llm/v1/models` — see `api/src/presentation/routes/llmRoutes.ts`.
 *  `codingModels` is the curated tool-calling + coding subset the plan can reach —
 *  the list a cloud-agent run should pick from. `premium` is set when a superadmin
 *  premium override is active (treats a free plan as paid for model selection). */
export type LlmModelsResponse =
  | { configured: false; product: string; effectivePlan: EffectivePlanLabel; premium?: boolean; models: string[]; codingModels?: string[] }
  | { configured: true;  product: string; effectivePlan: EffectivePlanLabel; premium?: boolean; object: 'list'; data: LlmModelStatus[]; codingModels?: string[] };

/** Learned Model Routing (PRD 13) — closed action-type taxonomy. MIRRORS
 *  `api/src/application/llm/actionTypes.ts` (the api is the source of truth). */
export const ACTION_TYPES = [
  'sql', 'frontend_ui', 'backend_api', 'refactor', 'bugfix',
  'tests', 'docs', 'devops_ci', 'data_migration', 'other',
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** One model's learned ranking within an action type — from `/llm/v1/model-analytics`. */
export interface ModelAnalyticsEntry {
  model: string;
  samples: number;
  avgScore: number;
  mergeRate: number;
  avgCostMillicents: number;
}
export interface ModelAnalyticsAction {
  actionType: ActionType;
  label: string;
  models: ModelAnalyticsEntry[];
}
export interface ModelAnalyticsResponse {
  scope: string;
  updatedAt: string;
  byAction: ModelAnalyticsAction[];
}

export const llmApi = {
  usage: (): Promise<LlmUsageStats> =>
    request<LlmUsageStats>('/llm/v1/usage'),

  health: (): Promise<LlmHealthResponse> =>
    request<LlmHealthResponse>('/llm/v1/health'),

  models: (): Promise<LlmModelsResponse> =>
    request<LlmModelsResponse>('/llm/v1/models'),

  /** Learned Model Routing analytics — the per-action-type model ranking the router
   *  seeds from. `scope` defaults to the caller's tenant; pass `global` or
   *  `project:<id>`. */
  modelAnalytics: (scope: string = 'tenant'): Promise<ModelAnalyticsResponse> =>
    request<ModelAnalyticsResponse>(`/llm/v1/model-analytics?scope=${encodeURIComponent(scope)}`),

  /** Learned Model Routing (§6.6): seed feed for the client's LOCAL SSM recall memory
   *  — the tenant's recently-scored outcomes (task text + winning model + score). */
  recallSeed: (limit = 50): Promise<{ memories: RecallSeedMemory[] }> =>
    request<{ memories: RecallSeedMemory[] }>(`/llm/v1/recall-seed?limit=${limit}`),
};

/** One scored outcome from `/llm/v1/recall-seed`, used to warm local recall memory. */
export interface RecallSeedMemory {
  id: number;
  taskText: string;
  model: string;
  score: number;
}

/** A tenant "LLM" — a named, reusable model config (migration 0211). */
export interface TenantModel {
  id: string;
  slug: string;
  /** The ref any surface selects it by: `tenant_model:<slug>`. */
  ref: string;
  name: string;
  baseModel: string | null;
  systemPrompt: string | null;
  params: Record<string, unknown>;
  personaId: string | null;
  providerKey: string | null;
  trainedModelRef: string | null;
  visibility: 'private' | 'tenant';
  updatedAt: string;
}

export interface TenantModelInput {
  name: string;
  baseModel?: string | null;
  systemPrompt?: string | null;
  params?: Record<string, unknown> | null;
  personaId?: string | null;
  providerKey?: string | null;
  trainedModelRef?: string | null;
  visibility?: 'private' | 'tenant';
}

/** CRUD for the tenant's named model configs ("LLMs"). */
export const tenantModelApi = {
  list: (): Promise<{ models: TenantModel[] }> =>
    request<{ models: TenantModel[] }>('/api/llm/models'),

  create: (body: TenantModelInput): Promise<TenantModel> =>
    request<TenantModel>('/api/llm/models', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<TenantModelInput>): Promise<TenantModel> =>
    request<TenantModel>(`/api/llm/models/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string): Promise<{ deleted: boolean }> =>
    request<{ deleted: boolean }>(`/api/llm/models/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Dispatch (send command to agentHost via relay)
// ---------------------------------------------------------------------------

export const dispatchApi = {
  send: (agentHostId: number, payload: unknown): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/agent-hosts/${agentHostId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// ---------------------------------------------------------------------------
// AgentHost Config (runtime configuration JSON)
// ---------------------------------------------------------------------------

export const agentHostConfigApi = {
  get: (agentHostId: number): Promise<{ config: Record<string, unknown> | null }> =>
    request<{ config: Record<string, unknown> | null }>(`/api/agent-hosts/${agentHostId}/config`),

  update: (agentHostId: number, config: Record<string, unknown>): Promise<{ config: Record<string, unknown> }> =>
    request<{ config: Record<string, unknown> }>(`/api/agent-hosts/${agentHostId}/config`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
};

// ---------------------------------------------------------------------------
// Audit Events
// ---------------------------------------------------------------------------

export interface AuditEvent {
  id: number;
  tenantId: number;
  userId: string | null;
  eventType: string;
  resourceType: string | null;
  resourceId: string | null;
  metadata: string | null;
  createdAt: string;
}

export const auditApi = {
  list: (params?: { limit?: number; offset?: number; eventType?: string; resourceType?: string }): Promise<AuditEvent[]> => {
    const q = new URLSearchParams();
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    if (params?.eventType) q.set('eventType', params.eventType);
    if (params?.resourceType) q.set('resourceType', params.resourceType);
    const query = q.toString();
    return request<{ events: AuditEvent[] }>(`/api/audit/events${query ? `?${query}` : ''}`).then(
      (r) => r.events ?? []
    );
  },
};

// ---------------------------------------------------------------------------
// Marketplace publisher auth (separate from tenant JWT — tid: 0 publisher identity)
// ---------------------------------------------------------------------------

const MP_TOKEN_KEY = 'bf_marketplace_token';

export function getMarketplaceToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(MP_TOKEN_KEY);
}

export function setMarketplaceToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(MP_TOKEN_KEY, token);
  else localStorage.removeItem(MP_TOKEN_KEY);
}

function mpHeaders(): Record<string, string> {
  const token = getMarketplaceToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function mpRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${AUTH_API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...mpHeaders(), ...(init?.headers as Record<string, string> ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? res.statusText ?? 'Request failed');
  }
  return res.json() as Promise<T>;
}

export interface MarketplaceUser {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface MarketplaceSkillDraft {
  name: string;
  slug: string;
  description?: string;
  category?: string;
  tags?: string[];
  version?: string;
  repoUrl?: string;
  iconUrl?: string;
}

// ---------------------------------------------------------------------------
// AgentHost nodes (cluster node management)
// ---------------------------------------------------------------------------

export interface AgentHostNode {
  id: string;
  name: string;
  capabilities: string[];
  connectedAt: string | null;
  lastSeenAt: string | null;
  status: 'connected' | 'disconnected';
}

export const agentHostNodesApi = {
  list: (agentHostId: number): Promise<AgentHostNode[]> =>
    request<AgentHostNode[]>(`/api/agent-hosts/${agentHostId}/nodes`),

  unpair: (agentHostId: number, nodeId: string): Promise<void> =>
    request<void>(`/api/agent-hosts/${agentHostId}/nodes/${nodeId}`, { method: 'DELETE' }),
};

export const marketplacePublisherApi = {
  register: (body: { email: string; password: string; username?: string; display_name?: string }) =>
    mpRequest<{ token: string; user: MarketplaceUser }>('/marketplace/auth/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  login: (body: { email: string; password: string }) =>
    mpRequest<{ token: string; user: MarketplaceUser }>('/marketplace/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  me: () => mpRequest<{ user: MarketplaceUser }>('/marketplace/auth/me'),

  publishSkill: (skill: MarketplaceSkillDraft) =>
    mpRequest<{ skill: MarketplaceSkill }>('/marketplace/skills', {
      method: 'POST',
      body: JSON.stringify(skill),
    }),

  updateSkill: (slug: string, updates: Partial<MarketplaceSkillDraft>) =>
    mpRequest<{ skill: MarketplaceSkill }>(`/marketplace/skills/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  likeSkill: (slug: string) =>
    mpRequest<{ liked: boolean; likes: number }>(`/marketplace/skills/${slug}/like`, { method: 'POST' }),
};

// ---------------------------------------------------------------------------
// Self-service session management (uses web JWT)
// ---------------------------------------------------------------------------

export interface MySession {
  id: string;
  sessionName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  isActive: boolean;
  isCurrent: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export const mySessionsApi = {
  list: (): Promise<MySession[]> =>
    webRequest<{ sessions: MySession[] }>('/api/auth/sessions').then((r) => r.sessions ?? []),

  revoke: (sessionId: string): Promise<void> =>
    webRequest(`/api/auth/sessions/${sessionId}/revoke`, { method: 'POST' }).then(() => undefined),

  revokeOthers: (): Promise<void> =>
    webRequest('/api/auth/sessions/revoke-others', { method: 'POST' }).then(() => undefined),
};

// ---------------------------------------------------------------------------
// My admin access log (impersonation sessions targeting the current user)
// ---------------------------------------------------------------------------

export interface MyAdminAccessSession {
  id: string;
  adminUserId: string;
  tenantId: number;
  tenantName: string;
  roleOverride: string;
  reason: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  pagesVisited: string[];
  writeBlockCount: number;
}

export const myAdminAccessApi = {
  list: (): Promise<MyAdminAccessSession[]> =>
    webRequest<{ sessions: MyAdminAccessSession[] }>('/api/auth/me/admin-access').then((r) => r.sessions ?? []),
};

// ---------------------------------------------------------------------------
// Tenant API keys (bfk_*) — gateway credentials for tenant apps.
// Owner-role only. Raw key returned once on mint and never again.
// ---------------------------------------------------------------------------

export interface TenantApiKey {
  id: string;
  name: string;
  createdByUserId: string | null;
  /** Browser allowlist — null = server-only key. */
  allowedOrigins: string[] | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface MintTenantApiKeyResult {
  key: string;
  id: string;
  name: string;
  allowedOrigins: string[] | null;
  createdAt: string;
}

export interface MintTenantApiKeyInput {
  name: string;
  /** null/empty = server-only; ['*'] = any origin; ['https://x', ...] = exact-match allowlist. */
  allowedOrigins?: string[] | null;
}

export interface UpdateTenantApiKeyInput {
  /** Replace the display name. Empty string is rejected by the server. */
  name?: string;
  /** Replace the origin allowlist. `null` = server-only; `['*']` = any origin. Omit to leave unchanged. */
  allowedOrigins?: string[] | null;
}

export interface TenantApiKeyUsageRow {
  id: number;
  createdAt: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  retries: number;
  streamed: boolean;
  useCase: string | null;
  metadata: Record<string, unknown> | null;
  idempotencyKey: string | null;
  userId: string | null;
}

export interface TenantApiKeyUsageResult {
  summary: { total: number; totalTokens: number; modelCount: number };
  rows: TenantApiKeyUsageRow[];
  days: number;
  page: number;
  limit: number;
}

export const tenantApiKeysApi = {
  list: (tenantId: number): Promise<TenantApiKey[]> =>
    request<{ keys: TenantApiKey[] }>(`/api/tenants/${tenantId}/api-keys`).then((r) => r.keys ?? []),

  mint: (tenantId: number, input: MintTenantApiKeyInput): Promise<MintTenantApiKeyResult> =>
    request<MintTenantApiKeyResult>(`/api/tenants/${tenantId}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  update: (tenantId: number, keyId: string, patch: UpdateTenantApiKeyInput): Promise<TenantApiKey> =>
    request<{ key: TenantApiKey }>(`/api/tenants/${tenantId}/api-keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.key),

  revoke: (tenantId: number, keyId: string): Promise<void> =>
    request(`/api/tenants/${tenantId}/api-keys/${keyId}`, { method: 'DELETE' }).then(() => undefined),

  usage: (tenantId: number, keyId: string, params?: { days?: number; page?: number; limit?: number }): Promise<TenantApiKeyUsageResult> => {
    const q = new URLSearchParams();
    if (params?.days  != null) q.set('days',  String(params.days));
    if (params?.page  != null) q.set('page',  String(params.page));
    if (params?.limit != null) q.set('limit', String(params.limit));
    const suffix = q.toString();
    return request<TenantApiKeyUsageResult>(`/api/tenants/${tenantId}/api-keys/${keyId}/usage${suffix ? `?${suffix}` : ''}`);
  },
};


// ---------------------------------------------------------------------------
// Embed integration config (/api/embed/config)
// ---------------------------------------------------------------------------

export type EmbedCapabilityKey = 'product' | 'agile' | 'security';

export interface EmbedConfigResult {
  enabled: boolean;
  capabilities: EmbedCapabilityKey[];
  isolationMode: 'single' | 'segmented';
  /** Consent version the tenant last agreed to (null = never). */
  consentVersion: number | null;
  consentedAt: string | null;
  consentedBy: string | null;
  /** The version the host must (re-)consent to before enabling. */
  consentRequiredVersion: number;
}

export interface EmbedSetConfigResult {
  enabled: boolean;
  capabilities: EmbedCapabilityKey[];
  consentVersion: number | null;
  consentedAt: string | null;
  consentedBy: string | null;
}

export const embedApi = {
  /** Current tenant's embed enablement + capabilities (any member). */
  getConfig: () => request<EmbedConfigResult>('/api/embed/config'),
  /**
   * Enable/disable + set capabilities (manager+). Pass `consentAcknowledged: true`
   * when enabling for the first time (or after a consent-version bump) — the API
   * returns 409 `EMBED_CONSENT_REQUIRED` otherwise.
   */
  setConfig: (body: { enabled: boolean; capabilities: EmbedCapabilityKey[]; consentAcknowledged?: boolean }) =>
    request<EmbedSetConfigResult>('/api/embed/config', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Host BI bridge (/api/bi/*) — burn-rate pull + self-serve host-BI config +
// validation-engagements overlay (spec 05 §4.1/§4.2).
// ---------------------------------------------------------------------------

export interface BurnRateResult {
  available: boolean;
  monthlyBurn?: number;
  runwayMonths?: number;
  source?: 'host';
  reason?: 'not_configured' | 'no_company' | 'unreachable' | 'bad_response';
}

export interface ValidationEngagement {
  id: string;
  name?: string;
  kind?: string;
  status?: string;
  responses?: number;
}

export interface ValidationEngagementsResult {
  available: boolean;
  engagements?: ValidationEngagement[];
  source?: 'host';
  reason?: 'not_configured' | 'no_company' | 'unreachable' | 'bad_response';
}

export const biApi = {
  /** Pull the segment's burn/runway from the host BI endpoint. */
  getBurnRate: () => request<BurnRateResult>('/api/bi/burn-rate'),
  /** List the host's validation engagements (feedback widgets/cohorts) for this segment. */
  getValidationEngagements: () => request<ValidationEngagementsResult>('/api/bi/validation-engagements'),
  /** Read the stored host-BI config (token never returned — only `hasToken`). */
  getConfig: () => request<{ baseUrl: string | null; hasToken: boolean }>('/api/bi/config'),
  /** Set/rotate the host BI base URL + token (manager+). Omit token to keep the existing one. */
  setConfig: (body: { baseUrl: string; token?: string }) =>
    request<{ baseUrl: string; hasToken: boolean }>('/api/bi/config', { method: 'PUT', body: JSON.stringify(body) }),
  /** Clear the host BI config (disconnect, manager+). */
  clearConfig: () => request<{ ok: boolean }>('/api/bi/config', { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Voice-of-Customer inbox (/api/reports/feedback) — ingested customer_feedback
// triage (spec 05 §4.2). new → triaged (optionally linking a backlog task).
// ---------------------------------------------------------------------------

export interface CustomerFeedbackRow {
  id: string;
  externalRef: string;
  widgetId: string | null;
  text: string;
  sentiment: string | null;
  contact: string | null;
  status: 'new' | 'triaged' | 'dismissed';
  triagedTaskId: number | null;
  triagedAt: string | null;
  createdAt: string;
}

export const feedbackApi = {
  /** List the segment's ingested feedback, optionally filtered by status. */
  list: (status?: 'new' | 'triaged' | 'dismissed') =>
    request<{ feedback: CustomerFeedbackRow[] }>(`/api/reports/feedback${status ? `?status=${status}` : ''}`),
  /** Triage one feedback row: flip status, optionally link the spawned backlog task (manager+). */
  triage: (id: string, body: { status: 'new' | 'triaged' | 'dismissed'; taskId?: number }) =>
    request<{ id: string; status: string; triagedTaskId: number | null }>(`/api/reports/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Governance & Security (/api/governance/*) — SOC 2 Control Tracker (doc 07 SEC-1)
// ---------------------------------------------------------------------------

export interface SocControl {
  id: string;
  controlRef: string;
  category: string;
  name: string;
  requirement: string | null;
  status: 'not_started' | 'in_progress' | 'ready' | 'out_of_scope';
  ownerId: string | null;
  notes: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const governanceApi = {
  soc2: {
    listControls: () => request<SocControl[]>('/api/governance/soc2/controls'),
    seed: () => request<{ seeded: number; message?: string }>('/api/governance/soc2/seed', { method: 'POST' }),
    patchControl: (id: string, body: { status?: SocControl['status']; ownerId?: string; notes?: string }) =>
      request<SocControl>(`/api/governance/soc2/controls/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    addEvidence: (id: string, body: { title: string; evidenceType: string; url?: string; note?: string }) =>
      request<{ id: string }>(`/api/governance/soc2/controls/${id}/evidence`, { method: 'POST', body: JSON.stringify(body) }),
  },
};

// Generic segment-scoped tracker client — one factory for every tracker surface
// (governance + product). `apiBase` is the full route, e.g. '/api/product/mvp'.
export type TrackerRow = Record<string, unknown> & { id: string };

export function segmentTrackerClient(apiBase: string) {
  return {
    /** List rows. For project-scoped trackers (roadmap, feature-scoring), pass a
     *  projectId to get that project's rows; omit for the segment/portfolio view. */
    list:   (projectId?: number) =>
      request<TrackerRow[]>(projectId != null ? `${apiBase}?project=${projectId}` : apiBase),
    create: (body: Record<string, unknown>) => request<TrackerRow>(apiBase, { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: Record<string, unknown>) => request<TrackerRow>(`${apiBase}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id: string) => request<{ deleted: string }>(`${apiBase}/${id}`, { method: 'DELETE' }),
  };
}

// Feature/portfolio ROI rollup (/api/roi/rollup). Composed live from tasks,
// task_status_transitions, sprints, llm_usage_log, and cost_calculations — see roiRoutes.ts.
export interface RoiRollup {
  scope: { projectId: number | null };
  time: { completedCount: number; avgCycleTimeHours: number; throughputPerWeek: number };
  spend: { sprintRunwayBudget: number; sprintActualBurn: number; agentLlmCostUsd: number; costModelTotal: number };
  roi: TrackerRow[];
  byProject: Array<{ projectId: number; projectName: string; completedCount: number; agentLlmCostUsd: number }>;
  byTask: Array<{ taskId: number; taskKey: string; title: string; agentLlmCostUsd: number }>;
}

export const roiApi = {
  /** Composed ROI rollup. Pass a projectId for the project view; omit for the
   *  segment-wide portfolio (which includes a per-project breakdown). */
  rollup: (projectId?: number): Promise<RoiRollup> =>
    request<RoiRollup>(`/api/roi/rollup${projectId != null ? `?project=${projectId}` : ''}`),
};

// ── PMO tier (portfolio / initiative / OKR above projects; /api/pmo/*) ─────────
// The enterprise rollup objects. Management CRUD rides the segment-tracker
// clients; the live rollup + structure tree are bespoke composed reads. Mirrors
// the API shapes in api/src/application/pmo/portfolioRollup.ts.
export type PmoScopeKind = 'portfolio' | 'initiative' | 'workspace';

export interface Portfolio {
  id: string; name: string; description: string | null; status: string;
  ownerUserId: string | null; targetDate: string | null;
}
export interface Initiative {
  id: string; name: string; description: string | null; status: string;
  portfolioId: string | null; ownerUserId: string | null; targetDate: string | null;
}
export interface Objective {
  id: string; title: string; description: string | null; period: string | null;
  status: string; portfolioId: string | null; initiativeId: string | null; ownerUserId: string | null;
}
export interface KeyResult {
  id: string; objectiveId: string; title: string; metricType: string;
  startValue: number; targetValue: number; currentValue: number; unit: string | null; status: string;
}

export interface PmoTree {
  portfolios: Array<{ id: string; name: string; description: string | null; status: string; targetDate: string | null }>;
  initiatives: Array<{ id: string; name: string; description: string | null; status: string; portfolioId: string | null; targetDate: string | null; projectCount: number }>;
  projects: Array<{ id: number; name: string; key: string; status: string; initiativeId: string | null }>;
  dependencies: Array<{ id: string; fromInitiativeId: string; toInitiativeId: string }>;
}

export interface InitiativeRef { initiativeId: string; name: string; status: string }

export interface KeyResultProgress {
  id: string; title: string; metricType: string;
  startValue: number; targetValue: number; currentValue: number; unit: string | null; progress: number;
}
export interface ObjectiveProgress {
  id: string; title: string; period: string | null; status: string;
  initiativeId: string | null; progress: number; keyResults: KeyResultProgress[];
}
export interface PmoRollup {
  scope: { kind: PmoScopeKind; id: string; name: string };
  projectCount: number;
  initiativeCount: number;
  delivery: { totalTasks: number; completedCount: number; openCount: number; avgCycleTimeHours: number; throughputPerWeek: number };
  spend: { agentLlmCostUsd: number };
  dora: {
    windowDays: number; deploymentFrequencyPerDay: number; totalDeployments: number;
    leadTimeHours: number | null; changeFailureRatePct: number | null; mttrHours: number | null;
  };
  outcomes: { runs: number; avgScore: number; mergedRatePct: number | null };
  okr: { objectives: ObjectiveProgress[]; avgProgress: number };
  byInitiative: Array<{ initiativeId: string; name: string; status: string; projectCount: number; completedCount: number; agentLlmCostUsd: number; avgProgress: number; isBlocked: boolean; blockedBy: string[] }>;
  criticalPath: InitiativeRef[];
  cycleDetected: boolean;
  blockedBy: InitiativeRef[];
  blocks: InitiativeRef[];
}

const portfolioTracker = segmentTrackerClient('/api/pmo/portfolios');
const initiativeTracker = segmentTrackerClient('/api/pmo/initiatives');
const objectiveTracker = segmentTrackerClient('/api/pmo/objectives');
const keyResultTracker = segmentTrackerClient('/api/pmo/key-results');

export const pmoApi = {
  /** Flat structure lists (portfolios, initiatives, projects-with-link). */
  tree: (): Promise<PmoTree> => request<PmoTree>('/api/pmo/tree'),
  /** Composed rollup (cost/DORA/outcomes/OKR/deps) for a portfolio, initiative,
   *  or the org-level workspace (workspace ignores `id`). */
  rollup: (kind: PmoScopeKind, id?: string): Promise<PmoRollup> =>
    request<PmoRollup>(`/api/pmo/rollup?kind=${kind}${kind !== 'workspace' && id ? `&id=${encodeURIComponent(id)}` : ''}`),
  /** Link (or, with initiativeId=null, unlink) a project to an initiative. */
  linkProject: (projectId: number, initiativeId: string | null): Promise<{ id: number; initiativeId: string | null }> =>
    request(`/api/pmo/projects/${projectId}/link`, { method: 'PATCH', body: JSON.stringify({ initiativeId }) }),
  /** Add an initiative dependency edge (fromInitiative BLOCKS toInitiative). */
  addDependency: (fromInitiativeId: string, toInitiativeId: string): Promise<{ id?: string; fromInitiativeId: string; toInitiativeId: string }> =>
    request('/api/pmo/dependencies', { method: 'POST', body: JSON.stringify({ fromInitiativeId, toInitiativeId }) }),
  /** Remove an initiative dependency edge by id. */
  removeDependency: (id: string): Promise<{ deleted: string }> =>
    request(`/api/pmo/dependencies/${id}`, { method: 'DELETE' }),

  portfolios: {
    list: () => portfolioTracker.list() as unknown as Promise<Portfolio[]>,
    create: (body: Partial<Omit<Portfolio, 'id'>>) => portfolioTracker.create(body) as unknown as Promise<Portfolio>,
    update: (id: string, body: Partial<Omit<Portfolio, 'id'>>) => portfolioTracker.update(id, body) as unknown as Promise<Portfolio>,
    remove: (id: string) => portfolioTracker.remove(id),
  },
  initiatives: {
    list: () => initiativeTracker.list() as unknown as Promise<Initiative[]>,
    create: (body: Partial<Omit<Initiative, 'id'>>) => initiativeTracker.create(body) as unknown as Promise<Initiative>,
    update: (id: string, body: Partial<Omit<Initiative, 'id'>>) => initiativeTracker.update(id, body) as unknown as Promise<Initiative>,
    remove: (id: string) => initiativeTracker.remove(id),
  },
  objectives: {
    list: () => objectiveTracker.list() as unknown as Promise<Objective[]>,
    create: (body: Partial<Omit<Objective, 'id'>>) => objectiveTracker.create(body) as unknown as Promise<Objective>,
    update: (id: string, body: Partial<Omit<Objective, 'id'>>) => objectiveTracker.update(id, body) as unknown as Promise<Objective>,
    remove: (id: string) => objectiveTracker.remove(id),
  },
  keyResults: {
    list: () => keyResultTracker.list() as unknown as Promise<KeyResult[]>,
    create: (body: Partial<Omit<KeyResult, 'id'>>) => keyResultTracker.create(body) as unknown as Promise<KeyResult>,
    update: (id: string, body: Partial<Omit<KeyResult, 'id'>>) => keyResultTracker.update(id, body) as unknown as Promise<KeyResult>,
    remove: (id: string) => keyResultTracker.remove(id),
  },
};

// Sprints (agile tracker; /api/agile/sprints). A planning ceremony creates/uses a
// sprint and schedules tasks into it via tasksApi.update({ sprintId }).
export interface Sprint {
  id: string;
  name: string;
  goal: string | null;
  status: 'planning' | 'active' | 'completed' | 'archived';
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
}

// ── Ceremony sessions (standup / planning tracking; /api/agile/ceremonies) ──
export type CeremonyKind = 'standup' | 'planning';

export interface CeremonySession {
  id: string;
  projectId: number;
  kind: CeremonyKind;
  status: 'active' | 'completed';
  facilitatorId: string | null;
  turnMode: 'facilitator' | 'timeboxed';
  turnSeconds: number;
  /** Index into participants.turnOrder of the current speaker (null = not started/ended). */
  currentTurn: number | null;
  turnStartedAt: string | null;
  startedAt: string;
  endedAt: string | null;
}

export interface CeremonyParticipant {
  id: string;
  sessionId: string;
  memberKind: 'human' | 'cloud_agent' | 'host_agent';
  memberRef: string;
  memberName: string;
  turnOrder: number;
  durationMs: number;
}

export interface CeremonySessionDetail {
  session: CeremonySession | null;
  participants?: CeremonyParticipant[];
}

const CEREMONY_BASE = '/api/agile/ceremonies';
export const ceremonySessionsApi = {
  active: (projectId: number, kind: CeremonyKind): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions?projectId=${projectId}&kind=${kind}`),
  start: (projectId: number, kind: CeremonyKind, participants: Array<{ kind: string; ref: string; name: string }>): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions`, { method: 'POST', body: JSON.stringify({ projectId, kind, participants }) }),
  advanceTurn: (id: string, currentTurn: number): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/turn`, { method: 'PATCH', body: JSON.stringify({ currentTurn }) }),
  complete: (id: string): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/complete`, { method: 'POST' }),
};

// Member metrics & profiles (the workforce scorecard system) live in `membersApi`
// (declared earlier in this file) — the ceremony UI consumes those directly.

const sprintTracker = segmentTrackerClient('/api/agile/sprints');
export const sprintsApi = {
  list: () => sprintTracker.list() as unknown as Promise<Sprint[]>,
  create: (body: {
    name: string;
    goal?: string;
    status?: Sprint['status'];
    startDate?: string;
    endDate?: string;
    capacity?: number;
  }) => sprintTracker.create(body) as unknown as Promise<Sprint>,
  update: (id: string, body: Partial<Omit<Sprint, 'id'>>) =>
    sprintTracker.update(id, body) as unknown as Promise<Sprint>,
  remove: (id: string) => sprintTracker.remove(id),
};

// Planning Poker + Retrospectives (nested session models; /api/agile/*).
export interface PokerSession { id: string; name: string; votingSystem: string; status: string; }
export interface PokerVote { userId: string; value: string | null; isRevealed: boolean; }
export interface PokerStory { id: string; title: string; description: string | null; status: string; finalEstimate: string | null; position: number; votes: PokerVote[]; }
export interface PokerSessionDetail extends PokerSession { stories: PokerStory[]; }
export interface RetroItem { id: string; category: string; content: string; authorId: string | null; votes: number; }
export interface Retrospective { id: string; name: string; template: string; status: string; }
export interface RetroDetail extends Retrospective { items: RetroItem[]; }

export const pokerApi = {
  listSessions: () => request<PokerSession[]>('/api/agile/poker/sessions'),
  createSession: (name: string, votingSystem?: string) => request<PokerSession>('/api/agile/poker/sessions', { method: 'POST', body: JSON.stringify({ name, votingSystem }) }),
  getSession: (id: string) => request<PokerSessionDetail>(`/api/agile/poker/sessions/${id}`),
  addStory: (sessionId: string, title: string, description?: string) => request<PokerStory>(`/api/agile/poker/sessions/${sessionId}/stories`, { method: 'POST', body: JSON.stringify({ title, description }) }),
  vote: (storyId: string, value: string) => request<{ ok: boolean }>(`/api/agile/poker/stories/${storyId}/vote`, { method: 'POST', body: JSON.stringify({ value }) }),
  reveal: (storyId: string) => request<{ ok: boolean }>(`/api/agile/poker/stories/${storyId}/reveal`, { method: 'POST' }),
  patchStory: (storyId: string, body: { finalEstimate?: string; status?: string }) => request<PokerStory>(`/api/agile/poker/stories/${storyId}`, { method: 'PATCH', body: JSON.stringify(body) }),
};

export const retroApi = {
  list: () => request<Retrospective[]>('/api/agile/retros'),
  create: (name: string, template?: string) => request<Retrospective>('/api/agile/retros', { method: 'POST', body: JSON.stringify({ name, template }) }),
  get: (id: string) => request<RetroDetail>(`/api/agile/retros/${id}`),
  addItem: (retroId: string, category: string, content: string) => request<RetroItem>(`/api/agile/retros/${retroId}/items`, { method: 'POST', body: JSON.stringify({ category, content }) }),
  voteItem: (itemId: string) => request<RetroItem>(`/api/agile/retros/items/${itemId}/vote`, { method: 'POST' }),
  deleteItem: (itemId: string) => request<{ deleted: string }>(`/api/agile/retros/items/${itemId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Analytics — unified contributor activity calendar (humans + AI agents)
// ---------------------------------------------------------------------------

export interface CalendarCell {
  date: string;   // YYYY-MM-DD
  count: number;
  level: number;  // 0–4 intensity bucket
}

export interface ContributorCalendar {
  id: number;
  displayName: string;
  kind: 'human' | 'agent';
  avatarUrl: string | null;
  jobTitle: string | null;
  agentHostId: number | null;
  total: number;
  days: CalendarCell[];
}

export interface ActivityCalendar {
  range: { from: string; to: string };
  maxCount: number;
  contributors: ContributorCalendar[];
  calendar: CalendarCell[];
}

export const analyticsApi = {
  activityCalendar: (params?: { from?: string; to?: string; contributorId?: number }) => {
    const q = new URLSearchParams();
    if (params?.from) q.set('from', params.from);
    if (params?.to) q.set('to', params.to);
    if (params?.contributorId != null) q.set('contributorId', String(params.contributorId));
    const query = q.toString();
    return request<ActivityCalendar>(`/api/analytics/activity-calendar${query ? `?${query}` : ''}`);
  },
  syncAgents: () =>
    request<{ created: number; updated: number; total: number }>('/api/analytics/sync-agents', { method: 'POST' }),

  /** Owner-facing cross-project activity rollup for the whole tenant. */
  tenantRollup: (days = 30): Promise<TenantActivityRollup> =>
    request<TenantActivityRollup>(`/api/analytics/tenant-rollup?days=${days}`),
};

// ---------------------------------------------------------------------------
// Tenant activity rollup (cross-project) + contributor consolidation (merge)
// ---------------------------------------------------------------------------

export interface TenantActivityRollup {
  windowDays: number;
  range: { from: string; to: string };
  totalEvents: number;
  activeContributors: number;
  totals: { linesAdded: number; linesRemoved: number };
  byType: Record<string, number>;
  byProvider: Array<{ provider: string; count: number }>;
  byRepository: Array<{ repository: string; count: number }>;
  byProject: Array<{ projectId: number; projectName: string; count: number }>;
  topContributors: Array<{ contributorId: number; displayName: string; count: number }>;
  daily: Array<{ date: string; count: number }>;
}

export interface ContributorRow {
  id: number;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  roleType: string;
  kind: 'human' | 'agent';
  userId: string | null;
  mergedIntoId: number | null;
  isActive: boolean;
}

export interface DuplicateGroup {
  reason: 'email' | 'identity_email' | 'name';
  key: string;
  contributors: Array<{ id: number; displayName: string; email: string | null; userId: string | null }>;
}

export interface MergePreview {
  source: { id: number; displayName: string; userId: string | null };
  target: { id: number; displayName: string; userId: string | null };
  movedActivityCount: number;
  movedIdentityCount: number;
  dedupedIdentityCount: number;
  movedTeamCount: number;
  dedupedTeamCount: number;
  willInheritUserLink: boolean;
}

export interface MergeRecord {
  id: string;
  targetContributorId: number | null;
  sourceContributorId: number | null;
  movedActivityCount: number;
  movedIdentityCount: number;
  status: 'merged' | 'reverted';
  mergedByUserId: string | null;
  mergedAt: string;
  revertedAt: string | null;
}

export const contributorsApi = {
  list: (includeMerged = false): Promise<{ contributors: ContributorRow[] }> =>
    request<{ contributors: ContributorRow[] }>(`/api/contributors${includeMerged ? '?includeMerged=true' : ''}`),

  duplicates: (): Promise<{ groups: DuplicateGroup[] }> =>
    request<{ groups: DuplicateGroup[] }>('/api/contributors/duplicates'),

  mergePreview: (sourceId: number, targetId: number): Promise<MergePreview> =>
    request<MergePreview>('/api/contributors/merge/preview', { method: 'POST', body: JSON.stringify({ sourceId, targetId }) }),

  merge: (sourceId: number, targetId: number): Promise<{ mergeId: string; movedActivityCount: number; movedIdentityCount: number }> =>
    request('/api/contributors/merge', { method: 'POST', body: JSON.stringify({ sourceId, targetId }) }),

  merges: (): Promise<{ merges: MergeRecord[] }> =>
    request<{ merges: MergeRecord[] }>('/api/contributors/merges'),

  revertMerge: (mergeId: string): Promise<{ reverted: true; sourceId: number; targetId: number }> =>
    request(`/api/contributors/merges/${mergeId}/revert`, { method: 'POST' }),

  linkUser: (contributorId: number, userId: string | null): Promise<ContributorRow> =>
    request<ContributorRow>(`/api/contributors/${contributorId}/link-user`, { method: 'PATCH', body: JSON.stringify({ userId }) }),
};

// ---------------------------------------------------------------------------
// Prompt Library — versioned templates with a public gallery
// ---------------------------------------------------------------------------

export interface PromptSummary {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  category: string | null;
  tags: string[];
  authorName: string | null;
  currentVersion: number;
  usageCount: number;
  starCount: number;
  isFeatured: boolean;
  updatedAt: string;
}

export interface PromptVariable { name: string; description?: string; default?: string; }

export interface PromptPublicView extends PromptSummary {
  body: string;
  variables: PromptVariable[];
  model: string | null;
}

export interface PromptVersion {
  id: string;
  version: number;
  body: string;
  variables: PromptVariable[];
  model: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PromptEntry extends PromptSummary {
  visibility: 'private' | 'tenant' | 'public';
  authorUserId: string | null;
  versions?: PromptVersion[];
}

export interface CreatePromptBody {
  title: string;
  description?: string;
  category?: string;
  tags?: string[];
  visibility?: 'private' | 'tenant' | 'public';
  authorName?: string;
  body: string;
  variables?: PromptVariable[];
  model?: string;
  notes?: string;
}

export const promptLibraryApi = {
  // Public (no auth required)
  browsePublic: (params?: { q?: string; category?: string; tag?: string; sort?: 'popular' | 'recent' | 'featured'; limit?: number; offset?: number }) => {
    const q = new URLSearchParams();
    if (params?.q) q.set('q', params.q);
    if (params?.category) q.set('category', params.category);
    if (params?.tag) q.set('tag', params.tag);
    if (params?.sort) q.set('sort', params.sort);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.offset != null) q.set('offset', String(params.offset));
    const query = q.toString();
    return request<{ prompts: PromptSummary[] }>(`/api/prompts/public${query ? `?${query}` : ''}`).then((r) => r.prompts);
  },
  getPublic: (slug: string) => request<PromptPublicView>(`/api/prompts/public/${slug}`),
  usePublic: (slug: string) => request<PromptPublicView & { usageCount: number }>(`/api/prompts/public/${slug}/use`, { method: 'POST' }),

  // Authenticated (tenant JWT)
  list: () => request<{ prompts: PromptEntry[] }>('/api/prompts').then((r) => r.prompts),
  get: (id: string) => request<PromptEntry>(`/api/prompts/${id}`),
  create: (body: CreatePromptBody) => request<PromptEntry>('/api/prompts', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<Pick<PromptEntry, 'title' | 'description' | 'category' | 'tags' | 'visibility'>>) =>
    request<PromptEntry>(`/api/prompts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  addVersion: (id: string, body: { body: string; variables?: PromptVariable[]; model?: string; notes?: string }) =>
    request<PromptEntry & { version: number }>(`/api/prompts/${id}/versions`, { method: 'POST', body: JSON.stringify(body) }),
  remove: (id: string) => request<{ deleted: boolean }>(`/api/prompts/${id}`, { method: 'DELETE' }),
  star: (id: string) => request<{ starred: boolean }>(`/api/prompts/${id}/star`, { method: 'POST' }),
  unstar: (id: string) => request<{ starred: boolean }>(`/api/prompts/${id}/star`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Integration credentials — /api/integrations  (GitHub / GitLab / Bitbucket /
// Jira / Confluence / Freshservice keys). Workspace-global when projectId is
// omitted, project-scoped when set (0074).
// ---------------------------------------------------------------------------

export type IntegrationProvider =
  | 'github' | 'gitlab' | 'bitbucket' | 'jira' | 'confluence' | 'freshservice'
  | 'servicenow' | 'linear' | 'sentry' | 'pagerduty' | 'monday' | 'asana' | 'clickup';

export interface IntegrationCredential {
  id: string;
  projectId: number | null;
  provider: IntegrationProvider;
  name: string;
  baseUrl: string | null;
  isEnabled: boolean;
  lastTestedAt?: string | null;
  lastTestOk?: boolean | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateIntegrationBody {
  provider: IntegrationProvider;
  name: string;
  baseUrl?: string | null;
  projectId?: number | null;
  credentials: Record<string, string>;
}

export const integrationsApi = {
  /** No opts → all tenant creds; {projectId} → that project; {scope:'global'} → workspace-global only. */
  list: (opts?: { projectId?: number; scope?: 'global' }): Promise<IntegrationCredential[]> => {
    const params = new URLSearchParams();
    if (opts?.projectId != null) params.set('projectId', String(opts.projectId));
    else if (opts?.scope) params.set('scope', opts.scope);
    const q = params.toString();
    return request<{ integrations: IntegrationCredential[] }>(`/api/integrations${q ? `?${q}` : ''}`)
      .then((r) => r.integrations ?? []);
  },

  get: (id: string): Promise<IntegrationCredential & { credentials: Record<string, string> }> =>
    request(`/api/integrations/${id}`),

  create: (body: CreateIntegrationBody): Promise<IntegrationCredential> =>
    request('/api/integrations', { method: 'POST', body: JSON.stringify(body) }),

  update: (
    id: string,
    body: Partial<{ name: string; baseUrl: string | null; credentials: Record<string, string>; isEnabled: boolean }>,
  ): Promise<IntegrationCredential> =>
    request(`/api/integrations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string): Promise<{ deleted: boolean }> =>
    request(`/api/integrations/${id}`, { method: 'DELETE' }),

  test: (id: string): Promise<{ ok: boolean; message: string }> =>
    request(`/api/integrations/${id}/test`, { method: 'POST' }),

  syncLogs: (id: string, limit = 20) =>
    request<{ logs: unknown[] }>(`/api/integrations/${id}/sync-logs?limit=${limit}`).then((r) => r.logs ?? []),
};

// ---------------------------------------------------------------------------
// Project repositories — /api/repos/*
// ---------------------------------------------------------------------------

export interface ProjectRepository {
  id: string;
  projectId: number;
  provider: string;
  host: string;
  owner: string;
  repo: string;
  defaultBranch: string | null;
  cloneUrlHttps: string | null;
  isDefault: boolean;
  credentialId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AddRepositoryBody {
  provider: string;
  owner: string;
  repo: string;
  host?: string;
  defaultBranch?: string | null;
  cloneUrlHttps?: string | null;
  isDefault?: boolean;
  credentialId?: string | null;
}

export interface ImportedRepoFile {
  path: string;
  content: string;
  truncated: boolean;
}

export interface ImportRepoManifest {
  ok: boolean;
  ref: string;
  files: ImportedRepoFile[];
  discovered: number;
  skipped: string[];
  truncated: boolean;
}

export const reposApi = {
  list: (projectId: number): Promise<ProjectRepository[]> =>
    request<{ repositories: ProjectRepository[] }>(`/api/repos/projects/${projectId}/repositories`)
      .then((r) => r.repositories ?? []),

  /** Read a connected repo's files (server-side, token-scoped) for importing into
   *  the IDE workspace. The caller persists the manifest via saveFile. */
  contents: (id: string, ref?: string): Promise<ImportRepoManifest> =>
    request<ImportRepoManifest>(
      `/api/repos/repositories/${id}/contents${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`,
    ),

  add: (projectId: number, body: AddRepositoryBody): Promise<ProjectRepository> =>
    request(`/api/repos/projects/${projectId}/repositories`, { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<AddRepositoryBody>): Promise<ProjectRepository> =>
    request(`/api/repos/repositories/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  setDefault: (id: string): Promise<ProjectRepository> =>
    request(`/api/repos/repositories/${id}/default`, { method: 'POST' }),

  test: (id: string): Promise<{ ok: boolean; message: string }> =>
    request(`/api/repos/repositories/${id}/test`, { method: 'POST' }),

  remove: (id: string): Promise<void> =>
    request<void>(`/api/repos/repositories/${id}`, { method: 'DELETE' }),

  listPullRequests: (projectId: number) =>
    request<{ pullRequests: unknown[] }>(`/api/repos/projects/${projectId}/pull-requests`).then((r) => r.pullRequests ?? []),

  // The latest recorded PR for a task + live provider detail (pullRequest is null
  // when the task has no PR yet).
  getTaskPullRequest: (taskId: number): Promise<TaskPullRequest | null> =>
    request<{ pullRequest: PullRequestRow | null; detail: PullRequestDetail | null }>(
      `/api/repos/tasks/${taskId}/pull-request`,
    ).then((r) => (r.pullRequest ? { pullRequest: r.pullRequest, detail: r.detail } : null)),

  // Approve & merge a recorded PR in-product (server-side with the tenant's token).
  mergePullRequest: (prId: string, method: MergeMethod = 'squash'): Promise<MergePrResponse> =>
    request<MergePrResponse>(`/api/repos/pull-requests/${prId}/merge`, {
      method: 'POST',
      body: JSON.stringify({ method }),
    }),
};

export type MergeMethod = 'squash' | 'merge' | 'rebase';

/** A recorded pull_requests row (subset the UI renders). */
export interface PullRequestRow {
  id: string;
  taskId: number | null;
  projectId: number;
  provider: string;
  number: number | null;
  url: string | null;
  branchName: string | null;
  baseBranch: string | null;
  status: string;          // draft | open | merged | closed
  mergedBy: string | null;
  mergedAt: string | null;
  mergeSha: string | null;
  buildStatus: string | null;  // null | pending | success | failure (pre-merge PR-branch or post-merge build)
  buildError: string | null;   // failing jobs/steps summary when buildStatus === 'failure'
}

/** Live provider-side state for a PR (mirrors api getPullRequestDetail). */
export interface PullRequestDetail {
  supported: boolean;
  state: string | null;
  merged: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  additions: number | null;
  deletions: number | null;
  changedFiles: number | null;
  checks: 'success' | 'failure' | 'pending' | null;
  checksTotal: number;
  error?: string;
}

export interface TaskPullRequest {
  pullRequest: PullRequestRow;
  detail: PullRequestDetail | null;
}

export interface MergePrResponse {
  ok: boolean;
  merged?: boolean;
  sha?: string | null;
  alreadyMerged?: boolean;
  pullRequest?: PullRequestRow;
}

// ---------------------------------------------------------------------------
// External board connections — /api/board-connections  (Jira / GitHub PM sync)
// ---------------------------------------------------------------------------

export interface BoardConnection {
  id: string;
  projectId: number;
  provider: string;
  credentialId: string | null;
  externalBoardId: string | null;
  status: string;
  webhookEnabled: boolean;
  pollIntervalSec: number;
  lastPolledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBoardConnectionBody {
  projectId: number;
  provider: string;
  credentialId?: string | null;
  externalBoardId?: string | null;
  webhookSecret?: string | null;
  webhookEnabled?: boolean;
  pollIntervalSec?: number;
}

export const boardConnectionsApi = {
  list: (projectId?: number): Promise<BoardConnection[]> => {
    const q = projectId != null ? `?projectId=${projectId}` : '';
    return request<{ connections: BoardConnection[] }>(`/api/board-connections${q}`).then((r) => r.connections ?? []);
  },

  get: (id: string): Promise<BoardConnection> =>
    request(`/api/board-connections/${id}`),

  create: (body: CreateBoardConnectionBody): Promise<BoardConnection> =>
    request('/api/board-connections', { method: 'POST', body: JSON.stringify(body) }),

  update: (id: string, body: Partial<Omit<CreateBoardConnectionBody, 'projectId'>> & { status?: string }): Promise<BoardConnection> =>
    request(`/api/board-connections/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (id: string): Promise<void> =>
    request<void>(`/api/board-connections/${id}`, { method: 'DELETE' }),

  /** Kick off (or re-run) a sync for this connection. */
  sync: (id: string): Promise<{ result: unknown }> =>
    request(`/api/board-connections/${id}/sync`, { method: 'POST' }),

  links: (id: string) =>
    request<{ links: unknown[] }>(`/api/board-connections/${id}/links`).then((r) => r.links ?? []),
};

// ---------------------------------------------------------------------------
// Cloud-agent boards / swimlanes / agent assignments — /api/boards/*
// ---------------------------------------------------------------------------

export interface Board {
  id: string;
  projectId: number;
  name: string;
  autonomous: boolean;
  maxConcurrentTickets: number;
  needsAttentionLane: string | null;
  /** Standup turn-timer behaviour for this board's ceremonies (migration 0119). */
  standupTurnMode: 'facilitator' | 'timeboxed';
  standupTurnSeconds: number;
  /** Hide tickets sitting in a terminal (Done) lane from the board (migration 0194). */
  hideDoneItems: boolean;
  createdAt: string;
  updatedAt: string;
  swimlanes?: Swimlane[];
}

/** What a lane does once its agents settle per its success policy. */
export type LaneActionType = 'advance' | 'move_ticket' | 'run_workflow' | 'do_nothing';
export type LaneSuccessPolicy = 'all' | 'any' | 'n_of_m';

export interface Swimlane {
  id: string;
  boardId: string;
  key: string;
  name: string;
  position: number;
  isTerminal: boolean;
  gate: 'auto' | 'human';
  executionMode: 'sequential' | 'parallel';
  failurePolicy: 'needs_attention' | 'retry' | 'skip';
  /** Lane action fired once the stage settles (null ⇒ advance to next lane). */
  actionType: LaneActionType | null;
  /** Target lane key (move_ticket) | workflow definition id (run_workflow). */
  actionTarget: string | null;
  successPolicy: LaneSuccessPolicy;
  successThreshold: number | null;
  createdAt: string;
  updatedAt?: string;
}

export interface SwimlaneAgent {
  id: string;
  swimlaneId: string;
  /** Which registry agent was chosen. */
  agentKind: 'workforce' | 'registered' | null;
  agentRef: string | null;
  name: string | null;
  role: string;
  runtime: 'cloud' | 'local' | 'remote' | 'browser';
  target: string | null;
  model: string | null;
  position: number;
  taskTemplate: string | null;
  requiredCapabilities: unknown;
  createdAt: string;
}

/** A live per-agent dispatch status across a board's tickets. */
export interface BoardDispatch {
  id: string;
  ticketRunId: string;
  taskId: number | null;
  swimlaneId: string | null;
  assignmentId: string | null;
  status: 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
  role: string;
  name: string | null;
  stageSeq: number;
  position: number;
  updatedAt: string;
}

export const boardsApi = {
  list: (): Promise<Board[]> =>
    request<{ boards: Board[] }>('/api/boards').then((r) => r.boards ?? []),

  get: (boardId: string): Promise<Board> =>
    request(`/api/boards/${boardId}`),

  create: (body: { projectId: number; name: string; maxConcurrentTickets?: number; needsAttentionLane?: string | null }): Promise<Board> =>
    request('/api/boards', { method: 'POST', body: JSON.stringify(body) }),

  update: (boardId: string, body: Partial<{ name: string; maxConcurrentTickets: number; needsAttentionLane: string | null; standupTurnMode: 'facilitator' | 'timeboxed'; standupTurnSeconds: number; hideDoneItems: boolean }>): Promise<Board> =>
    request(`/api/boards/${boardId}`, { method: 'PATCH', body: JSON.stringify(body) }),

  remove: (boardId: string): Promise<void> =>
    request<void>(`/api/boards/${boardId}`, { method: 'DELETE' }),

  /** Live per-agent dispatch status across the board's tickets (NOT cached). */
  dispatches: (boardId: string): Promise<BoardDispatch[]> =>
    request<{ dispatches: BoardDispatch[] }>(`/api/boards/${boardId}/dispatches`).then((r) => r.dispatches ?? []),

  swimlanes: {
    list: (boardId: string): Promise<Swimlane[]> =>
      request<{ swimlanes: Swimlane[] }>(`/api/boards/${boardId}/swimlanes`).then((r) => r.swimlanes ?? []),
    /** Seed the default status-mirroring lanes when a board has none. Idempotent. */
    ensureDefaults: (boardId: string): Promise<Swimlane[]> =>
      request<{ swimlanes: Swimlane[] }>(`/api/boards/${boardId}/swimlanes/ensure-defaults`, { method: 'POST' }).then((r) => r.swimlanes ?? []),
    create: (boardId: string, body: Partial<LaneWriteBody> & { key: string; name: string }): Promise<Swimlane> =>
      request(`/api/boards/${boardId}/swimlanes`, { method: 'POST', body: JSON.stringify(body) }),
    patch: (boardId: string, laneId: string, body: Partial<LaneWriteBody>): Promise<Swimlane> =>
      request(`/api/boards/${boardId}/swimlanes/${laneId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (boardId: string, laneId: string): Promise<void> =>
      request<void>(`/api/boards/${boardId}/swimlanes/${laneId}`, { method: 'DELETE' }),
  },

  agents: {
    list: (boardId: string, laneId: string): Promise<SwimlaneAgent[]> =>
      request<{ assignments: SwimlaneAgent[] }>(`/api/boards/${boardId}/swimlanes/${laneId}/agents`).then((r) => r.assignments ?? []),
    create: (boardId: string, laneId: string, body: { agentKind: 'workforce' | 'registered'; agentRef: string; name?: string | null; role?: string | null; model?: string | null; position?: number }): Promise<SwimlaneAgent> =>
      request(`/api/boards/${boardId}/swimlanes/${laneId}/agents`, { method: 'POST', body: JSON.stringify(body) }),
    remove: (boardId: string, laneId: string, id: string): Promise<void> =>
      request<void>(`/api/boards/${boardId}/swimlanes/${laneId}/agents/${id}`, { method: 'DELETE' }),
  },
};

/** Mutable swimlane fields shared by the create + patch requests. */
interface LaneWriteBody {
  name: string;
  position: number;
  isTerminal: boolean;
  gate: string;
  executionMode: string;
  failurePolicy: string;
  actionType: string;
  actionTarget: string;
  successPolicy: string;
  successThreshold: number;
}


// ── Anonymous pending prompts (landing-page → Brain handoff, cross-device) ──
// Durable server record alongside the localStorage fast path. `save` is public
// (pre-auth); `claim` sends the web token so the server can associate the row to
// the user. Both are best-effort — failures never block the funnel. [1517]
const ANON_ID_KEY = 'bf_anon_id';

function getAnonId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = window.localStorage.getItem(ANON_ID_KEY);
    if (!id) {
      id = (crypto?.randomUUID?.() ?? `a-${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 64);
      window.localStorage.setItem(ANON_ID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

export const pendingPromptsApi = {
  /** Record an anonymous landing prompt server-side (best-effort, fire-and-forget). */
  save(prompt: string, path?: string): void {
    const anonId = getAnonId();
    if (!anonId || !prompt.trim()) return;
    void fetch(`${AUTH_API_URL}/api/pending-prompts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anonId, prompt: prompt.trim(), path }),
    }).catch(() => {});
  },

  /** Claim this browser's anon prompt after auth (cross-device fallback). Returns null on miss. */
  async claim(): Promise<string | null> {
    const anonId = getAnonId();
    if (!anonId) return null;
    try {
      const res = await fetch(`${AUTH_API_URL}/api/pending-prompts/claim`, {
        method: 'POST',
        headers: webAuthHeaders(),
        body: JSON.stringify({ anonId }),
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => ({}))) as { prompt?: string | null };
      return body.prompt ?? null;
    } catch {
      return null;
    }
  },
};

// ---------------------------------------------------------------------------
// Personas marketplace (server-backed public registry)
//
// The persona marketplace listing now comes from the API rather than only the
// hardcoded builtins/localStorage. All methods degrade gracefully on an older
// backend that 404s the new routes (browse returns []), so the page keeps
// working with its localStorage "My Personas" draft layer as a fallback.
// ---------------------------------------------------------------------------

/** A persona published to the public registry. Mirrors the marketplace persona shape. */
export interface PublicPersona {
  id: string;
  slug: string;
  name: string;
  description: string;
  voice?: string;
  perspective?: string;
  decisionStyle?: string;
  outputPrefix?: string;
  capabilities?: string[];
  tags?: string[];
  author?: string;
  image?: string;
  likes?: number;
  downloads?: number;
  createdAt?: string;
}

export interface PublishPersonaInput {
  name: string;
  slug?: string;
  description?: string;
  voice?: string;
  perspective?: string;
  decisionStyle?: string;
  outputPrefix?: string;
  capabilities?: string[];
  tags?: string[];
  image?: string;
}

/** True when an error came from a 404 (older backend without the personas routes). */
function isNotFound(e: unknown): boolean {
  return e instanceof Error && /\b404\b|not found/i.test(e.message);
}

export const personasApi = {
  /**
   * Browse the public persona registry. Supports free-text `q`, `category`, and
   * `sort`. Returns [] (not a throw) when the backend doesn't yet serve the
   * route, so callers can fall back to builtins without special-casing.
   */
  listPublic: async (params?: { q?: string; category?: string; sort?: string }): Promise<PublicPersona[]> => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.category) qs.set('category', params.category);
    if (params?.sort) qs.set('sort', params.sort);
    const query = qs.toString();
    try {
      const res = await fetch(`${AUTH_API_URL}/api/personas/public${query ? `?${query}` : ''}`);
      if (res.status === 404) return [];
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || res.statusText || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { personas?: PublicPersona[] } | PublicPersona[];
      return Array.isArray(data) ? data : data.personas ?? [];
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  },

  /** Fetch a single public persona by slug. Returns null when missing / unsupported. */
  getBySlug: async (slug: string): Promise<PublicPersona | null> => {
    try {
      const res = await fetch(`${AUTH_API_URL}/api/personas/${encodeURIComponent(slug)}`);
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || res.statusText || `Request failed (${res.status})`);
      }
      const data = (await res.json()) as { persona?: PublicPersona } | PublicPersona;
      return (data as { persona?: PublicPersona }).persona ?? (data as PublicPersona);
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  },

  /** Publish a persona to the public registry (authenticated). */
  publish: (input: PublishPersonaInput): Promise<PublicPersona> =>
    request<{ persona: PublicPersona } | PublicPersona>('/api/personas', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => (r as { persona?: PublicPersona }).persona ?? (r as PublicPersona)),

  /** Install a published persona into the current tenant (authenticated). */
  install: (id: string): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/personas/${encodeURIComponent(id)}/install`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};

// ── Role-insight lenses (/api/insights/* and /api/innovation/*) ───────────────
// Read-only rollups that make the insights.* RBAC gates live. Shapes mirror the
// API read-models in api/src/application/insights/*. See insightsRoutes.ts.

export interface EffectivenessBucket {
  key: string; actionType?: string; model?: string;
  runs: number; avgScore: number; mergedRatePct: number; ciGreenRatePct: number;
  degradedRatePct: number; avgSteps: number; costUsd: number;
}
export interface EngineeringInsights {
  windowDays: number;
  totals: { runs: number; avgScore: number; mergedRatePct: number; ciGreenRatePct: number; degradedRatePct: number; costUsd: number };
  byModel: EffectivenessBucket[];
  byActionType: EffectivenessBucket[];
  byApproach: EffectivenessBucket[];
}

export interface DoraInsights {
  windowDays: number;
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
}

export type BudgetState = 'no_budget' | 'on_track' | 'forecast_over' | 'over';
export interface FinanceBudgetLine {
  id: string; scopeKind: string; projectId: number | null; initiativeId: string | null;
  scopeName: string; limitUsd: number; actualUsd: number; forecastUsd: number; status: BudgetState;
}
export interface FinanceInsights {
  periodMonth: string;
  totals: { spendUsd: number; forecastUsd: number; paidOverflowUsd: number; cacheReadTokens: number; cacheCreationTokens: number; costPerMergedPrUsd: number | null; mergedRuns: number };
  daily: Array<{ date: string; usd: number }>;
  byProject: Array<{ projectId: number; projectName: string; usd: number }>;
  budgets: FinanceBudgetLine[];
}

export type ToolRisk = 'sensitive' | 'normal';
export interface ComplianceSummary {
  windowDays: number; totalEvents: number; sensitiveEvents: number; distinctExecutions: number; distinctAgents: number;
  byTool: Array<{ toolName: string; risk: ToolRisk; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  byAgent: Array<{ agent: string; kind: 'host' | 'cloud'; count: number }>;
}

export type FunnelStage = 'idea' | 'validated' | 'in_build' | 'shipped' | 'measured';
export interface FunnelMetrics {
  totalIdeas: number; activeIdeas: number; killedCount: number;
  ideaToShipPct: number | null; avgIdeaToShipDays: number | null;
  stages: Array<{ stage: FunnelStage; current: number; reached: number; conversionFromPrevPct: number | null; avgDaysInStage: number | null }>;
}

export interface Budget extends TrackerRow {
  scopeKind: string; projectId: number | null; initiativeId: string | null; periodMonth: string; limitUsd: number; notes: string | null;
}
export interface InnovationIdea extends TrackerRow {
  initiativeId: string | null; title: string; description: string | null; stage: FunnelStage | 'killed';
  linkedProjectId: number | null; impact: number | null; effort: number | null; confidence: number | null;
  outcome: string | null; outcomeValue: number | null; killedReason: string | null;
}

const budgetTracker = segmentTrackerClient('/api/insights/budgets');
const ideaTracker = segmentTrackerClient('/api/innovation/ideas');

export const insightsApi = {
  engineering: (days = 30): Promise<EngineeringInsights> => request<EngineeringInsights>(`/api/insights/engineering?days=${days}`),
  dora: (days = 30): Promise<DoraInsights> => request<DoraInsights>(`/api/insights/dora?days=${days}`),
  finance: (period?: string): Promise<FinanceInsights> => request<FinanceInsights>(`/api/insights/finance${period ? `?period=${period}` : ''}`),
  compliance: (days = 30): Promise<ComplianceSummary> => request<ComplianceSummary>(`/api/insights/compliance?days=${days}`),
  budgets: {
    list: () => budgetTracker.list() as unknown as Promise<Budget[]>,
    create: (body: Partial<Omit<Budget, 'id'>>) => budgetTracker.create(body) as unknown as Promise<Budget>,
    update: (id: string, body: Partial<Omit<Budget, 'id'>>) => budgetTracker.update(id, body) as unknown as Promise<Budget>,
    remove: (id: string) => budgetTracker.remove(id),
  },
};

export const innovationApi = {
  funnel: (initiativeId?: string): Promise<FunnelMetrics> =>
    request<FunnelMetrics>(`/api/innovation/funnel${initiativeId ? `?initiative=${encodeURIComponent(initiativeId)}` : ''}`),
  ideas: {
    list: () => ideaTracker.list() as unknown as Promise<InnovationIdea[]>,
    create: (body: Partial<Omit<InnovationIdea, 'id'>>) => ideaTracker.create(body) as unknown as Promise<InnovationIdea>,
    update: (id: string, body: Partial<Omit<InnovationIdea, 'id'>>) => ideaTracker.update(id, body) as unknown as Promise<InnovationIdea>,
    remove: (id: string) => ideaTracker.remove(id),
  },
};
