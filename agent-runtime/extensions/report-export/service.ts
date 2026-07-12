/**
 * Report Export Service
 * Handles CSV, PDF, and JSON export for alerts, overrides, and incidents
 */

import { 
  ExportFormat, 
  ReportType, 
  ReportSchedule, 
  ReportFilter,
  ReportConfig,
  ReportData,
  DEFAULT_REPORT_CONFIG
} from './types';

interface ReportDataSources {
  getAlerts(ids?: string[], filter?: ReportFilter): Promise<any[]>;
  getOverrides(ids?: string[], filter?: ReportFilter): Promise<any[]>;
  getIncidents(ids?: string[], filter?: ReportFilter): Promise<any[]>;
  getMetrics(filter?: ReportFilter): Promise<any>;
}

interface ReportStorage {
  save(schedule: ReportSchedule): Promise<void>;
  update(schedule: ReportSchedule): Promise<void>;
  get(id: string): Promise<ReportSchedule | null>;
  list(filter?: any): Promise<ReportSchedule[]>;
}

interface ExportStorage {
  save(result: any): Promise<void>;
  find(format: ExportFormat, dateRange: any): Promise<any[]>;
}

interface Callbacks {
  onExportComplete?: (schedule: ReportSchedule, result: any) => Promise<void>;
  onExportFailed?: (schedule: ReportSchedule, error: any) => Promise<void>;
}

export class ReportExportService {
  public readonly config: ReportConfig;

  constructor(
    private dataSources: ReportDataSources,
    private storage: ReportStorage,
    private exportStorage: ExportStorage,
    private callbacks: Callbacks = {},
    config: Partial<ReportConfig> = {}
  ) {
    this.config = { ...DEFAULT_REPORT_CONFIG, ...config };
  }

  /**
   * Generate report
   */
  async generateReport(
    type: ReportType,
    format: ExportFormat,
    requesterId: string,
    filters?: ReportFilter,
    entityId?: string
  ): Promise<ReportData> {
    console.log(`[ReportExport] Generating ${format.toUpperCase()} report: ${type}`);

    const startTime = Date.now();

    // Fetch data
    let data: any[] = [];
    let metadata: any = { generatedAt: new Date(), generatedBy: requesterId, version: '1.0' };

    switch (type) {
      case 'alerts':
        data = await this.fetchAlertData(filters);
        break;
      case 'overrides':
        data = await this.fetchOverrideData(filters);
        break;
      case 'incidents':
        data = await this.fetchIncidentData(filters);
        break;
      case 'delivery-metrics':
        metadata = (await this.fetchMetricData(filters)) || {};
        data = [metadata]; // Metrics as single-row report
        break;
    }

    const summary = await this.generateMetadata(type, data);

    const report: ReportData = {
      id: entityId || this.generateReportId(),
      type,
      generatedAt: new Date(),
      createdBy: requesterId,
      filters,
      data,
      metadata: {
        ...metadata,
        ...this.config,
        summary,
        generatedDurationMs: Date.now() - startTime,
      },
      format,
    };

    return report;
  }

  /**
   * Fetch alert data
   */
  private async fetchAlertData(filters?: ReportFilter): Promise<any[]> {
    return this.dataSources.getAlerts(undefined, filters);
  }

  /**
   * Fetch override data
   */
  private async fetchOverrideData(filters?: ReportFilter): Promise<any[]> {
    return this.dataSources.getOverrides(undefined, filters);
  }

  /**
   * Fetch incident data
   */
  private async fetchIncidentData(filters?: ReportFilter): Promise<any[]> {
    return this.dataSources.getIncidents(undefined, filters);
  }

  /**
   * Fetch metric data
   */
  private async fetchMetricData(filters?: ReportFilter): Promise<any> {
    return this.dataSources.getMetrics(filters);
  }

