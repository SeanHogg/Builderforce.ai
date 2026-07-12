/**
 * TypeScript type definitions for Quality & Bugs Dashboard
 */

export type Severity = "Critical" | "High" | "Medium" | "Low";
export type Status = "Open" | "New" | "Resolved" | "Closed";

export interface Bug {
  id: string;
  title: string;
  severity: Severity;
  status: Status;
  assignee: string;
  team?: string;
  component?: string;
  project_id: number;
  created_at: string;
  resolved_date?: string;
  duration_days?: number;
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

export interface BugFilter {
  project_id?: number;
  team?: string;
  component?: string;
  assignee?: string;
  severity_threshold?: Severity;
  time_window_days: number;
}

export interface SyncResponse {
  source: "Jira" | "GitHub";
  project_id?: number;
  repo_full_name?: string;
  force_sync: boolean;
  last_synced: string;
  status: "connected" | "error";
  synced_count: number;
  message: string;
}

export interface QualityDashboardConfig {
  apiUrl: string;
  pollingInterval: number; // milliseconds
  enableAutoSync: boolean;
  autoSyncInterval: number; // milliseconds
}

export interface ExportReport {
  generated_at: string;
  filters: Partial<BugFilter>;
  summary: BugCountSummary;
  trend: TrendData;
  breakdown: {
    severity_breakdown: Record<Severity, number>;
    severity_colors: Record<Severity, string>;
  };
}

export interface SeverityColorMap {
  Critical: string;
  High: string;
  Medium: string;
  Low: string;
}