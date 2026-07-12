/**
 * Filter serialization and deserialization utilities
 */

import type { BugFilter } from "../types/quality";
import { decode } from "querystring"; // or URLSearchParams API as fallback

/**
 * Serialize filters to URL query parameters
 */
export function serializeFilters(filter: BugFilter): string {
  const params = new URLSearchParams();

  // Encode all provided filter values
  if (filter.project_id) params.set("project_id", filter.project_id.toString());
  if (filter.team) params.set("team", filter.team);
  if (filter.component) params.set("component", filter.component);
  if (filter.assignee) params.set("assignee", filter.assignee);
  if (filter.severity_threshold) params.set("severity_threshold", filter.severity_threshold);
  if (filter.time_window_days) params.set("time_window_days", filter.time_window_days.toString());

  return params.toString();
}

/**
 * Deserialize filters from URL query parameters
 */
export function deserializeFilters(searchParams: string): BugFilter {
  const params = new URLSearchParams(searchParams);

  const filter: BugFilter = {
    timeWindowDays: 30, // Default
  };

  // Decode for all supported filter fields
  if (params.has("project_id")) {
    const projectId = parseInt(params.get("project_id")!, 10);
    if (!isNaN(projectId)) {
      filter.project_id = projectId;
    }
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
    filter.severity_threshold = (severity === "Critical" || severity === "High" || severity === "Medium" || severity === "Low")
      ? severity as any
      : undefined;
  }

  if (params.has("time_window_days")) {
    const days = parseInt(params.get("time_window_days")!, 10);
    if (!isNaN(days)) {
      filter.timeWindowDays = days;
    }
  }

  return filter;
}

/**
 * Extract filters from URL pathname and search query
 * e.g., /dashboard?time_window_days=30
 */
export function extractFiltersFromUrl(): BugFilter {
  try {
    const url = new URL(window.location.href);
    return deserializeFilters(url.searchParams.toString());
  } catch (err) {
    console.error("Failed to extract filters from URL:", err);
    return { timeWindowDays: 30 };
  }
}

/**
 * Validate filter values
 */
export function validateFilter(filter: Partial<BugFilter>): boolean {
  if (filter.timeWindowDays !== undefined && (filter.timeWindowDays < 1 || filter.timeWindowDays > 365)) {
    return false;
  }
  return true;
}