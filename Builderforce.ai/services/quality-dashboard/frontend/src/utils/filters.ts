/**
 * Filter serialization and deserialization utilities
 */

import type { BugFilter } from "../types/quality";

/** Validate filter values */
function validateFilter(filter: Partial<BugFilter>): boolean {
  if (filter.time_window_days !== undefined && (filter.time_window_days < 1 || filter.time_window_days > 365)) {
    return false;
  }
  return true;
}

/** Serialize filters to URL query parameters */
export function serializeFilters(filter: BugFilter): string {
  const params = new URLSearchParams();

  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);
  if (filter.severity_threshold) params.set("severity_threshold", filter.severity_threshold);
  if (filter.time_window_days) params.set("time_window_days", filter.time_window_days.toString());

  return params.toString();
}

/** Deserialize filters from URL query parameters */
export function deserializeFilters(searchParams: string): BugFilter {
  const params = new URLSearchParams(searchParams);

  const filter: BugFilter = {
    project_id: undefined,
    team: undefined,
    component: undefined,
    assignee: undefined,
    severity_threshold: undefined,
    time_window_days: 30, // Default
  };

  if (params.has("project_id")) {
    const projectId = parseInt(params.get("project_id")!, 10);
    if (!isNaN(projectId)) filter.project_id = projectId;
  }

  if (params.has("team")) {
    filter.team = params.get("team") || undefined;
  }

  if (params.has("component")) {
    filter.component = params.get("component") || undefined;
  }

  if (params.has("assignee")) {
    filter.assignee = params.get("assignee") || undefined;
  }

  if (params.has("severity_threshold")) {
    const severity = params.get("severity_threshold");
    if (
      severity === "Critical" ||
      severity === "High" ||
      severity === "Medium" ||
      severity === "Low"
    ) {
      filter.severity_threshold = severity as BugFilter["severity_threshold"];
    }
  }

  if (params.has("time_window_days")) {
    const days = parseInt(params.get("time_window_days")!, 10);
    if (!isNaN(days)) filter.time_window_days = days;
  }

  return withDefaults(filter);
}

/** Build BugFilter with defaults, ensuring time_window_days defaults to 30 */
function withDefaults(filter: Partial<BugFilter>): BugFilter {
  return {
    project_id: filter.project_id !== undefined ? filter.project_id : undefined,
    team: filter.team !== undefined ? filter.team : undefined,
    component: filter.component !== undefined ? filter.component : undefined,
    assignee: filter.assignee !== undefined ? filter.assignee : undefined,
    severity_threshold: filter.severity_threshold !== undefined ? filter.severity_threshold : undefined,
    time_window_days: filter.time_window_days !== undefined ? filter.time_window_days : 30,
  };
}

/** Extract filters from URL pathname and search query without defaults */
export function extractFiltersFromUrl(): BugFilter {
  try {
    const url = new URL(window.location.href);
    return deserializeFilters(url.searchParams.toString());
  } catch (err) {
    console.error("Failed to extract filters from URL:", err);
    return withDefaults({});
  }
}

/** Append existing filters from current URL to a fresh filter object or apply a new filter */
export function mergeFilters(newFilter: BugFilter | undefined): BugFilter {
  try {
    const url = new URL(window.location.href);
    const current = deserializeFilters(url.searchParams.toString());
    const merged = newFilter !== undefined ? newFilter : {};

    return withDefaults({
      project_id: merged.project_id ?? current.project_id,
      team: merged.team ?? current.team,
      component: merged.component ?? current.component,
      assignee: merged.assignee ?? current.assignee,
      severity_threshold: merged.severity_threshold ?? current.severity_threshold,
      time_window_days: merged.time_window_days !== undefined ? merged.time_window_days : current.time_window_days,
    });
  } catch {
    return withDefaults({});
  }
}

/** Update the URL to reflect non-responsive filter fields (project, team, component, assignee, severity, time_window_days) */
export function updateUrlFilters(filter: BugFilter): void {
  const url = new URL(window.location.href);
  url.search = serializeFilters(filter);
  window.history.pushState({}, "", url);
}

/** Reset filters to defaults and clear URL */
export function resetFilters(): void {
  const emptyFilter: BugFilter = {
    project_id: undefined,
    team: undefined,
    component: undefined,
    assignee: undefined,
    severity_threshold: undefined,
    time_window_days: 30,
  };
  const url = new URL(window.location.href);
  url.search = "";
  window.history.pushState({}, "", url);
}