/**
 * Knowledge Management API client — SOPs, processes & documents with
 * versioning, tagging, read-acknowledgement (audit), training assignments and
 * AI-assisted authoring. Talks to /api/knowledge on the auth API.
 */
import { apiRequest, apiRequestStream } from './apiClient';

export type DocType = 'sop' | 'process' | 'doc';
export type DocStatus = 'draft' | 'published' | 'archived';
export type ComplianceState = 'acknowledged' | 'pending' | 'overdue' | 'not_required';
export type DocAccess = 'manager' | 'editor' | 'viewer' | 'none';
export type CollaboratorRole = 'editor' | 'viewer';

export interface KnowledgeDoc {
  id: string;
  tenantId: number;
  projectId: number | null;
  docType: DocType;
  title: string;
  summary: string | null;
  content: string;
  status: DocStatus;
  versionNumber: number;
  requiresAck: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  tags: string[];
}

export interface MyAcknowledgement {
  versionNumber: number;
  acknowledgedAt: string;
  current: boolean;
}

export interface KnowledgeDocDetail extends KnowledgeDoc {
  myAccess: DocAccess;
  canEdit: boolean;
  myAcknowledgement: MyAcknowledgement | null;
  versionCount: number;
}

export interface Collaborator {
  userId: string;
  name: string;
  email: string;
  role: CollaboratorRole;
  createdAt: string;
}

export interface DocVersion {
  id: string;
  documentId: string;
  versionNumber: number;
  title: string;
  content: string;
  changeNote: string | null;
  publishedBy: string | null;
  createdAt: string;
}

export interface ComplianceRow {
  userId: string;
  name: string;
  email: string;
  state: ComplianceState;
  acknowledgedVersion: number | null;
  acknowledgedAt: string | null;
  dueAt: string | null;
}

export interface ComplianceSummary {
  required: number;
  acknowledged: number;
  pending: number;
  overdue: number;
  percent: number;
}

export interface DocCompliance {
  rows: ComplianceRow[];
  summary: ComplianceSummary;
}

export interface TenantComplianceDoc extends ComplianceSummary {
  documentId: string;
  title: string;
  docType: DocType;
  versionNumber: number;
}

export interface TenantCompliance {
  documents: TenantComplianceDoc[];
  totals: { required: number; acknowledged: number; overdue: number; percent: number };
}

export interface AssignableMember {
  userId: string;
  name: string;
  email: string;
}

export interface TrainingItem {
  id: string;
  documentId: string;
  title: string;
  docType: DocType;
  dueAt: string | null;
  completed: boolean;
  overdue: boolean;
  state: 'completed' | 'overdue' | 'pending';
}

export type AnalysisCategory = 'inefficiency' | 'gap' | 'risk' | 'clarity';
export interface AnalysisFinding {
  category: AnalysisCategory;
  severity: 'low' | 'medium' | 'high';
  issue: string;
  recommendation: string;
}
export interface AnalysisResult {
  summary: string;
  findings: AnalysisFinding[];
  improvedFlow: string;
  model?: string;
}

export interface CreateDocInput {
  title?: string;
  summary?: string;
  content?: string;
  docType?: DocType;
  projectId?: number | null;
  requiresAck?: boolean;
  tags?: string[];
  /** Seed from a curated standard-library template (server fills the defaults). */
  templateKey?: string;
}

/** A standard-library item — both a coverage gap and a one-click template. */
export interface KnowledgeTemplate {
  key: string;
  title: string;
  docType: DocType;
  summary: string;
  tags: string[];
  present: boolean;
}

/** A public knowledge listing in the marketplace (browse shape). */
export interface KnowledgeListing {
  id: string;
  title: string;
  summary: string | null;
  docType: DocType;
  category: string | null;
  tags: string[];
  priceCents: number;
  authorName: string | null;
  installCount: number;
  createdAt: string;
}

/** The caller-tenant's own listing for a document (drives the list/unlist UI). */
export interface MyKnowledgeListing {
  id: string;
  sourceDocumentId: string | null;
  priceCents: number;
  visibility: string;
  category: string | null;
  tags: string[];
  installCount: number;
}

export interface KnowledgeOverview {
  counts: {
    total: number;
    sop: number;
    process: number;
    doc: number;
    published: number;
    draft: number;
    archived: number;
    requiresAck: number;
  };
  stale: number;
  staleDays: number;
  coverage: { score: number; present: number; total: number };
  /** Standard items the team has no document for yet. */
  gaps: KnowledgeTemplate[];
  /** Full standard-library catalogue for the template gallery. */
  templates: KnowledgeTemplate[];
}

export interface UpdateDocInput {
  title?: string;
  summary?: string | null;
  content?: string;
  docType?: DocType;
  projectId?: number | null;
  requiresAck?: boolean;
  status?: 'draft' | 'archived';
}

export interface ListQuery {
  type?: DocType;
  status?: DocStatus;
  project?: number | null;
  tag?: string;
  q?: string;
}

const BASE = '/api/knowledge';

