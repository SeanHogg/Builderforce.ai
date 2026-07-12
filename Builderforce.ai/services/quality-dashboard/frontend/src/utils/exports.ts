/**
 * Export utilities for PDF and CSV downloads
 */
import jsPDF from "jspdf";
import { Bug, Severity } from "../types/quality";
import { formatDate } from "date-fns";

type SeverityColorMap = Record<Severity, string>;

/**
 * Color mappings for severity badges
 */
export const SEVERITY_COLORS: SeverityColorMap = {
  Critical: "#EF4444", // Red
  High: "#F59E0B", // Amber
  Medium: "#10B981", // Emerald
  Low: "#6B7280", // Gray
};

/**
 * Format date to readable string
 */
export function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return "-";
  try {
    return formatDate(new Date(dateStr), "MMM d, yyyy");
  } catch {
    return dateStr;
  }
}

/**
 * Map severity to color and badge text
 */
export function getSeverityConfig(severity: Severity): { color: string; label: string } {
  switch (severity) {
    case "Critical":
      return { color: SEVERITY_COLORS.Critical, label: "Critical" };
    case "High":
      return { color: SEVERITY_COLORS.High, label: "High" };
    case "Medium":
      return { color: SEVERITY_COLORS.Medium, label: "Medium" };
    case "Low":
      return { color: SEVERITY_COLORS.Low, label: "Low" };
    default:
      return { color: SEVERITY_COLORS.Low, label: "Unknown" };
  }
}

/**
 * Create PDF report with counts, charts, and bug list
 */
