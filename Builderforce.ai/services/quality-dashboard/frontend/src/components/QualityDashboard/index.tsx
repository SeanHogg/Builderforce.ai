import React, { useMemo } from "react";
import { BugFilter } from "../types/quality";
import { BugCountWidget } from "./BugCountWidget";
import { SeverityDonutChart } from "./SeverityDonutChart";
import { TrendLineChart } from "./TrendLineChart";
import { FiltersBar } from "./FiltersBar";
import { BugTable } from "./BugTable";
import { useQualityData } from "../../hooks/useQualityData";
import { updateUrlFilters } from "../../utils/filters";
import "./index.css";

interface QualityDashboardViewProps {
  initialFilter: BugFilter;
}

export function QualityDashboardView({ initialFilter }: QualityDashboardViewProps) {
  const [filter, setFilterState] = React.useState<BugFilter>(initialFilter);

  // Wrap setFilter so every filter change is reflected in the URL (AC-04 / AC-05).
  const setFilter = React.useCallback((next: BugFilter) => {
    setFilterState(next);
    updateUrlFilters(next);
  }, []);

  const {
    bugCountSummary,
    trendData,
    severityBreakdown,
    bugList,
    loading,
    lastSynced,
    syncing,
    syncError,
    sync: handleSync,
    clearSyncError,
  } = useQualityData(filter);

  const handleSyncClick = () => {
    clearSyncError();
    handleSync();
  };

  const isStale = useMemo(() => {
    if (!lastSynced) return false;
    const syncTime = new Date(lastSynced).getTime();
    const now = Date.now();
    return (now - syncTime) > 30 * 60 * 1000; // 30 minutes
  }, [lastSynced]);

  if (loading && !bugCountSummary) {
    return (
      <div className="quality-dashboard loading">
        <div className="loading-state">
          <div className="spinner"></div>
          <p>Loading dashboard data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="quality-dashboard">
      <header className="dashboard-header">
        <h1>Quality & Bugs Dashboard</h1>
        <div className="header-actions">
          {lastSynced && (
            <span className="last-synced">
              Last synced: {new Date(lastSynced).toLocaleString()}
            </span>
          )}
          {syncing && <span className="syncing">Syncing...</span>}
          {syncError && (
            <span className="sync-error" title={syncError}>
              Sync failed
            </span>
          )}
          {isStale && !syncing && (
            <span className="staleness-badge" title="Data has not been updated in the last 30 minutes">
              Data stale
            </span>
          )}
          <button
            onClick={handleSyncClick}
            disabled={syncing || loading}
            className="sync-button"
          >
            Sync Data
          </button>
        </div>
      </header>

      <div className="dashboard-filters">
        <FiltersBar filter={filter} onFilterChange={setFilter} />
      </div>

      <div className="dashboard-content">
        {/* Bug Count Widget */}
        <section className="dashboard-section count-section">
          <h2>Bug Count Summary</h2>
          <BugCountWidget
            totalOpen={bugCountSummary?.total_open ?? 0}
            newlyOpened={bugCountSummary?.newly_opened ?? 0}
            resolved={bugCountSummary?.resolved ?? 0}
            netChange={bugCountSummary?.net_change ?? 0}
          />
        </section>

        {/* Severity Distribution */}
        <section className="dashboard-section severity-section">
          <h2>Severity Distribution</h2>
          <SeverityDonutChart
            breakdown={severityBreakdown?.breakdown ?? {
              Critical: 0,
              High: 0,
              Medium: 0,
              Low: 0,
            }}
            colors={severityBreakdown?.colors ?? {
              Critical: "#EF4444",
              High: "#F59E0B",
              Medium: "#10B981",
              Low: "#6B7280",
            }}
          />
        </section>

        {/* Trend Analysis */}
        <section className="dashboard-section trend-section">
          <h2>Trend Analysis</h2>
          <TrendLineChart
            labels={trendData?.labels ?? []}
            totalOpen={trendData?.total_open ?? []}
            newlyOpened={trendData?.newly_opened ?? []}
            resolved={trendData?.resolved ?? []}
          />
        </section>

        {/* Bug Table */}
        <section className="dashboard-section table-section">
          <h2>Bug List</h2>
          <BugTable bugs={bugList?.bugs ?? []} loading={syncing} />
        </section>
      </div>
    </div>
  );
}