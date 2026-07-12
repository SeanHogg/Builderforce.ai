/**
 * TypeScript interfaces for Quality & Bugs Dashboard
 */

export enum Severity {
  Critical = "Critical",
  High = "High",
  Medium = "Medium",
  Low = "Low",
}

export interface Bug {
  id: string;
  title: string;
  severity: Severity;
  status: "Open" | "New" | "Resolved" | "In Progress";
  assignee: string;
  created_at: string;
  resolved_date?: string;
  duration_days?: number;
  project_id: number;
  team: string;
  component: string;
}

export interface BugFilter {
  project_id?: number;
  team?: string;
  component?: string;
  assignee?: string;
  severity_threshold?: Severity;
  time_window_days: number;
}

export interface BugCountSummary {
  total_open: number;
  newly_opened: number;
  resolved: number;
  net_change: number;
  severity_breakdown: Record<Severity, number>;
}

export interface TrendData {
  labels: string[];
  total_open: number[];
  newly_opened: number[];
  resolved: number[];
}

export interface SeverityBreakdown {
  breakdown: Record<Severity, number>;
  colors: Record<Severity, string>;
  total: number;
}

export interface BugListResponse {
  bugs: Bug[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface SyncStatus {
  source: "Jira" | "GitHub" | "Linear";
  project_id?: number;
  repo_full_name?: string;
  force_sync: boolean;
  last_synced: string;
  status: "connected" | "error" | "syncing";
  synced_count: number;
  message: string;
}

export interface ExportReport {
  generated_at: string;
  filters: Partial<BugFilter>;
  summary: BugCountSummary;
  trend: TrendData;
  breakdown: SeverityBreakdown;
}

export interface FilterParams {
  project_id?: number;
  team?: string;
  component?: string;
  assignee?: string;
  severity?: Severity | string;
  time_window_days?: number;
}

// URL params serialization (preserves share state)
export const serializeFilters = (filters: BugFilter): string => {
  const params = new URLSearchParams();
  if (filters.project_id) params.set("project_id", filters.project_id.toString());
  if (filters.team) params.set("team", filters.team);
  if (filters.component) params.set("component", filters.component);
  if (filters.assignee) params.set("assignee", filters.assignee);
  if (filters.severity_threshold) params.set("severity", filters.severity_threshold);
  params.set("time_window_days", filters.time_window_days.toString());
  return params.toString();
};

export const deserializeFilters = (search: string): BugFilter => {
  const params = new URLSearchParams(search);
  const result: BugFilter = {
    project_id: params.has("project_id") ? Number(params.get("project_id")) : undefined,
    team: params.get("team") || undefined,
    component: params.get("component") || undefined,
    assignee: params.get("assignee") || undefined,
    severity_threshold: (params.get("severity") as Severity) || undefined,
    time_window_days: Number(params.get("time_window_days")) || 30,
  };
  return result;
};