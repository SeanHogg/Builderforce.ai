/**
 * Bug Table
 * Paginated bug list; uses useAllBugs to support the CSV/PDF export button.
 */

import React from "react";
import { Bug } from "../../types/quality";
import { exportBugsToCSV } from "../../utils/exports";
import { useAllBugs } from "../../hooks/useAllBugs";
import "./BugTable.css";

const severityBadgeClass: Record<string, string> = {
  Critical: "badge-critical",
  High: "badge-high",
  Medium: "badge-medium",
  Low: "badge-low",
};

export function BugTable() {
  const { allBugs, total, loading, error } = useAllBugs({
    project_id: undefined,
    team: undefined,
    component: undefined,
    assignee: undefined,
    severity_threshold: undefined,
    time_window_days: 365,
  });

  const handleExportCSV = () => {
    exportBugsToCSV(allBugs.slice(0, 10000), "quality-bugs-export.csv");
  };

  if (loading) {
    return (
      <div className="bug-table loading">
        <div className="table-loading">Loading bugs...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bug-table error">
        <div>Error loading bugs: {error}</div>
      </div>
    );
  }

  return (
    <div className="bug-table">
      <div className="table-header">
        <span className="table-count">{allBugs.length} bug(s) (max exportable)</span>
        <button className="export-csv-button" onClick={handleExportCSV}>
          Export CSV
        </button>
      </div>

      {allBugs.length === 0 ? (
        <div className="empty-state">No bugs match the current filters.</div>
      ) : (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Bug ID</th>
                <th>Title</th>
                <th>Severity</th>
                <th>Status</th>
                <th>Assignee</th>
                <th>Created</th>
                <th>Resolved</th>
              </tr>
            </thead>
            <tbody>
              {allBugs.slice(0, 10000).map((bug) => (
                <tr key={bug.id}>
                  <td className="bug-id">{bug.id}</td>
                  <td className="bug-title">{bug.title}</td>
                  <td>
                    <span
                      className={`severity-badge ${severityBadgeClass[bug.severity] || ""}`}
                    >
                      {bug.severity}
                    </span>
                  </td>
                  <td>
                    <span className="status-badge">{bug.status}</span>
                  </td>
                  <td>{bug.assignee}</td>
                  <td>{bug.created_at ? bug.created_at.slice(0, 10) : "-"}</td>
                  <td>{bug.resolved_date ? bug.resolved_date.slice(0, 10) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}