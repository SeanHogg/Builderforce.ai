/**
 * REST API client. Projects and IDE files use the worker when NEXT_PUBLIC_WORKER_URL
 * is set (so the IDE can open projects); otherwise they use the auth API (api.builderforce.ai).
 * Auth, datasets, training, AI always use the auth API.
 */

import {
  apiRequest,
  apiRequestText,
  apiRequestStream,
  getProjectsBaseUrl,
  isWorkerForFiles,
  type RequestOptions,
} from './apiClient';
import { getOrSetClientCached, invalidateClientCache } from '@/infrastructure/http/readThrough';
import { readSseDataPayloads } from '@seanhogg/builderforce-memory/wire';
import type { ColumnClassification, DatasetUsePolicy } from '@builderforce/creation-canvas-contract';
import type {
  Project,
  FileEntry,
  Dataset,
  TrainingJob,
  TrainingLog,
  EvaluationResult,
  PublishedAgent,
  BuiltinAgentEntry,
  AgentPackage,
} from './types';


/** The IDE route prefix, shared with `siteApi.ts`. */
export const IDE = '/api/ide';

/**
 * Project + IDE-file calls, which target the standalone worker when
 * NEXT_PUBLIC_WORKER_URL is set and the auth API otherwise.
 *
 * The different ORIGIN used to justify a separate fetch wrapper here; it no
 * longer does — `apiRequest` takes a `baseUrl`, so these calls get the same
 * headers (emulation, locale), the same 401 redirect and the same error
 * reporting as everything else.
 */
function projectsRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return apiRequest<T>(path, { ...opts, baseUrl: getProjectsBaseUrl() });
}

// ---------------------------------------------------------------------------
// Projects (worker: /api/projects array | API: /api/projects { projects })
// ---------------------------------------------------------------------------

// In-flight coalescing: concurrent callers (e.g. the dashboard's stat-card load
// AND an embedded <ProjectsContent>) share ONE /api/projects round-trip instead of
// each firing their own. Browser-side, so this is request coalescing — not the
// server's cross-isolate getOrSetCached, which can't run here. Cleared on settle,
// so there's no staleness window: later (sequential) calls always re-fetch.
const PROJECTS_CACHE_KEY = 'projects:list';