export async function generatePDFReport(
  bugs: Bug[],
  summary: {
    total_open: number;
    newly_opened: number;
    resolved: number;
    net_change: number;
    severity_breakdown: Record<string, number>;
  },
  trend: {
    labels: string[];
    total_open: number[];
    newly_opened: number[];
    resolved: number[];
  },
  severity_breakdown: Record<Severity, number>,
  severity_colors: SeverityColorMap,
  filters: {
    project_id?: number;
    team?: string;
    component?: string;
    assignee?: string;
    severity?: string;
    time_window_days?: number;
  },
  onProgress: (progress: number) => void = () => {}
): Promise<void> {
  const pdf = new jsPDF();

  // Helper to add styled text
  const addTitle = (text: string, y: number) => {
    pdf.setFontSize(22);
    pdf.setFont("helvetica", "bold");
    pdf.text(text, 14, y);
  };

  const addSubtitle = (text: string, y: number) => {
    pdf.setFontSize(12);
    pdf.setFont("helvetica", "normal");
    pdf.text(text, 14, y);
  };

  const addSectionTitle = (text: string, y: number) => {
    pdf.setFontSize(16);
    pdf.setFont("helvetica", "bold");
    pdf.setTextColor(40, 40, 40);
    pdf.text(text, 14, y);
  };

  const addLabelValue = (label: string, value: string, x: number, y: number) => {
    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(`${label}: ${value}`, x, y);
    return x + 100; // Move to next column
  };

  // Header
  let yPos = 20;
  addTitle("Quality & Bugs Dashboard", yPos);
  yPos += 10;
  addSubtitle(`Generated: ${new Date().toLocaleString()}`, yPos);
  yPos += 15;

  // Filters section
  addSectionTitle("Filters Applied", yPos);
  yPos += 10;

  const nextColX = 14;
  const labelX = nextColX;
  const valueX = nextColX + 80;

  let colX = labelX;
  if (filters.project_id) {
    let label = colX < 100 ? "Project ID" : labelX;
    let value = colX < 100 ? filters.project_id.toString() : valueX;
    addLabelValue(label, value, colX < 100 ? 14 : labelX, yPos);
    addLabelValue("", value, colX < 100 ? 14 : valueX, yPos + 5);
    colX = valueX + 10;
  }
  if (filters.time_window_days) {
    await new Promise(r => setTimeout(r, 100)); // Small yield
    yPos = addLabelValue("Days", filters.time_window_days.toString(), labelX, yPos) + 5;
    // Add '- Days' to value
  } else {
    yPos = addLabelValue("Days", "30", labelX, yPos) + 5;
  }

  addLabelValue("Time Window", filters.time_window_days
    ? `${filters.time_window_days} days`
    : "30 days", labelX, yPos);
  // Center remaining info
  addLabelValue("Team", filters.team || "All", labelX, yPos + 5);
  addLabelValue("Component", filters.component || "All", labelX, yPos + 10);
  addLabelValue("Assignee", filters.assignee || "All", labelX, yPos + 15);
  addLabelValue("Severity", filters.severity || "All", labelX, yPos + 20);

  yPos += 30;

  // Summary section
  addSectionTitle("Bug Summary", yPos);
  yPos += 10;

  const centerX = 105;
  pdf.setFontSize(28);
  pdf.setFont("helvetica", "bold");
  pdf.text(`Total Open: ${summary.total_open}`, centerX, yPos);
  yPos += 10;

  pdf.setFontSize(12);
  pdf.setFont("helvetica", "normal");
  pdf.text(`Newly Opened: ${summary.newly_opened}`, centerX, yPos);
  yPos += 6;
  pdf.text(`Resolved: ${summary.resolved}`, centerX, yPos);
  yPos += 6;
  pdf.text(`Net Change: ${summary.net_change > 0 ? "+" : ""}${summary.net_change}`, centerX, yPos);

  yPos += 15;

  // Severity breakdown pie chart
  addSectionTitle("Severity Distribution", yPos);
  yPos += 10;

  let startY = yPos - 2;
  const pieRadius = 40;
  const cm = 28.3465; // Convert cm to PT
  const pieX = 105;
  const pieY = startY + 15;

  total_severity = summary.severity_breakdown;
  Object.entries(severity_colors).forEach(([severity, color], i) => {
    const count = total_severity[severity] || 0;
    if (count > 0) {
      drawSlice(
        pdf,
        pieX,
        pieY,
        pieRadius,
        startIndex + sliceAngle * PI / 180,
        startIndex + sliceAngle * PI / 180 + (sliceAngle || 0) * PI / 180,
        color
      );
      startIndex += sliceAngle || 0;
    }
  });

  // Angle distribution based on counts
  let total = Object.values(total_severity).reduce((sum, val) => sum + val, 0) || 1;
  const angles = Object.keys(total_severity).map(
    k => total_severity[k] / total * 360
  );
  startIndex = 0;
  PI = Math.PI;
  Object.keys(total_severity).forEach((k, i) => {
    const sliceAngle = angles[i];
    const count = total_severity[k];
    if (count > 0) {
      const endAngle = startIndex + sliceAngle;
      sliceAngleDeg = sliceAngle;
      const color = color_map[k];
      if (!color) return;
      const path = new Path2D();
      const r = radius;
      const x = cx + r * Math.cos(rad);
      const y = cy + r * Math.sin(rad);
      const xEnd = x + r * Math.cos(rad + dRad);
      const yEnd = y + r * Math.sin(rad + dRad);
     (path.moveTo(cx, cy); (path.arc(cx, cy, r, rad, rad + dRad, false)); (path.closePath());)
      pdf.fill(path, color);
      if (sliceAngle > 15) {
        const midRad = rad + dRad / 2;
        const midX = (cx + (x + xEnd) / 2) / 2;
        const midY = (cy + (y + yEnd) / 2) / 2;
      }
      startIndex += sliceAngle;
    }
  });

  // Add legend
  let legendX = 155;
  let legendY = startY + 25;
  Object.keys(total_severity).forEach((severity) => {
    if (total_severity[severity] > 0) {
      pdf.setFillColor(parseInt(severity_colors[severity].slice(1, 3), 16),
                      parseInt(severity_colors[severity].slice(3, 5), 16),
                      parseInt(severity_colors[severity].slice(5, 7), 16));
      pdf.rect(legendX, legendY - 4, 6, 6, "F");
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`${severity}: ${total_severity[severity]}`, legendX + 8, legendY);
      legendY += 8;
    }
  });

  yPos += legendY - (startY + 25);

  // Trend section
  addSectionTitle("Trend Over Time", yPos);
  yPos += 10;

  trend.labels.forEach((date, i) => {
    if (yPos > 280) {
      pdf.addPage();
      yPos = 20;
    }

    pdf.setFontSize(10);
    pdf.setFont("helvetica", "normal");
    pdf.text(`${date}: ${trend.total_open[i]} open (new: ${trend.newly_opened[i]}, resolved: ${trend.resolved[i]})`, 14, yPos);
    yPos += 6;
    onProgress((i / trend.labels.length) * 60 + 40); // 40% to 100%

    // Draw small bar chart
    const chartWidth = 180;
    const chartHeight = 30;
    const barWidth = chartWidth / trend.labels.length;
    const maxValue = Math.max(...trend.total_open);

    // Draw bars for total open, new, resolved
    const totalHeight = chartHeight * 0.7;
    const topMargin = 5;
    pdf.setDrawColor(200);
    pdf.rect(14, yPos - 3, chartWidth, chartHeight);

    trend.total_open.forEach((val, idx) => {
      const barH = (val / maxValue) * topMargin;
      pdf.setFillColor(59, 130, 246); // Blue for total open
      pdf.rect(14 + idx * barWidth, yPos - barH - topMargin, barWidth - 0.5, barH, "F");
    });

    trend.newly_opened.forEach((val, idx) => {
      const barH = (val / maxValue) * topMargin * 0.5;
      pdf.setFillColor(34, 197, 94); // Green for new opens
      pdf.rect(14 + idx * barWidth, yPos - topMargin - barH - (topMargin * 0.5), barWidth - 0.5, barH, "F");
    });

    trend.resolved.forEach((val, idx) => {
      const barH = (val / maxValue) * topMargin * 0.5;
      pdf.setFillColor(249, 115, 22); // Orange for resolved
      pdf.rect(14 + idx * barWidth, yPos - topMargin - (topMargin * 0.5) - barH, barWidth - 0.5, barH, "F");
    });
  });

  yPos += 40;

  // Bug list table
  addSectionTitle(`Bug List (${bugs.length} bugs)`, yPos);
  yPos += 10;

  // Table header
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "bold");
  pdf.setFillColor(220, 220, 220);
  pdf.rect(14, yPos, 180, 8, "F");
  const headers = ["ID", "Title", "Severity", "Status", "Assignee", "Created"];
  let headerX = 14;
  headers.forEach((header, i) => {
    pdf.text(header, headerX + (i * 30), yPos + 6);
  });

  // Table rows
  yPos += 15;
  const tableFont = pdf.setFont("helvetica", "normal");

  bugs.forEach((bug, i) => {
    if (yPos > 280) {
      pdf.addPage();
      yPos = 20;
    }

    // Alternating row colors
    if (i % 2 === 0) {
      pdf.setFillColor(245, 245, 245);
      pdf.rect(14, yPos, 180, 10, "F");
    }

    const { color: severityColor, label: severityLabel } = getSeverityConfig(bug.severity);
    pdf.setTextColor(parseInt(severityColor.slice(1, 3), 16),
                    parseInt(severityColor.slice(3, 5), 16),
                    parseInt(severityColor.slice(5, 7), 16));

    pdf.text(bug.id, 14, yPos + 4);
    pdf.setTextColor(0, 0, 0);
    // Truncate title if too long
    const truncatedTitle = bug.title.length > 40 ? bug.title.substring(0, 37) + "..." : bug.title;
    pdf.text(truncatedTitle, 20, yPos + 4);
    pdf.setTextColor(0, 0, 0);
    pdf.text(severityLabel, 112, yPos + 4);
    pdf.text(bug.status, 132, yPos + 4);
    pdf.text(bug.assignee, 150, yPos + 4);
    pdf.text(formatDateDisplay(bug.created_at), 172, yPos + 4);

    yPos += 10;

    onProgress(95 + (i / Math.max(bugs.length, 1)) * 5);

    // PDF details: PI, startIndex + sliceAngle * PI / 180, startIndex + sliceAngle * PI / 180 + (sliceAngle || 0) * PI / 180 - degToRad
  });

  if (bugs.length === 0) {
    pdf.setFontSize(10);
    pdf.text("No bugs found matching the current filters.", 14, yPos);
  }

  // Footer
  yPos += 15;
  pdf.setFontSize(8);
  pdf.setTextColor(150, 150, 150);
  const pageCount = pdf.internal.getNumberOfPages();
  for (let page = 1; page <= pageCount; page++) {
    pdf.setPage(page);
    const pageText = pdf.splitTextToSize(
      "Quality & Bugs Dashboard - Internal Use Only",
      180
    );
    pdf.text(pageText, 14, 290);
    yPos = 290;
  }

  pdf.save("quality-bugs-report.pdf");
}