  /**
   * Generate metadata
   */
  private async generateMetadata(type: ReportType, data: any[]): Promise<any> {
    const summary: any = { alerts: {}, overrides: {} };

    if (type === 'alerts' || type === 'delivery-metrics') {
      const total = data.length;
      const delivered = data.filter((d) => d.status === 'delivered').length;
      const failed = data.filter((d) => d.status === 'failed').length;
      const slaCompliant = data.filter((d) => !d.slaBreached).length;
      const slaBreached = total - slaCompliant;

      summary.alerts = {
        total,
        delivered,
        failed,
        slaCompliant,
        slaBreached,
      };
    }

    if (type === 'overrides' || type === 'delivery-metrics') {
      const total = data.length;
      const pending = data.filter((d) => d.approvalStatus === 'pending' && !d.expired).length;
      const approved = data.filter((d) => d.approvalStatus === 'approved').length;
      const rejected = data.filter((d) => d.approvalStatus === 'rejected').length;
      const cancelled = data.filter((d) => d.approvalStatus === 'cancelled').length;

      summary.overrides = {
        total,
        pending,
        approved,
        rejected,
        cancelled,
      };
    }

    return summary;
  }

  /**
   * Export report to file
   */
  async exportReport(report: ReportData, fileName?: string): Promise<Buffer> {
    const startTime = Date.now();

    switch (report.format) {
      case 'csv':
        return await this.exportToCSV(report, fileName);
      case 'pdf':
        return await this.exportToPDF(report, fileName);
      case 'json':
        return await this.exportToJSON(report, fileName);
      default:
        throw new Error(`Unsupported format: ${report.format}`);
    }
  }

  /**
   * Export to CSV
   */
  private async exportToCSV(report: ReportData, fileName?: string): Promise<Buffer> {
    const headers = this.extractHeaders(report.data);
    const rows = this.generateCSVRows(report.data);

    const csvContent = [headers.join(','), ...rows].join('\n');
    return Buffer.from(csvContent);
  }

  /**
   * Export to JSON
   */
  private async exportToJSON(report: ReportData, fileName?: string): Promise<Buffer> {
    const jsonContent = JSON.stringify(report, null, 2);
    return Buffer.from(jsonContent);
  }

  /**
   * Export to PDF
   */
  private async exportToPDF(report: ReportData, fileName?: string): Promise<Buffer> {
    // This would integrate with a PDF generation library (e.g., puppeteer, pdfkit)
    // For now, we'll return a simulated buffer
    console.log(`[ReportExport] Generating PDF for ${report.type}`);
    await this.generatePlaceholderPDF(report);
    return Buffer.from('PDF placeholder - integrate with PDF generation library');
  }

  /**
   * Generate placeholder PDF
   */
  private async generatePlaceholderPDF(report: ReportData): Promise<void> {
    // In production, integrate with PDF generator
    // This is a placeholder to demonstrate the structure
  }

  /**
   * Extract headers from data
   */
  private extractHeaders(data: any[]): string[] {
    if (!data || data.length === 0) return [];

    const keys = new Set<string>();
    for (const item of data) {
      Object.keys(item).forEach((key) => keys.add(key));
    }
    return Array.from(keys);
  }

  /**
   * Generate CSV rows from data
   */
  private generateCSVRows(data: any[]): string[] {
    const headers = this.extractHeaders(data);
    
    return data.map((item) => {
      return headers.map((key) => {
        let value = item[key];
        
        // Handle nested objects
        if (typeof value === 'object' && value !== null) {
          value = JSON.stringify(value);
        }
        
        // Escape quotes and wrap in quotes
        value = String(value !== undefined && value !== null ? value : '');
        value = value.includes(',') || value.includes('"') 
          ? `"${value.replace(/"/g, '""')}"` 
          : value;
        
        return value;
      }).join(',');
    });
  }

