/**
 * API client for api.builderforce.ai app endpoints:
 * Brain (chats, messages), AgentHosts (list, register).
 * Uses tenant JWT from auth.
 */

import { attachEvermindLearn, subscribeToChatMessages } from '@seanhogg/builderforce-brain-embedded';
import {
  AUTH_API_URL,
  checkUnauthorizedAndRedirect,
  getStoredTenantToken,
  getStoredWebToken,
} from './auth';
import { downloadBlob, filenameFromResponse } from './download';
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

export async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
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
  SystemAuditSummary, AuditRunOutcome,
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

  /** List the system-level audit types (SOC 2, Architecture, Quality, PM Vision).
   *  Public — powers the onboarding wizard + marketing. */
  listAudits: (): Promise<SystemAuditSummary[]> =>
    webRequest<{ audits: SystemAuditSummary[] }>('/api/tools/audits').then((r) => r.audits ?? []),

  /** Run a system audit against a project (manager+): scores + records a report,
   *  notifies the user, and files the agent remediation ticket. */
  runAudit: (auditId: string, projectId: number): Promise<AuditRunOutcome> =>
    request<AuditRunOutcome>(`/api/tools/audits/${encodeURIComponent(auditId)}/run`, {
      method: 'POST', body: JSON.stringify({ projectId }),
    }),
};

// ---------------------------------------------------------------------------
// Agentic Workforce Kanban — roles, templates, roster, per-ticket audit
// ---------------------------------------------------------------------------

import type {
  JobRole, KanbanTemplate, TemplateSummary, RecommendedRoster, TicketAudit, FlaggedTicket, TemplateVisibility,
  RoleAssignment, AssigneeKind, AccountabilityReport, ManifestParticipant, SignoffContribution, ParticipantsSummaryRow, ImplicatedTicket,
} from './kanban';

export interface AssignableWorkforceDto {
  agents: Array<{ ref: string; name: string }>;
  humans: Array<{ ref: string; name: string }>;
  hires: Array<{ ref: string; name: string }>;
}

/** One assignee's personality readout, keyed in {@link AssigneeProfileMap} by select-value. */
export interface AssigneeProfileDto {
  name: string;
  psychometric: import('./psychometric').PsychometricProfile;
}
/** assignee select-value (`u:<userId>` / `c:<agentRef>`) → personality, for assignees that carry one. */
export type AssigneeProfileMap = Record<string, AssigneeProfileDto>;

export const kanbanApi = {
  // The cached server-side union the picker fan-out (my agents + purchased + members
  // + engagements) collapses into one read; includes marketplace-hired agents.
  assignable: (): Promise<AssignableWorkforceDto> =>
    request<AssignableWorkforceDto>('/api/kanban/assignable'),

  // The cached assignee-ref → personality map that powers the assignee hovercard —
  // one tenant-scoped read for every board card / drawer / standup row (no N+1).
  assigneeProfiles: (): Promise<AssigneeProfileMap> =>
    request<{ profiles: AssigneeProfileMap }>('/api/kanban/assignee-profiles').then((r) => r.profiles),

  // Roles
  listRoles: (): Promise<JobRole[]> =>
    request<{ roles: JobRole[] }>('/api/kanban/roles').then((r) => r.roles),
  createRole: (body: { name: string; key?: string; description?: string; discipline?: string; color?: string; icon?: string }): Promise<JobRole> =>
    request<{ role: JobRole }>('/api/kanban/roles', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.role),
  updateRole: (key: string, body: Partial<{ name: string; description: string; discipline: string; color: string; icon: string }>): Promise<void> =>
    request<void>(`/api/kanban/roles/${encodeURIComponent(key)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteRole: (key: string): Promise<void> =>
    request<void>(`/api/kanban/roles/${encodeURIComponent(key)}`, { method: 'DELETE' }),

  // Role assignments — pin an existing agent / human member / hire to a role.
  // projectId omitted → workspace-default (all projects); set → a project's roster.
  listRoleAssignments: (projectId?: number): Promise<RoleAssignment[]> =>
    request<{ assignments: RoleAssignment[] }>(
      `/api/kanban/role-assignments${projectId != null ? `?projectId=${projectId}` : ''}`,
    ).then((r) => r.assignments),
  assignRole: (body: { roleKey: string; assigneeKind: AssigneeKind; assigneeRef: string; assigneeName?: string; projectId?: number | null }): Promise<RoleAssignment> =>
    request<{ assignment: RoleAssignment }>('/api/kanban/role-assignments', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.assignment),
  unassignRole: (id: string): Promise<void> =>
    request<void>(`/api/kanban/role-assignments/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Templates
  listTemplates: (): Promise<TemplateSummary[]> =>
    request<{ templates: TemplateSummary[] }>('/api/kanban/templates').then((r) => r.templates),
  listPublicTemplates: (): Promise<TemplateSummary[]> =>
    request<{ templates: TemplateSummary[] }>('/api/kanban/templates/public').then((r) => r.templates),
  getTemplate: (id: string): Promise<KanbanTemplate> =>
    request<{ template: KanbanTemplate }>(`/api/kanban/templates/${encodeURIComponent(id)}`).then((r) => r.template),
  createTemplate: (body: Partial<KanbanTemplate> & { name: string; forkFrom?: string }): Promise<KanbanTemplate> =>
    request<{ template: KanbanTemplate }>('/api/kanban/templates', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.template),
  updateTemplate: (id: string, body: Partial<KanbanTemplate>): Promise<KanbanTemplate> =>
    request<{ template: KanbanTemplate }>(`/api/kanban/templates/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }).then((r) => r.template),
  deleteTemplate: (id: string): Promise<void> =>
    request<void>(`/api/kanban/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  publishTemplate: (id: string, body: { published: boolean; visibility?: TemplateVisibility; priceCents?: number | null }): Promise<void> =>
    request<void>(`/api/kanban/templates/${encodeURIComponent(id)}/publish`, { method: 'POST', body: JSON.stringify(body) }),
  installTemplate: (id: string): Promise<KanbanTemplate> =>
    request<{ template: KanbanTemplate }>(`/api/kanban/templates/${encodeURIComponent(id)}/install`, { method: 'POST' }).then((r) => r.template),

  // Apply + roster + audit (per project / ticket)
  applyTemplate: (projectId: number, templateId: string): Promise<{ lanesApplied: number; requirementsApplied: number }> =>
    request<{ lanesApplied: number; requirementsApplied: number }>(`/api/kanban/projects/${projectId}/apply`, { method: 'POST', body: JSON.stringify({ templateId }) }),
  roster: (projectId: number): Promise<RecommendedRoster> =>
    request<{ roster: RecommendedRoster }>(`/api/kanban/projects/${projectId}/roster`).then((r) => r.roster),
  flaggedForProject: (projectId: number): Promise<FlaggedTicket[]> =>
    request<{ flagged: FlaggedTicket[] }>(`/api/kanban/projects/${projectId}/flagged`).then((r) => r.flagged),
  flagged: (): Promise<FlaggedTicket[]> =>
    request<{ flagged: FlaggedTicket[] }>('/api/kanban/flagged').then((r) => r.flagged),
  ticketAudit: (taskId: number): Promise<TicketAudit | null> =>
    request<{ audit: TicketAudit | null }>(`/api/kanban/tasks/${taskId}/audit`).then((r) => r.audit),
  recomputeAudit: (taskId: number): Promise<TicketAudit> =>
    request<{ audit: TicketAudit }>(`/api/kanban/tasks/${taskId}/audit/recompute`, { method: 'POST' }).then((r) => r.audit),
  signoff: (taskId: number, body: { roleKey: string; laneKey?: string; verdict?: 'approved' | 'changes_requested' | 'waived' | 'delegated'; summary?: string; waiveReason?: string; contribution?: SignoffContribution }): Promise<TicketAudit> =>
    request<{ audit: TicketAudit }>(`/api/kanban/tasks/${taskId}/signoff`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.audit),
  // Coordinated Role Participation — manifest + accountability record.
  accountability: (taskId: number): Promise<AccountabilityReport> =>
    request<{ accountability: AccountabilityReport }>(`/api/kanban/tasks/${taskId}/accountability`).then((r) => r.accountability),
  participants: (taskId: number): Promise<ManifestParticipant[]> =>
    request<{ participants: ManifestParticipant[] }>(`/api/kanban/tasks/${taskId}/participants`).then((r) => r.participants),
  assessResource: (taskId: number, body: { roleKey: string; responsibility?: 'owner' | 'reviewer' | 'contributor'; stageKey?: string; note?: string }): Promise<ManifestParticipant | null> =>
    request<{ participant: ManifestParticipant | null }>(`/api/kanban/tasks/${taskId}/participants`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.participant),
  removeParticipant: (taskId: number, participantId: string): Promise<void> =>
    request<{ ok: boolean }>(`/api/kanban/tasks/${taskId}/participants/${participantId}`, { method: 'DELETE' }).then(() => undefined),
  materializeParticipants: (taskId: number): Promise<number> =>
    request<{ created: number }>(`/api/kanban/tasks/${taskId}/participants/materialize`, { method: 'POST' }).then((r) => r.created),
  participantsSummary: (projectId: number): Promise<ParticipantsSummaryRow[]> =>
    request<{ summary: ParticipantsSummaryRow[] }>(`/api/kanban/projects/${projectId}/participants-summary`).then((r) => r.summary),
  coordinate: (taskId: number): Promise<{ ok: boolean; status: string; dispatched: boolean; requiredOutstanding: number }> =>
    request<{ ok: boolean; status: string; dispatched: boolean; requiredOutstanding: number }>(`/api/kanban/tasks/${taskId}/coordinate`, { method: 'POST' }),
};

// ---------------------------------------------------------------------------
// Compile primitive — define a need (any modality) → AgentSpec → deploy plan
// ---------------------------------------------------------------------------

/** A modality need accepted by `POST /api/compile` (mirrors the api `Need` union). */
export type CompileNeed =
  | { modality: 'prose'; text: string }
  | { modality: 'dataset'; identity: { name: string; title?: string; bio?: string; skills?: string[] | string | null }; modelRef?: string | null; recalledContext?: string }
  | { modality: 'process-chart'; definition: unknown }
  | { modality: 'persona'; directives?: string[]; execParams?: Record<string, unknown> }
  | { modality: 'diagnostic'; findings: unknown; subject?: string }
  | { modality: 'policy'; gates: Array<{ id: string; tool?: string; effect: string; directive?: string; reason?: string }> };

export type CompileSurface = 'ide' | 'desktop' | 'cloud-durable' | 'cloud-container' | 'workflow-node';

export interface CompiledAgentSpec {
  id?: string;
  identity: { name: string; title?: string; bio?: string; skills?: string[] | string | null };
  model?: { ref: string | null; autoRoute?: boolean };
  persona?: { directives?: string[]; execParams?: Record<string, unknown> };
  memory?: { recalledContext?: string };
  policy?: { gates: Array<{ id: string; tool?: string; effect: string; directive?: string; reason?: string }> };
  steps?: unknown[];
  surfaces?: CompileSurface[];
}

export interface DeployPlan {
  surface: CompileSurface;
  engineId: string;
  transport: string;
  runInput: { systemPrompt: string; model?: string };
  execParams: Record<string, unknown>;
  cloudDispatchable: boolean;
}

export const compileApi = {
  /** Compile one or more needs → AgentSpec (+ optional deploy plan when `deploy` set). */
  compile: (needs: CompileNeed | CompileNeed[], deploy?: CompileSurface): Promise<{ spec: CompiledAgentSpec; plan?: DeployPlan }> =>
    request<{ spec: CompiledAgentSpec; plan?: DeployPlan }>('/api/compile', {
      method: 'POST',
      body: JSON.stringify(Array.isArray(needs) ? { needs, deploy } : { need: needs, deploy }),
    }),

  /** Compile → deploy(cloud-durable) → run a real first turn through the gateway. */
  run: (needs: CompileNeed | CompileNeed[], sample?: string): Promise<{ spec: CompiledAgentSpec; plan: DeployPlan; output?: string; error?: string }> =>
    request<{ spec: CompiledAgentSpec; plan: DeployPlan; output?: string; error?: string }>('/api/compile/run', {
      method: 'POST',
      body: JSON.stringify(Array.isArray(needs) ? { needs, sample } : { need: needs, sample }),
    }),
};

// ---------------------------------------------------------------------------
// Decks — board / CFO deck generation + template library
// ---------------------------------------------------------------------------

export interface DeckTemplateSummary {
  id: string;
  name: string;
  description: string | null;
  archetype: 'board' | 'cfo_devfinops' | 'custom' | 'generative';
  isBuiltin: boolean;
  /** True when this template has an uploaded .pptx that can be filled in place. */
  fillable: boolean;
}

export interface GenerateDeckResponse {
  deckId: string;
  filename: string;
  warnings: string[];
  downloadUrl: string;
}

export const decksApi = {
  /** List built-in + tenant deck templates. */
  listTemplates: (): Promise<DeckTemplateSummary[]> =>
    request<{ templates: DeckTemplateSummary[] }>('/api/decks/templates').then((r) => r.templates),

  /** Generate a deck (Brain path) — returns the id + warnings, no binary. */
  generate: (args: { mode?: 'generative' | 'fill'; templateId?: string; quarter?: string }): Promise<GenerateDeckResponse> =>
    request<GenerateDeckResponse>('/api/decks/generate', { method: 'POST', body: JSON.stringify(args) }),

  /** Promote an already-uploaded .pptx (brain upload key) into a tenant template. */
  promoteTemplate: (args: { name: string; description?: string; sourceKey: string }): Promise<{ id: string; tokens: string[] }> =>
    request<{ id: string; tokens: string[] }>('/api/decks/templates', { method: 'POST', body: JSON.stringify(args) }),

  deleteTemplate: (id: string): Promise<void> =>
    request<void>(`/api/decks/templates/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => undefined),

  /** Generate & download a deck synchronously (the PMO button path). */
  async download(args: { templateId?: string; quarter?: string; mode?: 'generative' | 'fill' }): Promise<void> {
    const q = new URLSearchParams();
    if (args.templateId) q.set('template', args.templateId);
    if (args.quarter) q.set('quarter', args.quarter);
    if (args.mode) q.set('mode', args.mode);
    const res = await fetch(`${AUTH_API_URL}/api/decks/download?${q.toString()}`, { headers: authHeaders() });
    if (!res.ok) await throwApiError(res, 'GET', '/api/decks/download');
    const blob = await res.blob();
    downloadBlob(blob, filenameFromResponse(res, `deck-${args.quarter ?? 'latest'}.pptx`));
  },

  /** Download a previously generated deck by id. */
  async downloadById(deckId: string, filename = 'deck.pptx'): Promise<void> {
    const res = await fetch(`${AUTH_API_URL}/api/decks/${encodeURIComponent(deckId)}/download`, { headers: authHeaders() });
    if (!res.ok) await throwApiError(res, 'GET', `/api/decks/${deckId}/download`);
    downloadBlob(await res.blob(), filename);
  },
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
  /** What the chat is making — a capability id (see lib/brain/capabilities.ts).
   *  Shapes the system prompt and the export format; null = no capability. */
  capability?: string | null;
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
  /** Transient (not persisted): the send-messages learn-gate outcome for this turn,
   *  attached to the assistant reply so the Brain run loop renders a truthful learn step. */
  evermindLearn?: { learned: boolean; version: number };
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

  createChat: (body: { title?: string; projectId?: number | null; capability?: string | null }) =>
    request<BrainChat>('/api/brain/chats', { method: 'POST', body: JSON.stringify(body) }),

  /** Resolve-or-create the canonical TEAM chat for a scope: a project when
   *  `projectId` is set, a named workforce team when `teamId` is set, otherwise
   *  the tenant-wide "broader team" chat. Everyone lands in the SAME conversation. */
  getTeamChat: (scope?: { projectId?: number | null; teamId?: number | null }) => {
    const q = new URLSearchParams();
    if (scope?.projectId != null) q.set('projectId', String(scope.projectId));
    if (scope?.teamId != null) q.set('teamId', String(scope.teamId));
    const query = q.toString();
    return request<BrainChat & { isTeamChat: true; isOwner: boolean; visibility: 'shared' | 'locked' }>(
      `/api/brain/team-chat${query ? `?${query}` : ''}`,
    );
  },

  getChat: (id: number) => request<BrainChat>(`/api/brain/chats/${id}`),

  updateChat: (id: number, body: { title?: string; projectId?: number | null; visibility?: 'shared' | 'locked'; capability?: string | null }) =>
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

  subscribeMessages: (chatId: number, onChanged: () => void) =>
    subscribeToChatMessages(AUTH_API_URL, getStoredTenantToken, chatId, onChanged),

  sendMessages: (chatId: number, messages: Array<{ role: string; content: string; metadata?: string }>) =>
    request<{ messages: BrainMessage[]; evermindLearn?: { learned: boolean; version: number } }>(`/api/brain/chats/${chatId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ messages }),
      // Attach the server's TRUTHFUL learn-gate outcome (transient, not persisted) to
      // the assistant turn(s) this POST persisted, so the Brain run loop renders a
      // learn/skip step exactly when the server contributed — not from a client
      // heuristic. Shared with the VS Code webview adapter so the two never drift.
    }).then((r) => attachEvermindLearn(r.messages, r.evermindLearn)),

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

  /**
   * Fetch an external URL/file/website server-side (CORS-free) so the Brain can
   * read a link the user pastes. The gateway strips HTML to text, follows
   * github-blob → raw rewrites, and caps the size. Throws on a blocked/internal
   * URL or an unreachable origin.
   */
  fetchUrl: (url: string) =>
    request<WebFetchResult>('/api/brain/fetch-url', { method: 'POST', body: JSON.stringify({ url }) }),

  // --- Chat ↔ ticket links, lineage, consolidation, agent invites ---

  /** Work items this chat is tied to, each with a live health (% done) summary. */
  listChatTickets: (chatId: number) =>
    request<{ tickets: ChatTicketLink[] }>(`/api/brain/chats/${chatId}/tickets`).then((r) => r.tickets),

  /** Tie a chat to a ticket. kind = portfolio|objective|initiative|roadmap|spec|epic|gap|task. */
  linkChatTicket: (chatId: number, body: { kind: TicketKind; ref: string; linkType?: 'linked' | 'created' }) =>
    request<ChatTicketLink>(`/api/brain/chats/${chatId}/tickets`, { method: 'POST', body: JSON.stringify(body) }),

  /** Remove a chat ↔ ticket link. */
  unlinkChatTicket: (chatId: number, kind: TicketKind, ref: string) =>
    request<{ removed: boolean }>(`/api/brain/chats/${chatId}/tickets?kind=${encodeURIComponent(kind)}&ref=${encodeURIComponent(ref)}`, { method: 'DELETE' }),

  /** Lineage: every chat that references a ticket (which spawned it / touched it). */
  listTicketChats: (kind: TicketKind, ref: string) =>
    request<{ chats: LinkedChatRef[] }>(`/api/brain/tickets/${encodeURIComponent(kind)}/${encodeURIComponent(ref)}/chats`).then((r) => r.chats),

  /** Server-side typeahead for the link picker — up to N (ref,label) hits for one
   *  tier matching `q` (empty = newest). Replaces loading every ticket client-side. */
  searchTickets: (kind: TicketKind, q: string, projectId: number | null) => {
    const qs = new URLSearchParams({ kind, q });
    if (projectId != null) qs.set('project_id', String(projectId));
    return request<{ results: Array<{ ref: string; label: string }> }>(`/api/brain/tickets/search?${qs.toString()}`).then((r) => r.results);
  },

  /** Merge source chats into a target (archive + redirect the sources). */
  consolidateChats: (targetChatId: number, sourceChatIds: number[]) =>
    request<{ targetChatId: number; mergedChats: number; messagesMoved: number; linksMoved: number }>(
      '/api/brain/chats/consolidate', { method: 'POST', body: JSON.stringify({ targetChatId, sourceChatIds }) }),

  /** Agents invited into a chat. */
  listChatAgents: (chatId: number) =>
    request<{ agents: ChatAgentInvite[] }>(`/api/brain/chats/${chatId}/agents`).then((r) => r.agents),

  /** Invite an agent into a chat as a participant. */
  inviteChatAgent: (chatId: number, body: { agentRef: string; agentKind?: string; role?: string }) =>
    request<ChatAgentInvite>(`/api/brain/chats/${chatId}/agents`, { method: 'POST', body: JSON.stringify(body) }),

  /** Remove an agent from a chat. */
  removeChatAgent: (chatId: number, assignmentId: string) =>
    request<{ removed: boolean }>(`/api/brain/chats/${chatId}/agents/${assignmentId}`, { method: 'DELETE' }),

  // --- Human members (shared access + invite, migration 0288) ---

  /** Human participants of a chat (the live audience). */
  listChatMembers: (chatId: number) =>
    request<{ members: ChatMemberInfo[] }>(`/api/brain/chats/${chatId}/members`).then((r) => r.members),

  /** Invite a human by email. Returns 'active' (existing teammate) | 'pending' (cold invite). */
  inviteChatMember: (chatId: number, email: string) =>
    request<{ status: 'active' | 'pending' }>(`/api/brain/chats/${chatId}/members`, { method: 'POST', body: JSON.stringify({ email }) }),

  /** Remove a human member from a chat. */
  removeChatMember: (chatId: number, memberId: number) =>
    request<{ removed: boolean }>(`/api/brain/chats/${chatId}/members/${memberId}`, { method: 'DELETE' }),

  /**
   * Ask an invited agent participant to reply — a chat-scoped run that answers AS
   * the agent, returning the posted assistant turn (attributed via metadata.authoredBy).
   * Wired into BrainPersistenceAdapter so `useBrainConversation` calls it after a
   * user directs a message to an @agent.
   */
  requestAgentReply: (chatId: number, input: { agentRef: string; agentName?: string }) =>
    request<{ message: BrainMessage }>(`/api/brain/chats/${chatId}/agent-reply`, { method: 'POST', body: JSON.stringify(input) }).then((r) => r.message),

  // --- Persisted run trace (tool/LLM turns survive reload) ---

  /** Persist a batch of run-trace events (tool/LLM/error turns) for this chat, so
   *  the timeline can rehydrate them after a reload. Best-effort; the caller drops
   *  the promise. Clears the local read cache so the next GET reflects the append. */
  appendChatTrace: (chatId: number, events: BrainChatTraceEventInput[]) => {
    brainTraceCache.delete(chatId);
    return request<{ appended: number }>(`/api/brain/chats/${chatId}/trace`, {
      method: 'POST',
      body: JSON.stringify({ events }),
    });
  },

  /** Load a chat's persisted run trace (oldest-first). Cached per-chat client-side
   *  (invalidated by appendChatTrace) so switching chats back and forth is cheap. */
  getChatTrace: async (chatId: number): Promise<BrainChatTraceRow[]> => {
    const cached = brainTraceCache.get(chatId);
    if (cached) return cached;
    const { trace } = await request<{ trace: BrainChatTraceRow[] }>(`/api/brain/chats/${chatId}/trace`);
    brainTraceCache.set(chatId, trace);
    return trace;
  },
};

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
export interface ChatAgentInvite {
  id: string;
  agentKind: string;
  agentRef: string;
  scope: string;
  scopeId: string | null;
  executionScope: string;
  role: string;
}

