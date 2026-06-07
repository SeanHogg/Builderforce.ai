/**
 * REST API client. Projects and IDE files use the worker when NEXT_PUBLIC_WORKER_URL
 * is set (so the IDE can open projects); otherwise they use the auth API (api.builderforce.ai).
 * Auth, datasets, training, AI always use the auth API.
 */

import { checkUnauthorizedAndRedirect } from './auth';
import {
  apiRequest,
  apiRequestText,
  apiRequestStream,
  getApiBaseUrl,
  getAuthHeaders,
  getProjectsBaseUrl,
  isWorkerForProjects,
} from './apiClient';
import { planLimitErrorFromResponse } from './planLimitError';
import type {
  Project,
  FileEntry,
  Dataset,
  TrainingJob,
  TrainingLog,
  EvaluationResult,
  PublishedAgent,
  AgentPackage,
} from './types';

const IDE = '/api/ide';
const AI = '/api/ai';

async function projectsRequest<T>(
  path: string,
  opts: RequestInit & { body?: string } = {}
): Promise<T> {
  const authHeaders = getAuthHeaders();
  const hadToken = !!authHeaders.Authorization;
  const { body, ...init } = opts;
  const url = `${getProjectsBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...authHeaders, ...(init.headers as Record<string, string>) },
    ...(body !== undefined && { body }),
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) {
    const msg = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(msg.error || res.statusText || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Projects (worker: /api/projects array | API: /api/projects { projects })
// ---------------------------------------------------------------------------

export async function fetchProjects(): Promise<Project[]> {
  if (isWorkerForProjects()) {
    const arr = await projectsRequest<Project[]>('/api/projects');
    return Array.isArray(arr) ? arr : [];
  }
  const res = await apiRequest<{ projects: Project[] }>('/api/projects');
  return res?.projects ?? [];
}

export async function fetchProject(id: number | string): Promise<Project> {
  const res = await projectsRequest<Project>(`/api/projects/${id}`);
  const p = res as Project;
  return {
    ...p,
    created_at: (p as { createdAt?: string }).createdAt ?? p.created_at,
    updated_at: (p as { updatedAt?: string }).updatedAt ?? p.updated_at,
  };
}

export async function createProject(data: {
  name: string;
  description?: string;
  template?: string;
  /** IDE project type — 'designer' | 'video' | 'llm'. Defaults server-side to 'designer'. */
  modality?: string;
}): Promise<Project> {
  const res = await projectsRequest<Project>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const p = res as Project;
  return {
    ...p,
    created_at: (p as { createdAt?: string }).createdAt ?? p.created_at,
    updated_at: (p as { updatedAt?: string }).updatedAt ?? p.updated_at,
  };
}

export async function updateProject(
  id: number | string,
  data: Partial<Pick<Project, 'name' | 'description' | 'template' | 'key' | 'status' | 'governance' | 'modality'>>
): Promise<Project> {
  const res = isWorkerForProjects()
    ? await projectsRequest<Project>(`/api/projects/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    : await apiRequest<Project>(`/api/projects/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
  return res as Project;
}

export async function deleteProject(id: number | string): Promise<void> {
  await projectsRequest(`/api/projects/${id}`, { method: 'DELETE' });
}

// ---------------------------------------------------------------------------
// IDE: Project files (worker: /api/projects/:id/files | API: /api/ide/projects/:id/files)
// ---------------------------------------------------------------------------

function filesBase(projectId: number | string): string {
  return isWorkerForProjects()
    ? `/api/projects/${projectId}/files`
    : `${IDE}/projects/${projectId}/files`;
}

export async function fetchFiles(projectId: number | string): Promise<FileEntry[]> {
  return projectsRequest<FileEntry[]>(filesBase(projectId));
}

export async function fetchFileContent(
  projectId: number | string,
  filePath: string
): Promise<string> {
  const base = getProjectsBaseUrl();
  const url = `${base}${filesBase(projectId)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const authHeaders = getAuthHeaders();
  const hadToken = !!authHeaders.Authorization;
  const res = await fetch(url, { headers: authHeaders as HeadersInit });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.text();
}

export async function saveFile(
  projectId: number | string,
  filePath: string,
  content: string
): Promise<void> {
  await projectsRequest(`${filesBase(projectId)}/${filePath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

export async function deleteFile(
  projectId: number | string,
  filePath: string
): Promise<void> {
  await projectsRequest(`${filesBase(projectId)}/${filePath.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// IDE: AI chat (streaming)
// ---------------------------------------------------------------------------

export async function sendAIMessage(
  projectId: number | string,
  messages: { role: string; content: string }[],
  onChunk: (chunk: string) => void
): Promise<void> {
  const res = await apiRequestStream(`${AI}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId: String(projectId), messages }),
  });
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) throw new Error('Failed to send AI message');
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
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
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string; reasoning?: string } }>;
          response?: string;
          text?: string;
          delta?: string;
        };
        const delta = parsed.choices?.[0]?.delta;
        const chunk =
          (delta && typeof delta.content === 'string' ? delta.content : null) ||
          parsed.response ||
          parsed.text ||
          parsed.delta ||
          '';
        if (chunk) onChunk(chunk);
      } catch {
        // Never append raw JSON to the message; skip malformed chunks
      }
    }
  }
}

// ---------------------------------------------------------------------------
// IDE: Datasets
// ---------------------------------------------------------------------------

export async function generateDataset(
  projectId: number | string,
  capabilityPrompt: string,
  name: string,
  onChunk?: (chunk: string) => void
): Promise<Dataset> {
  const res = await apiRequestStream(`${IDE}/datasets/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, capabilityPrompt, name }),
  });
  if (!res.ok) throw new Error('Failed to generate dataset');
  if (onChunk && res.headers.get('content-type')?.includes('text/event-stream')) {
    const reader = res.body?.getReader();
    if (reader) {
      const decoder = new TextDecoder();
      let finalDataset: Dataset | undefined;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === 'chunk' && parsed.content) onChunk(parsed.content);
              if (parsed.type === 'done') finalDataset = parsed.dataset;
            } catch {
              if (data) onChunk(data);
            }
          }
        }
      }
      if (finalDataset) return finalDataset;
    }
  }
  return res.json() as Promise<Dataset>;
}