export async function fetchProjects(): Promise<Project[]> {
  return getOrSetClientCached(PROJECTS_CACHE_KEY, async () => {
    // ONE shape now: the worker's bare-array variant went with its router.
    const res = await apiRequest<{ projects: Project[] }>('/api/projects');
    return res?.projects ?? [];
  }, { ttlMs: 0 });
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
  /** IDE project type — 'designer' | 'mobile' | 'evermind' | 'finetune' | 'voice'. Defaults server-side to 'designer'. */
  modality?: string;
  /** Where the project was born — 'ide' tags it for the Designer badge. */
  origin?: string;
}): Promise<Project> {
  const res = await projectsRequest<Project>('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  invalidateClientCache(PROJECTS_CACHE_KEY);
  const p = res as Project;
  return {
    ...p,
    created_at: (p as { createdAt?: string }).createdAt ?? p.created_at,
    updated_at: (p as { updatedAt?: string }).updatedAt ?? p.updated_at,
  };
}

export async function updateProject(
  id: number | string,
  data: Partial<Pick<Project, 'name' | 'description' | 'template' | 'key' | 'status' | 'governance' | 'modality' | 'startDate' | 'dueDate'>>
): Promise<Project> {
  // PATCH, always. The worker's PUT variant dropped `dueDate` — a save that
  // reported success and changed nothing — and it is retired.
  const res = await apiRequest<Project>(`/api/projects/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  invalidateClientCache(PROJECTS_CACHE_KEY);
  return res as Project;
}

export async function deleteProject(id: number | string): Promise<void> {
  await projectsRequest(`/api/projects/${id}`, { method: 'DELETE' });
  invalidateClientCache(PROJECTS_CACHE_KEY);
}

// ---------------------------------------------------------------------------
// IDE: Project files (worker: /api/projects/:id/files | API: /api/ide/projects/:id/files)
// ---------------------------------------------------------------------------

function filesBase(projectId: number | string): string {
  return isWorkerForFiles()
    ? `/api/projects/${projectId}/files`
    : `${IDE}/projects/${projectId}/files`;
}

/**
 * The URL for ONE file in a project's workspace.
 *
 * Encoded per segment, never as a whole: the slashes ARE the path — the server
 * reads them back as the file's location under the project prefix — while a
 * space or `#` inside a segment must not survive as itself. The server decodes
 * segment by segment to match (`presentation/routes/wildcardPath.ts`).
 */
function fileUrl(projectId: number | string, filePath: string): string {
  return `${filesBase(projectId)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
}

export async function fetchFiles(projectId: number | string): Promise<FileEntry[]> {
  return projectsRequest<FileEntry[]>(filesBase(projectId));
}

export async function fetchFileContent(
  projectId: number | string,
  filePath: string
): Promise<string> {
  const path = fileUrl(projectId, filePath);
  // 404 = the object was never written (the API distinguishes missing from
  // empty). Surface it as its own error so callers don't cache '' for a file
  // that doesn't exist — the silent-empty that used to propagate into saves.
  // It is an "expected" status: a missing file is not a system fault, so it must
  // not raise the global error toast.
  const res = await apiRequestStream(path, { baseUrl: getProjectsBaseUrl(), expectedErrors: [404] });
  if (res.status === 404) throw new Error(`File not found: ${filePath}`);
  if (!res.ok) throw new Error('Failed to fetch file content');
  return res.text();
}

export interface ProjectSearchMatch {
  path: string;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
  preview: string;
}

/** Project-wide text search (the IDE's Search panel). Always the API: the search is its use case. */
export async function searchProjectFiles(
  projectId: number | string,
  query: string,
): Promise<{ matches: ProjectSearchMatch[]; truncated: boolean }> {
  return apiRequest(`${IDE}/projects/${projectId}/search?q=${encodeURIComponent(query)}`);
}

/** Why a project version exists: the UI words each kind. */
export type ProjectCheckpointKind = 'baseline' | 'auto' | 'manual' | 'beforeRestore';

export interface ProjectCheckpoint {
  /** Epoch ms; also the id. */
  id: number;
  kind: ProjectCheckpointKind;
  name?: string;
  /** A few files that changed since the previous version. */
  changed: string[];
  fileCount: number;
}

export interface ProjectCheckpointRestore {
  restored: string[];
  removed: string[];
  /** Files the version names whose bytes are no longer kept. */
  missing: string[];
}

/** Whole-project versions: list, save one, put the project back to one. */
export const projectCheckpointsApi = {
  list: (projectId: number | string): Promise<ProjectCheckpoint[]> =>
    apiRequest(`${IDE}/projects/${projectId}/checkpoints`),
  create: (
    projectId: number | string,
    input: { kind: Exclude<ProjectCheckpointKind, 'beforeRestore'>; name?: string; changed?: string[] },
  ): Promise<ProjectCheckpoint> =>
    apiRequest(`${IDE}/projects/${projectId}/checkpoints`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  restore: (projectId: number | string, checkpointId: number): Promise<ProjectCheckpointRestore> =>
    apiRequest(`${IDE}/projects/${projectId}/checkpoints/${checkpointId}/restore`, { method: 'POST' }),
};

export async function saveFile(
  projectId: number | string,
  filePath: string,
  content: string
): Promise<void> {
  await projectsRequest(fileUrl(projectId, filePath), {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: content,
  });
}

export async function deleteFile(
  projectId: number | string,
  filePath: string
): Promise<void> {
  await projectsRequest(fileUrl(projectId, filePath), {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// IDE ↔ repo bridge — import a repo into the R2 workspace, commit edits back,
// create a clean repo, and read sync status. Siblings of /files under the IDE base.
// ---------------------------------------------------------------------------

/** Project-scoped IDE base (mirrors filesBase, minus the /files segment). */
function ideProjectBase(projectId: number | string): string {
  return isWorkerForFiles() ? `/api/projects/${projectId}` : `${IDE}/projects/${projectId}`;
}

export interface RepoSyncStatus {
  linked: boolean;
  repoId?: string;
  owner?: string;
  repo?: string;
  provider?: string;
  lastSyncedRef?: string | null;
  lastSyncedAt?: string | null;
}

export const ideRepoApi = {
  status: (projectId: number | string): Promise<RepoSyncStatus> =>
    projectsRequest<RepoSyncStatus>(`${ideProjectBase(projectId)}/repo-status`),

  import: (projectId: number | string, repoId: string, ref?: string): Promise<{ ok: boolean; imported: number; ref: string; truncated: boolean }> =>
    projectsRequest(`${ideProjectBase(projectId)}/import`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoId, ref }),
    }),

  commit: (projectId: number | string, repoId: string, message?: string, branch?: string): Promise<{ ok: boolean; branch: string; committed: number; deleted: number; prNumber: number | null; prUrl: string | null }> =>
    projectsRequest(`${ideProjectBase(projectId)}/commit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ repoId, message, branch }),
    }),

  createRepo: (projectId: number | string, body: { name: string; provider?: string; private?: boolean; credentialId: string }): Promise<{ ok: boolean; repoId: string; owner: string; repo: string; committed: number }> =>
    projectsRequest(`${ideProjectBase(projectId)}/create-repo`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),

  /** Write the GitHub Actions deploy workflow into the repo (idempotent). */
  enableDeploys: (
    projectId: number | string,
    body: { repoId?: string; subdomain?: string; distDir?: string } = {},
  ): Promise<{ path: string; branch: string; workflow: string }> =>
    projectsRequest(`${ideProjectBase(projectId)}/enable-deploys`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }),
};

