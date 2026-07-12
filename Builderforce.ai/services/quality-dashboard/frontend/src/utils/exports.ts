/**
 * Export utilities for PDF and CSV downloads
 */
import jsPDF from "jspdf";
import { Bug, Severity } from "../types/quality";
import { formatDate } from "date-fns";

/**
 * Color mappings for severity badges
 */
export const SEVERITY_COLORS: Record<Severity, string> = {
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
  return {
    color: SEVERITY_COLORS[severity] || SEVERITY_COLORS.Low,
    label: severity,
  };
}

/**
 * Small helper to draw a pie slice in PDF
 */
function drawSlice(
  pdf: jsPDF,
  cx: number,
  cy: number,
  r: number,
  startRad: number,
  endRad: number,
  color: string
) {
  const path = new jsPDF.Path2D();
  const x = cx + r * Math.cos(startRad);
  const y = cy + r * Math.sin(startRad);
  const xEnd = cx + r * Math.cos(endRad);
  const yEnd = cy + r * Math.sin(endRad);
  path.moveTo(cx, cy);
  path.arc(cx, cy, r, startRad, endRad, false);
  path.closePath();
  pdf.fill(path, color);
}