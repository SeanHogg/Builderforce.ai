/**
 * Bug Table
 * Paginated bug list with CSV/PDF export options
 */

import React from "react";
import { Bug } from "../../../types/quality";
import { exportBugsToCSV } from "../../../utils/exports";
import "./BugTable.css";

interface BugTableProps {
  bugs: Bug[];
  loading?: boolean;
}

const severityBadgeClass: Record<string, string> = {
  Critical: "badge-critical",
  High: "badge-high",
  Medium: "badge-medium",
  Low: "badge-low",
};

export function BugTable({ bugs, loading = false }: BugTableProps) {
  const handleExportCSV = () => {
    exportBugsToCSV(bugs, "quality-bugs-export.csv");
  };

  if (loading) {
    return (
      <div className="bug-table loading">
        <div className="table-loading">Loading bugs...</div>
      </div>
    );
  }

  return (
    <div className="bug-table">
      <div className="table-header">
        <span className="table-count">{bugs.length} bug(s)</span>
        <button className="export-csv-button" onClick={handleExportCSV}>
          Export CSV
        </button>
      </div>

      {bugs.length === 0 ? (
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
              {bugs.map((bug) => (
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