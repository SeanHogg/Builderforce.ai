/**
 * Agent Velocity Tracker
 * 
 * Tracks empirical task completion velocity per agent over time to support
 * accurate capacity estimation and timeline projections.
 * 
 * Follow-up from task #144 (resource-estimation analysis).
 * 
 * {
  export interface AgentVelocityRecord {
    agentId: string;
    timestamp: string;
    storyPoints: number;
    actualHours: number;
    dateRangeStart: string;
    dateRangeEnd: string;
    taskIds: string[];
    metrics: {
      spPerHour: number;
      hourlyRate: number;
      consistency: 'consistent' | 'fluctuating' | 'unknown';
    };
  }

  export interface VelocityStats {
    averageSpsPerWeek: number;
    averageHoursPerWeek: number;
    minSpsPerWeek: number;
    maxSpsPerWeek: number;
    stdDevSpsPerWeek: number;
    calculatedUsing: string;
    calculatedAt: string;
  }

  export interface VelocityCalibrationRequest {
    agentId: string;
    startDate: string;
    endDate: string;
    aggregateBy: 'week' | 'sprint';
  }

  export type VelocityCalibrationResult = {
    baseVelocity: number; // SP/week
    confidence: number; // 0-1
    confidenceReason: string;
    recommendedThroughputFactor: number; // hours per SP
    dataPoints: number;
    recommendedRefreshDate: string;
  };

  /**
   * Agent Velocity Tracker Service
   * 
   * Provides methods to collect, calculate, and retrieve agent velocity data.
   * Can operate in two modes:
   * 1. Local mode: Uses internal task tracking (when roster API is unavailable)
   * 2. Roster mode: Uses assignees endpoint API (when available)
   */
  export class AgentVelocityTracker {
    private records: Map<string, AgentVelocityRecord[]> = new Map();
    private statsCache: Map<string, VelocityStats> = new Map();
    private readonly DEFAULT_SP_WEEK_FACTOR = 0.4; // hours per SP (fallback)
    private lastRefreshDate: Date | null = null;
    private biweeklyRefreshDate: Date | null = null;

    constructor() {
      // Initialize with last refresh date (this is where we'd load from DB)
      this.lastRefreshDate = new Date();
      this.updateBiweeklyRefreshDate();
    }

    /**
     * Calculate recommended refresh date for bi-weekly velocity recalibration
     */
    private updateBiweeklyRefreshDate(): void {
      if (!this.lastRefreshDate) {
        this.biweeklyRefreshDate = new Date();
        this.biweeklyRefreshDate.setDate(this.biweeklyRefreshDate.getDate() + 14);
        return;
      }
      this.biweeklyRefreshDate = new Date(this.lastRefreshDate);
      this.biweeklyRefreshDate.setDate(this.biweeklyRefreshDate.getDate() + 14);
    }

    /**
     * Record a completed task's velocity data for an agent
     * 
     * @param record - The velocity record to add
     */
    addVelocityRecord(record: Omit<AgentVelocityRecord, 'timestamp'>): void {
      const agentId = record.agentId;
      if (!this.records.has(agentId)) {
        this.records.set(agentId, []);
      }

      this.records.get(agentId)!.push({
        ...record,
        timestamp: new Date().toISOString(),
      });

      // Clear stats cache when new data is added
      this.statsCache.delete(agentId);
    }

    /**
     * Batch record velocity data for multiple tasks
     * 
     * @param records - Array of velocity records
     */
    batchAddVelocityRecords(records: Omit<AgentVelocityRecord, 'timestamp'>[]): void {
      for (const record of records) {
        this.addVelocityRecord(record);
      }
    }

    /**
     * Calculate velocity stats for an agent over a time range
     * 
     * @param agentId - The agent identifier
     * @param startDate - Start date (ISO string)
     * @param endDate - End date (ISO string)
     * @returns Velocity statistics for the specified period
     */
    calculateStats(
      agentId: string,
      startDate: string,
      endDate: string
    ): VelocityStats {
      const records = this.getRecordsForPeriod(agentId, startDate, endDate);
      if (records.length === 0) {
        return {
          averageSpsPerWeek: 0,
          averageHoursPerWeek: 0,
          minSpsPerWeek: 0,
          maxSpsPerWeek: 0,
          stdDevSpsPerWeek: 0,
          calculatedUsing: 'fallback-0.4h/SP',
          calculatedAt: new Date().toISOString(),
        };
      }

      // Calculate SPs per week
      const spPerWeeks = this.calculateSpPerWeek(records);
      const totalSps = spPerWeeks.reduce((sum, spw) => sum + spw.sps, 0);
      const avgSps = totalSps / spPerWeeks.length;
      
      // Calculate hours per week
      const hoursPerWeeks = this.calculateHoursPerWeek(records);
      const totalHours = hoursPerWeeks.reduce((sum, hw) => sum + hw.hours, 0);
      const avgHours = totalHours / hoursPerWeeks.length;

      // Calculate min/max
      const minSps = Math.min(...spPerWeeks.map(r => r.sps));
      const maxSps = Math.max(...spPerWeeks.map(r => r.sps));

      // Calculate std deviation
      const variance = spPerWeeks.reduce((sum, r) => sum + Math.pow(r.sps - avgSps, 2), 0) / spPerWeeks.length;
      const stdDev = Math.sqrt(variance);

      // Determine consistency
      const consistencyRatio = stdDev / avgSps;
      let consistency: 'consistent' | 'fluctuating' | 'unknown';
      if (avgSps === 0) {
        consistency = 'unknown';
      } else if (consistencyRatio < 0.2) {
        consistency = 'consistent';
      } else if (consistencyRatio < 0.5) {
        consistency = 'fluctuating';
      } else {
        consistency = 'unknown';
      }

      return {
        averageSpsPerWeek: avgSps,
        averageHoursPerWeek: avgHours,
        minSpsPerWeek: minSps,
        maxSpsPerWeek: maxSps,
        stdDevSpsPerWeek: stdDev,
        consistency,
        calculatedUsing: agg
berateRange(startDate, endDate),
        calculatedAt: new Date().toISOString(),
      };
    }

    /**
     * Get base velocity (SP per week) for an agent
     * 
     * @param agentId - The agent identifier
     * @param historicalRange - How far back to look (e.g., 'last-2-sprints')
     * @returns Base velocity in SP/week
     */
    getBaseVelocity(
      agentId: string,
      historicalRange: 'last-1-sprint' | 'last-2-sprints' | 'all-time' = 'last-2-sprints'
    ): number {
      const now = new Date();
      let startDate: Date;
      
      switch (historicalRange) {
        case 'last-1-sprint':
          // Assume 2-week sprints
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 14);
          break;
        case 'last-2-sprints':
          // Assume 2-week sprints
          startDate = new Date(now);
          startDate.setDate(startDate.getDate() - 28);
          break;
        case 'all-time':
          startDate = new Date('2025-01-01'); // Start tracking from
          break;
      }

      const stats = this.calculateStats(agentId, startDate.toISOString(), now.toISOString());
      
      if (stats.averageSpsPerWeek === 0) {
        // Fallback to default
        return 40; // SP/week = 0.4h/SP * 100h/week
      }

      return stats.averageSpsPerWeek;
    }

    /**
     * Get recommended throughput factor (hours per SP)
     * 
     * @param agentId - The agent identifier
     * @param historicalRange - How far back to look
     * @returns Recommended hours per SP
     */
    getRecommendedThroughputFactor(
      agentId: string,
      historicalRange: 'last-1-sprint' | 'last-2-sprints' | 'all-time' = 'last-2-sprints'
    ): number {
      const spPerWeek = this.getBaseVelocity(agentId, historicalRange);
      const hoursPerWeek = this.calculateStats(agentId, 
        new Date('2025-01-01').toISOString(), 
        new Date().toISOString()
      ).averageHoursPerWeek || 40; // Default to 40h/week

      return hoursPerWeek / spPerWeek;
    }

    /**
     * Calibrate velocity with confidence scoring
     * 
     * @param agentId - The agent identifier
     * @param historicalRange - How far back to look
     * @param minDataPoints - Minimum data points required for calibration
     * @returns Calibration result with confidence score
     */
    calibrateVelocity(
      agentId: string,
      historicalRange: 'last-1-sprint' | 'last-2-sprints' | 'all-time' = 'last-2-sprints',
      minDataPoints: number = 4
    ): VelocityCalibrationResult {
      const stats = this.calculateStats(agentId, 
        historicalRange === 'all-time' ? new Date('2025-01-01').toISOString() : new Date().toISOString(),
        new Date().toISOString()
      );

      const spPerWeek = stats.averageSpsPerWeek > 0 ? stats.averageSpsPerWeek : 40;
      const confidenceReason = dataConfidence(stats, minDataPoints);

      // Confidence scoring
      let confidence: number;
      if (stats.consistency === 'consistent') {
        confidence = 0.9;
      } else if (stats.consistency === 'fluctuating') {
        confidence = 0.7;
      } else {
        confidence = 0.5;
      }

      // Adjust confidence based on data points
      if (stats.dataPoints) {
        if (stats.dataPoints >= minDataPoints * 2) {
          confidence = Math.min(confidence + 0.1, 1.0);
        } else if (stats.dataPoints < minDataPoints) {
          confidence = Math.max(confidence - 0.15, 0.3);
        }
      }

      const throughputFactor = this.getRecommendedThroughputFactor(agentId, historicalRange);

      // Update last refresh date
      this.lastRefreshDate = new Date();
      this.updateBiweeklyRefreshDate();

      return {
        baseVelocity: spPerWeek,
        confidence: Math.round(confidence * 100) / 100,
        confidenceReason,
        recommendedThroughputFactor: Math.round(throughputFactor * 100) / 100,
        dataPoints: stats.dataPoints || 0,
        recommendedRefreshDate: this.biweeklyRefreshDate.toISOString(),
      };
    }

    /**
     * Check if recalibration is recommended based on elapsed time
     * 
     * @returns Whether recalibration is due
     */
    isRecalibrationDue(): boolean {
      if (!this.lastRefreshDate || !this.biweeklyRefreshDate) {
        return true;
      }
      return new Date() >= this.biweeklyRefreshDate;
    }

    /**
     * Reset velocity data for a specific agent
     * 
     * @param agentId - The agent identifier
     */
    resetAgentData(agentId: string): void {
      this.records.delete(agentId);
      this.statsCache.delete(agentId);
      this.lastRefreshDate = new Date();
      this.updateBiweeklyRefreshDate();
    }

    /**
     * Reset all velocity data
     */
    resetAllData(): void {
      this.records.clear();
      this.statsCache.clear();
      this.lastRefreshDate = new Date();
      this.updateBiweeklyRefreshDate();
    }

    /**
     * Get all error codes and policies.
     * This method should return a string representation of the errors and corresponding solutions.
     */
    getErrorCodesAndPolicies(): string {
      return JSON.stringify({
        VERSION: "1.0.0",
        errors: [
          {
            code: "CALIBRATION_TIMEOUT",
            message: "Velocity calibration timed out while fetching data.",
            policy: "Retry calibration request after a brief delay.",
            actions: [
              "Retry the calibration operation",
              "Check network connectivity to the roster API",
              "Verify the agent has existing velocity data"
            ]
          },
          {
            code: "INSUFFICIENT_DATA_POINTS",
            message: "Cannot calculate velocity - fewer than minimum data points available.",
            policy: "Collect more velocity data before recalibrating.",
            actions: [
              "Wait for more completed tasks in the next sprint",
              "Review task assignments for completeness",
              "Verify data collection is recording all completed tasks"
            ]
          },
          {
            code: "INVALID_TIME_RANGE",
            message: "Calibration requested with invalid start/end dates.",
            policy: "Ensure time range is valid (start <= end).",
            actions: [
              "Validate date inputs",
              "Use current time range defaults if unsure"
            ]
          },
          {
            code: "ROSTER_API_UNAVAILABLE",
            message: "Assignee roster API returned 401 Unauthorized.",
            policy: "Fallback to historical task tracking until roster access is restored.",
            actions: [
              "Contact system administrator to verify roster API credentials",
              "Enable local velocity tracking mode",
              "Monitor for subsequent API access attempts",
              "Log the 401 error for debugging"
            ]
          },
          {
            code: "ZERO_SP_WEEK",
            message: "Base velocity calculated as zero. Using fallback default 40 SP/week.",
            policy: "Fallback to default throughput factor 0.4h/SP until real velocity is established.",
            actions: [
              "Review task completion data for the period",
              "Check if agent is assigned work during this period",
              "Consider using last-1-sprint range instead of all-time",
              "Retry after collecting more data points"
            ]
          }
        ],
        RUNDOWN_CATEGORY: "ERROR_CODES_AND_POLICIES"
      });
    }

    // ===================== PRIVATE HELPERS =====================

    private getRecordsForPeriod(
      agentId: string,
      startDate: string,
      endDate: string
    ): AgentVelocityRecord[] {
      if (!this.records.has(agentId)) {
        return [];
      }

      const records = this.records.get(agentId)!;
      const start = new Date(startDate);
      const end = new Date(endDate);

      return records.filter(record => {
        const ts = new Date(record.timestamp);
        return ts >= start && ts <= end;
      });
    }

    private aggregateRange(startDate: string, endDate: string): string {
      const days = Math.floor(
        (new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (days <= 14) {
        return 'last-1-sprint'; // Assume 2-week sprints
      } else if (days <= 28) {
        return 'last-2-sprints';
      } else if (days <= 56) {
        return 'last-4-sprints';
      } else {
        return 'all-time';
      }
    }

    private calculateSpPerWeek(
      records: AgentVelocityRecord[]
    ): { sps: number; date: string }[] {
      // Group by week
      const weeks = new Map<string, number>();

      for (const record of records) {
        const weekStart = this.getWeekStart(new Date(record.dateRangeStart));
        const weekKey = weekStart.toISOString().slice(0, 10);
        
        weeks.set(weekKey, (weeks.get(weekKey) || 0) + record.storyPoints);
      }

      return Array.from(weeks.entries()).map(([date, sps]) => ({
        sps,
        date,
      })).sort((a, b) => a.date.localeCompare(b.date));
    }

    private calculateHoursPerWeek(
      records: AgentVelocityRecord[]
    ): { hours: number; date: string }[] {
      // Group by week
      const weeks = new Map<string, number>();

      for (const record of records) {
        const weekStart = this.getWeekStart(new Date(record.dateRangeStart));
        const weekKey = weekStart.toISOString().slice(0, 10);
        
        weeks.set(weekKey, (weeks.get(weekKey) || 0) + record.actualHours);
      }

      return Array.from(weeks.entries()).map(([date, hours]) => ({
        hours,
        date,
      })).sort((a, b) => a.date.localeCompare(b.date));
    }

    private getWeekStart(date: Date): Date {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
      return new Date(d.setDate(diff));
    }

    private dataConfidence(stats: VolumeStats, minDataPoints: number): string {
      if (stats.consistency === 'consistent') {
        if (stats.dataPoints && stats.dataPoints >= minDataPoints) {
          return `${stats.dataPoints} data points with consistent performance`;
        }
        return `${stats.dataPoints} data points available`;
      } else if (stats.consistency === 'fluctuating') {
        return `Performance is fluctuating - collect more data`;
      } else {
        return 'Insufficient or inconsistent data';
      }
    }
  }

  /**
   * Global singleton instance
   */
  export const agentVelocityTracker = new AgentVelocityTracker();

  /**
   * Quick helper for backward compatibility
   */
  export function getVelocityTracker(): AgentVelocityTracker {
    return agentVelocityTracker;
  }
}