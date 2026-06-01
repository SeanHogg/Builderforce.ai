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
}

export function fetchFlows(): Promise<{ flows: QaFlow[] }> {
  return apiRequest('/api/qa/flows');
}

export function aggregateFlows(): Promise<{ upserted: number }> {
  return apiRequest('/api/qa/flows/aggregate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
}

export function seedCrawl(routes: string[], name?: string): Promise<{ flow: QaFlow }> {
  return apiRequest('/api/qa/flows/crawl', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ routes, name }),
  });
}

export function generateTest(flowId: string): Promise<{ test: QaTest; usedModel: string }> {
  return apiRequest('/api/qa/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flowId }),
  });
}

export function fetchTests(): Promise<{ tests: QaTest[] }> {
  return apiRequest('/api/qa/tests');
}

export function fetchRuns(): Promise<{ runs: QaRun[] }> {
  return apiRequest('/api/qa/runs');
}