function qs(query: ListQuery): string {
  const p = new URLSearchParams();
  if (query.type) p.set('type', query.type);
  if (query.status) p.set('status', query.status);
  if (query.project != null) p.set('project', String(query.project));
  if (query.tag) p.set('tag', query.tag);
  if (query.q) p.set('q', query.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

function jsonBody(body: unknown): { method?: string; headers: Record<string, string>; body: string } {
  return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export const knowledgeApi = {
  list: (query: ListQuery = {}) =>
    apiRequest<{ documents: KnowledgeDoc[] }>(`${BASE}/documents${qs(query)}`).then((r) => r.documents),

  tags: () => apiRequest<{ tags: string[] }>(`${BASE}/tags`).then((r) => r.tags),

  overview: () => apiRequest<KnowledgeOverview>(`${BASE}/overview`),

  // --- Marketplace: sell / install knowledge documents -------------------
  listings: () =>
    apiRequest<{ listings: KnowledgeListing[] }>(`${BASE}/listings`).then((r) => r.listings),

  docListing: (id: string) =>
    apiRequest<{ listing: MyKnowledgeListing | null }>(`${BASE}/documents/${id}/listing`).then((r) => r.listing),

  publishListing: (id: string, input: { priceCents?: number; category?: string; visibility?: string }) =>
    apiRequest<{ listing: MyKnowledgeListing }>(`${BASE}/documents/${id}/list`, {
      method: 'POST',
      ...jsonBody(input),
    }).then((r) => r.listing),

  unpublishListing: (listingId: string) =>
    apiRequest<void>(`${BASE}/listings/${listingId}`, { method: 'DELETE' }),

  installListing: (listingId: string) =>
    apiRequest<{ documentId: string }>(`${BASE}/listings/${listingId}/install`, { method: 'POST' }),

  get: (id: string) => apiRequest<KnowledgeDocDetail>(`${BASE}/documents/${id}`),

  create: (input: CreateDocInput) =>
    apiRequest<KnowledgeDoc>(`${BASE}/documents`, { method: 'POST', ...jsonBody(input) }),

  update: (id: string, input: UpdateDocInput) =>
    apiRequest<KnowledgeDoc>(`${BASE}/documents/${id}`, { method: 'PATCH', ...jsonBody(input) }),

  remove: (id: string) => apiRequest<void>(`${BASE}/documents/${id}`, { method: 'DELETE' }),

  publish: (id: string, changeNote?: string) =>
    apiRequest<KnowledgeDoc>(`${BASE}/documents/${id}/publish`, { method: 'POST', ...jsonBody({ changeNote }) }),

  acknowledge: (id: string) =>
    apiRequest<{ acknowledged: boolean; versionNumber: number; acknowledgedAt: string }>(
      `${BASE}/documents/${id}/acknowledge`,
      { method: 'POST' },
    ),

  versions: (id: string) =>
    apiRequest<{ versions: DocVersion[] }>(`${BASE}/documents/${id}/versions`).then((r) => r.versions),

  setTags: (id: string, tags: string[]) =>
    apiRequest<{ tags: string[] }>(`${BASE}/documents/${id}/tags`, { method: 'PUT', ...jsonBody({ tags }) }).then(
      (r) => r.tags,
    ),

  compliance: (id: string) => apiRequest<DocCompliance>(`${BASE}/documents/${id}/compliance`),

  tenantCompliance: () => apiRequest<TenantCompliance>(`${BASE}/compliance`),

  members: () =>
    apiRequest<{ members: AssignableMember[] }>(`${BASE}/members`).then((r) => r.members),

  collaborators: (id: string) =>
    apiRequest<{ owner: { userId: string; name: string; email: string } | null; collaborators: Collaborator[] }>(
      `${BASE}/documents/${id}/collaborators`,
    ),

  invite: (id: string, userId: string, role: CollaboratorRole) =>
    apiRequest<{ userId: string; role: CollaboratorRole }>(`${BASE}/documents/${id}/collaborators`, {
      method: 'POST',
      ...jsonBody({ userId, role }),
    }),

  removeCollaborator: (id: string, userId: string) =>
    apiRequest<void>(`${BASE}/documents/${id}/collaborators/${userId}`, { method: 'DELETE' }),

  myTraining: () =>
    apiRequest<{ assignments: TrainingItem[] }>(`${BASE}/training/me`).then((r) => r.assignments),

  assignTraining: (id: string, userIds: string[], dueAt: string | null) =>
    apiRequest<{ assigned: number }>(`${BASE}/documents/${id}/training`, {
      method: 'POST',
      ...jsonBody({ userIds, dueAt }),
    }),

  unassignTraining: (assignmentId: string) =>
    apiRequest<void>(`${BASE}/training/${assignmentId}`, { method: 'DELETE' }),

  analyze: (id: string) =>
    apiRequest<AnalysisResult>(`${BASE}/documents/${id}/analyze`, { method: 'POST' }),

  /**
   * Stream an AI-drafted document. Calls `onDelta` with the running accumulated
   * Markdown as tokens arrive (OpenAI-compatible SSE), and resolves with the
   * final text. Mirrors the IDE chat streaming consumer.
   */
  aiDraftStream: async (
    input: { prompt: string; docType?: DocType; title?: string; existingContent?: string },
    onDelta: (accumulated: string) => void,
  ): Promise<string> => {
    const res = await apiRequestStream(`${BASE}/ai/draft`, { method: 'POST', ...jsonBody(input) });
    if (!res.ok) {
      const msg = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(msg.error || `AI generation failed (${res.status})`);
    }
    const reader = res.body?.getReader();
    if (!reader) return '';
    const decoder = new TextDecoder();
    let buffer = '';
    let acc = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6).trim();
        if (data === '[DONE]') return acc;
        try {
          const parsed = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> };
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) {
            acc += chunk;
            onDelta(acc);
          }
        } catch {
          // skip malformed chunks
        }
      }
    }
    return acc;
  },
};
