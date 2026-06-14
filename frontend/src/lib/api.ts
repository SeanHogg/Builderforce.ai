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

// In-flight coalescing: concurrent callers (e.g. the dashboard's stat-card load
// AND an embedded <ProjectsContent>) share ONE /api/projects round-trip instead of
// each firing their own. Browser-side, so this is request coalescing — not the
// server's cross-isolate getOrSetCached, which can't run here. Cleared on settle,
// so there's no staleness window: later (sequential) calls always re-fetch.
let inFlightProjects: Promise<Project[]> | null = null;

export async function fetchProjects(): Promise<Project[]> {
  if (inFlightProjects) return inFlightProjects;
  inFlightProjects = (async () => {
    if (isWorkerForProjects()) {
      const arr = await projectsRequest<Project[]>('/api/projects');
      return Array.isArray(arr) ? arr : [];
    }
    const res = await apiRequest<{ projects: Project[] }>('/api/projects');
    return res?.projects ?? [];
  })();
  try {
    return await inFlightProjects;
  } finally {
    inFlightProjects = null;
  }
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
// IDE: Subdomain hosting (publish a Designer build to <sub>.apps.builderforce.ai)
// ---------------------------------------------------------------------------

export interface SiteInfo {
  subdomain: string;
  mode: string;
  status: string;
  versionToken: string;
  assetCount: number;
  totalBytes: number;
  publishedAt: string | null;
  url: string;
  pathUrl: string;
}

export interface SitePublishResult {
  subdomain: string;
  versionToken: string;
  assetCount: number;
  totalBytes: number;
  url: string;
  pathUrl: string;
}

/** Current published-site record for a project (or null if never published). */
export async function fetchSite(projectId: number | string): Promise<SiteInfo | null> {
  const res = await apiRequest<{ site: SiteInfo | null }>(`${IDE}/projects/${projectId}/site`);
  return res?.site ?? null;
}

/**
 * Publish a built static site. `assets` are the files under the build's `dist/`
 * root (path is dist-relative). Sent as multipart/form-data — one part per file,
 * the part name being the relative path — plus an optional `subdomain` field.
 * Always targets the auth API (the publish endpoint lives in ideRoutes).
 */
export async function publishSite(
  projectId: number | string,
  assets: Array<{ path: string; data: Uint8Array }>,
  subdomain?: string,
): Promise<SitePublishResult> {
  const form = new FormData();
  if (subdomain) form.append('subdomain', subdomain);
  for (const { path, data } of assets) {
    form.append(path, new Blob([data as BlobPart]), path);
  }
  // FormData sets its own multipart Content-Type (with boundary) — don't override.
  const authHeaders = getAuthHeaders();
  const hadToken = !!authHeaders.Authorization;
  const headers = { ...authHeaders } as Record<string, string>;
  delete headers['Content-Type'];
  const res = await fetch(`${getApiBaseUrl()}${IDE}/projects/${projectId}/publish`, {
    method: 'POST',
    headers,
    body: form,
  });
  checkUnauthorizedAndRedirect(res, hadToken);
  if (res.status === 402) throw await planLimitErrorFromResponse(res);
  if (!res.ok) {
    const msg = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(msg.error || res.statusText || `Publish failed (${res.status})`);
  }
  return res.json() as Promise<SitePublishResult>;
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

export async function unhireAgent(agentId: string): Promise<void> {
  // Release a hired marketplace agent from this tenant's workforce — removes the
  // purchase and decrements the hire counter. Mirrors hireAgent().
  await apiRequest<{ unhired: boolean }>(`/api/workforce/agents/${agentId}/hire`, { method: 'DELETE' });
}

export async function fetchAgentPackage(agentId: string): Promise<AgentPackage> {
  return apiRequest<AgentPackage>(`${IDE}/agents/${agentId}/package`);
}

// --- Workforce cloud agents (tenant-scoped create / publish / manage) -------

export type AgentRuntimeSupport = 'cloud' | 'host' | 'both';
export type AgentPricingModel = 'flat_fee' | 'consumption';
/**
 * Agent runtime engine. **V1 is RETIRED (2026-06-13)** — `builderforce-v2` (the Claude
 * Agent SDK runner, gateway-routed) is the only engine. The `builderforce-v1` pi loop is gone.
 */
export type AgentEngine = 'builderforce-v2';
/**
 * Execution surface for a V2 cloud agent — the two types the user picks at
 * creation. Both run the full task IN THE CLOUD (all Cloudflare, no local/hybrid
 * agent): `durable` on a Durable Object (on-demand serverless, per step);
 * `container` on a long-lived Cloudflare Container for very long, continuous tasks.
 */
export type AgentRuntimeSurface = 'durable' | 'container';

export interface CloudAgentInput {
  name: string;
  title?: string;
  bio?: string;
  skills?: string[];
  baseModel?: string;
  runtimeSupport?: AgentRuntimeSupport;
  preferredRuntime?: 'cloud' | 'host' | null;
  engine?: AgentEngine;
  runtimeSurface?: AgentRuntimeSurface;
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
 * Owner-only agent performance + buyer-feedback rollup (gap [1247]). Success rate
 * / runs / latency are computed per currently-hired tenant from execution
 * telemetry; ratings are the buyers' feedback. The backend 404s unless the caller
 * owns the agent, so this is safe to call only from owner surfaces.
 */
export interface AgentPerfRollup {
  totalRuns: number;
  completedRuns: number;
  failedRuns: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  hiredTenants: number;
  ratingCount: number;
  avgRating: number | null;
  feedback: { rating: number; comment: string | null; createdAt: string }[];
}

export async function fetchAgentPerf(agentId: string): Promise<AgentPerfRollup> {
  return apiRequest<AgentPerfRollup>(`/api/workforce/agents/${agentId}/perf`);
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
// Architect analysis (/api/repo-analysis)
//
// Launched from a project: creates an "Architecture Analysis" Task on the board
// and kicks off the cloud analysis run. The result is written back as an
// architecture PRD. A repo must be mapped first — otherwise the API returns 409
// { error: 'no_repo' }, which the caller handles inline (no global error toast).
// ---------------------------------------------------------------------------

export interface RunArchitectureAnalysisResult {
  task: { id: number; projectId: number; status: string };
  executionId: number | null;
}

export async function runArchitectureAnalysis(projectId: number | string): Promise<RunArchitectureAnalysisResult> {
  return apiRequest<RunArchitectureAnalysisResult>(`/api/repo-analysis/projects/${projectId}/architect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    expectedErrors: [409],
  });
}