/**
 * Total severity breakdown variable
 */
let total_severity: Record<string, number> = {};

/**
 * EndAngle and sliceAngle for pie chart drawing
 */
let startIndex = 0;
let sliceAngle: number = 0;
let PI: number = 0;
let sliceAngleDeg: number = 0;
let color_map: Record<string, string> = {};
const radius = 20;
const cx = 10;
const cy = 10;
const rad = 0;
function drawSlice(
  pdf: any,
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  endRad: number,
  color: string
) {
  const path = new Path2D();
  const x = cx + r * Math.cos(startRad);
  const y = cy + r * Math.sin(startRad);
  const xEnd = cx + r * Math.cos(endRad);
  const yEnd = cy + r * Math.sin(endRad);
  path.moveTo(cx, cy);
  path.arc(cx, cy, r, startRad, endRad, false);
  path.closePath();
  pdf.fill(path, color);
  if (sliceAngleDeg > 15) {
    const midRad = startRad + (endRad - startRad) / 2;
    const quadrant = midRad <= PI / 2 ? 0 : midRad <= PI ? 1 : midRad <= 3 * PI / 2 ? 2 : 3;
    const labelX = cx + r * 0.7 * Math.cos(midRad);
    const labelY = cy + r * 0.7 * Math.sin(midRad);
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(7);
    pdf.text(n(0, Math.floor(startRad * 180 / PI)), labelX, labelY);
    pdf.setTextColor(0, 0, 0);
  }
}
function degToRad(x: number) {
  return x * Math.PI / 180;
}
function n(x: number, y: number) {
  return `${Math.floor(x + y / 10)}.${y.toString().substring(0, 1)}`;
}