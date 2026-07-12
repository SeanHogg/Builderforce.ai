/**
 * Report Export System
 * Handles CSV, PDF, and JSON export for alerts, overrides, and incidents
 */

export type ExportFormat = 'csv' | 'pdf' | 'json';

export type ReportType = 'alerts' | 'overrides' | 'incidents' | 'delivery-metrics';

export type ReportFrequency = 'daily' | 'weekly' | 'monthly';

export interface ReportSchedule {
  id: string;
  name: string;
  type: ReportType;
  format: ExportFormat;
  frequency: ReportFrequency;
  startTime: string; // "09:00"
  recipientEmails: string[];
  filters?: ReportFilter;
  active: boolean;
  createdAt: Date;
  lastRunAt?: Date;
  nextRunAt?: Date;
}

export interface ReportFilter {
  alertStatus?: string[];
  channel?: string[];
  timeRange?: {
    start: Date;
    end: Date;
  };
  severity?: string[];
  slaCompliant?: boolean;
  overrides?: {
    status?: string[];
    requiresApproval?: boolean;
  };
}

export interface ReportConfig {
  includeTimestamps: boolean;
  includeMetadata: boolean;
  includeAccessorsApprovals: boolean;
  includeEscalations: boolean;
  includeDeliveryStatus: boolean;
  includeSlaCompliance: boolean;
}

/**
 * Exportable report data
 */
export interface ReportData {
  id: string;
  type: ReportType;
  generatedAt: Date;
  createdBy: string;
  filters: ReportFilter;
  data: any[];
  metadata: ReportMetadata;
  format: ExportFormat;
}

export interface ReportMetadata {
  generatedBy: string;
  generatedAt: string;
  version: string;
  totalRecords: number;
  filtersApplied: string[];
  generatedDurationMs: number;
  summary?: {
    alerts: {
      total: number;
      delivered: number;
      failed: number;
      slaCompliant: number;
      slaBreached: number;
    };
    overrides: {
      pending: number;
      approved: number;
      rejected: number;
      cancelled: number;
    };
    cost?: {
      email: number;
      slack: number;
      sms: number;
      total: number;
    };
  };
}

/**
 * Export delivery result
 */
export interface ExportResult {
  success: boolean;
  format: ExportFormat;
  recordCount: number;
  fileSizeBytes: number;
  downloadUrl?: string;
  error?: string;
  deliveredTo?: string[];
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  includeTimestamps: true,
  includeMetadata: true,
  includeAccessorsApprovals: true,
  includeEscalations: true,
  includeDeliveryStatus: true,
  includeSlaCompliance: true,
};