/** Readable result of {@link brain.fetchUrl}. */
export interface WebFetchResult {
  /** The URL actually fetched (after github-blob → raw rewrite + redirects). */
  url: string;
  /** Original URL passed in. */
  requestedUrl: string;
  status: number;
  contentType: string;
  /** Page <title> when the document was HTML, else null. */
  title: string | null;
  /** Plain-text content (HTML stripped), capped server-side. */
  text: string;
  truncated: boolean;
}

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

  /** Tool audit events for timeline/observability. Pass executionId to scope to a
   *  single run (parity with cloudAgents.toolAuditEvents) so a host run's Logs/Timeline
   *  isolates one execution and surfaces its terminal run.failed. */
  toolAuditEvents: (
    agentHostId: number,
    params?: { runId?: string; sessionKey?: string; limit?: number; executionId?: number }
  ) => {
    const q = new URLSearchParams();
    if (params?.runId) q.set('runId', params.runId);
    if (params?.sessionKey) q.set('sessionKey', params.sessionKey);
    if (params?.limit != null) q.set('limit', String(params.limit));
    if (params?.executionId != null) q.set('executionId', String(params.executionId));
    const query = q.toString();
    return request<{ events: ToolAuditEvent[] }>(
      `/api/agent-hosts/${agentHostId}/tool-audit${query ? `?${query}` : ''}`
    ).then((r) => r.events);
  },
};

/** A connected VS Code editor (mig 0202 `vscode_connections`) — a per-user, per-machine
 *  editor runtime that appears in the workforce/observability surfaces as a presence
 *  entry. Mirrors the API's `GET /api/vscode/connections` row shape. */
export interface VscodeConnection {
  id: number;
  tenantId: number;
  userId: string | null;
  machineName: string;
  extensionVersion: string | null;
  status: string;
  connectedAt: string;
  lastSeenAt: string;
  createdAt: string;
}

export const vscodeConnections = {
  list: () =>
    request<{ connections: VscodeConnection[] }>('/api/vscode/connections').then((r) => r.connections),
};

/** A VS Code connection is "online" when it's active and its heartbeat (every 5 min)
 *  is fresh. Single source of truth for VS Code liveness across workforce + observability
 *  so the two surfaces never disagree. */
export function isVscodeConnectionOnline(conn: Pick<VscodeConnection, 'status' | 'lastSeenAt'>): boolean {
  if (conn.status !== 'active') return false;
  const last = Date.parse(conn.lastSeenAt);
  if (Number.isNaN(last)) return false;
  return Date.now() - last < 11 * 60_000; // two missed 5-min heartbeats + slack
}

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

/**
 * Evermind BUILD-step node kinds — a client-side SUPERSET of the server's node
 * kinds. Each string equals an engine workflow step `type` (see
 * `@seanhogg/builderforce-memory` steps.ts), so a build graph compiles 1:1 to a
 * `WorkflowConfig` and runs IN-BROWSER via `runWorkflow` (see lib/evermindBuild.ts)
 * — it is NOT dispatched through the server agentic orchestrator. The graph still
 * persists as opaque JSON through the normal save endpoints; the server union
 * (api/src/domain/workflowGraph.ts) intentionally does NOT list these.
 */
export type EvermindBuildKind =
  | 'train-tokenizer' | 'dataset-quality' | 'train-model' | 'convergence'
  | 'evaluate' | 'generate-check' | 'benchmark' | 'roundtrip' | 'export'
  | 'distill-corpus' | 'code-parse-check' | 'code-eval' | 'code-benchmark';

