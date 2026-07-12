/**
 * React hooks for Quality & Bugs Dashboard
 */
import { useState, useEffect, useCallback } from "react";
import { BugFilter, Bug, BugCountSummary, TrendData, SeverityBreakdown } from "../types/quality";
import {
  getBugCountSummary,
  getTrendData,
  getSeverityBreakdown,
  getBugList,
  healthCheck,
  type BugListResponse,
} from "../utils/apiClient";

/**
 * Custom hook for fetching and managing bug data
 */
export function useQualityData() {
  const [countSummary, setCountSummary] = useState<BugCountSummary | null>(null);
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [severityBreakdown, setSeverityBreakdown] = useState<SeverityBreakdown | null>(null);
  const [bugs, setBugs] = useState<Bug[]>([]);
  const [loadingCount, setLoadingCount] = useState(true);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [loadingSeverity, setLoadingSeverity] = useState(true);
  const [loadingBugs, setLoadingBugs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch all data for current filters
   */
  const fetchData = useCallback(async (
    filter: BugFilter,
    page: number = 1
  ) => {
    const commonFilter = {
      ...filter,
      timeWindowDays: filter.timeWindowDays || 30,
    };

    try {
      setLoadingCount(true);
      setLoadingTrend(true);
      setLoadingSeverity(true);
      setLoadingBugs(true);
      setError(null);

      const [summary, trend, severity, bugList] = await Promise.all([
        getBugCountSummary(commonFilter),
        getTrendData(commonFilter),
        getSeverityBreakdown(commonFilter),
        getBugList(commonFilter, page, 100), // Get more bugs for the table
      ]);

      setCountSummary(summary);
      setTrendData(trend);
      setSeverityBreakdown(severity);
      setBugs(bugList.bugs);
    } catch (err) {
      console.error("Failed to fetch quality data:", err);
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoadingCount(false);
      setLoadingTrend(false);
      setLoadingSeverity(false);
      setLoadingBugs(false);
    }
  }, []);

  return {
    countSummary,
    trendData,
    severityBreakdown,
    bugs,
    loadingCount,
    loadingTrend,
    loadingSeverity,
    loadingBugs,
    error,
    fetchData,
  };
}

/**
 * Custom hook for managing filter state with URL sync
 */
export function useQualityFilters(initialFilters: BugFilter) {
  const [filters, setFilters] = useState<BugFilter>({
    ...initialFilters,
    timeWindowDays: initialFilters.timeWindowDays ?? 30,
  });

  // Update filters from URL params on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);

    if (urlParams.has("time_window_days")) {
      const days = parseInt(urlParams.get("time_window_days")!, 10);
      setFilters((prev) => ({ ...prev, timeWindowDays: days }));
    }

    // Other filters would be decoded here if needed
  }, []);

  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    params.set("time_window_days", filters.time_window_days.toString());
    // Encode other filter fields for URL
    if (filters.project_id) params.set("project_id", filters.project_id.toString());
    if (filters.team) params.set("team", filters.team);
    if (filters.component) params.set("component", filters.component);
    if (filters.assignee) params.set("assignee", filters.assignee);
    if (filters.severity_threshold) params.set("severity_threshold", filters.severity_threshold);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.pushState({}, "", newUrl);
  }, [filters]);

  return {
    filters,
    setFilters,
  };
}

/**
 * Custom hook for polling data with exponential backoff
 */
export function usePolling<T>(
  fetchFn: () => Promise<T>,
  interval: number,
  shouldPoll: boolean = true
): { data: T | null; loading: boolean; error: string | null } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startTime, setStartTime] = useState(Date.now());

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    const poll = async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchFn();
        setData(result);
        setStartTime(Date.now());
      } catch (err) {
        console.error("Polling failed:", err);
        setError(err instanceof Error ? err.message : "Polling failed");
      } finally {
        setLoading(false);
      }
    };

    poll(); // Immediate first fetch

    const timer = setInterval(poll, interval);
    return () => clearInterval(timer);
  }, [fetchFn, interval, shouldPoll]);

  return { data, loading, error };
}

/**
 * Custom hook for data staleness detection
 */
export function useStalenessIndicator(lastSynced: string | null | undefined): {
  isStale: boolean;
  timeSinceSync: string;
  lastSyncedDisplay: string;
} {
  const [timeSinceSync, setTimeSinceSync] = useState<string>("");

  useEffect(() => {
    if (!lastSynced) {
      setTimeSinceSync("Never synced");
      return;
    }

    try {
      const syncTime = new Date(lastSynced).getTime();
      const now = Date.now();
      const seconds = Math.floor((now - syncTime) / 1000);

      let timeString = "";
      if (seconds < 60) {
        timeString = `just now`;
      } else if (seconds < 3600) {
        const minutes = Math.floor(seconds / 60);
        timeString = `${minutes}m ago`;
      } else if (seconds < 86400) {
        const hours = Math.floor(seconds / 3600);
        timeString = `${hours}h ago`;
      } else {
        const days = Math.floor(seconds / 86400);
        timeString = `${days}d ago`;
      }
      setTimeSinceSync(timeString);
    } catch (err) {
      console.error("Failed to parse sync time:", err);
      setTimeSinceSync("Invalid time");
    }
  }, [lastSynced]);

  return {
    isStale: lastSynced ? (Date.now() - new Date(lastSynced).getTime() > 30 * 60 * 1000) : false,
    timeSinceSync,
    lastSyncedDisplay: lastSynced ? new Date(lastSynced).toLocaleString() : "Never",
  };
}

/**
 * Custom hook for manual sync
 */
export function useSync(projectId?: number, repoFullName?: string) {
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ source: string; message: string; timestamp: string } | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const syncJira = async (force: boolean = false) => {
    setSyncing(true);
    setSyncResult(null);
    setLastSynced(null);

    try {
      const response = await fetch(
        `/api/v1/sync/jira?project_id=${projectId || ""}&force_sync=${force}`
      );

      if (!response.ok) {
        throw new Error("Sync failed");
      }

      const data = await response.json();
      setSyncResult({ source: "Jira", message: data.message, timestamp: data.last_synced });
      setLastSynced(data.last_synced);
    } catch (err) {
      console.error("Jira sync failed:", err);
      throw err;
    } finally {
      setSyncing(false);
    }
  };

  const syncGitHub = async (repoFullNames?: string[], force: boolean = false) => {
    setSyncing(true);
    setSyncResult(null);

    try {
      const repoParam = repoFullNames ? repoFullNames.join(",") : "";
      const response = await fetch(
        `/api/v1/sync/github?repo_full_name=${repoParam}&force_sync=${force}`
      );

      if (!response.ok) {
        throw new Error("Sync failed");
      }

      const data = await response.json();
      setSyncResult({ source: "GitHub", message: data.message, timestamp: data.last_synced });
      setLastSynced(data.last_synced);
    } catch (err) {
      console.error("GitHub sync failed:", err);
      throw err;
    } finally {
      setSyncing(false);
    }
  };

  return { syncJira, syncGitHub, syncing, syncResult, lastSynced };
}