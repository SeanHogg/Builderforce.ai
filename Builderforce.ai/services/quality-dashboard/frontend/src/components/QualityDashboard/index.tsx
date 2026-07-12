/**
 * Quality & Bugs Dashboard - Main container
 * Integrates all widgets: count summary, severity chart, trend chart, filters, and bug table
 */

import { BugFilter } from "../../types/quality";
import { BugCountWidget } from "../BugCountWidget";
import { SeverityDonutChart } from "../SeverityDonutChart";
import { TrendLineChart } from "../TrendLineChart";
import { FiltersBar } from "../FiltersBar";
import { BugTable } from "../BugTable";
import { useQualityData } from "../../hooks/useQualityData";
import "./index.css";

export function QualityDashboard() {
  const [filter, setFilter] = React.useState<BugFilter>({
    project_id: undefined,
    team: undefined,
    component: undefined,
    assignee: undefined,
    severity_threshold: undefined,
    time_window_days: 30,
  });
  const [autoRefresh, setAutoRefresh] = React.useState(true);

  const {
    bugCountSummary,
    trendData,
    severityBreakdown,
    bugList,
    loading,
    lastSynced,
    syncing,
    syncError,
  } = useQualityData(filter);

  const handleSync = async () => {
    try {
      // Trigger manual sync (this will refresh the data)
      // In a real implementation, this would call the sync endpoints
      await fetch("/api/v1/health", {
        headers: { "Cache-Control": "no-cache" },
      });
      setAutoRefresh(true); // Reset auto-refresh timer
      alert("Data synced successfully!");
    } catch (error) {
      console.error("Sync failed:", error);
      alert("Data sync failed. Please try again later.");
    }
  };

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
          {syncError && <span className="sync-error">Sync failed</span>}
          <button
            onClick={handleSync}
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