/**
 * Red Alert Export Utilities
 * 
 * Provides CSV and PDF export functionality with Red status annotations.
 * AC-10: CSV exports include "Critical" in severity column for Red-tier rows.
 * AC-5: WCAG AA-compliant color tokens exported correctly (not grayscale).
 */

import { MetricSeverity } from '../utils/redAlertUtils';

/**
 * Metric data row for export
 */
export interface MetricExportRow {
  /** Metric name */
  name: string;
  /** Metric value */
  value: number | null;
  /** Computed severity */
  severity: MetricSeverity;
  /** Classification reason (when applicable) */
  reason?: string;
}

/**
 * Export format type
 */
export type ExportFormat = 'csv' | 'pdf';

/**
 * Export options
 */
export interface ExportOptions {
  /** Format of the export */
  format: ExportFormat;
  /** Include metric name column */
  includeName?: boolean;
  /** Include value column */
  includeValue?: boolean;
  /** Include severity column */
  includeSeverity?: boolean;
  /** Custom headers */
  headers?: string[];
  /** Application context for PDF/PNG thumbnails */
  context?: string;
  /** Southbound webhook URL (if sending exports to external systems) */
  webhookUrl?: string;
}

/**
 * Generate CSV header based on options
 */
export function generateCSVHeader(options: ExportOptions): string[] {
  const headers: string[] = [];
  
  if (options.includeName !== false || options.includeSeverity !== false) {
    headers.push('Metric Name');
  }
  
  if (options.includeValue !== false) {
    headers.push('Value');
  }
  
  if (options.includeSeverity !== false) {
    headers.push('Severity');
  }
  
  if (options.headers && options.headers.length > 0) {
    headers.push(...options.headers);
  }
  
  return headers;
}

/**
 * Generate CSV row from metric data
 * AC-10: Critical entries have severity column populated with "Critical"
 */
export function generateCSVRow(metric: MetricExportRow, options: ExportOptions): string {
  const row: (string | number | null)[] = [];
  
  if (options.includeName !== false) {
    row.push(metric.name);
  }
  
  if (options.includeValue !== false) {
    row.push(metric.value);
  }
  
  if (options.includeSeverity !== false) {
    // AC-10: severity column is populated with the human-readable label
    // ("Critical" / "Normal" / "No Data"), not the raw enum value.
    row.push(getExportSeverityLabel(metric.severity));
  }
  
  return row.map(cell => {
    // Convert numbers to strings, handle null/undefined
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'number') return cell.toString();
    return cell.toString();
  }).join(',');
}

/**
 * Generate complete CSV export
 * AC-10: CSV exports include "Critical" in severity column for Red-tier rows
 */
export function generateCSVExport(
  metrics: MetricExportRow[],
  options: ExportOptions = {}
): string {
  const { format = 'csv', includeName = true, includeValue = true, includeSeverity = true } = options;
  
  if (format !== 'csv') {
    throw new Error('CSV export only supports CSV format');
  }
  
  const headers = generateCSVHeader({ includeName, includeValue, includeSeverity });
  const rows = metrics.map(m => generateCSVRow(m, { format, includeName, includeValue, includeSeverity }));
  
  return [headers.join(','), ...rows].join('\n');
}

/**
 * Convert Red Alert severity to export label
 */
export function getExportSeverityLabel(severity: MetricSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Critical';
    case 'normal':
      return 'Normal';
    case 'No Data':
      return 'No Data';
    default:
      return severity;
  }
}

/**
 * Determine if severity should be bold in exports
 */
export function shouldHighlightInExport(severity: MetricSeverity): boolean {
  return severity === 'critical';
}

/**
 * Generate PDF-ready HTML with Red treatment (not grayscale fallback)
 * AC-5: Red colors preserved (not mapped to grayscale)
 */
export function generatePDFTemplate(
  metrics: MetricExportRow[],
  options: ExportOptions = {}
): string {
  const includesName = options.includeName !== false;
  const includesValue = options.includeValue !== false;
  const includesSeverity = options.includeSeverity !== false;
  
  const rows = metrics.map(m => {
    const rowHtml: string[] = [];
    
    if (includesName) {
      rowHtml.push(`<td><strong>${escapeHtml(m.name)}</strong></td>`);
    }
    
    if (includesValue) {
      rowHtml.push(`<td>${m.value !== null ? escapeHtml(m.value.toString()) : '-'}</td>`);
    }
    
    if (includesSeverity) {
      const isRed = m.severity === 'critical';
      rowHtml.push(`<td style="background-color: ${isRed ? '#FFEBEE' : ''}; color: ${isRed ? '#D32F2F' : '#333'}">
        ${getExportSeverityLabel(m.severity)}
      </td>`);
    }
    
    return `<tr>${rowHtml.join('')}</tr>`;
  });
  
  const headerHtml = (includesName || includesSeverity ? `<th>Metric Name</th>` : '') +
                    (includesValue ? `<th>Value</th>` : '') +
                    (includesSeverity ? `<th>Severity</th>` : '');
  
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Red Alert Metrics Export</title>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f5f5f5; }
    tr:hover { background-color: #f9f9f9; }
    .critical-severity { font-weight: bold; color: #D32F2F; }
    .severity-critical { background-color: #FFEBEE; }
  </style>
</head>
<body>
  <h1>Red Alert Thresholds Export</h1>
  <p>Generated at: ${new Date().toISOString()}</p>
  <p>Threshold Upper Bound: 49</p>
  
  <table>
    <thead>
      <tr>${headerHtml}</tr>
    </thead>
    <tbody>
      ${rows.join('')}
    </tbody>
  </table>
</body>
</html>
  `.trim();
}

/**
 * Escape HTML entities for CSV and HTML safety
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Trigger export via configured webhook
 * (If webhookUrl is provided, POST the export payload externally)
 */
export async function triggerExportWebhook(
  exportData: string,
  options: { webhookUrl: string; format: ExportFormat }
): Promise<void> {
  if (!options.webhookUrl) {
    throw new Error('webhookUrl must be provided');
  }
  
  if (options.format !== 'csv') {
    throw new Error('Only CSV exports supported for webhook delivery');
  }
  
  try {
    // Send to external service
    const response = await fetch(options.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/csv',
        'export-format': options.format,
      },
      body: exportData,
    });
    
    if (!response.ok) {
      throw new Error(`Webhook response ${response.status}: ${response.statusText}`);
    }
    
    console.log('[Red Alert] Export sent to webhook');
  } catch (error) {
    console.error('[Red Alert] Failed to send export to webhook:', error);
    throw error;
  }
}

// Re-export types and constants for component use
export type { MetricExportRow };