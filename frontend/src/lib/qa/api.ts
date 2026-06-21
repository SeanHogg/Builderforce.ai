/**
 * Frontend client for the Agentic QA endpoints (/api/qa). Thin typed wrappers
 * over apiRequest so the observability QA tab stays declarative.
 */

import { apiRequest } from '../apiClient';

export interface QaFlow {
  id: string;
  name: string;
  slug: string;
  source: string;
  description: string | null;
  startRoute: string | null;
  projectId: number | null;
  personaRole: string | null;
  credentialId: string | null;
  frequency: number;
  status: string;
  steps: { action: string; route?: string; selector?: string; label?: string }[];
}

export interface QaTest {
  id: string;
  name: string;
  slug: string;
  framework: string;
  model: string | null;
  version: number;
  status: string;
  updatedAt: string;
  projectId: number | null;
  credentialId: string | null;
  personaRole: string | null;
}

export interface QaRun {
  id: string;
  testId: string | null;
  status: string;
  browser: string | null;
  targetUrl: string | null;
  commitSha: string | null;
  durationMs: number | null;
  totalSteps: number | null;
  passedSteps: number | null;
  errorMessage: string | null;
  createdAt: string;
  testName: string | null;
  testSlug: string | null;
  credentialLabel?: string | null;
  credentialRole?: string | null;
}

export interface QaTarget {
  id: string;
  projectId: number;
  name: string;
  baseUrl: string;
  isDefault: boolean;
  status: string;
}

export interface QaCredential {
  id: string;
  projectId: number;
  label: string;
  role: string | null;
  username: string;
  loginUrl: string | null;
  status: string;
}

/** Build a `?projectId=` suffix when a project is selected. */
function pq(projectId: number | null): string {
  return projectId != null ? `?projectId=${projectId}` : '';
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function fetchFlows(projectId: number | null): Promise<{ flows: QaFlow[] }> {
  return apiRequest(`/api/qa/flows${pq(projectId)}`);
}

export function aggregateFlows(projectId: number | null): Promise<{ upserted: number }> {
  return apiRequest('/api/qa/flows/aggregate', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ projectId: projectId ?? undefined }) });
}

export function seedCrawl(routes: string[], projectId: number | null, name?: string): Promise<{ flow: QaFlow }> {
  return apiRequest('/api/qa/flows/crawl', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ routes, name, projectId: projectId ?? undefined }),
  });
}

export function generateTest(flowId: string): Promise<{ test: QaTest; usedModel: string }> {
  return apiRequest('/api/qa/generate', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ flowId }),
  });
}

export function fetchTests(projectId: number | null): Promise<{ tests: QaTest[] }> {
  return apiRequest(`/api/qa/tests${pq(projectId)}`);
}

export function fetchRuns(projectId: number | null): Promise<{ runs: QaRun[] }> {
  return apiRequest(`/api/qa/runs${pq(projectId)}`);
}

// --- Targets (per project) ---------------------------------------------------

export function fetchTargets(projectId: number): Promise<{ targets: QaTarget[] }> {
  return apiRequest(`/api/qa/projects/${projectId}/targets`);
}

export function createTarget(projectId: number, data: { name: string; baseUrl: string; isDefault?: boolean }): Promise<{ target: QaTarget }> {
  return apiRequest(`/api/qa/projects/${projectId}/targets`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
}

export function deleteTarget(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(`/api/qa/targets/${id}`, { method: 'DELETE' });
}

// --- Credentials / personas (per project) ------------------------------------

export function fetchCredentials(projectId: number): Promise<{ credentials: QaCredential[] }> {
  return apiRequest(`/api/qa/projects/${projectId}/credentials`);
}

export function createCredential(
  projectId: number,
  data: { label: string; role?: string; username: string; password: string; loginUrl?: string },
): Promise<{ credential: QaCredential }> {
  return apiRequest(`/api/qa/projects/${projectId}/credentials`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(data) });
}

export function deleteCredential(id: string): Promise<{ deleted: boolean }> {
  return apiRequest(`/api/qa/credentials/${id}`, { method: 'DELETE' });
}

// --- Agentic Tester (heatmap-driven exploration) -----------------------------

export interface QaHeatZone {
  route: string;
  selector: string | null;
  kind: string;
  label: string | null;
  heat: number;
  score: number;
}

export interface QaExploration {
  id: string;
  projectId: number | null;
  status: string;
  trigger: string;
  heatBudget: number;
  zonesPlanned: number;
  zonesExplored: number | null;
  findingsCount: number;
  model: string | null;
  targetUrl: string | null;
  summary: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface QaFinding {
  id: string;
  explorationId: string;
  projectId: number | null;
  type: string;
  severity: string;
  route: string | null;
  selector: string | null;
  message: string;
  detail: string | null;
  heat: number;
  status: string;
  taskId: number | null;
  createdAt: string;
}

export function fetchHeatmap(opts?: { sinceDays?: number; limit?: number }): Promise<{ zones: QaHeatZone[] }> {
  const qs = new URLSearchParams();
  if (opts?.sinceDays != null) qs.set('sinceDays', String(opts.sinceDays));
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  const suffix = qs.toString() ? `?${qs.toString()}` : '';
  return apiRequest(`/api/qa/heatmap${suffix}`);
}

export function fetchExplorations(projectId: number | null): Promise<{ explorations: QaExploration[] }> {
  return apiRequest(`/api/qa/explorations${pq(projectId)}`);
}

export function fetchExploration(id: string): Promise<{ exploration: QaExploration & { plan: unknown[]; heatZones: QaHeatZone[] }; findings: QaFinding[] }> {
  return apiRequest(`/api/qa/explorations/${id}`);
}

export function startExploration(
  data: { projectId?: number | null; heatBudget?: number; sinceDays?: number },
): Promise<{ exploration: QaExploration; plannedSteps: number }> {
  return apiRequest('/api/qa/explorations', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      projectId: data.projectId ?? undefined,
      heatBudget: data.heatBudget,
      sinceDays: data.sinceDays,
    }),
  });
}

export function createTaskFromFinding(findingId: string): Promise<{ task: { id: number; title: string }; finding: QaFinding }> {
  return apiRequest(`/api/qa/findings/${findingId}/task`, { method: 'POST' });
}
