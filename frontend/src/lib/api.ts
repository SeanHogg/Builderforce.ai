/**
 * REST API client. Projects and IDE files use the worker when NEXT_PUBLIC_WORKER_URL
 * is set (so the IDE can open projects); otherwise they use the auth API (api.builderforce.ai).
 * Auth, datasets, training, AI always use the auth API.
 */

import {
  apiRequest,
  apiRequestText,
  apiRequestStream,
  getApiBaseUrl,
  getAuthHeaders,
  getProjectsBaseUrl,
  useWorkerForProjects,
} from './apiClient';
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
  const { body, ...init } = opts;
  const url = `${getProjectsBaseUrl()}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...getAuthHeaders(), ...(init.headers as Record<string, string>) },
    ...(body !== undefined && { body }),
  });
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
  if (useWorkerForProjects()) {
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
  data: Partial<Pick<Project, 'name' | 'description' | 'template'>>
): Promise<Project> {
  const method = useWorkerForProjects() ? 'PUT' : 'PATCH';
  const res = useWorkerForProjects()
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
  return useWorkerForProjects()
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
  const url = `${base}${filesBase(projectId)}/${encodeURIComponent(filePath)}`;
  const res = await fetch(url, { headers: getAuthHeaders() as HeadersInit });
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.text();
}

export async function saveFile(
  projectId: number | string,
  filePath: string,
  content: string
): Promise<void> {
  await projectsRequest(`${filesBase(projectId)}/${encodeURIComponent(filePath)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

export async function deleteFile(
  projectId: number | string,
  filePath: string
): Promise<void> {
  await projectsRequest(`${filesBase(projectId)}/${encodeURIComponent(filePath)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Project chats (persisted on auth API)
// ---------------------------------------------------------------------------

export interface ProjectChatSummary {
  id: number;
  title: string;
  /** Where the chat was created: 'brainstorm' | 'ide' | 'project'. Tells the page which tools to load. */
  origin?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectChatMessage {
  id: number;
  role: string;
  content: string;
  seq: number;
  createdAt: string;
}

export interface ProjectChat extends ProjectChatSummary {
  projectId?: number;
  tenantId?: number;
  messages: ProjectChatMessage[];
}

/** Normalize a single chat from API (handles snake_case or camelCase from server). */
function normalizeProjectChatSummary(raw: Record<string, unknown>): ProjectChatSummary {
  return {
    id: Number(raw.id),
    title: String(raw.title ?? 'New chat'),
    origin: raw.origin != null ? String(raw.origin) : undefined,
    createdAt: String(raw.createdAt ?? raw.created_at ?? ''),
    updatedAt: String(raw.updatedAt ?? raw.updated_at ?? ''),
  };
}

export async function listProjectChats(projectId: number | string): Promise<ProjectChatSummary[]> {
  const res = await apiRequest<{ chats?: ProjectChatSummary[] } | ProjectChatSummary[]>(
    `/api/projects/${String(projectId)}/chats`
  );
  const rawList = Array.isArray(res) ? res : (res && typeof res === 'object' && res.chats) ? res.chats : [];
  if (!Array.isArray(rawList)) return [];
  return rawList.map((item) => normalizeProjectChatSummary(item as unknown as Record<string, unknown>));
}

export async function getProjectChat(projectId: number | string, chatId: number): Promise<ProjectChat> {
  return apiRequest<ProjectChat>(`/api/projects/${projectId}/chats/${chatId}`);
}

export async function createProjectChat(projectId: number | string, title?: string): Promise<ProjectChatSummary> {
  return apiRequest<ProjectChatSummary>(`/api/projects/${projectId}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title ?? 'New chat' }),
  });
}

export async function appendProjectChatMessages(
  projectId: number | string,
  chatId: number,
  messages: Array<{ role: string; content: string }>,
  title?: string
): Promise<ProjectChat> {
  const body: { messages: Array<{ role: string; content: string }>; title?: string } = { messages };
  if (title !== undefined) body.title = title;
  return apiRequest<ProjectChat>(`/api/projects/${projectId}/chats/${chatId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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
  const res = await fetch(
    `${getApiBaseUrl()}${IDE}/training/${jobId}/artifact`,
    {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/octet-stream' }) as HeadersInit,
      body: data,
    }
  );
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
  return apiRequest<PublishedAgent[]>(`${IDE}/agents`);
}

export async function fetchAgent(agentId: string): Promise<PublishedAgent> {
  return apiRequest<PublishedAgent>(`${IDE}/agents/${agentId}`);
}

export async function hireAgent(agentId: string): Promise<PublishedAgent> {
  return apiRequest<PublishedAgent>(`${IDE}/agents/${agentId}/hire`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
}

export async function fetchAgentPackage(agentId: string): Promise<AgentPackage> {
  return apiRequest<AgentPackage>(`${IDE}/agents/${agentId}/package`);
}