// ---------------------------------------------------------------------------
// Workspace file history
// ---------------------------------------------------------------------------

/** One archived version of a workspace file. `at` is when it stopped being current. */
export interface FileVersion {
  path: string;
  at: number;
  size: number;
}

export async function fetchFileHistory(projectId: number | string, path?: string): Promise<FileVersion[]> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  return apiRequest<FileVersion[]>(`${IDE}/projects/${projectId}/history${query}`);
}

export async function restoreFileVersion(
  projectId: number | string,
  path: string,
  at: number,
): Promise<{ success: boolean }> {
  return apiRequest(`${IDE}/projects/${projectId}/history/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, at }),
  });
}

// ---------------------------------------------------------------------------
// IDE: Datasets
// ---------------------------------------------------------------------------

export async function generateDataset(
  projectId: number | string,
  capabilityPrompt: string,
  name: string,
  onChunk?: (chunk: string) => void,
  /** Optional generation model id (e.g. an OpenRouter model). Routed by the gateway; omit for the default pool. */
  model?: string
): Promise<Dataset> {
  const res = await apiRequestStream(`${IDE}/datasets/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, capabilityPrompt, name, ...(model ? { model } : {}) }),
  });
  if (!res.ok) throw new Error('Failed to generate dataset');
  if (onChunk && res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
    let finalDataset: Dataset | undefined;
    for await (const data of readSseDataPayloads(res.body)) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.type === 'chunk' && parsed.content) onChunk(parsed.content);
        if (parsed.type === 'done') finalDataset = parsed.dataset;
      } catch {
        if (data) onChunk(data);
      }
    }
    if (finalDataset) return finalDataset;
  }
  return res.json() as Promise<Dataset>;
}

/**
 * Promote a CLASSIFIED canvas dataset into a fine-tune corpus.
 *
 * Distinct from {@link generateDataset}, which synthesises instruction pairs from a
 * prompt: this carries real rows a person uploaded, together with the classification and
 * the use policy authored on the board. Sending them in one call is deliberate — a corpus
 * created in one request and classified in a second is a corpus that can be trained on in
 * between, which is the window the whole gate exists to close.
 */
