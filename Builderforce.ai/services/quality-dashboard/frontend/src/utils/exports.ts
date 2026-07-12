/**
 * Export utilities for Quality Dashboard
 * Supports CSV and PDF report generation
 */

import type { BugFilter, Bug } from "../types/quality";

/**
 * Export bugs to CSV
 */
export async function exportBugsToCSV(bugs: Bug[], filename: string = "quality-bugs.csv"): Promise<void> {
  try {
    const headers = ["Bug ID", "Title", "Severity", "Status", "Assignee", "Created Date", "Resolved Date"];
    const rows = bugs.map(bug => [
      bug.id,
      bug.title,
      bug.severity,
      bug.status,
      bug.assignee,
      bug.created_at || "",
      bug.resolved_date || ""
    ]);

    const csvContent = [headers.join(","), ...rows.map(r => r.map(c => `"${c || ""}"`).join(","))].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("CSV export failed:", error);
    alert("Failed to export CSV. Please try again.");
    throw error;
  }
}

/**
 * Export bug summary report to JSON (placeholder for future PDF generation)
 * Note: PDF generation requires full chart rendering and reportlab support;
 * currently returns JSON export as per PRD/README.
 */
export async function exportBugSummary(filter: BugFilter, summary: any, trendData: any): Promise<void> {
  const report = {
    generated_at: new Date().toISOString(),
    filters: filter,
    summary: summary,
    trend: trendData,
  };

  const filename = `quality-bug-report-${Date.now()}.json`;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json; charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}