export async function listDatasets(projectId: number | string): Promise<Dataset[]> {
  return apiRequest<Dataset[]>(
    `${IDE}/datasets?projectId=${encodeURIComponent(String(projectId))}`
  );
}

export async function fetchDataset(datasetId: string): Promise<Dataset> {
  return apiRequest<Dataset>(`${IDE}/datasets/${datasetId}`);
}

export async function downloadDataset(datasetId: string): Promise<string> {
  return apiRequestText(`${IDE}/datasets/${datasetId}/download`);
}

// ---------------------------------------------------------------------------
// IDE: Training
// ---------------------------------------------------------------------------

export async function createTrainingJob(data: {
  projectId: number | string;
  datasetId?: string;
  baseModel: string;
  loraRank: number;
  epochs: number;
  batchSize: number;
  learningRate: number;
}): Promise<TrainingJob> {
  return apiRequest<TrainingJob>(`${IDE}/training`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function listTrainingJobs(
  projectId: number | string
): Promise<TrainingJob[]> {
  return apiRequest<TrainingJob[]>(
    `${IDE}/training?projectId=${encodeURIComponent(String(projectId))}`
  );
}

export async function fetchTrainingJob(jobId: string): Promise<TrainingJob> {
  return apiRequest<TrainingJob>(`${IDE}/training/${jobId}`);
}

export async function fetchTrainingLogs(jobId: string): Promise<TrainingLog[]> {
  return apiRequest<TrainingLog[]>(`${IDE}/training/${jobId}/logs`);
}

export async function streamTrainingLogs(
  jobId: string,
  onLog: (log: TrainingLog) => void
): Promise<void> {
  const res = await apiRequestStream(`${IDE}/training/${jobId}/logs/stream`);
  if (!res.ok) throw new Error('Failed to stream training logs');
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;
        try {
          onLog(JSON.parse(data) as TrainingLog);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

export async function evaluateModel(jobId: string): Promise<EvaluationResult> {
  return apiRequest<EvaluationResult>(`${IDE}/training/${jobId}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function updateTrainingJob(
  jobId: string,
  data: {
    status?: string;
    currentEpoch?: number;
    currentLoss?: number;
    r2ArtifactKey?: string;
    errorMessage?: string;
  }
): Promise<TrainingJob> {
  return apiRequest<TrainingJob>(`${IDE}/training/${jobId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function uploadArtifact(
  jobId: string,
  data: ArrayBuffer
): Promise<{ r2Key: string }> {
  const authHeaders = getAuthHeaders({ 'Content-Type': 'application/octet-stream' });
  const hadToken = !!authHeaders.Authorization;
  const res = await fetch(
    `${getApiBaseUrl()}${IDE}/training/${jobId}/artifact`,
    {
      method: 'POST',
      headers: authHeaders as HeadersInit,
      body: data,
    }
  );
  checkUnauthorizedAndRedirect(res, hadToken);
  if (!res.ok) throw new Error('Failed to upload artifact');
  return res.json();
}

// ---------------------------------------------------------------------------
// IDE: Workforce agents
// ---------------------------------------------------------------------------

export async function publishAgent(data: {
  project_id: number | string;
  job_id?: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_rank?: number;
  r2_artifact_key?: string;
  resume_md?: string;
  eval_score?: number;
}): Promise<PublishedAgent> {
  return apiRequest<PublishedAgent>(`${IDE}/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...data, project_id: data.project_id }),
  });
}

export async function listAgents(): Promise<PublishedAgent[]> {
  // Public workforce registry — works for anonymous visitors on /marketplace.
  // Management endpoints (hire, update, etc.) still live under /api/ide/agents.
  return apiRequest<PublishedAgent[]>(`/api/workforce/agents`);
}

export async function fetchAgent(agentId: string): Promise<PublishedAgent> {
  return apiRequest<PublishedAgent>(`${IDE}/agents/${agentId}`);
}

export async function hireAgent(agentId: string): Promise<PublishedAgent> {
  // Authenticated workforce hire: records the purchase for this tenant (so the
  // agent shows under "purchased" in /workforce) and bumps the hire counter.
  return apiRequest<PublishedAgent>(`/api/workforce/agents/${agentId}/hire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function fetchAgentPackage(agentId: string): Promise<AgentPackage> {
  return apiRequest<AgentPackage>(`${IDE}/agents/${agentId}/package`);
}

// --- Workforce cloud agents (tenant-scoped create / publish / manage) -------

export type AgentRuntimeSupport = 'cloud' | 'host' | 'both';
export type AgentPricingModel = 'flat_fee' | 'consumption';
/**
 * Agent runtime engine. `builderforce-v1` is the pi-coding-agent embedded runner
 * (default); `builderforce-v2` is the Claude Agent SDK runner.
 */
export type AgentEngine = 'builderforce-v1' | 'builderforce-v2';

export interface CloudAgentInput {
  name: string;
  title?: string;
  bio?: string;
  skills?: string[];
  baseModel?: string;
  runtimeSupport?: AgentRuntimeSupport;
  preferredRuntime?: 'cloud' | 'host' | null;
  engine?: AgentEngine;
  /** Price in USD cents (0 = free). */
  priceCents?: number;
  pricingModel?: AgentPricingModel;
  priceUnit?: string | null;
  published?: boolean;
}

/** The tenant's own agents (any publish state). */
export async function listMyAgents(): Promise<PublishedAgent[]> {
  return apiRequest<PublishedAgent[]>(`/api/workforce/agents/mine`);
}

/** Agents this tenant acquired from the marketplace (distinct from owned). */
export async function listPurchasedAgents(): Promise<PublishedAgent[]> {
  return apiRequest<PublishedAgent[]>(`/api/workforce/agents/purchased`);
}

export async function createCloudAgent(data: CloudAgentInput): Promise<PublishedAgent> {
  return apiRequest<PublishedAgent>(`/api/workforce/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateAgent(agentId: string, data: Partial<CloudAgentInput> & { status?: string }): Promise<PublishedAgent> {
  return apiRequest<PublishedAgent>(`/api/workforce/agents/${agentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(agentId: string): Promise<void> {
  await apiRequest<{ deleted: boolean }>(`/api/workforce/agents/${agentId}`, { method: 'DELETE' });
}

/**
 * Ensure the agent's canonical (project-less) identity row and return its
 * numeric id. Per-agent skills/personas are assigned against this id with
 * artifact_assignments scope='agent', so they follow the agent everywhere.
 */
export async function ensureWorkforceAgentBridge(agentId: string): Promise<number> {
  const r = await apiRequest<{ projectAgentId: number }>(`/api/workforce/agents/${agentId}/bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.projectAgentId;
}

// ---------------------------------------------------------------------------
// Repo analysis — the Architect / Digital-Transformation tool (/api/repo-analysis)
// ---------------------------------------------------------------------------

export type RepoAnalysisStatus =
  | 'queued' | 'fetching' | 'analyzing' | 'writing_back' | 'completed' | 'partial' | 'failed';

export type RepoAnalysisKind =
  | 'diagnostic' | 'recommendation' | 'business' | 'arch_4plus1' | 'antipatterns' | 'principles';

export interface RepoAnalysisRun {
  id: string;
  projectId: number;
  status: RepoAnalysisStatus;
  stage: string | null;
  progress: number;
  recommendation: 'brownfield' | 'greenfield' | 'parallel' | null;
  effectivePlan: string | null;
  tokensUsed: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface RepoAnalysisArtifactMeta {
  id: string;
  kind: RepoAnalysisKind;
  title: string | null;
  status: 'complete' | 'skipped' | 'failed';
  model: string | null;
  tokens: number | null;
  updatedAt: string;
}

export interface RepoAnalysisEvidenceMeta {
  id: string;
  repoId: string;
  provider: string | null;
  defaultBranch: string | null;
  status: 'complete' | 'partial' | 'failed';
  tokenEstimate: number | null;
}

export interface RepoAnalysisArtifact extends RepoAnalysisArtifactMeta {
  bodyMd: string | null;
  dataJson: string | null;
}

export async function startRepoAnalysis(projectId: number | string): Promise<{ run: RepoAnalysisRun }> {
  return apiRequest<{ run: RepoAnalysisRun }>(`/api/repo-analysis/projects/${projectId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    // 409 = no_repo: an expected, user-actionable state the Architect page
    // renders inline. Don't surface it as a global error toast / support ticket.
    expectedErrors: [409],
  });
}

export async function fetchRepoAnalysisRuns(projectId: number | string): Promise<{ runs: RepoAnalysisRun[]; total: number }> {
  return apiRequest<{ runs: RepoAnalysisRun[]; total: number }>(`/api/repo-analysis/projects/${projectId}/runs`);
}

export async function fetchRepoAnalysisRun(runId: string): Promise<{
  run: RepoAnalysisRun;
  artifacts: RepoAnalysisArtifactMeta[];
  evidence: RepoAnalysisEvidenceMeta[];
}> {
  return apiRequest(`/api/repo-analysis/runs/${runId}`);
}

export async function fetchRepoAnalysisArtifact(
  runId: string,
  kind: RepoAnalysisKind,
): Promise<{ artifact: RepoAnalysisArtifact }> {
  return apiRequest<{ artifact: RepoAnalysisArtifact }>(`/api/repo-analysis/runs/${runId}/artifacts/${kind}`);
}
