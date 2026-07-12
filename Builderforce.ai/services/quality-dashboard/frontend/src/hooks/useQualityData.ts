/**
 * React hooks for Quality Dashboard - Fetching and state management
 */

import { useState, useEffect, useCallback } from "react";
import type { BugFilter, BugCountSummary, TrendData, SeverityBreakdown, BugListResponse, SyncResponse } from "../types/quality";
import {
  getBugCountSummary,
  getTrendData,
  getSeverityBreakdown,
  getBugList,
  healthCheck,
  syncJira,
  syncGitHub,
} from "../utils/apiClient";

const POLLING_INTERVAL = 15000; // 15 minutes

export function useQualityData(filter: BugFilter) {
  const [bugCountSummary, setBugCountSummary] = useState<BugCountSummary | null>(null);
  const [trendData, setTrendData] = useState<TrendData | null>(null);
  const [severityBreakdown, setSeverityBreakdown] = useState<SeverityBreakdown | null>(null);
  const [bugList, setBugList] = useState<BugListResponse | null>(null);
  const [lastSynced, setLastSynced] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setSyncError(null);

    try {
      // Fetch all data in parallel for performance
      const [summary, trend, breakdown, list] = await Promise.all([
        getBugCountSummary(filter),
        getTrendData(filter),
        getSeverityBreakdown(filter),
        getBugList(filter, 1, 20), // Default page 1, pageSize 20
      ]);

      setBugCountSummary(summary);
      setTrendData(trend);
      setSeverityBreakdown(breakdown);
      setBugList(list);

      // Update last synced time from healthCheck
      const health = await healthCheck();
      setLastSynced(health.timestamp);
    } catch (error) {
      console.error("Failed to fetch data:", error);
      setSyncError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Initial load
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh polling
  useEffect(() => {
    if (!filter.time_window_days) return;

    const intervalId = setInterval(fetchData, POLLING_INTERVAL);
    return () => clearInterval(intervalId);
  }, [fetchData, filter.time_window_days]);

  const handleSync = async (source?: ("jira" | "github" | undefined)) => {
    setSyncing(true);
    setSyncError(null);

    try {
      // REAL sync: call the appropriate sync endpoint
      if (source === "jira") {
        await syncJira(filter.project_id);
      } else if (source === "github") {
        await syncGitHub();
      } else {
        // No source specified — rely on the next refresh of fetchData
      }

      await fetchData(); // Refresh everything after manual sync
      setLastSynced(new Date().toISOString()); // Expect hard poll to also set it
    } catch (error) {
      console.error("Sync failed:", error);
      setSyncError(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const clearSyncError = () => setSyncError(null);

  return {
    bugCountSummary,
    trendData,
    severityBreakdown,
    bugList,
    lastSynced,
    loading,
    syncing,
    syncError,
    sync: handleSync,
    clearSyncError,
  };
}