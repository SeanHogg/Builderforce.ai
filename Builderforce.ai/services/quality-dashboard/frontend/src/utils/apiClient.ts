/**
 * API client utilities for Quality & Bugs Dashboard backend
 */

import type { BugFilter, BugCountSummary, TrendData, SeverityBreakdown, BugListResponse, SyncResponse, ExportReport } from "../types/quality";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8001";

/**
 * Base API client with error handling
 */
async function apiRequest<T>(
  endpoint: string,
  options?: RequestInit
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const startTime = performance.now();

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error("API request failed:", error);
    throw error;
  }
}

/**
 * Bug Count Summary
 */
export async function getBugCountSummary(
  filter: BugFilter
): Promise<BugCountSummary> {
  const params = new URLSearchParams();
  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);
  if (filter.severity_threshold)
    params.set("severity_threshold", filter.severity_threshold);
  params.set("time_window_days", filter.time_window_days.toString());

  // Ensure proper encoding: encode all values; input is already stringified
  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  return apiRequest<BugCountSummary>(
    `/api/v1/bugs/count-summary?${serialized.toString()}`
  );
}

/**
 * Trend Data (time-series)
 */
export async function getTrendData(filter: BugFilter): Promise<TrendData> {
  const params = new URLSearchParams();
  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);
  if (filter.severity_threshold)
    params.set("severity_threshold", filter.severity_threshold);
  params.set("time_window_days", filter.time_window_days.toString());

  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  return apiRequest<TrendData>(`/api/v1/bugs/trend-data?${serialized.toString()}`);
}

/**
 * Severity Breakdown
 */
export async function getSeverityBreakdown(
  filter: BugFilter
): Promise<SeverityBreakdown> {
  const params = new URLSearchParams();
  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);

  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  return apiRequest<SeverityBreakdown>(
    `/api/v1/bugs/severity-breakdown?${serialized.toString()}`
  );
}

/**
 * Bug List with pagination
 */
export async function getBugList(
  filter: BugFilter,
  page: number,
  pageSize: number = 20
): Promise<BugListResponse> {
  const params = new URLSearchParams();
  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);
  if (filter.severity_threshold)
    params.set("severity_threshold", filter.severity_threshold);
  params.set("time_window_days", filter.time_window_days.toString());
  params.set("page", page.toString());
  params.set("page_size", pageSize.toString());

  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  return apiRequest<BugListResponse>(
    `/api/v1/bugs/list?${serialized.toString()}`
  );
}

/**
 * Sync Jira data
 */
export async function syncJira(
  projectId?: number,
  forceSync: boolean = false
): Promise<SyncResponse> {
  const params = new URLSearchParams();
  if (projectId) params.set("project_id", projectId.toString());
  if (forceSync) params.set("force_sync", forceSync.toString());

  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  return apiRequest<SyncResponse>(
    `/api/v1/sync/jira?${serialized.toString()}`
  );
}

/**
 * Sync GitHub data
 */
export async function syncGitHub(
  repoFullName?: string,
  forceSync: boolean = false
): Promise<SyncResponse> {
  const params = new URLSearchParams();
  if (repoFullName) params.set("repo_full_name", repoFullName);
  if (forceSync) params.set("force_sync", forceSync.toString());

  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  return apiRequest<SyncResponse>(
    `/api/v1/sync/github?${serialized.toString()}`
  );
}

/**
 * Export bugs to CSV
 */
export async function exportBugsToCSV(
  filter: BugFilter
): Promise<Blob> {
  const params = new URLSearchParams();
  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);
  if (filter.severity_threshold)
    params.set("severity_threshold", filter.severity_threshold);
  params.set("time_window_days", filter.time_window_days.toString());

  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/v1/export/csv?${serialized.toString()}`
  );

  if (!response.ok) {
    throw new Error("Failed to export to CSV");
  }

  return await response.blob();
}

/**
 * Export bug report to PDF
 */
export async function exportBugReport(
  filter: BugFilter
): Promise<Blob> {
  const params = new URLSearchParams();
  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);
  if (filter.severity_threshold)
    params.set("severity_threshold", filter.severity_threshold);
  params.set("time_window_days", filter.time_window_days.toString());

  const serialized = new URLSearchParams();
  for (const [key, val] of params.entries()) {
    serialized.set(key, val);
  }

  const response = await fetch(
    `${API_BASE_URL}/api/v1/export/pdf?${serialized.toString()}`
  );

  if (!response.ok) {
    throw new Error("Failed to export report");
  }

  return await response.blob();
}

/**
 * Health check
 */
export async function healthCheck(): Promise<{ status: string; timestamp: string }> {
  return apiRequest(`${API_BASE_URL}/api/v1/health`);
}