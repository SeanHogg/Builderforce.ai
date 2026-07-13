/**
 * Backlog Scan Persistence Layer
 * Manages scan results, schedules, and audit logs using JSON/JSON-lines
 * Designed for embeddable usage in BuilderForce gateway
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  ScanResult,
  ScanSchedule,
  ScanAuditLog,
  IdentifiedWorkItem,
  ScanConfig,
} from './scan-types.js';

const BACKLOG_SCAN_DIR = 'backlog-scans';

/**
 * Memory cache for scan results (LRU-like behavior)
 */
class ScanResultCache {
  private cache = new Map<string, {
    result: ScanResult;
    timestamp: Date;
  }>();
  private maxEntries = 500;

  set(scanId: string, result: ScanResult): void {
    this.cache.set(scanId, { result, timestamp: new Date() });
    
    // Trim cache if needed
    if (this.cache.size > this.maxEntries) {
      // Keep only newest N entries
      const entries = Array.from(this.cache.entries())
        .sort((a, b) => b[1].timestamp.getTime() - a[1].timestamp.getTime())
        .slice(this.maxEntries);
      
      this.cache = new Map(entries);
    }
  }

  get(scanId: string): ScanResult | undefined {
    const entry = this.cache.get(scanId);
    if (entry) {
      entry.timestamp = new Date(); // Keep warm
      return entry.result;
    }
    return undefined;
  }

  has(scanId: string): boolean {
    return this.cache.has(scanId);
  }