export async function importCanvasDataset(input: {
  projectId: number | string;
  name: string;
  examples: Array<{ instruction: string; input?: string; output: string }>;
  capabilityPrompt?: string;
  classifications?: readonly ColumnClassification[];
  usePolicy?: DatasetUsePolicy | null;
  sourceSessionId?: string;
  sourceObjectId?: string;
}): Promise<Dataset> {
  return apiRequest<Dataset>(`${IDE}/datasets/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function listDatasets(projectId: number | string): Promise<Dataset[]> {
  return apiRequest<Dataset[]>(
    `${IDE}/datasets?projectId=${encodeURIComponent(String(projectId))}`
  );
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
  for await (const data of readSseDataPayloads(res.body)) {
    try {
      onLog(JSON.parse(data) as TrainingLog);
    } catch {
      /* ignore */
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
  data: ArrayBuffer,
  metadata?: {
    format?: 'safetensors' | 'evermind-lora';
    filename?: string;
    baseModel?: string;
    rank?: number;
    alpha?: number;
  },
): Promise<{ r2Key: string }> {
  const query = metadata?.format ? `?format=${encodeURIComponent(metadata.format)}` : '';
  return apiRequest<{ r2Key: string }>(`${IDE}/training/${jobId}/artifact${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': metadata?.format === 'safetensors' ? 'application/x-safetensors' : 'application/octet-stream',
      ...(metadata?.filename ? { 'X-Artifact-Filename': metadata.filename } : {}),
      ...(metadata?.baseModel ? { 'X-Base-Model': metadata.baseModel } : {}),
      ...(metadata?.rank != null ? { 'X-LoRA-Rank': String(metadata.rank) } : {}),
      ...(metadata?.alpha != null ? { 'X-LoRA-Alpha': String(metadata.alpha) } : {}),
    },
    body: data,
  });
}