export type WorkflowNodeKind =
  | 'trigger' | 'agent' | 'llm' | 'mcp' | 'memory' | 'knowledge' | 'train'
  | 'transform' | 'filter' | 'branch' | 'output' | 'gmail'
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
  /**
   * Fork a (typically shared/global) definition into a custom, project-scoped
   * copy — the "modify a shared workflow → custom workflow" path. The source
   * template is left untouched; the fork records its `parentDefinitionId`.
   */
  fork: (id: string, body?: { name?: string; projectId?: number | null }) =>
    request<WorkflowDefinitionDetail>(`/api/workflow-definitions/${id}/fork`, {
      method: 'POST',
      body: JSON.stringify(body ?? {}),
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
    request<{ vector: Record<string, number>; mbti?: string; enneagramType?: number; source: string }>(
      `/api/personas/psychometric/score`,
      {
        method: 'POST',
        body: JSON.stringify({ answers }),
      },
    ),
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
  /** Fixed type dimension: a plain task, an Epic (planning container with
   *  children), or a GAP (minted by the Validator when a Done item is reviewed
   *  and found incomplete). */
  taskType: 'task' | 'epic' | 'gap' | 'security';
  /** True when this is a SECURITY ticket the current viewer isn't cleared to see:
   *  its content is redacted server-side and the UI shows a "clearance needed"
   *  placeholder. Present only on masked rows. */
  restricted?: boolean;
  /** Parent Epic's id (null for top-level tasks). Set when grouped under an Epic. */
  parentTaskId: number | null;
  /** How many times a Validator has reviewed this item (0 = never reviewed). */
  reviewCount?: number;
  /** ISO timestamp of the most recent review, or null when never reviewed. */
  lastReviewedAt?: string | null;
  /** Verdict of the most recent review: complete, gaps found, or null. */
  lastReviewVerdict?: 'complete' | 'gaps' | null;
  /** For a GAP task: the Done item's id this gap was minted from (else null). */
  gapOriginTaskId?: number | null;
  /** sprints.id this task is scheduled into, or null when unscheduled (backlog). */
  sprintId: string | null;
  /** product_releases.id this task ships in, or null (the delivery deliverable). */
  releaseId?: string | null;
  /** Story-point estimate, or null when unestimated — drives derived sprint velocity. */
  storyPoints?: number | null;
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
  /** Manager-scored business value 0–100 (null = unscored). */
  businessValue?: number | null;
  /** Plain-language justification for the business value, when scored. */
  businessValueRationale?: string | null;
  /** How the value was set: 'manual' (a human pinned it) | 'manager' (AI) | null. */
  businessValueSource?: string | null;
  /** The AI Manager's backlog rank (ascending; null = unranked, sorts last). */
  managerRank?: number | null;
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

/** Why a ticket will / will not auto-run its assigned agent (board triage). */
export type AutoRunReason =
  | 'will_run'
  | 'no_board'
  | 'no_lane'
  | 'terminal_lane'
  | 'human_gate'
  | 'no_agent'
  | 'capability_mismatch'
  | 'already_running'
  | 'run_cap_exhausted'
  | 'cooldown_active'
  | 'not_executable'
  | 'pending_approval';

export interface AutoRunDiagnostic {
  status: string;
  assignedAgentRef: string | null;
  laneResolved: boolean;
  isTerminalLane: boolean;
  laneGate: 'auto' | 'human' | null;
  staffedAgentRefs: string[];
  decision: {
    autoRun: boolean;
    agentRef?: string;
    model?: string;
    capabilityMismatches?: { agentRef: string; missing: string[] }[];
  };
  candidate: { agentRef: string; model?: string } | null;
  liveExecution: { id: number; status: string } | null;
  canRunNow: boolean;
  reason: AutoRunReason;
  /** Milliseconds still owed on the per-ticket re-run cooldown (0 unless the reason
   *  is `cooldown_active`) — lets triage say when the ticket resumes. */
  cooldownRemainingMs?: number;
}

/** The three work-item types you can convert between across the board ⇄ OKR boundary. */
export type WorkItemKind = 'task' | 'epic' | 'objective';
/** Result of a {@link tasksApi.convertType} / objectives convert-type call. */
export interface WorkItemConversion {
  kind: WorkItemKind;
  id: string;
  projectId: number | null;
  migrated: { children: number; links: number; keyResultsDropped: number; initiativeLinksDropped: number };
  warnings: string[];
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
      /** Pin the business value 0–100 (or null to clear). Setting it server-side
       *  marks the source 'manual'. */
      businessValue: number | null;
      /** Associate the task with a product release, or null to detach (EMP-10a). */
      releaseId: string | null;
      archived: boolean;
    }>
  ): Promise<Task> =>
    request<Task>(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  delete: (id: number): Promise<void> =>
    request<void>(`/api/tasks/${id}`, { method: 'DELETE' }),

  /** Change a board item's TYPE: task⇄epic, or promote it to an OKR Objective
   *  ('objective'). Promoting re-links the item's child tasks to the new objective
   *  and scopes it to the item's project (so the 360 counts it). See {@link WorkItemConversion}. */
  convertType: (id: number, target: WorkItemKind): Promise<WorkItemConversion> =>
    request<WorkItemConversion>(`/api/tasks/${id}/convert-type`, { method: 'POST', body: JSON.stringify({ target }) }),

  /** An Epic and its direct child tasks (the planning tree). */
  tree: (id: number): Promise<{ epic: Task; children: Task[] }> =>
    request<{ epic: Task; children: Task[] }>(`/api/tasks/${id}/tree`),

  /** Triage: why a ticket will / will not auto-run its assigned agent. */
  autorunDiagnostics: (id: number): Promise<AutoRunDiagnostic> =>
    request<AutoRunDiagnostic>(`/api/tasks/${id}/autorun-diagnostics`),

  /** Triage: dispatch the ticket's owner / first-capable lane agent now,
   *  overriding the lane gate (an explicit human click is the approval). */
  runNow: (id: number): Promise<{ ok: true; executionId: number | null; agentRef: string }> =>
    request<{ ok: true; executionId: number | null; agentRef: string }>(`/api/tasks/${id}/run-now`, { method: 'POST' }),

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

// ---------------------------------------------------------------------------
// AI Manager — per-project backlog manager (scores business value, ranks the
// backlog, assigns owners, conducts PRs). Mirrors /api/manager on the API.
// ---------------------------------------------------------------------------

/** How pull requests an agent opens are merged once it finishes a ticket. */
export type PrMergePolicy = 'immediate' | 'on_green' | 'queue';

/** The action types the manager records on each run (drives the activity feed). */
export type ManagerActionType =
  | 'prioritize' | 'assign' | 'score_value' | 'dispatch' | 'sync_pr' | 'merge_pr' | 'flag'
  /** Staffed a flagged ticket's missing role owner/reviewer (the fix for a flag). */
  | 'coordinate';

/** Persisted manager configuration for a project (null until first configured). */
export interface ManagerConfig {
  /** Assignee-encoded manager (`c:<ref>` agent / `u:<userId>` human / null = system). */
  managerRef: string | null;
  enabled: boolean;
  prMergePolicy: PrMergePolicy;
  autoAssign: boolean;
  autoBusinessValue: boolean;
  autoPrioritize: boolean;
  lastRunAt: string | null;
}

/** The AI Manager's domain type / functional role (see api managerTypes.ts). A stored
 *  type is a built-in id OR a `role:<key>` id derived from a tenant custom job role. */
export type ManagerTypeBuiltinId = 'general' | 'delivery' | 'qa' | 'service_desk' | 'devops';
export type ManagerTypeId = ManagerTypeBuiltinId | (string & {});

/** One selectable manager type: a built-in domain or a custom-role-derived type. The UI
 *  localizes built-ins by id; custom types render by their tenant-authored label. */
export interface ManagerTypeOption {
  id: ManagerTypeId;
  /** The roster role (roleCatalog key) this type fills, or null when none maps. */
  roleKey: string | null;
  builtin: boolean;
  label: string;
  description: string;
}

/** Effective policy (config merged with defaults + resolved manager kind). */
export interface ManagerPolicy {
  enabled: boolean;
  managerRef: string | null;
  managerKind: 'agent' | 'human' | 'system';
  prMergePolicy: PrMergePolicy;
  autoAssign: boolean;
  autoBusinessValue: boolean;
  autoPrioritize: boolean;
  /** The manager's domain type / role. */
  managerType: ManagerTypeId;
}

/** One standing coaching directive that steers the manager (project-scoped, or
 *  tenant-wide when projectId is null). */
export interface ManagerDirective {
  id: string;
  projectId: number | null;
  directive: string;
  status: 'active' | 'done' | 'dismissed';
  createdBy: string | null;
  source: 'coach' | 'chat';
  createdAt: string;
  expiresAt: string | null;
}

/** Headline counts for the manager dashboard tiles. */
export interface ManagerStats {
  total: number;
  unscored: number;
  unranked: number;
  unowned: number;
  openPullRequests: number;
  /** Tickets whose required role/reviewer coverage is unmet (the manager staffs these). */
  flagged: number;
  lastRunAt: string | null;
}

/** One backlog row as ranked/scored by the manager (sorted managerRank asc, nulls last). */
export interface ManagerBacklogItem {
  id: number;
  key: string;
  title: string;
  status: string;
  priority: TaskPriority;
  businessValue: number | null;
  businessValueRationale: string | null;
  managerRank: number | null;
  dueDate: string | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
}

/** A single manager action (audit-feed entry). */
export interface ManagerAction {
  id: string;
  taskId: number | null;
  ticketKey?: string | null;
  ticketTitle?: string | null;
  actionType: ManagerActionType;
  summary: string;
  detail: string | null;
  createdAt: string;
}

/** One "Backlog management pass" task the manager kicked off — a board task the
 *  manager owns, moved in_progress→done with the run summary in `summary`. */
export interface ManagerRunTask {
  id: number;
  key: string;
  title: string;
  status: string;
  /** The run summary (task description), or the initial "grooming…" copy while open. */
  summary: string | null;
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
  createdAt: string;
  completedAt: string | null;
}

/** Why the autonomous machinery (cron manager sweep + executor) may be paused for
 *  this tenant. `tokenBlocked` freezes ranking/assignment/dispatch AND Evermind
 *  learning — only manual "Run manager now" (which does not token-gate) still runs. */
export interface ManagerAutonomy {
  tokenBlocked: boolean;
  reason: 'daily_exhausted' | 'monthly_exhausted' | null;
  effectivePlan: 'free' | 'pro' | 'teams' | null;
}

/** The full manager overview returned by GET /api/manager/:projectId. */
export interface ManagerOverview {
  config: ManagerConfig | null;
  policy: ManagerPolicy;
  stats: ManagerStats;
  backlog: ManagerBacklogItem[];
  actions: ManagerAction[];
  /** The manager's own run tasks (open / in-progress / done), newest first. */
  runTasks: ManagerRunTask[];
  /** Autonomy health — whether the cron sweeps are paused (e.g. tenant out of tokens). */
  autonomy: ManagerAutonomy;
  /** The available manager types: built-in domains + tenant custom-role types. */
  managerTypes: ManagerTypeOption[];
  /** Standing coaching directives that steer this project's passes (incl. tenant-wide). */
  directives: ManagerDirective[];
}

/** Editable subset accepted by PUT /api/manager/:projectId. */
export type ManagerConfigPatch = Partial<{
  /** '' clears the manager (system service takes over); `c:`/`u:` encode an assignee. */
  managerRef: string;
  enabled: boolean;
  prMergePolicy: PrMergePolicy;
  autoAssign: boolean;
  autoBusinessValue: boolean;
  autoPrioritize: boolean;
  managerType: ManagerTypeId;
}>;

export const managerApi = {
  /** Full manager overview for a project (config, effective policy, stats, backlog, activity). */
  get: (projectId: number): Promise<ManagerOverview> =>
    request<ManagerOverview>(`/api/manager/${projectId}`),

  /** Update the manager config (manager-role only). Returns the fresh config + policy. */
  update: (projectId: number, patch: ManagerConfigPatch): Promise<{ config: ManagerConfig; policy: ManagerPolicy }> =>
    request<{ config: ManagerConfig; policy: ManagerPolicy }>(`/api/manager/${projectId}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  /**
   * Start a manager pass now (manager-role only). Non-blocking: the server kicks the
   * (heavy) pass off in the background and acknowledges immediately with
   * `{ started: true }`, then journals each decision to the activity feed as it runs.
   * `started` is false with `reason: 'disabled'` when managing is paused. Poll `get`
   * / `activity` after starting to stream the live decisions.
   */
  run: (projectId: number): Promise<{ started: boolean; reason?: 'disabled' }> =>
    request<{ started: boolean; reason?: 'disabled' }>(`/api/manager/${projectId}/run`, { method: 'POST' }),

  /** Coach the manager. mode 'directive' (default) records a STANDING directive it honors
   *  on every pass (`scope: 'tenant'` applies to every project; `expiresInDays` time-boxes
   *  it). mode 'task' hands the manager ONE discrete task to execute once. */
  coach: (
    projectId: number,
    body: { directive: string; scope?: 'project' | 'tenant'; mode?: 'directive' | 'task'; expiresInDays?: number },
  ): Promise<{ mode: 'directive' | 'task'; id?: string; taskId?: number; started: boolean }> =>
    request<{ mode: 'directive' | 'task'; id?: string; taskId?: number; started: boolean }>(
      `/api/manager/${projectId}/coach`, { method: 'POST', body: JSON.stringify(body) }),

  /** Retire a coaching directive (dismissed / done). */
  dismissDirective: (projectId: number, directiveId: string, status: 'dismissed' | 'done' = 'dismissed'): Promise<{ ok: boolean }> =>
    request<{ ok: boolean }>(`/api/manager/${projectId}/directives/${directiveId}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  /** Recent manager actions (activity feed), newest first. */
  activity: (projectId: number, limit?: number): Promise<ManagerAction[]> => {
    const q = limit != null ? `?limit=${limit}` : '';
    return request<{ actions: ManagerAction[] }>(`/api/manager/${projectId}/activity${q}`).then((r) => r.actions);
  },
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
  /** Models observed in llm.complete telemetry for the execution that made this change. */
  models?: string[];
  /** Authoritative usage provenance: whether the tenant's own provider key served it. */
  modelUsage?: Array<{ model: string; byo: boolean; provider: string | null }>;
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

/**
 * Files on a task's AGENT WORKING BRANCH (the ticket branch a run commits to),
 * read server-side for the Brain composer's "Add context". Falls back to the base
 * branch when the ticket branch doesn't exist yet. `ImportedRepoFile` is defined
 * with the other repo types below.
 */
export interface TaskRepoFilesResult {
  ok: boolean;
  ref?: string;
  branch?: string;
  base?: string;
  files: ImportedRepoFile[];
  truncated?: boolean;
  reason?: string;
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

/** Cross-surface "needs attention" state for a work item, most-severe wins.
 *  `awaiting_input` = an agent paused on ask_human and a person must answer;
 *  `running` = actively executing. Idle items are omitted from the response. */
export type AttentionState = 'running' | 'awaiting_input';
export interface AttentionItem {
  state: AttentionState;
  executionId?: number;
  approvalId?: string;
}
/** AI Manager cadence carried on the same cross-surface attention signal, so any
 *  screen can show an ambient "Manager active / last managed" indicator. Scope is
 *  the requested project, or the whole tenant when no projectId is passed. */
export interface AttentionManager {
  /** ISO of the freshest manager pass in scope, or null if never managed. */
  lastRunAt: string | null;
  /** A pass landed in the last few minutes (pulse the indicator). */
  recentlyActive: boolean;
}
export interface AttentionResponse {
  /** Keyed by task id. */
  tasks: Record<number, AttentionItem>;
  /** Keyed by Brain chat id (a chat inherits the state of its linked task). */
  chats: Record<number, AttentionItem & { taskId?: number }>;
  counts: { running: number; awaiting: number };
  /** AI Manager cadence (present on every response). */
  manager: AttentionManager;
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

  /** The ONE cross-surface "what's live / what needs me" signal: per-task and
   *  per-Brain-chat attention state (running / awaiting_input). Poll this and
   *  render an indicator wherever sessions or tickets are listed. */
  attention: (projectId?: number): Promise<AttentionResponse> =>
    request<AttentionResponse>(`/api/runtime/attention${projectId != null ? `?projectId=${projectId}` : ''}`),

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

  /** Files on the task's agent working branch (ticket branch), for "Add context". */
  taskRepoFiles: (taskId: number): Promise<TaskRepoFilesResult> =>
    request<TaskRepoFilesResult>(`/api/runtime/tasks/${taskId}/repo-files`),

  /** Cancel a running/queued execution. */
  cancel: (id: number): Promise<Execution> =>
    request<Execution>(`/api/runtime/executions/${id}/cancel`, { method: 'POST' }),

  /**
   * Revert a finished run: close the PR it opened and delete the ticket branch it
   * wrote. Manager-gated and destructive — always confirm before calling.
   *
   * The server REFUSES with a 409 (message = the exact reason) whenever it cannot
   * prove the artifacts are still only this run's: a merged PR, a branch that
   * advanced, foreign commits or paths, unreadable evidence, or a provider that
   * cannot support the operation. Surface that message verbatim.
   */
  revert: (id: number): Promise<{ reverted: true; branch: string; branchDeleted: boolean; prClosed: boolean; commits: number }> =>
    request<{ reverted: true; branch: string; branchDeleted: boolean; prClosed: boolean; commits: number }>(
      `/api/runtime/executions/${id}/revert`, { method: 'POST' },
    ),

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
  /** Per-individual-user spend — attributed to the human / SDK caller. */
  perUser: Array<{ userId: string | null; userName: string; totalTokens: number; requests: number; estimatedCostUsd: number }>;
  /** Per-team spend — usage mapped to a team via team membership. */
  perTeam: Array<{ teamId: number; teamName: string; totalTokens: number; requests: number; estimatedCostUsd: number }>;
  /** Per-repo spend — attributed to the explicit repo of the originating task. */
  perRepo: Array<{ repoId: string; repoLabel: string; totalTokens: number; requests: number; estimatedCostUsd: number }>;
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

export type MeterKey = 'ai_tokens' | 'cloud_runs' | 'ingestion' | 'error_events' | 'outbound_fetches';
export type MeterUnit = 'tokens' | 'runs' | 'bytes' | 'events' | 'fetches';

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
  /** Month-to-date daily series (one entry per elapsed UTC day) for a sparkline;
   *  omitted for meters without a daily trend. */
  trend?: number[];
  /** Optional month-to-date totals scoped beneath this meter. */
  breakdown?: Array<{ key: string; used: number }>;
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
  discipline: 'engineering' | 'product' | 'design' | 'qa' | 'devops' | 'data' | 'other' | null;
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
  discipline: string | null;
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

export interface DisciplineRollup {
  discipline: string;
  memberCount: number;
  completedCount: number;
  avgEffectiveness: number | null;
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

  /** Effectiveness/engagement scorecards for every member over a window (MANAGER+).
   *  Optional `discipline` filters to one builder discipline; `byDiscipline` is the
   *  full (unfiltered) rollup by discipline. */
  metrics: (days = 7, discipline?: string): Promise<{ windowDays: number; members: MemberScorecard[]; byDiscipline: DisciplineRollup[] }> =>
    request<{ windowDays: number; members: MemberScorecard[]; byDiscipline: DisciplineRollup[] }>(
      `/api/members/metrics?days=${days}${discipline ? `&discipline=${encodeURIComponent(discipline)}` : ''}`,
    ),

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

// ---------------------------------------------------------------------------
// Extended member / EMP metrics (EMP-12..20) — /api/members/* additional router.
// All MANAGER+ on the API. Mirror the compute shapes in api/src/application/metrics/*.
// ---------------------------------------------------------------------------

export interface AllocationHealthRow {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  maxWip: number;
  hasExplicitMax: boolean;
  observedWip: number;
  overAllocated: boolean;
  utilizationPct: number;
}
export interface AllocationHealthResult {
  members: AllocationHealthRow[];
  overAllocatedCount: number;
  totalMembers: number;
}

export interface CollaborationRow {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  prsReviewed: number;
  reviewComments: number;
  handoffs: number;
  avgReviewTurnaroundHours: number | null;
  collaborationScore: number;
  breakdown: { reviewsPts: number; commentsPts: number; handoffPts: number; latencyPts: number };
}
export interface CollaborationResult { windowDays: number; members: CollaborationRow[] }

export interface DocActivityRow {
  memberKind: 'human';
  memberRef: string;
  name: string;
  docsAuthored: number;
  edits: number;
  acksGiven: number;
  score: number;
}
export interface DocActivityResult {
  windowDays: number;
  members: DocActivityRow[];
  totals: { docsAuthored: number; edits: number; acksGiven: number };
}

export interface LaborByMember {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  costUsd: number;
  effortHours: number;
  taskCount: number;
}
export interface LaborBucket { id: string; name: string; costUsd: number }
export interface LaborCostResult {
  windowDays: number;
  totalUsd: number;
  byMember: LaborByMember[];
  byProject: LaborBucket[];
  byInitiative: LaborBucket[];
}

export type PerformerTier = 'high' | 'solid' | 'watch';
export interface PerformerRow {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  discipline: string | null;
  effectivenessScore: number | null;
  engagementScore: number | null;
  composite: number;
  percentile: number;
  tier: PerformerTier;
}
export interface PerformerTiersResult {
  windowDays: number;
  members: PerformerRow[];
  counts: Record<PerformerTier, number>;
}
export interface CoachingNote {
  id: number;
  tenantId: number;
  memberKind: MemberKind;
  memberRef: string;
  note: string;
  authorId: string | null;
  createdAt: string;
}

export interface InitiativeSlice { initiativeId: string; initiativeName: string; hours: number; pct: number }
export interface MemberAllocationRow {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  totalHours: number;
  initiativeCount: number;
  slices: InitiativeSlice[];
}
export interface MemberInitiativeAllocResult {
  windowDays: number;
  members: MemberAllocationRow[];
  initiatives: Array<{ id: string; name: string }>;
}

export const empMetricsApi = {
  /** EMP-12 — over-allocation detection (observed WIP vs. ceiling). */
  allocationHealth: (): Promise<AllocationHealthResult> =>
    request<AllocationHealthResult>('/api/members/allocation-health'),

  /** EMP-14 — collaboration metrics (reviews, comments, handoffs). */
  collaboration: (days = 30): Promise<CollaborationResult> =>
    request<CollaborationResult>(`/api/members/collaboration?days=${days}`),

  /** EMP-17 — documentation-activity metrics per member. */
  docActivity: (days = 30): Promise<DocActivityResult> =>
    request<DocActivityResult>(`/api/members/doc-activity?days=${days}`),

  /** EMP-19 — labour-cost attribution (member / project / initiative). */
  laborCost: (days = 30, projectId?: number): Promise<LaborCostResult> =>
    request<LaborCostResult>(`/api/members/labor-cost?days=${days}${projectId != null ? `&projectId=${projectId}` : ''}`),

  /** EMP-16 — high/low-performer tiers within discipline. */
  performerTiers: (days = 30): Promise<PerformerTiersResult> =>
    request<PerformerTiersResult>(`/api/members/performer-tiers?days=${days}`),

  /** EMP-16 — coaching notes for a member (or all when kind/ref omitted). */
  coachingNotes: (kind?: MemberKind, ref?: string): Promise<{ notes: CoachingNote[] }> =>
    request<{ notes: CoachingNote[] }>(`/api/members/coaching-notes${kind && ref ? `?kind=${kind}&ref=${encodeURIComponent(ref)}` : ''}`),

  addCoachingNote: (memberKind: MemberKind, memberRef: string, note: string): Promise<{ note: CoachingNote }> =>
    request<{ note: CoachingNote }>('/api/members/coaching-notes', {
      method: 'POST', body: JSON.stringify({ memberKind, memberRef, note }),
    }),

  deleteCoachingNote: (id: number): Promise<void> =>
    request<void>(`/api/members/coaching-notes/${id}`, { method: 'DELETE' }),

  /** EMP-13 — per-member strategic-initiative allocation. */
  initiativeAllocation: (days = 30): Promise<MemberInitiativeAllocResult> =>
    request<MemberInitiativeAllocResult>(`/api/members/initiative-allocation?days=${days}`),

  /** EMP-20 — download the member metrics as CSV/JSON (auth'd blob → browser save). */
  exportMetrics: async (days = 30, format: 'csv' | 'json' = 'csv'): Promise<void> => {
    const token = getStoredTenantToken();
    const res = await fetch(`${AUTH_API_URL}/api/members/metrics/export?days=${days}&format=${format}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    const blob = await res.blob();
    downloadBlob(blob, `member-metrics-${days}d-${new Date().toISOString().slice(0, 10)}.${format}`);
  },
};

/**
 * BYO LLM provider keys — a tenant stores its own Anthropic key so the gateway
 * proxies BuilderForce-V2 (Claude Agent SDK) model calls with the tenant's key
 * and meters them. The key is write-only: we only ever read which providers are
 * configured, never the secret.
 */
export type LlmProvider = 'anthropic' | 'openai' | 'google' | 'meta' | 'kimi' | 'qwen' | 'minimax' | 'xai';

/** How a configured provider authenticates: a pasted API key, or a connected
 *  Claude Pro/Max subscription via OAuth. */
export type ProviderAuthType = 'api_key' | 'oauth';
/**
 * A dispatch-observed rejection of a connected account — the gateway authenticated
 * with the stored credential and the upstream refused it (401/403).
 *
 * This is deliberately NOT derivable from `ProviderDiagnostic.status`: that field
 * reports whether the credential RESOLVES, and the worst case here — a ChatGPT
 * account whose plan lapsed or that lacks Codex entitlement — resolves perfectly and
 * still 403s on every call. Without this signal the card reads "● connected" forever
 * while the account silently serves nothing.
 */
export interface ProviderAuthAlert {
  provider: LlmProvider;
  /** `not_entitled` — the account authenticated but the plan doesn't cover this
   *  surface (reconnect a different account, or upgrade the plan). `rejected` — the
   *  credential itself was refused (expired/revoked/rotated; reconnect the same one). */
  reason: 'not_entitled' | 'rejected';
  /** Upstream status that produced the alert (401 / 403). */
  status: number;
  /** The gateway vendor that was rejected — `openai-codex` (a ChatGPT subscription)
   *  reads differently to the operator than `openai` (an API key). */
  vendor: string;
  /** Epoch-ms of the most recent rejection. */
  at: number;
}

export interface ProviderKeySummary {
  provider: LlmProvider;
  authType: ProviderAuthType;
  /** Tenant-set BYO precedence — LOWER = tried first by the auto-select cloud pin;
   *  `null` = unset (falls back to catalog-tier ordering). */
  priority: number | null;
  /** Present when this account was rejected on a recent call — see {@link ProviderAuthAlert}. */
  authAlert?: ProviderAuthAlert;
}
export interface ProviderDiagnostic {
  provider: LlmProvider;
  configured: boolean;
  usable: boolean;
  status: 'ready' | 'not_connected' | 'revoked' | 'expired' | 'undecryptable' | 'unavailable';
  usage: { periodDays: number; requests: number; tokens: number; lastUsedAt: string | null };
  /** Present when this account was rejected on a recent call — see {@link ProviderAuthAlert}. */
  authAlert?: ProviderAuthAlert;
}

export interface ProviderConnectionTestResult {
  ok: boolean;
  status: string;
  model?: string;
  testedAt?: string;
  error?: string;
  code?: string;
  /** `attempts` is the per-model failover breakdown — the only place the real
   *  upstream status survives when the gateway collapses a retryable failure
   *  into its cascade summary. */
  details?: {
    provider: LlmProvider;
    model: string;
    upstreamStatus: number;
    attempts?: Array<{ model: string; vendor: string; code: number; durationMs: number; kind: string }>;
  };
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

  status: (provider: LlmProvider): Promise<ProviderDiagnostic> =>
    request<ProviderDiagnostic>(`/llm/provider-keys/${provider}/status`),

  test: (provider: LlmProvider): Promise<ProviderConnectionTestResult> =>
    request<ProviderConnectionTestResult>(`/llm/provider-keys/${provider}/test`, { method: 'POST' }),

  /** Set the BYO precedence — the ordered provider list (most-preferred first) the
   *  auto-select cloud pin leads its connected flagships by (e.g. Meta first). */
  setPriority: (order: LlmProvider[]): Promise<{ ok: true; order: LlmProvider[] }> =>
    request<{ ok: true; order: LlmProvider[] }>('/llm/provider-keys/priority', {
      method: 'PUT',
      body: JSON.stringify({ order }),
    }),

  /** Begin connecting a Claude subscription — returns the Claude.ai authorize URL
   *  the user opens to grant access (PKCE verifier is held server-side). */
  oauthStart: (provider: LlmProvider): Promise<{ authorizeUrl: string; state: string }> =>
    request<{ authorizeUrl: string; state: string }>(`/llm/provider-keys/${provider}/oauth/start`, {
      method: 'POST',
    }),

  /** Finish connecting a Claude subscription with the `code#state` the user
   *  pasted from Claude.ai's consent page. */
  oauthComplete: (provider: LlmProvider, code: string, state?: string): Promise<{ ok: true; provider: LlmProvider; authType: ProviderAuthType }> =>
    request<{ ok: true; provider: LlmProvider; authType: ProviderAuthType }>(
      `/llm/provider-keys/${provider}/oauth/complete`,
      { method: 'POST', body: JSON.stringify({ code, ...(state ? { state } : {}) }) },
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
  /** Ticket that caused this request, when it originated from a task execution. */
  taskId: number | null;
  /** Project containing the related ticket. */
  projectId: number | null;
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
// Governance policy packs — the gates the agent runtime hard-enforces at its
// tool-call seam (`evaluatePolicyGate`). A pack is a named, toggleable bundle of
// gates; NULL projectId/agentRef mean "applies to every project / every agent".
// ---------------------------------------------------------------------------

/** The three effects the runtime evaluator switches on. */
export type PolicyGateEffect = 'inject-directive' | 'require-approval' | 'block';

export interface PolicyGate {
  id: string;
  packId: string;
  /** The gate id carried on the wire and echoed back in a block/approval decision. */
  gateKey: string;
  /** null or '*' governs EVERY tool — how a broad deny posture is authored. */
  tool: string | null;
  effect: PolicyGateEffect;
  directive: string | null;
  reason: string | null;
  position: number;
}

export interface PolicyPack {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  projectId: number | null;
  agentRef: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  gates: PolicyGate[];
}

export interface PolicyPackInput {
  name?: string;
  description?: string | null;
  enabled?: boolean;
  projectId?: number | null;
  agentRef?: string | null;
}

export interface PolicyGateInput {
  gateKey?: string;
  tool?: string | null;
  effect?: PolicyGateEffect;
  directive?: string | null;
  reason?: string | null;
  position?: number;
}

/** The resolved wire shape a run actually receives (preview of enforcement). */
export interface EffectivePolicyGate {
  id: string;
  tool?: string;
  effect: PolicyGateEffect;
  directive?: string;
  reason?: string;
}

export const policyPacksApi = {
  list: (): Promise<PolicyPack[]> =>
    request<PolicyPack[]>('/api/governance/policy-packs'),

  create: (input: PolicyPackInput): Promise<PolicyPack> =>
    request<PolicyPack>('/api/governance/policy-packs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),

  update: (packId: string, input: PolicyPackInput): Promise<void> =>
    request(`/api/governance/policy-packs/${packId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }).then(() => undefined),

  remove: (packId: string): Promise<void> =>
    request(`/api/governance/policy-packs/${packId}`, { method: 'DELETE' }).then(() => undefined),

  addGate: (packId: string, input: PolicyGateInput): Promise<PolicyGate> =>
    request<PolicyGate>(`/api/governance/policy-packs/${packId}/gates`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }),

  updateGate: (gateId: string, input: PolicyGateInput): Promise<void> =>
    request(`/api/governance/policy-gates/${gateId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }).then(() => undefined),

  removeGate: (gateId: string): Promise<void> =>
    request(`/api/governance/policy-gates/${gateId}`, { method: 'DELETE' }).then(() => undefined),

  /** What a run in this scope would actually be gated by — the same resolver dispatch uses. */
  effective: (projectId?: number | null, agentRef?: string | null): Promise<EffectivePolicyGate[]> => {
    const qs = new URLSearchParams();
    if (projectId != null) qs.set('project', String(projectId));
    if (agentRef) qs.set('agent', agentRef);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<{ gates: EffectivePolicyGate[] }>(`/api/governance/policy-gates/effective${suffix}`)
      .then((r) => r.gates ?? []);
  },
};

// ---------------------------------------------------------------------------
// Security agent — SOC 2 audit + access-restricted SECURITY tickets
// ---------------------------------------------------------------------------

/** Whole-population opt-ins for who can see SECURITY tickets (default all off). */
export interface SecurityAudiences {
  humans: boolean;
  hired: boolean;
  talent: boolean;
}

export interface SecurityAccessConfig {
  audiences: SecurityAudiences;
  allowUserIds: string[];
  allowAgentRefs: string[];
}

export interface SecurityAudit {
  id: number;
  projectId: number | null;
  status: 'running' | 'complete' | 'failed';
  triggerSource: 'cron' | 'manual';
  summary: string | null;
  findingsCount: number;
  countsBySeverity: Record<string, number> | null;
  countsByTsc: Record<string, number> | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SecurityAuditFinding {
  id: number;
  title: string;
  status: string;
  priority: string;
  severity: string | null;
  tsc: string | null;
}

/** One external website security-scan run (a security_audits row, scanKind='web'). */
export interface WebScanRun {
  id: number;
  status: 'running' | 'complete' | 'failed';
  targetUrl: string | null;
  score: number | null;
  summary: string | null;
  findingsCount: number;
  countsBySeverity: Record<string, number> | null;
  startedAt: string;
  finishedAt: string | null;
}

/** A single finding from the deterministic web scan (before it becomes a ticket). */
export interface WebScanFinding {
  checkId: string;
  title: string;
  detail: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  recommendation: string;
  tsc: string;
  marker: string;
}

export interface WebScanBaseline {
  previousScore: number | null;
  previousFindings: number | null;
  scoreDelta: number | null;
  newFindings: number;
  resolvedFindings: number;
}

export interface WebScanRunResult {
  ok: true;
  auditId: number;
  projectId: number;
  targetUrl: string;
  finalUrl: string;
  score: number;
  recorded: number;
  deduped: number;
  taskIds: number[];
  findings: WebScanFinding[];
  baseline: WebScanBaseline;
}

export const securityAgentApi = {
  getAccess: (): Promise<SecurityAccessConfig> =>
    request<SecurityAccessConfig>('/api/security/access'),

  setAccess: (cfg: Partial<SecurityAccessConfig>): Promise<SecurityAccessConfig> =>
    request<SecurityAccessConfig>('/api/security/access', { method: 'PUT', body: JSON.stringify(cfg) }),

  listAudits: (): Promise<SecurityAudit[]> =>
    request<{ audits: SecurityAudit[] }>('/api/security/audits').then((r) => r.audits ?? []),

  getAudit: (id: number): Promise<{ audit: SecurityAudit; findings: SecurityAuditFinding[] }> =>
    request<{ audit: SecurityAudit; findings: SecurityAuditFinding[] }>(`/api/security/audits/${id}`),

  runAudit: (projectId?: number): Promise<{ auditId: number }> =>
    request<{ auditId: number }>('/api/security/audits/run', {
      method: 'POST',
      body: JSON.stringify(projectId != null ? { projectId } : {}),
    }),

  // ── Web (external URL) security scan ──────────────────────────────────────
  getWebScanConfig: (): Promise<{ projectId: number | null; targetUrl: string | null }> =>
    request<{ projectId: number | null; targetUrl: string | null }>('/api/security/web-scan/config'),

  setWebScanTarget: (url: string | null): Promise<{ projectId: number; targetUrl: string | null }> =>
    request<{ projectId: number; targetUrl: string | null }>('/api/security/web-scan/config', {
      method: 'PUT',
      body: JSON.stringify({ url }),
    }),

  listWebScans: (): Promise<WebScanRun[]> =>
    request<{ scans: WebScanRun[] }>('/api/security/web-scan').then((r) => r.scans ?? []),

  runWebScan: (url?: string): Promise<WebScanRunResult> =>
    request<WebScanRunResult>('/api/security/web-scan/run', {
      method: 'POST',
      body: JSON.stringify(url ? { url } : {}),
    }),
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
  byCredential: Array<{ type: 'integration' | 'api_key'; id: string; name: string; requests: number; modelCount: number; tokens: number }>;
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
/** One BYO (bring-your-own-provider) model a tenant's connected account can serve,
 *  as a pinnable `<vendor>/<id>` ref. */
export interface ByoModel { id: string; vendor: string; tier: string; contextWindow?: number }
/** The tenant's connected providers + the models they unlock. `canChooseModel` is
 *  true when the tenant may pick a model at all — a paid plan OR at least one
 *  connected provider (BYO), so the model choices follow the connected providers. */
export interface ByoModelInfo { providers: string[]; models: ByoModel[] }

/** How a tenant's card-validation flow stands — the gate on PREMIUM model selection. */
export type CardValidationStatus = 'none' | 'pending' | 'validated' | 'failed';

/** PREMIUM (any-paid-OpenRouter) model selection: the tenant may pick ANY paid
 *  OpenRouter model, billed at OpenRouter's own price + a flat per-request surcharge.
 *  Stricter than frontier access — it needs a paid plan AND a validated card, because
 *  it routes on Builderforce's metered key. `unlock` names the exact next step on a
 *  miss so the UI shows "Upgrade" vs "Validate your card" rather than a generic wall.
 *  Mirrors `evaluatePremiumModelAccess` (the api is the source of truth). */
export interface PremiumModelInfo {
  entitled: boolean;
  reason: 'superadmin' | 'premium_override' | 'paid_card' | 'card_required' | 'plan_required';
  unlock?: 'upgrade' | 'validate_card';
  cardValidationStatus: CardValidationStatus;
  /** Flat surcharge added per request, in millicents (1/100000 USD). 1000 = 1¢. */
  surchargeMillicents: number;
}

export type LlmModelsResponse =
  | { configured: false; product: string; effectivePlan: EffectivePlanLabel; premium?: boolean; models: string[]; codingModels?: string[]; teacherModels?: string[]; canChooseModel?: boolean; canUseFrontierModels?: boolean; canUsePremiumModels?: boolean; premiumInfo?: PremiumModelInfo; byo?: ByoModelInfo }
  | { configured: true;  product: string; effectivePlan: EffectivePlanLabel; premium?: boolean; object: 'list'; data: LlmModelStatus[]; codingModels?: string[]; teacherModels?: string[]; canChooseModel?: boolean; canUseFrontierModels?: boolean; canUsePremiumModels?: boolean; premiumInfo?: PremiumModelInfo; byo?: ByoModelInfo };

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

/** Card-validation state — the gate on PREMIUM (any-paid-OpenRouter) model selection.
 *  Mirrors exactly what `GET /api/tenants/:id/card-validation` returns; a field the
 *  route doesn't send has no business being declared here (a non-optional
 *  `paymentProvider: string` used to be, so any reader would have got `undefined`
 *  from a type that promised a string). */
export interface CardValidationState {
  status: CardValidationStatus;
  validated: boolean;
  validatedAt: string | null;
  brand: string | null;
  last4: string | null;
}

/**
 * Explicit card validation (Stripe SetupIntent / Helcim $0 verify). A paid tenant runs
 * this once to unlock premium model selection — no charge is made; it only proves the
 * card is usable, since premium is metered per request rather than sold as a plan.
 */
export const cardValidationApi = {
  get: (tenantId: number): Promise<CardValidationState> =>
    request<CardValidationState>(`/api/tenants/${tenantId}/card-validation`),

  /** Start validation. Hosted providers return a `checkoutUrl` to send the user to;
   *  the manual provider validates immediately (`validated: true`). */
  start: (tenantId: number, body?: { billingEmail?: string; successUrl?: string; cancelUrl?: string }) =>
    request<{ checkoutUrl: string | null; sessionId: string; validated: boolean; status: CardValidationStatus }>(
      `/api/tenants/${tenantId}/card-validation`,
      { method: 'POST', body: JSON.stringify(body ?? {}) },
    ),

  /**
   * Remove the card on file — detached at the processor, then cleared here. This
   * REVOKES premium model selection, which is the point of removing it.
   *
   * 409 `card_backs_active_subscription` when a paid plan still bills this card:
   * downgrade to Free first. Manager role required.
   */
  remove: (tenantId: number): Promise<CardValidationState> =>
    request<CardValidationState>(`/api/tenants/${tenantId}/card-validation`, { method: 'DELETE' }),
};

export const llmApi = {
  usage: async (): Promise<LlmUsageStats> => {
    const raw = await request<{
      days: number;
      totals: { requests: number; totalTokens: number; promptTokens: number; completionTokens: number };
      byModel: Array<{ model: string; requests: number; total_tokens: string | number }>;
      byCredential?: Array<{ type: 'integration' | 'api_key'; id: string; name: string; requests: number; modelCount: number; tokens: string | number }>;
    }>('/llm/v1/usage');
    return {
      totalRequests: raw.totals.requests,
      totalTokens: raw.totals.totalTokens,
      promptTokens: raw.totals.promptTokens,
      completionTokens: raw.totals.completionTokens,
      byModel: raw.byModel.map((m) => ({ model: m.model, requests: m.requests, tokens: Number(m.total_tokens) })),
      byCredential: (raw.byCredential ?? []).map((c) => ({ ...c, requests: Number(c.requests), modelCount: Number(c.modelCount), tokens: Number(c.tokens) })),
      period: `${raw.days} days`,
    };
  },

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
export type PmoScopeKind = 'portfolio' | 'initiative' | 'project' | 'workspace';

// ── Planning spine (0225): the unified dated, cost-bearing hierarchy ──────────
export type CostClass = 'capex' | 'opex';
export type SpineNodeKind = 'portfolio' | 'objective' | 'initiative' | 'epic' | 'task' | 'roadmap';

export interface CostClassSuggestion { costClass: CostClass; confidence: number; rationale: string }
export interface SpineCost { llmUsd: number; humanUsd: number; totalUsd: number; capexUsd: number; opexUsd: number }
export interface SpineNode {
  key: string; id: string; kind: SpineNodeKind; parentKey: string | null;
  title: string; status: string; startDate: string | null; endDate: string | null; depth: number;
  declaredCostClass: CostClass | null; costClassSource: string;
  inheritedCostClass: CostClass | null; effectiveCostClass: CostClass | null;
  costClassVerified: boolean; anomaly: boolean; hasDescendantAnomaly: boolean;
  suggestion: CostClassSuggestion | null; cost: SpineCost; childCount: number;
}
export interface SpineResult {
  nodes: SpineNode[]; totals: SpineCost; anomalyCount: number; unverifiedCount: number;
}

export interface Portfolio {
  id: string; name: string; description: string | null; status: string;
  ownerUserId: string | null; targetDate: string | null;
}
export interface Initiative {
  id: string; name: string; description: string | null; status: string;
  portfolioId: string | null; ownerUserId: string | null;
  startDate: string | null; targetDate: string | null;
  costClass: CostClass | null; costClassSource: string;
}
export interface Objective {
  id: string; title: string; description: string | null; period: string | null;
  status: string; projectId: number | null; portfolioId: string | null; initiativeId: string | null; ownerUserId: string | null;
  startDate: string | null; endDate: string | null;
  costClass: CostClass | null; costClassSource: string;
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
export interface ObjectiveLinkRef { id: string; kind: 'initiative' | 'epic' | 'task'; refId: string; label: string }
export interface ObjectiveProgress {
  id: string; title: string; period: string | null; status: string;
  portfolioId: string | null; initiativeId: string | null; projectId: number | null;
  startDate: string | null; endDate: string | null; costClass: CostClass | null;
  progress: number; keyResults: KeyResultProgress[]; links: ObjectiveLinkRef[];
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
  byPortfolio: Array<{ portfolioId: string | null; name: string; initiativeCount: number; projectCount: number; completedCount: number; agentLlmCostUsd: number; avgProgress: number }>;
  criticalPath: InitiativeRef[];
  cycleDetected: boolean;
  blockedBy: InitiativeRef[];
  blocks: InitiativeRef[];
}

/** Value stream — the initiative dependency graph + per-node delivery progress. */
export interface ValueStreamInitiative {
  id: string; name: string; status: string;
  onCriticalPath: boolean; blockedBy: string[];
  totalTasks: number; completedTasks: number; completionPct: number;
}
export interface ValueStreamEdge { id: string; fromInitiativeId: string; toInitiativeId: string; onCriticalPath: boolean }
export interface ValueStream {
  nodes: ValueStreamInitiative[];
  edges: ValueStreamEdge[];
  criticalPath: string[];
  cycleDetected: boolean;
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
  /** The value stream: initiative dependency graph + per-node delivery progress +
   *  critical path (the cross-artifact "where is value stuck" view). */
  valueStream: (): Promise<ValueStream> => request<ValueStream>('/api/pmo/value-stream'),

  /** The unified planning spine: every level dated + cost-rolled, with effective
   *  CAPEX/OPEX, anomalies and agent suggestions. Powers the Gantt + reconcile.
   *  Pass a projectId to scope the leaf set to one project (empty parents pruned). */
  spine: (projectId?: number | null): Promise<SpineResult> =>
    request<SpineResult>(`/api/pmo/spine${projectId != null ? `?project=${projectId}` : ''}`),
  /** Period-bounded CapEx/OpEx finance export (CSV text). from/to are YYYY-MM-DD. */
  exportSpineCsv: async (params: { from?: string; to?: string; projectId?: number | null } = {}): Promise<string> => {
    const q = new URLSearchParams();
    if (params.from && params.to) { q.set('from', params.from); q.set('to', params.to); }
    if (params.projectId != null) q.set('project', String(params.projectId));
    const res = await fetch(`${AUTH_API_URL}/api/pmo/spine/export.csv${q.toString() ? `?${q}` : ''}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Export failed (${res.status})`);
    return res.text();
  },
  /** Set (or clear, with null) the CAPEX/OPEX class on any level. A PM 'manual'
   *  set also verifies the row; pass source:'agent' for an applied suggestion. */
  setCostClass: (kind: SpineNodeKind, id: string, costClass: CostClass | null, source?: 'manual' | 'agent'): Promise<{ ok: true }> =>
    request('/api/pmo/cost-class', { method: 'PATCH', body: JSON.stringify({ kind, id, costClass, source }) }),
  /** Run the agent classifier over unclassified/unverified tasks. apply=false to
   *  preview suggestions without writing. */
  classifyCostClasses: (apply = true): Promise<{ classified: number; applied: boolean; suggestions: Array<{ id: number; title: string; suggestion: CostClassSuggestion }> }> =>
    request('/api/pmo/cost-class/classify', { method: 'POST', body: JSON.stringify({ apply }) }),

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
    /** Link an initiative / epic / task to an objective (the OKR lineage edge). */
    addLink: (objectiveId: string, link: { linkKind: 'initiative' | 'epic' | 'task'; initiativeId?: string; taskId?: number }): Promise<{ id: string }> =>
      request(`/api/pmo/objectives/${objectiveId}/links`, { method: 'POST', body: JSON.stringify(link) }),
    removeLink: (objectiveId: string, linkId: string): Promise<{ deleted: string }> =>
      request(`/api/pmo/objectives/${objectiveId}/links/${linkId}`, { method: 'DELETE' }),
    /** Demote an objective back to a board task/epic (the reverse of promoting an
     *  epic to an OKR). Re-parents linked tasks; key results are dropped. */
    convertType: (objectiveId: string, target: 'task' | 'epic', projectId?: number | null): Promise<WorkItemConversion> =>
      request<WorkItemConversion>(`/api/pmo/objectives/${objectiveId}/convert-type`, { method: 'POST', body: JSON.stringify({ target, projectId }) }),
  },
  keyResults: {
    list: () => keyResultTracker.list() as unknown as Promise<KeyResult[]>,
    create: (body: Partial<Omit<KeyResult, 'id'>>) => keyResultTracker.create(body) as unknown as Promise<KeyResult>,
    update: (id: string, body: Partial<Omit<KeyResult, 'id'>>) => keyResultTracker.update(id, body) as unknown as Promise<KeyResult>,
    remove: (id: string) => keyResultTracker.remove(id),
  },
};

// ── Time tracking (real logged effort; /api/time/*) ───────────────────────────
export interface DailyHoursBucket { date: string; hours: number }
export interface MemberTimeEntry {
  id: string; taskId: number; taskKey: string | null; taskTitle: string | null;
  minutes: number; entryDate: string; source: string; note: string | null;
}
export interface MemberDailyHours {
  windowDays: number; totalHours: number; daily: DailyHoursBucket[]; entries: MemberTimeEntry[];
}

export const timeApi = {
  /** Log minutes against a task. Defaults to the current user; a manager may pass
   *  memberKind/memberRef to log for another member. */
  log: (body: { taskId: number; minutes: number; entryDate?: string; note?: string; memberKind?: string; memberRef?: string }): Promise<{ id: string }> =>
    request('/api/time/entries', { method: 'POST', body: JSON.stringify(body) }),
  /** A member's daily logged-hours chart + recent entries. */
  member: (kind: string, ref: string, days = 30): Promise<MemberDailyHours> =>
    request<MemberDailyHours>(`/api/time/member/${kind}/${encodeURIComponent(ref)}?days=${days}`),
  /** All entries logged against a task. */
  forTask: (taskId: number): Promise<{ entries: Array<{ id: string; memberKind: string; memberRef: string; minutes: number; entryDate: string; source: string; note: string | null }> }> =>
    request(`/api/time/entries?taskId=${taskId}`),
  remove: (id: string): Promise<{ deleted: string }> =>
    request(`/api/time/entries/${id}`, { method: 'DELETE' }),
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
  /** Nullable project scope: null = portfolio-wide cadence, non-null = one project. */
  projectId: number | null;
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

/** Tenant-wide ceremonies rollup — cadence + engagement across all projects. */
export interface CeremonyRollup {
  windowDays: number;
  totals: {
    sessions: number;
    completed: number;
    active: number;
    completionRate: number;
    projects: number;
    avgDurationMinutes: number;
    participants: number;
    avgTurnSeconds: number;
    agentTalkShare: number;
  };
  byKind: Array<{ kind: string; sessions: number }>;
  series: Array<{ day: string; sessions: number }>;
  topTalkers: Array<{ memberKind: string; memberRef: string; memberName: string; talkSeconds: number; turns: number }>;
}

const CEREMONY_BASE = '/api/agile/ceremonies';
export const ceremonySessionsApi = {
  /** Tenant-wide cadence + engagement rollup across every project (MANAGER+). */
  rollup: (days = 30): Promise<CeremonyRollup> =>
    request<CeremonyRollup>(`${CEREMONY_BASE}/rollup?days=${days}`),
  active: (projectId: number, kind: CeremonyKind): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions?projectId=${projectId}&kind=${kind}`),
  start: (projectId: number, kind: CeremonyKind, participants: Array<{ kind: string; ref: string; name: string }>): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions`, { method: 'POST', body: JSON.stringify({ projectId, kind, participants }) }),
  advanceTurn: (id: string, currentTurn: number): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/turn`, { method: 'PATCH', body: JSON.stringify({ currentTurn }) }),
  /** End the session. The server then auto-dispatches the project's agent-owned
   *  work through the canonical lane-entry gate (bounded) — the client does NOT
   *  submit executions itself any more. */
  complete: (id: string): Promise<CeremonySessionDetail> =>
    request(`${CEREMONY_BASE}/sessions/${id}/complete`, { method: 'POST' }),
};

/** A recurring standup/planning. The frequent cron sweep opens a session for every
 *  due row with its roster pre-seeded, then re-arms nextRunAt from the cron. */
export interface CeremonySchedule {
  id: string;
  projectId: number;
  kind: CeremonyKind;
  /** 5-field cron — the same cadence language as QA schedules / workflow triggers. */
  cron: string;
  timezone: string;
  enabled: boolean;
  turnMode: 'facilitator' | 'timeboxed' | null;
  turnSeconds: number | null;
  /** 'members' derives the roster from member metrics; 'roster' uses `participants`. */
  participantScope: 'members' | 'roster';
  /** JSON array of { kind, ref, name }; only meaningful for the 'roster' scope. */
  participants: string;
  maxParticipants: number;
  autoDispatch: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastSessionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CeremonyScheduleInput {
  projectId?: number;
  kind?: CeremonyKind;
  cron?: string;
  timezone?: string;
  enabled?: boolean;
  turnMode?: 'facilitator' | 'timeboxed' | null;
  turnSeconds?: number | null;
  participantScope?: 'members' | 'roster';
  participants?: Array<{ kind: string; ref: string; name: string }>;
  maxParticipants?: number;
  autoDispatch?: boolean;
}

/** Ceremony cadence CRUD. Reads are member-level; writes are MANAGER+. */
export const ceremonySchedulesApi = {
  list: (projectId: number): Promise<{ schedules: CeremonySchedule[] }> =>
    request(`${CEREMONY_BASE}/schedules?projectId=${projectId}`),
  create: (body: CeremonyScheduleInput): Promise<{ schedule: CeremonySchedule }> =>
    request(`${CEREMONY_BASE}/schedules`, { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: CeremonyScheduleInput): Promise<{ schedule: CeremonySchedule }> =>
    request(`${CEREMONY_BASE}/schedules/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string): Promise<{ deleted: boolean }> =>
    request(`${CEREMONY_BASE}/schedules/${id}`, { method: 'DELETE' }),
};

// Member metrics & profiles (the workforce scorecard system) live in `membersApi`
// (declared earlier in this file) — the ceremony UI consumes those directly.

// ---------------------------------------------------------------------------
// Meetings — live video/audio (WebRTC mesh) + scheduling. /api/meetings/*
// ---------------------------------------------------------------------------
export type MeetingKind = 'standup' | 'planning' | 'retrospective' | 'adhoc' | 'direct' | 'interview' | 'review';
export type MeetingStatus = 'scheduled' | 'live' | 'ended' | 'cancelled';

export interface Meeting {
  id: string;
  projectId: number | null;
  kind: MeetingKind;
  title: string;
  description: string | null;
  scheduledAt: string | null;
  durationMinutes: number;
  status: MeetingStatus;
  createdBy: string | null;
  roomKey: string;
  /** Team Chat backchannel (0294): the meeting's persistent group chat — joining
   *  opens it, and absentees still post their update there. Null when unlinked. */
  chatId: number | null;
  videoEnabled: boolean;
  calendarProvider: string | null;
  calendarEventId: string | null;
  calendarHtmlLink: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** Recording/transcription (0330): generated minutes (recap + decisions + action
   *  items), also posted into the linked team chat. Null until summarized. */
  summary: string | null;
  summaryGeneratedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface MeetingAttendee {
  id: string;
  meetingId: string;
  memberKind: string;
  memberRef: string;
  memberName: string;
  email: string | null;
  role: string;
  response: 'invited' | 'accepted' | 'declined' | 'tentative';
  joinedAt: string | null;
  leftAt: string | null;
}
export interface MeetingDetail { meeting: Meeting; attendees: MeetingAttendee[]; }
export interface MeetingTranscriptSegment {
  id: string;
  speakerRef: string;
  speakerName: string;
  speakerKind: 'human' | 'agent';
  text: string;
  atMs: number;
  createdAt: string;
}
export interface MeetingTranscript {
  segments: MeetingTranscriptSegment[];
  summary: string | null;
  summaryGeneratedAt: string | null;
}
export interface MeetingJoinInfo {
  roomKey: string;
  videoEnabled: boolean;
  iceServers: unknown[];
  meeting: MeetingDetail;
}
export interface MeetingCreate {
  title?: string;
  kind?: MeetingKind;
  projectId?: number | null;
  scheduledAt?: string | null;
  durationMinutes?: number;
  videoEnabled?: boolean;
  attendees?: Array<{ kind?: string; ref: string; name: string; email?: string; role?: string }>;
  organizerName?: string;
  organizerEmail?: string;
  /** Team Chat (0294): scope the meeting's backing team chat to a named workforce
   *  team, and opt in/out of linking one (defaults on for team ceremonies). */
  teamId?: number | null;
  linkTeamChat?: boolean;
}

const MEETINGS_BASE = '/api/meetings';
export const meetingsApi = {
  list: (opts?: { projectId?: number; scope?: 'upcoming' | 'all' }): Promise<{ meetings: MeetingDetail[] }> => {
    const qs = new URLSearchParams();
    if (opts?.projectId) qs.set('projectId', String(opts.projectId));
    if (opts?.scope) qs.set('scope', opts.scope);
    const s = qs.toString();
    return request(`${MEETINGS_BASE}${s ? `?${s}` : ''}`);
  },
  get: (id: string): Promise<MeetingDetail> => request(`${MEETINGS_BASE}/${id}`),
  create: (body: MeetingCreate): Promise<MeetingDetail> =>
    request(MEETINGS_BASE, { method: 'POST', body: JSON.stringify(body) }),
  patch: (id: string, body: Partial<Pick<MeetingCreate, 'title' | 'scheduledAt' | 'durationMinutes' | 'videoEnabled'>>): Promise<MeetingDetail> =>
    request(`${MEETINGS_BASE}/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  join: (id: string, body?: { name?: string; email?: string }): Promise<MeetingJoinInfo> =>
    request(`${MEETINGS_BASE}/${id}/join`, { method: 'POST', body: JSON.stringify(body ?? {}) }),
  leave: (id: string): Promise<void> => request(`${MEETINGS_BASE}/${id}/leave`, { method: 'POST' }),
  rsvp: (id: string, response: 'accepted' | 'declined' | 'tentative'): Promise<MeetingDetail> =>
    request(`${MEETINGS_BASE}/${id}/rsvp`, { method: 'POST', body: JSON.stringify({ response }) }),
  start: (id: string): Promise<MeetingDetail> => request(`${MEETINGS_BASE}/${id}/start`, { method: 'POST' }),
  end: (id: string): Promise<MeetingDetail> => request(`${MEETINGS_BASE}/${id}/end`, { method: 'POST' }),
  cancel: (id: string): Promise<MeetingDetail> => request(`${MEETINGS_BASE}/${id}/cancel`, { method: 'POST' }),
  ice: (): Promise<{ iceServers: unknown[] }> => request(`${MEETINGS_BASE}/ice`),

  // Recording / transcription + agent voice (0330).
  transcript: (id: string): Promise<MeetingTranscript> => request(`${MEETINGS_BASE}/${id}/transcript`),
  /** Append one final caption line (from the caller's own browser speech-to-text). */
  appendTranscript: (id: string, text: string): Promise<{ ok: boolean; id: string | null }> =>
    request(`${MEETINGS_BASE}/${id}/transcript`, { method: 'POST', body: JSON.stringify({ text }) }),
  /** Have an agent attendee speak (LLM turn → caption + browser voice). */
  agentTurn: (id: string, agentRef: string, prompt?: string): Promise<{ text: string; atMs: number; agentRef: string; agentName: string }> =>
    request(`${MEETINGS_BASE}/${id}/agent-turn`, { method: 'POST', body: JSON.stringify({ agentRef, prompt }) }),
  /** Generate + store meeting minutes from the transcript (posts into the team chat). */
  summarize: (id: string): Promise<{ summary: string; meeting: MeetingDetail }> =>
    request(`${MEETINGS_BASE}/${id}/summarize`, { method: 'POST' }),

  // Availability (bookable working hours) + "find a time".
  myAvailability: (): Promise<AvailabilityProfile> => request(`${MEETINGS_BASE}/availability/me`),
  setMyAvailability: (body: AvailabilityProfile): Promise<AvailabilityProfile> =>
    request(`${MEETINGS_BASE}/availability/me`, { method: 'PUT', body: JSON.stringify(body) }),
  availability: (refs: string[]): Promise<{ availability: Array<AvailabilityProfile & { userId: string }> }> =>
    request(`${MEETINGS_BASE}/availability?refs=${encodeURIComponent(refs.join(','))}`),
  freeBusy: (refs: string[], fromISO: string, toISO: string): Promise<FreeBusy> =>
    request(`${MEETINGS_BASE}/freebusy?refs=${encodeURIComponent(refs.join(','))}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`),
  suggest: (refs: string[], durationMinutes: number, fromISO: string, toISO: string, count = 6): Promise<{ slots: TimeSlot[] }> =>
    request(`${MEETINGS_BASE}/suggest?refs=${encodeURIComponent(refs.join(','))}&durationMinutes=${durationMinutes}&from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}&count=${count}`),
};

/** A weekly recurring availability window. day 0=Sun..6=Sat; start/end minutes from midnight. */
export interface AvailabilityWindow { day: number; start: number; end: number; }
export interface AvailabilityProfile { timezone: string; windows: AvailabilityWindow[]; }
export interface TimeSlot { startISO: string; endISO: string; }
export interface FreeBusy {
  availability: Array<AvailabilityProfile & { userId: string }>;
  busy: Array<{ userId: string; intervals: TimeSlot[] }>;
}

// ---------------------------------------------------------------------------
// Calendar connections (per-user Google / Microsoft OAuth). /api/calendar/*
// ---------------------------------------------------------------------------
export interface CalendarConnectionInfo { id: string; provider: string; accountEmail: string | null; calendarId: string; }
export interface CalendarEventItem {
  id: string; title: string; startISO: string; endISO: string;
  htmlLink?: string; location?: string; organizer?: string; provider: string;
}

const CALENDAR_BASE = '/api/calendar';
export const calendarApi = {
  providers: (): Promise<{ providers: string[]; connections: CalendarConnectionInfo[] }> =>
    request(`${CALENDAR_BASE}/providers`),
  connectUrl: (provider: string, returnTo = '/meetings'): Promise<{ authUrl: string }> =>
    request(`${CALENDAR_BASE}/connect/${provider}?returnTo=${encodeURIComponent(returnTo)}`),
  disconnect: (id: string): Promise<void> =>
    request(`${CALENDAR_BASE}/connections/${id}`, { method: 'DELETE' }),
  events: (days = 14): Promise<{ events: CalendarEventItem[] }> =>
    request(`${CALENDAR_BASE}/events?days=${days}`),
};

const sprintTracker = segmentTrackerClient('/api/agile/sprints');
export const sprintsApi = {
  /** Pass a projectId for that project's sprints; omit for the portfolio view. */
  list: (projectId?: number) => sprintTracker.list(projectId) as unknown as Promise<Sprint[]>,
  create: (body: {
    name: string;
    goal?: string;
    status?: Sprint['status'];
    startDate?: string;
    endDate?: string;
    capacity?: number;
    projectId?: number | null;
  }) => sprintTracker.create(body) as unknown as Promise<Sprint>,
  update: (id: string, body: Partial<Omit<Sprint, 'id'>>) =>
    sprintTracker.update(id, body) as unknown as Promise<Sprint>,
  remove: (id: string) => sprintTracker.remove(id),
};

/** Derived sprint velocity from real task story points (EMP-4). */
export const agileMetricsApi = {
  derivedVelocity: (projectId?: number | null): Promise<VelocityInsights> =>
    request<VelocityInsights>(`/api/agile/velocity/derived${projectId != null ? `?projectId=${projectId}` : ''}`),
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
// Unified activity / audit log — "who did what, to what, when" across the whole
// workforce (team members, external talent / hires, AI agents).
// ---------------------------------------------------------------------------

export type ActivityActorType = 'human' | 'hire' | 'cloud_agent' | 'host_agent' | 'system';

export interface ActivityLogEvent {
  id: number;
  actorType: ActivityActorType;
  actorRef: string | null;
  actorName: string | null;
  engagementId: string | null;
  verb: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  summary: string | null;
  projectId: number | null;
  occurredAt: string;
  metadata: unknown;
}

export interface ActivityLogPage {
  events: ActivityLogEvent[];
  nextCursor: number | null;
}

export interface ActivityLogFilter {
  actorType?: string;
  actorRef?: string;
  targetType?: string;
  targetId?: string;
  verb?: string;
  projectId?: number;
  beforeId?: number;
  limit?: number;
}

export const activityApi = {
  /** The unified activity / audit timeline (MANAGER+). Keyset-paginated via nextCursor→beforeId. */
  log: (params: ActivityLogFilter = {}): Promise<ActivityLogPage> => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v != null && v !== '') q.set(k, String(v));
    }
    const query = q.toString();
    return request<ActivityLogPage>(`/api/activity/log${query ? `?${query}` : ''}`);
  },
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

  /** Telemetry-driven "Analyze & improve" — returns a DRAFT suggestion (not saved). */
  analyze: (id: string) =>
    request<PromptAnalysis>(`/api/prompt-analyzer/${id}/analyze`, { method: 'POST' }),
};

// ---------------------------------------------------------------------------
// Prompt Analyzer — /api/prompt-analyzer
// ---------------------------------------------------------------------------

export interface PromptAnalysis {
  suggestion: string;
  rationale: string | null;
  stats: { usageCount: number; starCount: number; versions: number; category: string };
  basedOnVersion: number;
}

// ---------------------------------------------------------------------------
// Catalog adoption analytics — /api/catalog-analytics
// ---------------------------------------------------------------------------

export type CatalogAnalyticsKind = 'skills' | 'personas' | 'prompts';

export interface CatalogAnalytics {
  kind: 'skill' | 'persona' | 'prompt';
  windowDays: number;
  totals: { items: number; installs: number; usage: number };
  series: Array<{ day: string; installs: number; usage: number }>;
  topItems: Array<{ id: string; name: string; installs: number; usage: number }>;
}

export const catalogAnalyticsApi = {
  /** Adoption trend + top adopted items for a catalog kind over `windowDays`. */
  get: (kind: CatalogAnalyticsKind, windowDays = 30): Promise<CatalogAnalytics> =>
    request<CatalogAnalytics>(`/api/catalog-analytics/${kind}?window=${windowDays}`),
};

// ---------------------------------------------------------------------------
// FACTS library — /api/facts
// ---------------------------------------------------------------------------

export interface Fact {
  id: string;
  projectId: number | null;
  subject: string;
  predicate: string;
  object: string;
  source: string | null;
  confidence: number | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FactInput {
  subject: string;
  predicate: string;
  object: string;
  source?: string | null;
  confidence?: number | null;
  projectId?: number | null;
}

export const factsApi = {
  list: (params?: { subject?: string; predicate?: string; q?: string; projectId?: number | null; limit?: number; offset?: number }): Promise<Fact[]> => {
    const p = new URLSearchParams();
    if (params?.subject) p.set('subject', params.subject);
    if (params?.predicate) p.set('predicate', params.predicate);
    if (params?.q) p.set('q', params.q);
    if (params?.projectId != null) p.set('projectId', String(params.projectId));
    if (params?.limit != null) p.set('limit', String(params.limit));
    if (params?.offset != null) p.set('offset', String(params.offset));
    const q = p.toString();
    return request<{ facts: Fact[] }>(`/api/facts${q ? `?${q}` : ''}`).then((r) => r.facts);
  },
  schema: (): Promise<{ subjects: string[]; predicates: string[] }> =>
    request<{ subjects: string[]; predicates: string[] }>('/api/facts/schema'),
  create: (body: FactInput): Promise<Fact> =>
    request<Fact>('/api/facts', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<FactInput>): Promise<Fact> =>
    request<Fact>(`/api/facts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  remove: (id: string): Promise<{ deleted: string }> =>
    request<{ deleted: string }>(`/api/facts/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// RFP / RFQ Response — /api/rfp  (PRD 15). Pre-sales proposal generation.
// ---------------------------------------------------------------------------

export interface BrandPalette {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  background: string;
  logoUrl?: string | null;
}

export interface RfpCostLineItem {
  label: string;
  category: 'build' | 'agentic' | 'marketing' | 'contingency' | 'margin';
  amountUsd: number;
}

export interface RfpCostModel {
  buildCostUsd: number;
  agenticCostUsd: number;
  marketingCostUsd: number;
  contingencyUsd: number;
  subtotalCostUsd: number;
  marginPct: number;
  marginUsd: number;
  quotedPriceUsd: number;
  effortWeeks: number;
  lineItems: RfpCostLineItem[];
}

export interface RfpCapabilityRoster {
  capabilities: string[];
  keyComponents: { name: string; responsibility: string }[];
  frameworks: string[];
  primaryLanguages: string[];
  valueProps: string[];
  source: 'diagnostics' | 'audit' | 'greenfield';
}

export interface RfpPhase {
  name: string;
  startDate: string;
  endDate: string;
  milestones: { name: string; date: string }[];
}

export interface RfpRisk { title: string; severity: 'low' | 'medium' | 'high'; mitigation: string }
export interface RfpDependency { title: string; type: 'internal' | 'external' | 'third_party'; note: string }
export interface RfpPortfolioMatch { projectId: number; name: string; score: number; rationale: string }

export interface RfpScanFreshness {
  toolId: string;
  lastScanAt: string | null;
  ageDays: number | null;
  refreshed: boolean;
}

export interface RfpResponseBody {
  executiveSummary: string;
  grounding: { mode: 'new' | 'existing'; projectId?: number; projectName?: string; scanFreshness?: RfpScanFreshness };
  capabilityRoster: RfpCapabilityRoster;
  costModel: RfpCostModel;
  plan: { phases: RfpPhase[] };
  risks: RfpRisk[];
  dependencies: RfpDependency[];
  timeline: { startDate: string; endDate: string; weeks: number };
  branding: { requester: BrandPalette; tenant: BrandPalette; blended: BrandPalette };
  portfolioMatches?: RfpPortfolioMatch[];
}

export interface RfpRequestRow {
  id: string;
  tenantId: number;
  title: string;
  requesterOrgName: string | null;
  requesterBrand: BrandPalette | null;
  requirements: string | null;
  sourceMode: 'new' | 'existing_project';
  basedOnProjectId: number | null;
  marginPct: number | null;
  marketingPct: number | null;
  contingencyPct: number | null;
  dueDate: string | null;
  status: 'draft' | 'analyzing' | 'ready' | 'submitted';
  createdAt: string;
  updatedAt: string;
}

export interface RfpResponseRow {
  id: string;
  tenantId: number;
  requestId: string;
  projectId: number | null;
  status: 'draft' | 'ready' | 'submitted';
  body: RfpResponseBody | null;
  docHtml: string | null;
  quotedPriceUsdCents: number | null;
  marginPct: number | null;
  scanRefreshed: boolean;
  generatedBy: { cto: string | null; productOwner: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export type RfpResponseSummary = Pick<RfpResponseRow, 'id' | 'requestId' | 'status' | 'quotedPriceUsdCents' | 'marginPct' | 'scanRefreshed' | 'createdAt'>;
export type RfpRequestListRow = RfpRequestRow & { latestResponse: RfpResponseSummary | null };

export interface RfpRequestInput {
  title: string;
  requesterOrgName?: string | null;
  requesterBrand?: BrandPalette | null;
  requirements?: string | null;
  sourceMode?: 'new' | 'existing_project';
  basedOnProjectId?: number | null;
  marginPct?: number | null;
  marketingPct?: number | null;
  contingencyPct?: number | null;
  dueDate?: string | null;
}

export interface RfpGenerateResult {
  responseId: string;
  body: RfpResponseBody;
  quotedPriceUsdCents: number;
  marginPct: number;
  scanRefreshed: boolean;
  generatedBy: { cto: string | null; productOwner: string | null };
  docHtml: string;
}

export const rfpApi = {
  list: (): Promise<{ requests: RfpRequestListRow[] }> =>
    request<{ requests: RfpRequestListRow[] }>('/api/rfp'),
  getRequest: (id: string): Promise<{ request: RfpRequestRow; responses: RfpResponseRow[] }> =>
    request<{ request: RfpRequestRow; responses: RfpResponseRow[] }>(`/api/rfp/requests/${id}`),
  createRequest: (body: RfpRequestInput): Promise<RfpRequestRow> =>
    request<RfpRequestRow>('/api/rfp/requests', { method: 'POST', body: JSON.stringify(body) }),
  updateRequest: (id: string, body: Partial<RfpRequestInput>): Promise<RfpRequestRow> =>
    request<RfpRequestRow>(`/api/rfp/requests/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  generate: (id: string): Promise<RfpGenerateResult> =>
    request<RfpGenerateResult>(`/api/rfp/requests/${id}/generate`, { method: 'POST' }),
  getResponse: (id: string): Promise<RfpResponseRow> =>
    request<RfpResponseRow>(`/api/rfp/responses/${id}`),
  portfolioMatch: (requirements: string, excludeProjectId?: number | null): Promise<{ matches: RfpPortfolioMatch[] }> =>
    request<{ matches: RfpPortfolioMatch[] }>('/api/rfp/portfolio-match', { method: 'POST', body: JSON.stringify({ requirements, excludeProjectId }) }),
};

// ---------------------------------------------------------------------------
// Integration credentials — /api/integrations  (GitHub / GitLab / Bitbucket /
// Jira / Confluence / Freshservice keys). Workspace-global when projectId is
// omitted, project-scoped when set (0074).
// ---------------------------------------------------------------------------

export type IntegrationProvider =
  | 'github' | 'gitlab' | 'bitbucket' | 'jira' | 'confluence' | 'freshservice' | 'freshdesk'
  | 'servicenow' | 'linear' | 'sentry' | 'pagerduty' | 'monday' | 'asana' | 'clickup'
  // BYO web-search vendor key — unlocks the cloud agent's `web_search` tool.
  | 'brave_search'
  // Google connectors (OAuth offline credentials): Gmail powers the email
  // workflow node; Google Drive can back a project's file storage.
  | 'gmail' | 'google_drive';

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
// Incident Management — /api/incidents (prod_incidents war rooms, on-call
// rotations, escalation policies, business-contact directory). Reads require
// auth; writes require MANAGER (server-enforced via requireRole).
// ---------------------------------------------------------------------------

export type IncidentSeverity = 'sev1' | 'sev2' | 'sev3' | 'sev4';
export type IncidentStatus = 'open' | 'acknowledged' | 'mitigated' | 'resolved';

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  source: string | null;
  affectedSystem: string | null;
  boardTaskId: string | null;
  warRoomChatId: string | null;
  escalationLevel: number;
  startedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  impact: string | null;
  rootCause: string | null;
  externalUrl: string | null;
  postmortemUrl?: string | null;
}

export type PostmortemDocType = 'postmortem' | 'known_error';

export interface PublishPostmortemBody {
  summary?: string;
  rootCause?: string;
  impact?: string;
  contributingFactors?: string;
  resolution?: string;
  whatWentWell?: string;
  whatWentWrong?: string;
  docType?: PostmortemDocType;
  actionItems?: { title: string; detail?: string }[];
}

export interface PublishPostmortemResult {
  docId: string;
  url: string;
  actionItemTaskIds: number[];
  incidentTitle: string;
  affectedSystem: string | null;
}

export interface IncidentEvent {
  id: string;
  kind: string;
  actorRef: string | null;
  message: string | null;
  channel: string | null;
  target: string | null;
  level: number | null;
  createdAt: string;
}

export interface CreateIncidentBody {
  title: string;
  description?: string;
  severity?: IncidentSeverity;
  source?: string;
  affectedSystem?: string;
  projectId?: number | null;
  escalationPolicyId?: string | null;
  openWarRoom?: boolean;
  page?: boolean;
}

/** A workflow run spawned by an incident — via an event trigger or a manual runbook. */
export interface IncidentWorkflowRun {
  id: string;
  description: string | null;
  status: string;
  runtime: string;
  createdAt: string;
  completedAt: string | null;
  definitionId: string | null;
  definitionName: string | null;
}

export interface OnCallRotationMember {
  id: string;
  memberRef: string;
  displayName: string | null;
  position: number;
}

export type RotationKind = 'manual' | 'daily' | 'weekly';

export interface OnCallRotation {
  id: string;
  name: string;
  description: string | null;
  rotationKind: RotationKind;
  currentIndex: number;
  active: boolean;
  members: OnCallRotationMember[];
  onCall: { memberRef: string; displayName: string | null } | null;
}

export type EscalationTargetKind = 'oncall_rotation' | 'user' | 'contact' | 'team_chat';

export interface EscalationLevel {
  id: string;
  level: number;
  afterMinutes: number;
  targetKind: EscalationTargetKind;
  targetRef: string | null;
  notifyTeams: boolean;
  notifySlack: boolean;
  notifyEmail: boolean;
}

export interface EscalationPolicy {
  id: string;
  name: string;
  description: string | null;
  matchSeverity: IncidentSeverity | null;
  active: boolean;
  levels: EscalationLevel[];
}

export interface BusinessContact {
  id: string;
  name: string;
  roleTitle: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  teamsId: string | null;
  notes: string | null;
}

export const incidentsApi = {
  list: (activeOnly = false): Promise<Incident[]> =>
    request<{ incidents: Incident[] }>(`/api/incidents?activeOnly=${activeOnly ? 'true' : 'false'}`)
      .then((r) => r.incidents ?? []),

  create: (body: CreateIncidentBody): Promise<{ incidentId: string; boardTaskId: string | null; warRoomChatId: string | null; created: boolean }> =>
    request('/api/incidents', { method: 'POST', body: JSON.stringify(body) }),

  get: (id: string): Promise<{ incident: Incident; timeline: IncidentEvent[] }> =>
    request(`/api/incidents/${id}`),

  // RCA linkage: implicated delivery ticket(s) + each one's Accountability Report.
  implicated: (id: string): Promise<ImplicatedTicket[]> =>
    request<{ implicated: ImplicatedTicket[] }>(`/api/incidents/${id}/implicated`).then((r) => r.implicated ?? []),
  linkImplicated: (id: string, body: { taskId: number; relation?: string; note?: string }): Promise<{ ok: boolean }> =>
    request(`/api/incidents/${id}/implicated`, { method: 'POST', body: JSON.stringify(body) }),
  unlinkImplicated: (id: string, taskId: number): Promise<{ ok: boolean }> =>
    request(`/api/incidents/${id}/implicated/${taskId}`, { method: 'DELETE' }),

  update: (id: string, body: Partial<{ severity: IncidentSeverity; status: IncidentStatus; impact: string; rootCause: string }>): Promise<{ ok: boolean }> =>
    request(`/api/incidents/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  classify: (id: string, system: string): Promise<{ ok: boolean }> =>
    request(`/api/incidents/${id}/classify`, { method: 'POST', body: JSON.stringify({ system }) }),

  addNote: (id: string, message: string): Promise<{ ok: boolean }> =>
    request(`/api/incidents/${id}/notes`, { method: 'POST', body: JSON.stringify({ message }) }),

  page: (id: string): Promise<{ paged: boolean }> =>
    request(`/api/incidents/${id}/page`, { method: 'POST' }),

  warRoom: (id: string): Promise<{ chatId: string }> =>
    request(`/api/incidents/${id}/war-room`, { method: 'POST' }),

  triage: (id: string): Promise<{ dispatched: boolean }> =>
    request(`/api/incidents/${id}/triage`, { method: 'POST' }),

  publishPostmortem: (id: string, body: PublishPostmortemBody): Promise<PublishPostmortemResult> =>
    request(`/api/incidents/${id}/postmortem`, { method: 'POST', body: JSON.stringify(body) }),

  // Custom workflows (runbooks) attached to an incident
  listWorkflowRuns: (id: string): Promise<IncidentWorkflowRun[]> =>
    request<{ runs: IncidentWorkflowRun[] }>(`/api/incidents/${id}/workflow-runs`).then((r) => r.runs ?? []),

  runWorkflow: (id: string, body: { definitionId: string; runtime?: string; agentHostId?: number; cloudAgentRef?: string }): Promise<{ workflowId: string; taskCount: number }> =>
    request(`/api/incidents/${id}/run-workflow`, { method: 'POST', body: JSON.stringify(body) }),

  // On-call rotations
  listRotations: (): Promise<OnCallRotation[]> =>
    request<{ rotations: OnCallRotation[] }>('/api/incidents/on-call/rotations').then((r) => r.rotations ?? []),

  createRotation: (body: { name: string; description?: string; rotationKind?: RotationKind; projectId?: number | null }): Promise<OnCallRotation> =>
    request<{ rotation: OnCallRotation }>('/api/incidents/on-call/rotations', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.rotation),

  updateRotation: (id: string, body: Partial<{ name: string; description: string; rotationKind: RotationKind; active: boolean; currentIndex: number }>): Promise<{ ok: boolean }> =>
    request(`/api/incidents/on-call/rotations/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeRotation: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/incidents/on-call/rotations/${id}`, { method: 'DELETE' }),

  addRotationMember: (id: string, body: { memberRef: string; displayName?: string; position?: number }): Promise<OnCallRotationMember> =>
    request<{ member: OnCallRotationMember }>(`/api/incidents/on-call/rotations/${id}/members`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.member),

  removeRotationMember: (id: string, memberId: string): Promise<{ ok: boolean }> =>
    request(`/api/incidents/on-call/rotations/${id}/members/${memberId}`, { method: 'DELETE' }),

  // Escalation policies
  listPolicies: (): Promise<EscalationPolicy[]> =>
    request<{ policies: EscalationPolicy[] }>('/api/incidents/escalation/policies').then((r) => r.policies ?? []),

  createPolicy: (body: { name: string; description?: string; matchSeverity?: IncidentSeverity; projectId?: number | null }): Promise<EscalationPolicy> =>
    request<{ policy: EscalationPolicy }>('/api/incidents/escalation/policies', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.policy),

  removePolicy: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/incidents/escalation/policies/${id}`, { method: 'DELETE' }),

  addPolicyLevel: (id: string, body: { level?: number; afterMinutes: number; targetKind?: EscalationTargetKind; targetRef?: string; notifyTeams?: boolean; notifySlack?: boolean; notifyEmail?: boolean }): Promise<EscalationLevel> =>
    request<{ level: EscalationLevel }>(`/api/incidents/escalation/policies/${id}/levels`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.level),

  removeLevel: (levelId: string): Promise<{ ok: boolean }> =>
    request(`/api/incidents/escalation/levels/${levelId}`, { method: 'DELETE' }),

  // Business contacts
  listContacts: (): Promise<BusinessContact[]> =>
    request<{ contacts: BusinessContact[] }>('/api/incidents/contacts').then((r) => r.contacts ?? []),

  createContact: (body: Partial<Omit<BusinessContact, 'id'>> & { name: string }): Promise<BusinessContact> =>
    request<{ contact: BusinessContact }>('/api/incidents/contacts', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.contact),

  updateContact: (id: string, body: Partial<Omit<BusinessContact, 'id'>>): Promise<{ ok: boolean }> =>
    request(`/api/incidents/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  removeContact: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/incidents/contacts/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Active Monitoring — /api/monitoring (monitoring boards = an uploaded diagram
// with monitor pins overlaid; a breach opens an incident). Reads require auth;
// writes require MANAGER (server-enforced via requireRole → 402/403).
// ---------------------------------------------------------------------------

export type MonitorType = 'heartbeat' | 'http_check' | 'webhook' | 'metric_threshold' | 'manual';
export type MonitorStatus = 'ok' | 'breached' | 'unknown';
export type MonitorMetric =
  | 'token_spend_usd'
  | 'token_spend_pct_of_cap'
  | 'cost_per_merged_pr_usd'
  | 'dora_change_failure_rate'
  | 'dora_lead_time_hours'
  | 'ai_effectiveness_score'
  | 'eval_drift';
export type MonitorComparator = 'gt' | 'lt' | 'gte' | 'lte';

export interface MonitoringBoard {
  id: string;
  name: string;
  imageKey: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  projectId: number | null;
  monitorCount: number;
  breachedCount: number;
  updatedAt: string;
}

export interface Monitor {
  id: string;
  boardId: string;
  label: string;
  description: string | null;
  posX: number;
  posY: number;
  monitorType: MonitorType;
  config: Record<string, unknown>;
  affectedSystem: string | null;
  severity: IncidentSeverity;
  escalationPolicyId: string | null;
  status: MonitorStatus;
  currentIncidentId: string | null;
  lastSignalAt: string | null;
  lastCheckedAt: string | null;
  active: boolean;
}

export interface MonitorEvent {
  id: string;
  kind: string;
  status: string | null;
  message: string | null;
  incidentId: string | null;
  createdAt: string;
}

export interface MonitoringReport {
  monitors: { total: number; ok: number; breached: number; unknown: number };
  incidents: {
    total: number;
    open: number;
    bySeverity: Record<string, number>;
    bySystem: Record<string, number>;
    bySource: Record<string, number>;
    mttrMinutes: number | null;
    recent: Incident[];
  };
}

export interface CreateBoardBody {
  name: string;
  projectId?: number | null;
  imageKey?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

export interface CreateMonitorBody {
  label: string;
  description?: string | null;
  posX: number;
  posY: number;
  monitorType?: MonitorType;
  config?: Record<string, unknown>;
  affectedSystem?: string | null;
  severity?: IncidentSeverity;
  escalationPolicyId?: string | null;
  active?: boolean;
}

export type UpdateMonitorBody = Partial<CreateMonitorBody> & { posX?: number; posY?: number };

export const monitoringApi = {
  getReport: (): Promise<MonitoringReport> =>
    request('/api/monitoring/report'),

  listBoards: (): Promise<MonitoringBoard[]> =>
    request<{ boards: MonitoringBoard[] }>('/api/monitoring/boards').then((r) => r.boards ?? []),

  createBoard: (body: CreateBoardBody): Promise<MonitoringBoard> =>
    request<{ board: MonitoringBoard }>('/api/monitoring/boards', { method: 'POST', body: JSON.stringify(body) }).then((r) => r.board),

  getBoard: (id: string): Promise<{ board: MonitoringBoard; monitors: Monitor[] }> =>
    request(`/api/monitoring/boards/${id}`),

  updateBoard: (id: string, body: Partial<CreateBoardBody>): Promise<{ board: MonitoringBoard }> =>
    request(`/api/monitoring/boards/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteBoard: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/monitoring/boards/${id}`, { method: 'DELETE' }),

  createMonitor: (boardId: string, body: CreateMonitorBody): Promise<Monitor> =>
    request<{ monitor: Monitor }>(`/api/monitoring/boards/${boardId}/monitors`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.monitor),

  getMonitor: (id: string): Promise<{ monitor: Monitor; events: MonitorEvent[]; signalUrl: string | null }> =>
    request(`/api/monitoring/monitors/${id}`),

  updateMonitor: (id: string, body: UpdateMonitorBody): Promise<{ monitor: Monitor }> =>
    request(`/api/monitoring/monitors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteMonitor: (id: string): Promise<{ ok: boolean }> =>
    request(`/api/monitoring/monitors/${id}`, { method: 'DELETE' }),

  testSignal: (id: string, body: { status?: 'ok' | 'breach'; value?: number; message?: string }): Promise<{ status: string }> =>
    request(`/api/monitoring/monitors/${id}/test-signal`, { method: 'POST', body: JSON.stringify(body) }),
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

/** Per-repo readiness of the GitHub Actions execution surface. */
export interface GithubActionsRepoStatus {
  repoId: string;
  /** Only GitHub has Actions — a GitLab/Bitbucket repo has nothing to enable. */
  supported: boolean;
  /** The Builderforce agent workflow is present on the repo's default branch. */
  enabled: boolean;
  isDefault: boolean;
}

export interface GithubActionsStatus {
  /** The repo dispatch would actually use (the default) carries the workflow, so
   *  an agent set to the `github_actions` surface will really run there. */
  ready: boolean;
  workflowPath: string;
  repositories: GithubActionsRepoStatus[];
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

  /**
   * Is the GitHub Actions execution surface usable for this project's repos?
   * `ready` answers the question the agent surface picker asks (the DEFAULT repo
   * carries the agent workflow); `repositories` answers the per-row question the
   * Source control panel asks. Server-side this is read-through cached and
   * invalidated by `enableGithubActions`, so callers may refetch freely.
   */
  githubActionsStatus: (projectId: number): Promise<GithubActionsStatus> =>
    request<GithubActionsStatus>(`/api/repos/projects/${projectId}/github-actions`),

  /** Commit the Builderforce agent workflow into a repo's default branch — what
   *  makes the `github_actions` surface actually runnable for this project. */
  enableGithubActions: (id: string): Promise<{ ok: true; created: boolean; path: string }> =>
    request(`/api/repos/repositories/${id}/github-actions/enable`, { method: 'POST' }),

  /** Ingest every OPEN code-scanning / Dependabot alert as a security finding —
   *  for a repo connected after alerts accumulated, or whose webhook never fired.
   *  Idempotent (ingestion dedupes against open findings). */
  backfillSecurityAlerts: (id: string): Promise<{ ok: true; ingested?: number; deduped?: number }> =>
    request(`/api/repos/repositories/${id}/security/backfill-alerts`, { method: 'POST' }),

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
  draft: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  allowedMergeMethods: MergeMethod[] | null;
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

  /** The connectable-board catalog (single source of truth for the gallery). */
  providers: (): Promise<BoardProviderMeta[]> =>
    request<{ providers: BoardProviderMeta[] }>(`/api/board-connections/providers`).then((r) => r.providers ?? []),
};

export interface BoardProviderMeta {
  id: string;
  label: string;
  category: 'pm' | 'itsm' | 'incident' | 'scm';
  externalBoardId: 'required' | 'optional';
  externalBoardIdHint: string;
  supportsWebhook: boolean;
  supportsDiscovery: boolean;
}

// ---------------------------------------------------------------------------
// Platform migration / import wizard — /api/migrations
// ---------------------------------------------------------------------------

export type MigrationMode = 'migrate' | 'sync' | 'both';
export type MigrationStatus =
  | 'discovering' | 'staged' | 'mapped' | 'importing' | 'completed' | 'failed' | 'cancelled';

export interface MigrationRun {
  id: string;
  provider: string;
  credentialId: string | null;
  mode: MigrationMode;
  status: MigrationStatus;
  summary: Record<string, number> | null;
  errorMessage: string | null;
  createdBy: string | null;
}

export interface MigStagedProject {
  id: string;
  externalId: string;
  externalKey: string | null;
  name: string;
  description: string | null;
  externalUrl: string | null;
  itemCount: number | null;
  action: 'create' | 'map' | 'skip';
  targetProjectId: number | null;
  targetProjectName: string | null;
}

export interface MigTypeMapping {
  externalType: string;
  targetTaskType: string;
  targetStatus: string;
}

export interface MigStagedUser {
  id: string;
  externalId: string;
  displayName: string | null;
  email: string | null;
  action: 'invite' | 'map' | 'skip';
  targetUserId: string | null;
}

export interface MigStagedItem {
  id: string;
  stagedProjectId: string;
  externalId: string;
  externalType: string | null;
  externalUrl: string | null;
  title: string;
  body: string | null;
  state: string | null;
  storyPoints: number | null;
  targetTaskType: string;
  targetStatus: string;
  include: boolean;
}

export interface MigrationRunDetail {
  run: MigrationRun;
  projects: MigStagedProject[];
  itemTypes: MigTypeMapping[];
  users: MigStagedUser[];
  items: MigStagedItem[];
}

export interface MigrationMappingInput {
  projects?: Array<{ id: string; action?: 'create' | 'map' | 'skip'; targetProjectId?: number | null; targetProjectName?: string | null }>;
  types?: MigTypeMapping[];
  users?: Array<{ id: string; action?: 'invite' | 'map' | 'skip'; targetUserId?: string | null }>;
  items?: Array<{ id: string; include: boolean }>;
}

export const migrationsApi = {
  start: (body: { provider: string; credentialId: string; mode?: MigrationMode }): Promise<MigrationRunDetail> =>
    request('/api/migrations', { method: 'POST', body: JSON.stringify(body) }),

  list: (): Promise<MigrationRun[]> =>
    request<{ runs: MigrationRun[] }>('/api/migrations').then((r) => r.runs ?? []),

  get: (id: string): Promise<MigrationRunDetail> =>
    request(`/api/migrations/${id}`),

  setMappings: (id: string, body: MigrationMappingInput): Promise<MigrationRunDetail> =>
    request(`/api/migrations/${id}/mappings`, { method: 'PATCH', body: JSON.stringify(body) }),

  stage: (id: string): Promise<MigrationRunDetail> =>
    request(`/api/migrations/${id}/stage`, { method: 'POST' }),

  commit: (id: string): Promise<MigrationRun> =>
    request(`/api/migrations/${id}/commit`, { method: 'POST' }),

  discard: (id: string): Promise<void> =>
    request<void>(`/api/migrations/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Product Quality / error observability — /api/quality/*
// ---------------------------------------------------------------------------

export interface QualitySourceCatalogEntry {
  id: string;
  label: string;
  transport: 'key' | 'otlp' | 'webhook';
  supportsWebhook: boolean;
  hint: string;
}

/** A project's (or tenant's) error collector — one per project (1 snippet). */
export interface QualityCollector {
  id: string;
  name: string;
  /** null = tenant-level collector (routes via mapping rules). */
  projectId: number | null;
  defaultProjectId: number | null;
  enabled: boolean;
  status: string;
  lastEventAt: string | null;
  createdAt: string;
  /** Attached provider-webhook integrations. */
  providers: string[];
}

export interface CreateQualityCollectorResult {
  collector: { id: string; name: string; projectId: number | null };
  /** Plaintext ingest key — shown ONCE, never retrievable again. */
  ingestKey: string;
  eventsEndpoint: string;
  otlpEndpoint: string;
  webhookBase: string;
}

export interface QualityIntegration {
  provider: string;
  createdAt: string;
  hasSecret: boolean;
  webhookUrl: string;
}

export interface QualityMappingRule {
  id: string;
  matchField: string;
  matchOp: string;
  matchValue: string;
  projectId: number;
  priority: number;
}

export interface ErrorGroup {
  id: string;
  projectId: number;
  collectorId: string | null;
  fingerprint: string;
  title: string;
  type: string | null;
  level: string;
  status: string;
  eventCount: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  environment: string | null;
  release: string | null;
  taskId: number | null;
}

export interface ErrorGroupEvent {
  ts: string;
  userKey: string | null;
  release: string | null;
  environment: string | null;
  payload: Record<string, unknown> | null;
}

export interface ErrorGroupDetail {
  group: ErrorGroup & { samplePayload: Record<string, unknown> | null; culprit: string | null };
  recentEvents: ErrorGroupEvent[];
  trend: { day: string; count: number }[];
  affectedUsers: number;
}

export interface QualityGroupFilter {
  projectId?: number | null;
  status?: string;
  level?: string;
  collectorId?: string;
  limit?: number;
  /** Keyset cursor from a previous page's `nextCursor`. */
  cursor?: string | null;
}

export interface ErrorGroupPage {
  groups: ErrorGroup[];
  /** Pass back as `cursor` for the next page; null when exhausted. */
  nextCursor: string | null;
}

/** Aggregate Quality stats — volume collected, breakdowns and daily frequency. */
export interface QualityStats {
  windowDays: number;
  totals: { groups: number; events: number; users: number };
  byLevel: { level: string; groups: number; events: number }[];
  byStatus: { status: string; groups: number }[];
  /** In-window event volume attributed to the ingest adapter that produced it
   *  (native SDK / OTLP / Sentry / PostHog / LogRocket). */
  bySource: { source: string; events: number }[];
  byCollector: { collectorId: string | null; name: string | null; groups: number; events: number; lastEventAt: string | null }[];
  /** Event volume per UTC day (YYYY-MM-DD) over the window. */
  daily: { day: string; count: number }[];
}

/** Month-to-date event consumption attributable to one error collector. */
export interface QualityCollectorConsumption {
  used: number;
  trend: number[];
}

export const qualityApi = {
  sourceCatalog: (): Promise<QualitySourceCatalogEntry[]> =>
    request<{ sources: QualitySourceCatalogEntry[] }>('/api/quality/source-catalog').then((r) => r.sources ?? []),

  collectors: {
    list: (): Promise<QualityCollector[]> =>
      request<{ collectors: QualityCollector[] }>('/api/quality/collectors').then((r) => r.collectors ?? []),
    create: (body: { projectId?: number | null; name: string; defaultProjectId?: number | null }): Promise<CreateQualityCollectorResult> =>
      request('/api/quality/collectors', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: { name?: string; enabled?: boolean; status?: string; defaultProjectId?: number | null }): Promise<{ ok: true }> =>
      request(`/api/quality/collectors/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    test: (id: string): Promise<{ ok: true; accepted: number; dropped: number }> =>
      request(`/api/quality/collectors/${id}/test`, { method: 'POST' }),
    consumption: (id: string): Promise<QualityCollectorConsumption> =>
      request(`/api/quality/collectors/${id}/consumption`),
    remove: (id: string): Promise<void> =>
      request<void>(`/api/quality/collectors/${id}`, { method: 'DELETE' }),

    integrations: {
      list: (id: string): Promise<QualityIntegration[]> =>
        request<{ integrations: QualityIntegration[] }>(`/api/quality/collectors/${id}/integrations`).then((r) => r.integrations ?? []),
      save: (id: string, body: { provider: string; secret?: string | null; apiToken?: string | null; scope?: string | null; baseUrl?: string | null }): Promise<{ ok: true; webhookUrl: string }> =>
        request(`/api/quality/collectors/${id}/integrations`, { method: 'POST', body: JSON.stringify(body) }),
      remove: (id: string, provider: string): Promise<void> =>
        request<void>(`/api/quality/collectors/${id}/integrations/${provider}`, { method: 'DELETE' }),
      /** Seed the Quality model from the collector's Sentry integration. */
      backfillSentry: (id: string): Promise<{ pulled: number; accepted: number; dropped: number }> =>
        request(`/api/quality/collectors/${id}/integrations/sentry/backfill`, { method: 'POST' }),
    },

    rules: {
      list: (id: string): Promise<QualityMappingRule[]> =>
        request<{ rules: QualityMappingRule[] }>(`/api/quality/collectors/${id}/rules`).then((r) => r.rules ?? []),
      create: (id: string, body: { matchField: string; matchOp: string; matchValue: string; projectId: number; priority?: number }): Promise<{ id: string }> =>
        request(`/api/quality/collectors/${id}/rules`, { method: 'POST', body: JSON.stringify(body) }),
      remove: (id: string, ruleId: string): Promise<void> =>
        request<void>(`/api/quality/collectors/${id}/rules/${ruleId}`, { method: 'DELETE' }),
    },
  },

  groups: {
    list: (filter: QualityGroupFilter = {}): Promise<ErrorGroupPage> => {
      const q = new URLSearchParams();
      if (filter.projectId != null) q.set('projectId', String(filter.projectId));
      if (filter.status) q.set('status', filter.status);
      if (filter.level) q.set('level', filter.level);
      if (filter.collectorId) q.set('collectorId', filter.collectorId);
      if (filter.limit) q.set('limit', String(filter.limit));
      if (filter.cursor) q.set('cursor', filter.cursor);
      const qs = q.toString();
      return request<ErrorGroupPage>(`/api/quality/groups${qs ? `?${qs}` : ''}`)
        .then((r) => ({ groups: r.groups ?? [], nextCursor: r.nextCursor ?? null }));
    },
    get: (id: string): Promise<ErrorGroupDetail> =>
      request(`/api/quality/groups/${id}`),
    setStatus: (id: string, status: 'unresolved' | 'resolved' | 'ignored'): Promise<{ ok: true }> =>
      request(`/api/quality/groups/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
    fix: (id: string): Promise<{ taskId: number; executionId: number | null }> =>
      request(`/api/quality/groups/${id}/fix`, { method: 'POST' }),
  },

  /** Aggregate volume + breakdowns + daily frequency for the Quality charts and
   *  the collectors "data collected" card. Project-scoped or tenant-wide. */
  stats: (projectId?: number | null, days = 30): Promise<QualityStats> => {
    const q = new URLSearchParams();
    if (projectId != null) q.set('projectId', String(projectId));
    q.set('days', String(days));
    return request<QualityStats>(`/api/quality/stats?${q.toString()}`);
  },
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
  /** When true (default), high/urgent tickets need manager approval before an agent
   *  executes them; a manager can set false to override the gate (migration 0257). */
  requireExecutionApproval: boolean;
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
  /** How strictly this lane's requirements gate entry: off (audit only) | soft | hard. */
  requirementGate?: 'off' | 'soft' | 'hard';
  createdAt: string;
  updatedAt?: string;
}

/** A live per-lane requirement (role sign-off / diagnostic / review) the audit + gating engines enforce. */
export interface SwimlaneRequirement {
  id: string;
  swimlaneId: string;
  kind: 'role' | 'diagnostic' | 'review';
  ref: string;
  responsibility: 'owner' | 'reviewer' | 'contributor' | null;
  isRequired: boolean;
  description: string | null;
  position: number;
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

  update: (boardId: string, body: Partial<{ name: string; maxConcurrentTickets: number; needsAttentionLane: string | null; standupTurnMode: 'facilitator' | 'timeboxed'; standupTurnSeconds: number; hideDoneItems: boolean; requireExecutionApproval: boolean }>): Promise<Board> =>
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

  /** LIVE per-lane requirements — directly editable on a running board (no template re-apply). */
  requirements: {
    list: (boardId: string, laneId: string): Promise<SwimlaneRequirement[]> =>
      request<{ requirements: SwimlaneRequirement[] }>(`/api/boards/${boardId}/swimlanes/${laneId}/requirements`).then((r) => r.requirements ?? []),
    create: (boardId: string, laneId: string, body: { kind: SwimlaneRequirement['kind']; ref: string; responsibility?: SwimlaneRequirement['responsibility']; isRequired?: boolean; description?: string; position?: number }): Promise<SwimlaneRequirement> =>
      request(`/api/boards/${boardId}/swimlanes/${laneId}/requirements`, { method: 'POST', body: JSON.stringify(body) }),
    patch: (boardId: string, laneId: string, reqId: string, body: Partial<{ ref: string; responsibility: SwimlaneRequirement['responsibility']; isRequired: boolean; description: string; position: number }>): Promise<SwimlaneRequirement> =>
      request(`/api/boards/${boardId}/swimlanes/${laneId}/requirements/${reqId}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (boardId: string, laneId: string, reqId: string): Promise<void> =>
      request<void>(`/api/boards/${boardId}/swimlanes/${laneId}/requirements/${reqId}`, { method: 'DELETE' }),
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
  requirementGate: 'off' | 'soft' | 'hard';
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
  /** The anon id this browser uses to correlate a pre-auth landing prompt with the
   *  authenticated user (cross-device via `claim`). Exposed so a cross-device link
   *  can seed it (see setAnonId). */
  getAnonId,

  /** Adopt an anon id carried on a cross-device link (`?aid=`) so a signup/verify
   *  link opened on a second device claims the FIRST device's typed prompt. Validated
   *  + capped to 64 chars; ignores empty/oversized values. Must run BEFORE `claim`. */
  setAnonId(id: string | null | undefined): void {
    if (typeof window === 'undefined') return;
    const clean = (id ?? '').trim().slice(0, 64);
    if (!clean) return;
    try { window.localStorage.setItem(ANON_ID_KEY, clean); } catch { /* storage blocked */ }
  },

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

/** The behaviour body of a persona (mirrors the server `persona` JSON column). */
export interface PersonaBody {
  voice?: string;
  perspective?: string;
  decisionStyle?: string;
  outputPrefix?: string;
  capabilities?: string[];
  systemDirectives?: string;
  /** Cover image URL for the marketplace card. */
  image?: string;
}

/** A persona published to the public registry. Mirrors the server `publicView`. */
export interface PublicPersona {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  category?: string | null;
  tags?: string[];
  /** Behaviour body — nested (NOT flat) to match the server contract. */
  persona?: PersonaBody | null;
  /** Psychometric profile (Pro) — compiled into behaviour at run time. */
  psychometric?: import('./psychometric').PsychometricProfile | null;
  authorName?: string | null;
  installCount?: number;
  likeCount?: number;
  updatedAt?: string;
  /** Present on the owner-scoped `/mine` + PATCH responses (private = a "My Persona"). */
  visibility?: 'private' | 'tenant' | 'public';
}

export interface PublishPersonaInput {
  name: string;
  description?: string;
  category?: string;
  tags?: string[];
  visibility?: 'private' | 'tenant' | 'public';
  authorName?: string;
  /** Behaviour body — sent nested to match the server `sanitizePersonaBody`. */
  persona?: PersonaBody;
  /** Psychometric profile (Pro); the server stores it only for entitled tenants. */
  psychometric?: import('./psychometric').PsychometricProfile;
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

  /** The tenant's OWN personas (any visibility) — the server-backed "My Personas"
   *  store (replaces the old browser-localStorage one). [] on an older backend. */
  listMine: async (): Promise<PublicPersona[]> => {
    try {
      const r = await request<{ personas?: PublicPersona[] } | PublicPersona[]>('/api/personas/mine');
      return Array.isArray(r) ? r : r.personas ?? [];
    } catch (e) {
      if (isNotFound(e)) return [];
      throw e;
    }
  },

  /** Create a tenant persona (defaults to private = a "My Persona"). */
  create: (input: PublishPersonaInput): Promise<PublicPersona> =>
    request<{ persona?: PublicPersona } | PublicPersona>('/api/personas', {
      method: 'POST',
      body: JSON.stringify({ visibility: 'private', ...input }),
    }).then((r) => (r as { persona?: PublicPersona }).persona ?? (r as PublicPersona)),

  /** Edit a persona the tenant owns (name/body/psychometric/visibility). */
  update: (id: string, input: Partial<PublishPersonaInput>): Promise<PublicPersona> =>
    request<{ persona?: PublicPersona } | PublicPersona>(`/api/personas/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }).then((r) => (r as { persona?: PublicPersona }).persona ?? (r as PublicPersona)),

  /** Delete a persona the tenant owns. */
  remove: (id: string): Promise<void> =>
    request<void>(`/api/personas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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

/** One weekly DORA bucket — the four keys computed over that week's rows. */
export interface DoraSeriesPoint {
  /** UTC YYYY-MM-DD of the bucket start. */
  bucketStart: string;
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
}

export interface DoraInsights {
  windowDays: number;
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
  /** Per-week buckets so the four keys can be charted over time (may be empty/short). */
  series: DoraSeriesPoint[];
}

export interface BottleneckStageStat { stage: string; avgHours: number; medianHours: number; taskCount: number }
export interface BottleneckSlowestStage { stage: string; avgHours: number }
export interface BottleneckRework { reworkedTasks: number; totalReopens: number; totalRedos: number; reworkRate: number }
export interface BottleneckAgingTask { taskId: number; key: string; title: string; status: string; ageHours: number }
export interface BottleneckAgingWip { thresholdHours: number; stuckCount: number; oldest: BottleneckAgingTask[] }
export interface BottleneckInsights {
  windowDays: number;
  sampleSize: number;
  byStage: BottleneckStageStat[];
  slowestStage: BottleneckSlowestStage | null;
  rework: BottleneckRework;
  agingWip: BottleneckAgingWip;
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

export type AllocationCategory = 'innovation' | 'ktlo' | 'support' | 'tech_debt' | 'other';
export interface CategoryAllocation {
  category: AllocationCategory; label: string;
  hours: number; pct: number; taskCount: number;
  costUsd: number; capexUsd: number; opexUsd: number;
  targetPct?: number; variancePct?: number;
}
export interface MemberAllocation {
  memberKind: string; memberRef: string; memberName: string;
  totalHours: number; categorySpread: number;
  byCategory: Array<{ category: AllocationCategory; label: string; hours: number; pct: number }>;
}
/** Cost-report capitalization status (Jellyfish "Capitalized / Not Capitalized / Uncategorized"). */
export type CapitalizationStatus = 'capitalized' | 'not_capitalized' | 'uncategorized';
export type CapitalizationSource = 'manual' | 'inherited' | 'derived';
export interface StatusBucket { hours: number; fteMonths: number; costUsd: number; taskCount: number }
export interface EpicCapitalization {
  epicId: number; title: string; status: CapitalizationStatus; source: CapitalizationSource;
  hours: number; fteMonths: number; costUsd: number; taskCount: number; projectName: string | null;
}
export interface AllocationInsights {
  windowDays: number;
  totals: {
    hours: number; taskCount: number; costUsd: number; capexUsd: number; opexUsd: number;
    capitalizablePct: number;
    byStatus: Record<CapitalizationStatus, StatusBucket>;
  };
  byCategory: CategoryAllocation[];
  byMember: MemberAllocation[];
  epics: EpicCapitalization[];
}
export interface AllocationHistoryMonth {
  month: string; status: 'ready' | 'in_progress';
  capitalizedFteMonths: number; totalFteMonths: number;
  capitalizedUsd: number; notCapitalizedUsd: number; uncategorizedUsd: number; totalUsd: number; taskCount: number;
}
export interface AllocationHistory { months: AllocationHistoryMonth[]; dataAsOf: string }
export interface AllocationGoal extends TrackerRow {
  scopeKind: string; teamId: number | null; projectId: number | null;
  periodMonth: string; category: AllocationCategory; targetPct: number; notes: string | null;
}

export type DeliverableScope = 'initiative' | 'project' | 'release' | 'sprint';
export type DeliveryStatus = 'on_track' | 'at_risk' | 'late' | 'no_signal' | 'done';
export interface BurnPoint { date: string; scope: number; completed: number; remaining: number }
export interface ScopeEffortPoint { date: string; definedPoints: number; completedPoints: number; fte: number }
export interface DeliveryInsights {
  scope: DeliverableScope; scopeId: string; name: string;
  totalTasks: number; completedTasks: number; openTasks: number; completionPct: number;
  throughputPerWeek: number; activeContributors: number;
  forecastDate: string | null; forecastDateOptimistic: string | null; forecastDatePessimistic: string | null;
  targetDate: string | null; status: DeliveryStatus;
  baselineDate: string | null; baselineScope: number; addedScope: number; addedScopePct: number;
  series: BurnPoint[];
  /** Forward completion ramp from today → forecast date (drawn dashed). */
  projection: BurnPoint[];
  // Scope & Effort (points-denominated value + development FTE line).
  hasPoints: boolean; hasEffort: boolean;
  totalPoints: number; donePoints: number; cancelledPoints: number;
  currentFte: number;
  scopeEffort: ScopeEffortPoint[];
}

/** Scenario planner — what-if completion modelling for a deliverable. */
export interface ScenarioParams { developers: number; attentionPct: number; scopeDelta: number }
export interface ScenarioResult {
  developers: number; attentionPct: number; scopeDelta: number;
  adjustedOpenTasks: number;
  perDeveloperPerWeek: number;
  projectedThroughputPerWeek: number;
  projectedWeeks: number | null;
  projectedDate: string | null;
  targetDate: string | null;
  status: DeliveryStatus;
  deltaDaysVsTarget: number | null;
  effortPersonWeeks: number | null;
}
export interface ScenarioResponse {
  baseline: {
    openTasks: number; throughputPerWeek: number; activeContributors: number;
    targetDate: string | null; forecastDate: string | null; status: DeliveryStatus;
  };
  scenario: ScenarioResult;
}

/** Life cycle explorer — time per SDLC phase + the end-to-end lifecycle trend. */
export type LifecyclePhase = 'refinement' | 'work' | 'review' | 'deploy';
export interface LifecyclePhaseStat { phase: LifecyclePhase; avgHours: number; medianHours: number; taskCount: number }
export interface LifecycleTrendPoint { period: string; avgLifecycleHours: number; taskCount: number }
export interface LifecycleInsights {
  windowDays: number; sampleSize: number; totalAvgHours: number;
  byPhase: LifecyclePhaseStat[]; trend: LifecycleTrendPoint[];
}

export interface ProductRelease extends TrackerRow {
  name: string; version: string | null; releaseDate: string | null; status: string; notes: string | null;
}

export type DeliverableUpdateStatus = 'on_track' | 'at_risk' | 'blocked' | 'done' | 'note';
export interface DeliverableUpdate {
  id: string; scopeKind: DeliverableScope; scopeId: string;
  statusLabel: DeliverableUpdateStatus | null; body: string;
  authorId: string | null; authorName: string | null; createdAt: string;
}

export interface SprintVelocity {
  sprintId: string; name: string; status: string; endDate: string | null;
  committedPoints: number; completedPoints: number; taskCount: number; completedCount: number;
  completionRatePct: number | null;
}
export interface VelocityInsights {
  sprints: SprintVelocity[];
  averageVelocity: number | null;
  velocitySampleSize: number;
  estimatedTasks: number;
  unestimatedTasks: number;
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
const allocationGoalTracker = segmentTrackerClient('/api/insights/allocation-goals');
const releaseTracker = segmentTrackerClient('/api/product/release-planning');

/** Product releases (the delivery deliverable). Reuses the product tracker. */
export const releasesApi = {
  list: () => releaseTracker.list() as unknown as Promise<ProductRelease[]>,
};

export interface AllocationQuery { days?: number; period?: string; projectId?: number; teamId?: number }
export interface AllocationHistoryQuery { months?: number; projectId?: number; teamId?: number }

function insightScopeQuery(days: number, projectId?: number | null): string {
  const q = new URLSearchParams({ days: String(days) });
  if (projectId != null) q.set('projectId', String(projectId));
  return q.toString();
}

export const insightsApi = {
  engineering: (days = 30): Promise<EngineeringInsights> => request<EngineeringInsights>(`/api/insights/engineering?days=${days}`),
  dora: (days = 30, projectId?: number | null): Promise<DoraInsights> => request<DoraInsights>(`/api/insights/dora?${insightScopeQuery(days, projectId)}`),
  bottlenecks: (days = 30, projectId?: number | null): Promise<BottleneckInsights> => request<BottleneckInsights>(`/api/insights/bottlenecks?${insightScopeQuery(days, projectId)}`),
  finance: (period?: string): Promise<FinanceInsights> => request<FinanceInsights>(`/api/insights/finance${period ? `?period=${period}` : ''}`),
  compliance: (days = 30): Promise<ComplianceSummary> => request<ComplianceSummary>(`/api/insights/compliance?days=${days}`),
  allocation: (q: AllocationQuery = {}): Promise<AllocationInsights> => {
    const p = new URLSearchParams();
    if (q.days) p.set('days', String(q.days));
    if (q.period) p.set('period', q.period);
    if (q.projectId) p.set('projectId', String(q.projectId));
    if (q.teamId) p.set('teamId', String(q.teamId));
    const qs = p.toString();
    return request<AllocationInsights>(`/api/insights/allocation${qs ? `?${qs}` : ''}`);
  },
  allocationHistory: (q: AllocationHistoryQuery = {}): Promise<AllocationHistory> => {
    const p = new URLSearchParams();
    if (q.months) p.set('months', String(q.months));
    if (q.projectId) p.set('projectId', String(q.projectId));
    if (q.teamId) p.set('teamId', String(q.teamId));
    const qs = p.toString();
    return request<AllocationHistory>(`/api/insights/allocation/history${qs ? `?${qs}` : ''}`);
  },
  delivery: (scope: DeliverableScope, id: string): Promise<DeliveryInsights> =>
    request<DeliveryInsights>(`/api/insights/delivery?scope=${scope}&id=${encodeURIComponent(id)}`),
  /** What-if completion modelling for a deliverable under team/focus/scope changes. */
  deliveryScenario: (scope: DeliverableScope, id: string, params: ScenarioParams): Promise<ScenarioResponse> => {
    const p = new URLSearchParams({
      scope, id, developers: String(params.developers),
      attentionPct: String(params.attentionPct), scopeDelta: String(params.scopeDelta),
    });
    return request<ScenarioResponse>(`/api/insights/delivery/scenario?${p.toString()}`);
  },
  /** Time per SDLC phase + end-to-end lifecycle trend (Life Cycle Explorer). */
  lifecycle: (days = 30, projectId?: number | null): Promise<LifecycleInsights> =>
    request<LifecycleInsights>(`/api/insights/delivery/lifecycle?${insightScopeQuery(days, projectId)}`),
  deliverableUpdates: {
    list: (scope: DeliverableScope, id: string): Promise<DeliverableUpdate[]> =>
      request<DeliverableUpdate[]>(`/api/insights/deliverable-updates?scope=${scope}&id=${encodeURIComponent(id)}`),
    create: (body: { scopeKind: DeliverableScope; scopeId: string; body: string; statusLabel?: DeliverableUpdateStatus }): Promise<DeliverableUpdate> =>
      request<DeliverableUpdate>(`/api/insights/deliverable-updates`, { method: 'POST', body: JSON.stringify(body) }),
    remove: (id: string): Promise<{ deleted: string }> =>
      request<{ deleted: string }>(`/api/insights/deliverable-updates/${id}`, { method: 'DELETE' }),
  },
  budgets: {
    list: () => budgetTracker.list() as unknown as Promise<Budget[]>,
    create: (body: Partial<Omit<Budget, 'id'>>) => budgetTracker.create(body) as unknown as Promise<Budget>,
    update: (id: string, body: Partial<Omit<Budget, 'id'>>) => budgetTracker.update(id, body) as unknown as Promise<Budget>,
    remove: (id: string) => budgetTracker.remove(id),
  },
  allocationGoals: {
    list: () => allocationGoalTracker.list() as unknown as Promise<AllocationGoal[]>,
    create: (body: Partial<Omit<AllocationGoal, 'id'>>) => allocationGoalTracker.create(body) as unknown as Promise<AllocationGoal>,
    update: (id: string, body: Partial<Omit<AllocationGoal, 'id'>>) => allocationGoalTracker.update(id, body) as unknown as Promise<AllocationGoal>,
    remove: (id: string) => allocationGoalTracker.remove(id),
  },
  /** Bulk-import board-deck datasets (headcount/financials/quality/AI). Returns the
   *  importable dataset → column spec. */
  importDatasets: (): Promise<{ datasets: Record<string, Array<{ name: string; type: string; required: boolean }>> }> =>
    request<{ datasets: Record<string, Array<{ name: string; type: string; required: boolean }>> }>('/api/insights/import/datasets'),
  /** Bulk-insert rows for one dataset (CSV parsed to row objects client-side). */
  importBoardData: (dataset: string, rows: Array<Record<string, unknown>>): Promise<{ inserted: number; skipped: number; errors: string[] }> =>
    request(`/api/insights/import/${encodeURIComponent(dataset)}`, { method: 'POST', body: JSON.stringify({ rows }) }),
};

// ---------------------------------------------------------------------------
// Alerts — threshold alert rules on platform metrics + their firings.
// ---------------------------------------------------------------------------

/** Metric keys a rule may target (mirrors the API AlertMetric union). */
export type AlertMetric =
  | 'token_spend_usd'
  | 'token_spend_pct_of_cap'
  | 'cost_per_merged_pr_usd'
  | 'dora_change_failure_rate'
  | 'dora_lead_time_hours'
  | 'ai_effectiveness_score'
  | 'eval_drift';

export type AlertComparator = 'gt' | 'lt' | 'gte' | 'lte';
export type AlertScopeKind = 'tenant' | 'project' | 'team';
export type AlertEventStatus = 'triggered' | 'acknowledged' | 'resolved';

export interface Alert {
  id: string;
  tenantId: number;
  name: string;
  metric: AlertMetric;
  comparator: AlertComparator;
  threshold: number;
  windowDays: number;
  scopeKind: AlertScopeKind;
  projectId: number | null;
  teamId: number | null;
  notifySlack: boolean;
  notifyEmail: boolean;
  enabled: boolean;
  cooldownHours: number;
  lastTriggeredAt: string | null;
  lastEvaluatedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertEvent {
  id: string;
  alertId: string | null;
  tenantId: number;
  metric: AlertMetric | null;
  observedValue: number | null;
  threshold: number | null;
  comparator: AlertComparator | null;
  message: string;
  status: AlertEventStatus;
  notifiedSlack: boolean;
  notifiedEmail: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
}

/** Writable fields when creating/updating an alert rule. */
export type AlertInput = Partial<
  Pick<
    Alert,
    | 'name' | 'metric' | 'comparator' | 'threshold' | 'windowDays' | 'scopeKind'
    | 'projectId' | 'teamId' | 'notifySlack' | 'notifyEmail' | 'enabled' | 'cooldownHours'
  >
>;

export interface AlertTestResult {
  metric: AlertMetric;
  observedValue: number | null;
  threshold: number;
  comparator: AlertComparator;
}

export const alertsApi = {
  /** List the workspace's alert rules. */
  list: (): Promise<{ alerts: Alert[] }> => request<{ alerts: Alert[] }>('/api/alerts'),

  /** Create a threshold alert rule. */
  create: (body: AlertInput): Promise<Alert> =>
    request<Alert>('/api/alerts', { method: 'POST', body: JSON.stringify(body) }),

  /** Update an alert rule (partial). */
  update: (id: string, body: AlertInput): Promise<Alert> =>
    request<Alert>(`/api/alerts/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  /** Delete an alert rule. */
  remove: (id: string): Promise<{ deleted: string }> =>
    request<{ deleted: string }>(`/api/alerts/${id}`, { method: 'DELETE' }),

  /** Recent alert firings, optionally filtered by status. */
  listEvents: (opts: { limit?: number; status?: AlertEventStatus } = {}): Promise<{ events: AlertEvent[] }> => {
    const p = new URLSearchParams();
    if (opts.limit) p.set('limit', String(opts.limit));
    if (opts.status) p.set('status', opts.status);
    const qs = p.toString();
    return request<{ events: AlertEvent[] }>(`/api/alerts/events${qs ? `?${qs}` : ''}`);
  },

  /** Acknowledge a firing. */
  ackEvent: (id: string): Promise<AlertEvent> =>
    request<AlertEvent>(`/api/alerts/events/${id}/ack`, { method: 'POST' }),

  /** Evaluate a rule once now and return the observed value (no notify). */
  testRule: (id: string): Promise<AlertTestResult> =>
    request<AlertTestResult>(`/api/alerts/${id}/test`, { method: 'POST' }),
};

export const innovationApi = {
  funnel: (initiativeId?: string, projectId?: number | null): Promise<FunnelMetrics> => {
    const q = new URLSearchParams();
    if (initiativeId) q.set('initiative', initiativeId);
    if (projectId != null) q.set('projectId', String(projectId));
    return request<FunnelMetrics>(`/api/innovation/funnel${q.size ? `?${q.toString()}` : ''}`);
  },
  ideas: {
    list: (projectId?: number | null) => request<InnovationIdea[]>(`/api/innovation/ideas${projectId != null ? `?projectId=${projectId}` : ''}`),
    create: (body: Partial<Omit<InnovationIdea, 'id'>>) => ideaTracker.create(body) as unknown as Promise<InnovationIdea>,
    update: (id: string, body: Partial<Omit<InnovationIdea, 'id'>>) => ideaTracker.update(id, body) as unknown as Promise<InnovationIdea>,
    remove: (id: string) => ideaTracker.remove(id),
  },
};