  getAll(limit?: number): ScanResult[] {
    const entries = Array.from(this.cache.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
    
    return limit ? entries.slice(0, limit).map(e => e.result) : entries.map(e => e.result);
  }
}

const cache = new ScanResultCache();

/**
 * File persistence for scan results
 */
interface ScanResultMetadata {
  scanId: string;
  fileName: string;
  created_at: string;
  source: 'memory' | 'disk';
  last_accessed: string;
}

/**
 * Load scan result from file system
 */
async function loadScanFromDisk(scanId: string, dataDir: string): Promise<ScanResult | null> {
  try {
    const file = path.join(dataDir, `${scanId}.jsonl`);
    const lines = await fs.readFile(file, 'utf-8');
    const entries: ScanResult[] = [];
    
    for (const line of lines.trim().split('\n')) {
      if (line.trim()) {
        entries.push(JSON.parse(line));
      }
    }
    
    if (entries.length === 0) {
      return null;
    }
    
    // Combine multiple entries (e.g., incremental)
    return combineScanResults(entries);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Combine multiple scan result entries into one
 */
function combineScanResults(entries: ScanResult[]): ScanResult {
  if (entries.length === 0) throw new Error('Empty scan results');
  
  const totalItems = entries.reduce((sum, e) => sum + e.totalItems, 0);
  const newItems = entries.flatMap(e => e.newOrChangedItems);
  const combined = entries[0];
  
  return {
    ...combined,
    totalItems: totalItems > 0 ? totalItems : combined.totalItems,
    newOrChangedItems: newItems.length > 0 ? newItems : combined.newOrChangedItems,
    summary: {
      totalNew: newItems.length,
      highPriorityCount: newItems.filter(i => i.priority === 'high' || i.priority === 'critical').length,
      byType: {
        new_project: newItems.filter(i => i.confidence > 0.7).length,
        growth: newItems.filter(i => i.confidence > 0.5).length,
        efficiency: newItems.filter(i => i.confidence > 0.6).length,
        compliance: newItems.filter(i => i.confidence > 0.7).length,
        other: newItems.filter(i => i.confidence > 0.4).length,
      },
    },
    rawItems: entries.flatMap(e => e.rawItems),
  };
}

/**
 * Save scan result to file system
 */
async function saveScanToDisk(result: ScanResult, dataDir: string): Promise<void> {
  const filePath = path.join(dataDir, `${result.scanId}.jsonl`);
  
  const writeStream = await fs.open(filePath, 'w');
  await writeStream.write(JSON.stringify(result, null, 2) + '\n');
  await writeStream.close();
}

/**
 * Audit log persistence
 */
interface AuditLogMetadata {
  logId: string;
  timestamp: string;
  operation: string;
  scanId?: string;
}

/**
 * Scan Persistence Service
 */
export class ScanPersistenceService {
  private dataDir: string;

  constructor(dataDir = path.join(process.cwd(), BACKLOG_SCAN_DIR)) {
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
    } catch (err) {
      // Already exists or permission error - continue
    }
  }

  /**
   * Generate a unique scan ID
   */
  generateScanId(): string {
    return `scan-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a unique log ID
   */
  generateLogId(): string {
    return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate a unique schedule ID
   */
  generateScheduleId(): string {
    return `schedule-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Save or update scan result
   */
  async saveScanResult(result: ScanResult): Promise<void> {
    // Save to cache
    cache.set(result.scanId, result);
    
    // Also save to disk
    await saveScanToDisk(result, this.dataDir);
  }

  /**
   * Get scan result (from cache or disk)
   */
  async getScanResult(scanId: string): Promise<ScanResult | null> {
    // Check cache first
    const cached = cache.get(scanId);
    if (cached) {
      return cached;
    }
    
    // Try to load from disk
    return loadScanFromDisk(scanId, this.dataDir);
  }

  /**
   * List scans (paginated)
   */
  async listScans(limit?: number): Promise<ScanResult[]> {
    // Use cache for quick access
    return cache.getAll(limit);
  }

  /**
   * Get most recent scans
   */
  async getRecentScans(limit = 10): Promise<ScanResult[]> {
    return cache.getAll(limit);
  }

  /**
   * Save audit log entry
   */
  async saveAuditLog(log: ScanAuditLog): Promise<void> {
    const logDir = path.join(this.dataDir, 'audit');
    await fs.mkdir(logDir, { recursive: true });
    
    const filePath = path.join(logDir, `${log.id}.jsonl`);
    const content = JSON.stringify(log, null, 2) + '\n';
    await fs.appendFile(filePath, content);
  }

  /**
   * Get audit logs for a scan or schedule
   */
  async getAuditLogs(scanId?: string, scheduleId?: string, limit = 100): Promise<ScanAuditLog[]> {
    const logDir = path.join(this.dataDir, 'audit');
    const files = await fs.readdir(logDir);
    const entries: ScanAuditLog[] = [];
    
    for (const file of files) {
      const logPath = path.join(logDir, file);
      const content = await fs.readFile(logPath, 'utf-8');
      
      for (const line of content.trim().split('\n')) {
        if (!line.trim()) continue;
        
        const logEntry = JSON.parse(line);
        
        const matches =
          (!scanId || logEntry.scanId === scanId) &&
          (!scheduleId || logEntry.scheduleId === scheduleId);
        
        if (matches) {
          entries.push(logEntry);
        }
      }
    }
    
    return entries
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Delete scan result and associated logs
   */
  async deleteScan(scanId: string): Promise<void> {
    // Remove from cache
    const hasEntry = cache.has(scanId);
    if (hasEntry) {
      const result = await this.getScanResult(scanId);
      if (result) {
        cache.delete(scanId);
      }
    }
    
    // Remove disk file
    const diskFile = path.join(this.dataDir, `${scanId}.jsonl`);
    await fs.unlink(diskFile).catch(() => {});
  }

  /**
   * Delete all scans older than a given date
   */
  async pruneOldScans(beforeDate: Date): Promise<number> {
    const files = await fs.readdir(this.dataDir);
    let deletedCount = 0;
    
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      
      const filePath = path.join(this.dataDir, file);
      const stat = await fs.stat(filePath);
      
      if (stat.mtime < beforeDate) {
        await fs.unlink(filePath);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }
}

/**
 * In-memory schedule store (replace with DB in production)
 */
interface ScheduleState {
  byId = new Map<string, ScanSchedule>();
  byOwner = new Map<string, ScanSchedule[]>();
}

const scheduleStore = new ScheduleState();

/**
 * Schedule Scope
 */
interface ScheduleScope {
  /** Default directory for scan data */
  dataDir: string;
  
  /** Default owner for scan results */
  defaultOwner: {
    userId: string;
    name: string;
  };
}

/**
 * Scan Schedule Service
 */
export class ScanScheduleService {
  private dataDir: string;
  private defaultOwner: ScheduleScope['defaultOwner'];
  private persistence: ScanPersistenceService;

  constructor(params: ScheduleScope & { persistence?: ScanPersistenceService }) {
    this.dataDir = params.dataDir;
    this.defaultOwner = params.defaultOwner;
    this.persistence = params.persistence || new ScanPersistenceService(params.dataDir);
  }

  /**
   * Create a new scan schedule
   */
  createSchedule(schedule: Omit<ScanSchedule, 'id' | 'lastExecutedAt' | 'nextScheduledAt'>): ScanSchedule {
    const id = this.persistence.generateScheduleId();
    
    const newSchedule: ScanSchedule = {
      ...schedule,
      id,
      active: schedule.active ?? true,
      owner: schedule.owner || this.defaultOwner,
      alertThreshold: schedule.alertThreshold ?? 0,
      notificationChannels: schedule.notificationChannels || ['email'],
      nextScheduledAt: this.calculateNextScheduledAt(schedule),
    };
    
    scheduleStore.byId.set(id, newSchedule);
    
    // Add to owner's schedule list
    const ownerSchedules = scheduleStore.byOwner.get(newSchedule.owner.userId);
    if (ownerSchedules) {
      ownerSchedules.push(newSchedule);
    } else {
      scheduleStore.byOwner.set(newSchedule.owner.userId, [newSchedule]);
    }
    
    return newSchedule;
  }

  /**
   * Get schedule by ID
   */
  getSchedule(id: string): ScanSchedule | undefined {
    return scheduleStore.byId.get(id);
  }

  /**
   * List schedules for a user
   */
  getSchedulesByOwner(userId: string): ScanSchedule[] {
    return scheduleStore.byOwner.get(userId) || [];
  }

  /**
   * List all active schedules
   */
  listActiveSchedules(): ScanSchedule[] {
    return Array.from(scheduleStore.byId.values()).filter(s => s.active);
  }

  /**
   * Update schedule configuration
   */
  updateSchedule(
    id: string,
    updates: Partial<Omit<ScanSchedule, 'id' | 'created_at' | 'lastExecutedAt' | 'nextScheduledAt' | 'owner'>>
  ): ScanSchedule | undefined {
    const schedule = scheduleStore.byId.get(id);
    if (!schedule) return undefined;
    
    const updated = {
      ...schedule,
      frequency: updates.frequency ?? schedule.frequency,
      cronExpression: updates.cronExpression ?? schedule.cronExpression,
      timeZone: updates.timeZone ?? schedule.timeZone,
      alertThreshold: updates.alertThreshold ?? schedule.alertThreshold,
      notificationChannels: updates.notificationChannels ?? schedule.notificationChannels,
      scope: updates.scope ?? schedule.scope,
      stopAfterNew: updates.stopAfterNew ?? schedule.stopAfterNew,
      active: updates.active !== undefined ? updates.active : schedule.active,
    };
    
    scheduleStore.byId.set(id, updated);
    
    return updated;
  }

  /**
   * Disables a schedule
   */
  disableSchedule(id: string): ScanSchedule | undefined {
    return this.updateSchedule(id, { active: false });
  }

  /**
   * Calculates next scheduled time based on frequency and cron expression
   */
  private calculateNextScheduledAt(schedule: ScanSchedule): Date | undefined {
    if (schedule.cronExpression) {
      // If cron expression is provided, use it
      const next = this.cronNext(schedule.cronExpression);
      return next;
    }
    
    // Default frequency-based scheduling
    const now = new Date();
    const tz = schedule.timeZone || 'UTC';
    
    switch (schedule.frequency) {
      case 'hourly':
        return new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
      case 'daily':
        return new Date(now.setHours(0, 0, 0, 0));
      case 'weekly':
        // Simple weekly schedule: next Sunday at midnight
        const dayOfWeek = now.getDay();
        const daysUntilSunday = 7 - dayOfWeek;
        return new Date(now.setDate(now.getDate() + daysUntilSunday));
      case 'monthly':
        // First of next month
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return nextMonth;
      default:
        return undefined;
    }
  }

  /**
   * Cron expression parser (simplified)
   */
  private cronNext(cron: string): Date | undefined {
    // Basic parsing: minute hour day month weekday
    const parts = cron.split(/\s+/);
    if (parts.length !== 5) return undefined;
    
    const [minute, hour, day, month, weekday] = parts.map(p => {
      if (p === '*') return -1; // wildcard
      return parseInt(p, 10);
    });
    
    const now = new Date();
    let next = new Date(now);
    
    // Simple implementation: add 1 hour and repeat until all conditions pass
    while (true) {
      next = new Date(next.getTime() + 60 * 60 * 1000);
      
      const m = next.getMinutes();
      const h = next.getHours();
      const d = next.getDate();
      const mon = next.getMonth();
      const w = next.getDay();
      
      const matchesHour = hour === -1 || h === hour;
      const matchesDay = day === -1 || d === day;
      const matchesMonth = month === -1 || mon === (month - 1);
      const matchesWeekday = weekday === -1 || w === weekday;
      
      if (matchesHour && matchesDay && matchesMonth && matchesWeekday) {
        return next;
      }
    }
  }
}