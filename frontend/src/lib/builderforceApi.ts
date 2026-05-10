/**
 * API client for api.builderforce.ai app endpoints:
 * Brain (chats, messages), Claws (list, register).
 * Uses tenant JWT from auth.
 */

import {
  AUTH_API_URL,
  checkUnauthorizedAndRedirect,
  getStoredTenantToken,
  getStoredWebToken,
} from './auth';
import { planLimitErrorFromResponse } from './planLimitError';

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
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || res.statusText || 'Request failed');
  }
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
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || res.statusText || 'Request failed');
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

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
};

/** OpenAI-compatible chat completion (uses tenant JWT for billing). */
export async function llmChat(
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ content: string }> {
  const headers = authHeaders();
  const hadToken = !!headers.Authorization;
  const res = await fetch(`${AUTH_API_URL}/llm/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages,
      temperature: options?.temperature ?? 0.3,
      max_tokens: options?.maxTokens ?? 4096,
    }),
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(err.error?.message || res.statusText || 'LLM request failed');
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? '';
  return { content };
}

// ---------------------------------------------------------------------------
// Claws (Workforce / Agent registration)
// ---------------------------------------------------------------------------

export interface Claw {
  id: number;
  name: string;
  tenantId: number;
  slug?: string;
  status?: string;
  apiKeyHash?: string;
  connectedAt: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClawRegistration extends Claw {
  apiKey: string;
}

export const claws = {
  list: () => request<{ claws: Claw[] }>('/api/claws').then((r) => r.claws),

  register: (name: string) =>
    request<{ claw: Claw; apiKey: string }>('/api/claws', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim() }),
    }).then((r) => ({ ...r.claw, apiKey: r.apiKey } as ClawRegistration)),

  /** WebSocket URL for claw relay (gateway). Pass tenant token via ?token=. */
  wsUrl: (clawId: number): string => {
    const base = (AUTH_API_URL || '').replace(/^http/, 'ws');
    const token = getStoredTenantToken();
    return `${base}/api/claws/${clawId}/ws?token=${encodeURIComponent(token || '')}`;
  },

  /** Tool audit events for timeline/observability. */
  toolAuditEvents: (
    clawId: number,
    params?: { runId?: string; sessionKey?: string; limit?: number }
  ) => {
    const q = new URLSearchParams();
    if (params?.runId) q.set('runId', params.runId);
    if (params?.sessionKey) q.set('sessionKey', params.sessionKey);
    if (params?.limit != null) q.set('limit', String(params.limit));
    const query = q.toString();
    return request<{ events: ToolAuditEvent[] }>(
      `/api/claws/${clawId}/tool-audit${query ? `?${query}` : ''}`
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
  ts: string;
}

export interface Workflow {
  id: string;
  clawId: number;
  specId?: string | null;
  workflowType: string;
  status: string;
  description?: string | null;
  createdAt: string;
  completedAt?: string | null;
  updatedAt: string;
  tasks?: WorkflowTask[];
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
  list: (params?: { status?: string; workflowType?: string; clawId?: number }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.workflowType) q.set('workflowType', params.workflowType);
    if (params?.clawId != null) q.set('clawId', String(params.clawId));
    const query = q.toString();
    return request<{ workflows: Workflow[] }>(
      `/api/workflows${query ? `?${query}` : ''}`
    ).then((r) => r.workflows);
  },
  get: (id: string) => request<Workflow>(`/api/workflows/${id}`),
  getGraph: (id: string) => request<WorkflowGraph>(`/api/workflows/${id}/graph`),
};

/** Tenant default claw (for workforce "Set as default"). */
export const tenantDefaultClaw = {
  get: (tenantId: number) =>
    request<{ defaultClawId: number | null }>(`/api/tenants/${tenantId}/default-claw`).then((r) => r.defaultClawId),
  set: (tenantId: number, clawId: number | null) =>
    request<{ defaultClawId: number | null }>(`/api/tenants/${tenantId}/default-claw`, {
      method: 'PUT',
      body: JSON.stringify({ clawId }),
    }).then((r) => r.defaultClawId),
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
// Artifact assignments (skills, personas, content → tenant/claw/project/task)
// ---------------------------------------------------------------------------

export type ArtifactType = 'skill' | 'persona' | 'content';
export type AssignmentScope = 'tenant' | 'claw' | 'project' | 'task';

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

export const artifactAssignments = {
  list: (scope: AssignmentScope, scopeId: number, artifactType?: ArtifactType) => {
    const q = new URLSearchParams({ scope: String(scope), scopeId: String(scopeId) });
    if (artifactType) q.set('artifactType', artifactType);
    return request<{ assignments: ArtifactAssignment[] }>(`/api/artifact-assignments?${q}`).then((r) => r.assignments);
  },

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
  status: TaskStatus;
  priority: TaskPriority;
  assignedAgentType: string | null;
  assignedClawId: number | null;
  githubPrUrl: string | null;
  githubPrNumber: number | null;
  startDate: string | null;
  dueDate: string | null;
  persona: string | null;
  archived: boolean;
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
  list: (projectId?: number): Promise<Task[]> => {
    const q = projectId != null ? `?project_id=${projectId}` : '';
    return request<{ tasks: Task[] }>(`/api/tasks${q}`).then((r) => r.tasks ?? []);
  },

  get: (id: number): Promise<Task> =>
    request<Task>(`/api/tasks/${id}`),

  create: (body: {
    projectId: number;
    title: string;
    description?: string | null;
    priority?: TaskPriority;
    assignedClawId?: number | null;
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
      status: TaskStatus;
      priority: TaskPriority;
      assignedClawId: number | null;
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
};

/** Runtime executions – submit tasks to claws for agent execution. */
export interface Execution {
  id: number;
  taskId: number;
  status: string;
  submittedBy?: string;
  submittedAt?: string;
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

export const runtimeApi = {
  /** Submit a task for execution. Dispatches to assigned claw or all connected claws. */
  submitExecution: (body: {
    taskId: number;
    clawId?: number | null;
    sessionId?: string;
    payload?: string;
  }): Promise<SubmitExecutionResponse> =>
    request<SubmitExecutionResponse>('/api/runtime/executions', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Approvals (human-in-the-loop decisions)
// ---------------------------------------------------------------------------

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface Approval {
  id: string;
  tenantId: number;
  clawId: number | null;
  requestedBy: string | null;
  actionType: string;
  description: string;
  metadata: string | null;
  status: ApprovalStatus;
  reviewedBy: string | null;
  reviewNote: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const approvalsApi = {
  list: (params?: { status?: ApprovalStatus; clawId?: number | null }): Promise<Approval[]> => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.clawId != null) q.set('clawId', String(params.clawId));
    const query = q.toString();
    return request<{ approvals: Approval[] }>(`/api/approvals${query ? `?${query}` : ''}`).then((r) => r.approvals ?? []);
  },

  get: (id: string): Promise<Approval> => request<Approval>(`/api/approvals/${id}`),

  decide: (
    id: string,
    body: { status: 'approved' | 'rejected'; reviewNote?: string }
  ): Promise<Approval> =>
    request<Approval>(`/api/approvals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};

/** Specs/PRDs – project PRD storage. */
export interface Spec {
  id: string;
  projectId: number | null;
  goal: string;
  prd: string | null;
  status: string;
  archSpec?: string | null;
  taskList?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const specsApi = {
  create: (body: {
    projectId?: number | null;
    goal: string;
    prd?: string | null;
    status?: 'draft' | 'reviewed' | 'approved' | 'in_progress' | 'done';
  }) =>
    request<Spec>('/api/specs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  list: (projectId?: number | null) => {
    const q = projectId != null ? `?projectId=${projectId}` : '';
    return request<{ specs: Spec[] }>(`/api/specs${q}`).then((r) => r.specs ?? []);
  },

  get: (id: string) => request<Spec>(`/api/specs/${id}`),

  patch: (id: string, body: { goal?: string; status?: string; prd?: string | null }) =>
    request<Spec>(`/api/specs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  delete: (id: string) => request<void>(`/api/specs/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Cron Jobs (claw-scoped, optionally project-associated)
// ---------------------------------------------------------------------------

export interface CronJob {
  id: string;
  tenantId: number;
  clawId: number;
  projectId: number | null;
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
  list: (clawId: number, projectId?: number): Promise<CronJob[]> => {
    const q = projectId != null ? `?projectId=${projectId}` : '';
    return request<{ jobs: CronJob[] }>(`/api/claws/${clawId}/cron${q}`).then((r) => r.jobs ?? []);
  },

  create: (clawId: number, body: {
    id?: string;
    name: string;
    schedule: string;
    taskId?: number | null;
    projectId?: number | null;
    enabled?: boolean;
  }): Promise<CronJob> =>
    request<CronJob>(`/api/claws/${clawId}/cron`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (clawId: number, jobId: string, body: Partial<{
    name: string;
    schedule: string;
    taskId: number | null;
    projectId: number | null;
    enabled: boolean;
  }>): Promise<CronJob> =>
    request<CronJob>(`/api/claws/${clawId}/cron/${jobId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (clawId: number, jobId: string): Promise<void> =>
    request<void>(`/api/claws/${clawId}/cron/${jobId}`, { method: 'DELETE' }),
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
// Chat Sessions (claw chat history)
// ---------------------------------------------------------------------------

export interface ChatSession {
  id: string;
  clawId: number;
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
  list: (clawId: number): Promise<ChatSession[]> => {
    return request<{ sessions: ChatSession[] }>(`/api/chats?clawId=${clawId}`).then((r) => r.sessions ?? []);
  },

  listAll: (limit = 100): Promise<(ChatSession & { clawName?: string })[]> => {
    return request<{ sessions: (ChatSession & { clawName?: string })[] }>(`/api/chats?limit=${limit}`).then((r) => r.sessions ?? []);
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
// Usage Snapshots (token telemetry from claws)
// ---------------------------------------------------------------------------

export interface UsageSnapshot {
  id: number;
  clawId: number;
  sessionKey: string | null;
  inputTokens: number;
  outputTokens: number;
  contextTokens: number;
  contextWindowMax: number | null;
  compactionCount: number;
  ts: string;
}

export const usageApi = {
  list: (clawId: number, limit = 50): Promise<UsageSnapshot[]> =>
    request<{ snapshots: UsageSnapshot[] }>(`/api/claws/${clawId}/usage?limit=${limit}`).then(
      (r) => r.snapshots ?? []
    ),
};

// ---------------------------------------------------------------------------
// Claw Workspace (synced directories + files)
// ---------------------------------------------------------------------------

export interface ClawDirectory {
  id: number;
  clawId: number;
  projectId: number | null;
  absPath: string;
  pathHash: string;
  status: 'pending' | 'synced' | 'error';
  lastSyncedAt: string | null;
  fileCount?: number;
}

export interface ClawDirectoryFile {
  id: number;
  directoryId: number;
  relPath: string;
  contentHash: string;
  sizeBytes: number;
  updatedAt: string;
}

export const workspaceApi = {
  listDirectories: (clawId: number): Promise<ClawDirectory[]> =>
    request<{ directories: ClawDirectory[] }>(`/api/claws/${clawId}/directories`).then(
      (r) => r.directories ?? []
    ),

  listFiles: (clawId: number, directoryId: number): Promise<ClawDirectoryFile[]> =>
    request<{ files: ClawDirectoryFile[] }>(
      `/api/claws/${clawId}/directories/${directoryId}/files`
    ).then((r) => r.files ?? []),

  getFileContent: (clawId: number, directoryId: number, fileId: number): Promise<{ content: string }> =>
    request<{ content: string }>(`/api/claws/${clawId}/directories/${directoryId}/files/${fileId}/content`),

  triggerSync: (clawId: number, directoryId: number): Promise<void> =>
    request<void>(`/api/claws/${clawId}/directories/${directoryId}/sync`, { method: 'POST' }),
};

// ---------------------------------------------------------------------------
// Claw Projects (project ↔ claw associations)
// ---------------------------------------------------------------------------

export interface ClawProject {
  clawId: number;
  projectId: number;
  role: string | null;
  project?: {
    id: number;
    name: string;
    description: string | null;
    status: string;
  };
}

export const clawProjectsApi = {
  list: (clawId: number): Promise<ClawProject[]> =>
    request<{ projects: ClawProject[] }>(`/api/claws/${clawId}/projects`).then((r) => r.projects ?? []),

  assign: (clawId: number, projectId: number, role?: string): Promise<void> =>
    request<void>(`/api/claws/${clawId}/projects/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    }),

  unassign: (clawId: number, projectId: number): Promise<void> =>
    request<void>(`/api/claws/${clawId}/projects/${projectId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Claw Channels (multi-channel messaging integrations)
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

export interface ClawChannel {
  id: string;
  clawId: number;
  platform: ChannelPlatform;
  name: string;
  config: string | null; // JSON config (webhook URL, token, etc.)
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export const channelsApi = {
  list: (clawId: number): Promise<ClawChannel[]> =>
    request<{ channels: ClawChannel[] }>(`/api/claws/${clawId}/channels`).then((r) => r.channels ?? []),

  create: (
    clawId: number,
    body: { platform: ChannelPlatform; name: string; config?: string; enabled?: boolean }
  ): Promise<ClawChannel> =>
    request<ClawChannel>(`/api/claws/${clawId}/channels`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (
    clawId: number,
    channelId: string,
    body: Partial<{ name: string; config: string; enabled: boolean }>
  ): Promise<ClawChannel> =>
    request<ClawChannel>(`/api/claws/${clawId}/channels/${channelId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (clawId: number, channelId: string): Promise<void> =>
    request<void>(`/api/claws/${clawId}/channels/${channelId}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Claw Skills (tenant + claw-scoped skill assignments)
// ---------------------------------------------------------------------------

export interface ClawSkillAssignment {
  id: number;
  clawId: number | null;
  tenantId: number;
  skillSlug: string;
  scope: 'tenant' | 'claw';
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

export const clawSkillsApi = {
  list: (clawId: number): Promise<ClawSkillAssignment[]> => {
    const q = new URLSearchParams({ clawId: String(clawId) });
    return request<{ assignments: ClawSkillAssignment[] }>(`/api/skill-assignments?${q}`).then(
      (r) => r.assignments ?? []
    );
  },

  assignToClaw: (clawId: number, skillSlug: string): Promise<void> =>
    request<void>(`/api/skill-assignments/claw/${clawId}`, {
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

export const llmApi = {
  usage: (): Promise<LlmUsageStats> =>
    request<LlmUsageStats>('/llm/v1/usage'),

  health: (): Promise<{ status: string; free: unknown[]; pro: unknown[]; timestamp: string }> =>
    request<{ status: string; free: unknown[]; pro: unknown[]; timestamp: string }>('/llm/v1/health'),

  models: (): Promise<{ data: Array<{ id: string; object: string }> }> =>
    request<{ data: Array<{ id: string; object: string }> }>('/llm/v1/models'),
};

// ---------------------------------------------------------------------------
// Dispatch (send command to claw via relay)
// ---------------------------------------------------------------------------

export const dispatchApi = {
  send: (clawId: number, payload: unknown): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/claws/${clawId}/dispatch`, {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};

// ---------------------------------------------------------------------------
// Claw Config (runtime configuration JSON)
// ---------------------------------------------------------------------------

export const clawConfigApi = {
  get: (clawId: number): Promise<{ config: Record<string, unknown> | null }> =>
    request<{ config: Record<string, unknown> | null }>(`/api/claws/${clawId}/config`),

  update: (clawId: number, config: Record<string, unknown>): Promise<{ config: Record<string, unknown> }> =>
    request<{ config: Record<string, unknown> }>(`/api/claws/${clawId}/config`, {
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
// Claw nodes (cluster node management)
// ---------------------------------------------------------------------------

export interface ClawNode {
  id: string;
  name: string;
  capabilities: string[];
  connectedAt: string | null;
  lastSeenAt: string | null;
  status: 'connected' | 'disconnected';
}

export const clawNodesApi = {
  list: (clawId: number): Promise<ClawNode[]> =>
    request<ClawNode[]>(`/api/claws/${clawId}/nodes`),

  unpair: (clawId: number, nodeId: string): Promise<void> =>
    request<void>(`/api/claws/${clawId}/nodes/${nodeId}`, { method: 'DELETE' }),
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