  /**
   * Schedule report
   */
  async scheduleReport(
    name: string,
    type: ReportType,
    format: ExportFormat,
    frequency: any,
    startTime: string,
    recipientEmails: string[],
    filters?: ReportFilter
  ): Promise<ReportSchedule> {
    const schedule: ReportSchedule = {
      id: this.generateScheduleId(),
      name,
      type,
      format,
      frequency,
      startTime,
      recipientEmails,
      filters,
      active: true,
      createdAt: new Date(),
    };

    await this.storage.save(schedule);
    console.log(`[ReportExport] Scheduled: ${name} (${frequency})`);

    return schedule;
  }

  /**
   * Update scheduled report
   */
  async updateSchedule(schedule: ReportSchedule): Promise<void> {
    schedule.updatedAt = new Date();
    await this.storage.update(schedule);
  }

  /**
   * Deactivate schedule
   */
  async deactivateSchedule(scheduleId: string): Promise<void> {
    const schedule = await this.storage.get(scheduleId);
    if (schedule) {
      schedule.active = false;
      await this.updateSchedule(schedule);
    }
  }

  /**
   * Get active schedules
   */
  async getActiveSchedules(type?: ReportType): Promise<ReportSchedule[]> {
    return this.storage.list({ active: true, ...(type && { type }) });
  }

  /**
   * Check and run pending scheduled reports
   */
  async checkAndRunScheduledReports(): Promise<void> {
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    const schedules = await this.storage.list({ active: true });

    for (const schedule of schedules) {
      // Check if it's time to run this report
      if (schedule.startTime === currentTime) {
        await this.runScheduledReport(schedule);
      }
    }
  }

  /**
   * Run scheduled report
   */
  private async runScheduledReport(schedule: ReportSchedule): Promise<void> {
    console.log(`[ReportExport] Running scheduled report: ${schedule.name}`);

    try {
      const report = await this.generateReport(
        schedule.type,
        schedule.format,
        'system',
        schedule.filters
      );

      // Export to file
      const buffer = await this.exportReport(report, `${schedule.name}.${schedule.format}`);
      
      // Save export
      await this.saveExport(schedule.id, buffer, report);

      // Update schedule
      schedule.lastRunAt = new Date();
      schedule.nextRunAt = this.calculateNextRun(schedule.frequency);
      await this.updateSchedule(schedule);

      // Notify recipients
      await this.processReportDelivery(schedule, report);

      // Trigger callback
      await this.callbacks.onExportComplete?.(schedule, { success: true, recordCount: report.data.length });
    } catch (error) {
      console.error(`[ReportExport] Failed to run scheduled report: ${schedule.name}`, error);
      await this.callbacks.onExportFailed?.(schedule, error);
    }
  }

  /**
   * Save export result
   */
  private async saveExport(
    scheduleId: string,
    buffer: Buffer,
    report: ReportData
  ): Promise<void> {
    // Save to storage for retrieval
    await this.exportStorage.save({
      scheduleId,
      format: report.format,
      data: report,
      size: buffer.length,
      createdAt: new Date(),
    });
  }

  /**
   * Process report delivery
   */
  private async processReportDelivery(
    schedule: ReportSchedule,
    report: ReportData
  ): Promise<void> {
    // Send to recipients
    for (const email of schedule.recipientEmails) {
      console.log(`[ReportExport] Delivering report to ${email}`);
      // Implement actual email sending
    }
  }

  /**
   * Calculate next run time
   */
  private calculateNextRun(frequency: any): Date {
    const now = new Date();
    const hour = parseInt(now.getHours());
    const nextTime = new Date(now);

    switch (frequency) {
      case 'daily':
        nextTime.setDate(nextTime.getDate() + 1);
        break;
      case 'weekly':
        nextTime.setDate(nextTime.getDate() + 7);
        break;
      case 'monthly':
        nextTime.setMonth(nextTime.getMonth() + 1);
        break;
    }

    return nextTime;
  }

