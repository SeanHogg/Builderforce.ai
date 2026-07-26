/**
 * Agent Ops API client — coordination, memory governance and rehearsal.
 *
 * Built on `apiRequest` from `lib/apiClient` rather than on `builderforceApi`'s own
 * `request()`: apiRequest is the ONE transport that attaches the emulation token, the
 * locale header, the request-id capture and the global error toast. The gap register
 * records what the other path costs — a superadmin emulating a user gets the admin's
 * own data, and server-sent mail goes out in the wrong language — so a new module has
 * no business re-creating it.
 */

import { apiRequest } from './apiClient';

// ── Coordination ────────────────────────────────────────────────────────────────

export type LeaseMode = 'exclusive' | 'shared';

export interface Lease {
  resource: string;
  mode: LeaseMode;
  holder: string;
  mine: boolean;
  reason?: string | null;
  expiresAt?: string | null;
}

export interface WorkspaceNote {
  key: string;
  content: string;
  author: string;
  updatedAt: string;
  mine: boolean;
}

export interface TicketCoordination {
  taskId: number;
  taskTitle: string;
  leases: Lease[];
  notes: WorkspaceNote[];
}

export const getTicketCoordination = (taskId: number): Promise<TicketCoordination> =>
  apiRequest<TicketCoordination>(`/api/agent-ops/coordination/${taskId}`);

export const releaseLease = (taskId: number, resource: string): Promise<{ released: number }> =>
  apiRequest<{ released: number }>(`/api/agent-ops/coordination/${taskId}/leases`, {
    method: 'DELETE',
    body: JSON.stringify({ resource }),
  });

// ── Memory governance ───────────────────────────────────────────────────────────

export type MemoryScope = 'tenant' | 'project' | 'ticket';

export interface GovernedMemory {
  key: string;
  content: string;
  scope: MemoryScope;
  scopeId: number;
  origin: string;
  originExecutionId: number | null;
  importance: number;
  expiresAt: string | null;
  updatedAt: string;
}

/**
 * Has this fact lapsed? THE one expiry predicate on the client — the summary tiles and
 * the per-row badge both call it, so a fact can never be counted lapsed in one place
 * and rendered live in the other. A null expiry means durable.
 */
export const isMemoryLapsed = (m: Pick<GovernedMemory, 'expiresAt'>, now: number): boolean =>
  m.expiresAt != null && Math.sign(Date.parse(m.expiresAt) - now) !== 1;

/** Query-string builder shared by the memory reads, so scope params never drift. */
function scopeQuery(scope: { projectId?: number | null; taskId?: number | null; limit?: number }): string {
  const p = new URLSearchParams();
  if (scope.projectId) p.set('projectId', String(scope.projectId));
  if (scope.taskId) p.set('taskId', String(scope.taskId));
  if (scope.limit) p.set('limit', String(scope.limit));
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const listMemories = (scope: { projectId?: number | null; taskId?: number | null; limit?: number } = {}): Promise<{ memories: GovernedMemory[] }> =>
  apiRequest<{ memories: GovernedMemory[] }>(`/api/agent-ops/memory${scopeQuery(scope)}`);

export const forgetMemory = (key: string, scope: { projectId?: number | null; taskId?: number | null } = {}): Promise<{ ok: boolean; deleted?: boolean }> =>
  apiRequest<{ ok: boolean; deleted?: boolean }>(`/api/agent-ops/memory/${encodeURIComponent(key)}${scopeQuery(scope)}`, {
    method: 'DELETE',
  });

export const purgeExpiredMemories = (): Promise<{ removed: { agentMemory: number; projectFacts: number } }> =>
  apiRequest<{ removed: { agentMemory: number; projectFacts: number } }>('/api/agent-ops/memory/purge', { method: 'POST' });

// ── Rehearsal ───────────────────────────────────────────────────────────────────

export type RehearsalKind = 'dry_run' | 'replay' | 'trial';

export interface Rehearsal {
  id: string;
  kind: RehearsalKind;
  status: string;
  agentRef: string | null;
  agentLabel: string;
  model: string | null;
  taskId: number | null;
  taskTitle?: string | null;
  sourceExecutionId: number | null;
  frozenRef: string | null;
  executionId: number | null;
  steps: number;
  suppressedWrites: number;
  finishedOk: boolean | null;
  summary: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface RehearsalStep {
  seq: number;
  op: string;
  target: string | null;
  detail: unknown;
}

export const listRehearsals = (projectId?: number | null): Promise<{ rehearsals: Rehearsal[] }> =>
  apiRequest<{ rehearsals: Rehearsal[] }>(`/api/agent-ops/rehearsals${projectId ? `?projectId=${projectId}` : ''}`);

export const getRehearsalReport = (id: string): Promise<{ rehearsal: Rehearsal; steps: RehearsalStep[] }> =>
  apiRequest<{ rehearsal: Rehearsal; steps: RehearsalStep[] }>(`/api/agent-ops/rehearsals/${id}`);

export interface StartRehearsalBody {
  kind: RehearsalKind;
  taskId?: number;
  sourceExecutionId?: number;
  agentRef?: string;
  model?: string;
  projectId?: number | null;
  ticketCount?: number;
}

export const startRehearsal = (body: StartRehearsalBody): Promise<{ id?: string; ids?: string[] }> =>
  apiRequest<{ id?: string; ids?: string[] }>('/api/agent-ops/rehearsals', {
    method: 'POST',
    body: JSON.stringify(body),
    // A rehearsal drives a real model loop, so a 400 here ("this ticket is not in your
    // workspace") is an expected user-facing outcome, not an incident to report.
    expectedErrors: [400],
  });