/** Persist a binary artifact through the same authenticated workspace route. */
export async function saveBinaryFile(
  projectId: number | string,
  filePath: string,
  content: Blob,
): Promise<void> {
  await projectsRequest(fileUrl(projectId, filePath), {
    method: 'PUT',
    headers: { 'Content-Type': content.type || 'application/octet-stream' },
    body: content,
  });
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

/** Result of a pre-publish validation call against a candidate model. */
export interface ValidateAgentResult {
  ok: boolean;
  inference_mode?: 'base' | 'lora' | 'hybrid';
  latency_ms?: number;
  model_ref?: string;
  sample?: string;
  error?: string;
}

/**
 * Validates a freshly-trained candidate model by CALLING it via API before it can
 * be published — runs one test inference against the candidate descriptor and
 * returns the sample output. The publish UI gates "Publish" on `ok === true`.
 */
export async function validateAgent(data: {
  name: string;
  title?: string;
  bio?: string;
  skills?: string[];
  base_model: string;
  r2_artifact_key?: string;
  mamba_state?: unknown;
  prompt?: string;
}): Promise<ValidateAgentResult> {
  return apiRequest<ValidateAgentResult>(`${IDE}/agents/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

/**
 * Ingest proprietary documents for a published agent so it recalls them at
 * inference (grounded context). Replace semantics — re-ingesting supersedes the
 * agent's prior knowledge. Returns the number of stored chunks.
 */
export async function ingestAgentKnowledge(
  agentId: string,
  data: { text?: string; documents?: Array<{ name?: string; text: string }> },
): Promise<{ chunks: number }> {
  return apiRequest<{ chunks: number }>(`${IDE}/agents/${agentId}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function listAgents(): Promise<PublishedAgent[]> {
  // Public workforce registry — works for anonymous visitors on /marketplace.
  // Management endpoints (hire, update, etc.) still live under /api/ide/agents.
  return apiRequest<PublishedAgent[]>(`/api/workforce/agents`);
}

/** The built-in roster every workspace receives. Not hireable rows — each
 *  workspace already holds its own copy — so the marketplace shows them as a
 *  catalogue rather than as listings. */
export async function listBuiltinAgents(): Promise<BuiltinAgentEntry[]> {
  return apiRequest<BuiltinAgentEntry[]>(`/api/workforce/builtin-agents`);
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
 * Agent runtime engine. There is ONE engine — the current version (`builderforce-v3`,
 * the Claude-Agent-SDK loop with the limbic layer always composed). It is not
 * user-selectable; the field is a read-only denormalized value on the agent record.
 */
export type AgentEngine = 'builderforce-v3';
/**
 * Execution surface for a cloud agent. `durable` is Builderforce Cloud — the ONE cloud
 * runtime every plan runs on, with a real shell and a clone of the repo whenever the
 * platform can provide one; `github_actions` runs on the linked repo's own GitHub Actions
 * runners (60-minute cap), which requires the Builderforce agent workflow committed to
 * the repo. `container` is LEGACY — a row written when the container was a separate paid
 * surface; the server runs it on Builderforce Cloud and the picker reads it as `durable`.
 */
export type AgentRuntimeSurface = 'durable' | 'container' | 'github_actions';

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
  /** This agent's OWN personality (Pro). null clears it; server ignores for free plans. */
  psychometric?: import('./psychometric').PsychometricProfile | null;
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

// ── Personality LEARNING + TRACKING (Gaps 6 & 7) ──────────────────────────────
// Usage events + outcome-driven trait reinforcement for a cloud agent. Powers the
// PersonalityUsagePanel in the agent details slide-out.

/** One "personality applied to a run" entry — recorded durably, or derived live
 *  from a real terminal run (`recorded: false`). */
export interface PersonalityEvent {
  id: string;
  recorded: boolean;
  executionId: number | null;
  runId: string | null;
  profileSource: string;
  personaIds: string[];
  directivesSummary: string;
  directiveCount: number;
  thinkLevel: string | null;
  reasoningLevel: string | null;
  temperature: number | null;
  at: string | null;
}

export interface PersonalityEventsResponse {
  agentRef: string;
  activeSummary: string;
  activeDirectiveCount: number;
  events: PersonalityEvent[];
}

/** A bounded, reversible trait-reinforcement proposal computed from run outcomes. */
export interface ReinforcementProposal {
  deltas: Record<string, number>;
  rationale: string[];
  summary: string;
  previewVector: Record<string, number>;
}

export interface ReinforcementHistoryItem {
  id: number;
  status: 'proposed' | 'applied' | 'dismissed';
  deltas: Record<string, number>;
  rationale: string[];
  basedOnRuns: number;
  autoApplied: boolean;
  proposedAt: string | null;
  decidedAt: string | null;
}

export interface ReinforcementResponse {
  agentRef: string;
  windowDays: number;
  basedOnRuns: number;
  proposal: ReinforcementProposal | null;
  rationale: string[];
  caps: { perDimension: number; perPeriod: number };
  history: ReinforcementHistoryItem[];
}

export async function fetchPersonalityEvents(agentId: string, limit = 20): Promise<PersonalityEventsResponse> {
  return apiRequest<PersonalityEventsResponse>(`/api/personality/agents/${agentId}/events?limit=${limit}`);
}

export async function fetchTraitReinforcements(agentId: string, days = 14): Promise<ReinforcementResponse> {
  return apiRequest<ReinforcementResponse>(`/api/personality/agents/${agentId}/reinforcements?days=${days}`);
}

export async function applyTraitReinforcement(
  agentId: string,
  body: { deltas: Record<string, number>; rationale: string[]; basedOnRuns: number; windowDays: number },
): Promise<{ id: number; applied: Record<string, number>; vector: Record<string, number>; summary: string }> {
  return apiRequest(`/api/personality/agents/${agentId}/reinforcements/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function dismissTraitReinforcement(
  agentId: string,
  body: { deltas: Record<string, number>; rationale: string[] },
): Promise<{ id: number; dismissed: boolean }> {
  return apiRequest(`/api/personality/agents/${agentId}/reinforcements/dismiss`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Ensure the agent's workspace identity (assignment scope 'workspace') and return its handle — per-agent
 * skills/personas are assigned against it (artifact_assignments scope='agent') and follow the agent everywhere.
 */
export async function ensureWorkforceAgentBridge(agentId: string): Promise<number> {
  const r = await apiRequest<{ agentHandle: number }>(`/api/workforce/agents/${agentId}/bridge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return r.agentHandle;
}