  /**
   * Generate unique report ID
   */
  private generateReportId(): string {
    return `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique schedule ID
   */
  private generateScheduleId(): string {
    return `schedule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export singleton instance
export const reportExportService = new ReportExportService(
  // Mock data sources
  {
    async getAlerts(ids, filter) {
      return [
        {
          id: 'alert_1',
          severity: 'critical',
          title: 'High CPU Usage',
          message: 'CPU usage on server-1 exceeds 90%',
          recipient: 'admin@example.com',
          channel: ['email', 'slack'],
          status: 'delivered',
          createdAt: new Date(),
          sentAt: new Date(Date.now() - 60000),
          deliveredAt: new Date(Date.now() - 59000),
          metadata: { slaBreached: false },
        },
        {
          id: 'alert_2',
          severity: 'high',
          title: 'Disk space low',
          message: 'Server-2 disk usage at 80%',
          recipient: 'admin@example.com',
          channel: ['email', 'sms'],
          status: 'failed',
          createdAt: new Date(),
          sentAt: new Date(Date.now() - 600000),
          failedAt: new Date(Date.now() - 120000),
          metadata: { slaBreached: true },
        },
        {
          id: 'alert_3',
          severity: 'medium',
          title: 'Database connection pool full',
          message: 'DB connection pool reached 90%',
          recipient: 'devops@example.com',
          channel: ['slack'],
          status: 'pending',
          createdAt: new Date(),
        },
      ];
    },
    async getOverrides(ids, filter) {
      return [
        {
          id: 'override_1',
          title: 'Override alert rule',
          description: 'Temporarily disable high CPU alert',
          requesterId: 'user_1',
          requesterName: 'John Doe',
          entityType: 'rule',
          entityId: 'rule_high_cpu',
          reason: 'Temporary increase in load due to maintenance',
          enabled: true,
          requiresApproval: true,
          approvalStatus: 'approved',
          approvedBy: 'admin_1',
          createdAt: new Date(),
          approvedAt: new Date(Date.now() - 3600000),
        },
        {
          id: 'override_2',
          title: 'Change route to backup',
          description: 'Route traffic to backup server',
          requesterId: 'user_2',
          requesterName: 'Jane Smith',
          entityType: 'route',
          entityId: 'route_primary_to_backup',
          reason: 'Primary route is unstable',
          enabled: true,
          requiresApproval: true,
          approvalStatus: 'pending',
          approvedCount: 1,
          createdAt: new Date(),
        },
      ];
    },
    async getIncidents(ids, filter) {
      return [
        {
          id: 'incident_1',
          title: 'Service downtime',
          status: 'open',
          severity: 'critical',
          createdAt: new Date(Date.now() - 3600000),
          impact: 'high',
        },
      ];
    },
    async getMetrics(filter) {
      return {
        totalSent: 1567,
        totalDelivered: 1523,
        totalFailed: 44,
        slaBreached: 12,
        slaComplianceRate: 99.2,
        averageDeliveryTimeMs: 4200,
        channelStats: {
          email: { sent: 800, delivered: 785, failed: 15 },
          slack: { sent: 500, delivered: 485, failed: 15 },
          sms: { sent: 267, delivered: 253, failed: 14 },
        },
      };
    },
  },
  // Mock storage
  {
    async save(schedule) {
      console.log(`[ReportExport] Saving schedule: ${schedule.name} - ${schedule.id}`);
      schedule.createdAt = new Date();
      schedules.set(schedule.id, schedule);
    },
    async get(id) {
      return schedules.get(id);
    },
    async list(filter) {
      return Array.from(schedules.values());
    },
    async update(schedule) {
      schedule.updatedAt = new Date();
      schedules.set(schedule.id, schedule);
      console.log(`[ReportExport] Updated schedule: ${schedule.name} - ${schedule.id}`);
    },
  },
  // Mock export storage
  {
    async save(result) {
      // In-memory storage for demo
    },
    async find(format, dateRange) {
      return [];
    },
  },
  // Callbacks
  {
    async onExportComplete(schedule, result) {
      console.log(`[ReportExport] Export complete: ${schedule.name}`);
    },
  }
);

const schedules = new Map<string, ReportSchedule>();