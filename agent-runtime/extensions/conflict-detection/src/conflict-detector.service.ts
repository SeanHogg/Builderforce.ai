/**
 * Conflict Detector Service
 * Core conflict detection engine with deduplication and alert management
 */

import { v4 as uuidv4 } from 'uuid';
import type { 
  ConflictAlert, 
  StakeholderRequest, 
  ConflictDetectionResult,
  ConflictStatus,
  ListConflictsQuery,
  ResolveConflictRequest
} from './types.js';
import { conflictRules, getRuleById } from './conflict-rule.spec.js';

/**
 * Creates a request-scoped conflict detector
 * Each request gets its own instance to avoid shared state issues
 */
export function createConflictDetector() {
  // Request-scoped storage (not singleton)
  const alerts = new Map<string, ConflictAlert>();
  
  /**
   * Generate a deterministic conflict key for deduplication
   * Uses safe delimiter that won't break on ids containing '__'
   */
  function generateConflictKey(
    ruleId: string,
    teamId: string,
    reviewWindowId: string,
    stakeholderIds: string[]
  ): string {
    // Sort stakeholder IDs for deterministic key
    const sortedStakeholders = [...stakeholderIds].sort();
    // Use URL-safe delimiter
    return `${ruleId}||${teamId}||${reviewWindowId}||${sortedStakeholders.join('|')}`;
  }
  
  /**
   * Check if an identical conflict already exists (deduplication)
   */
  function conflictExists(
    ruleId: string,
    teamId: string,
    reviewWindowId: string,
    stakeholderIds: string[]
  ): boolean {
    const key = generateConflictKey(ruleId, teamId, reviewWindowId, stakeholderIds);
    return Array.from(alerts.values()).some(
      alert => 
        alert.ruleId === ruleId && 
        alert.labels.some(l => l.type === 'team' && l.value === teamId) &&
        alert.labels.some(l => l.type === 'review-window' && l.value === reviewWindowId) &&
        stakeholderIds.every(sid => 
          alert.labels.some(l => l.type === 'stakeholder' && l.value === sid)
        ) &&
        alert.status !== 'dismissed'
    );
  }
  
  /**
   * Detect conflicts in the provided requests
   * Applies all enabled rules and generates alerts
   */
  function detect(
    requests: StakeholderRequest[],
    options: { rules?: string[] } = {}
  ): ConflictDetectionResult {
    const enabledRules = options.rules || conflictRules.map(r => r.id);
    const detectedConflicts: ConflictAlert[] = [];
    
    for (const ruleId of enabledRules) {
      const rule = getRuleById(ruleId);
      if (!rule) continue;
      
      const ruleConflicts = rule.detect(requests);
      
      for (const conflict of ruleConflicts) {
        const teamLabel = conflict.labels.find(l => l.type === 'team');
        const windowLabel = conflict.labels.find(l => l.type === 'review-window');
        const stakeholderLabels = conflict.labels.filter(l => l.type === 'stakeholder');
        
        const teamId = teamLabel?.value || '';
        const reviewWindowId = windowLabel?.value || '';
        const stakeholderIds = stakeholderLabels.map(l => l.value);
        
        // Deduplication check - include versionId in check
        const versionIds = conflict.priorityVersionIds;
        for (const versionId of versionIds) {
          if (conflictExists(ruleId, teamId, reviewWindowId, stakeholderIds)) {
            continue; // Skip duplicate
          }
        }
        
        // Store the alert
        alerts.set(conflict.id, conflict);
        detectedConflicts.push(conflict);
      }
    }
    
    return {
      conflicts: detectedConflicts,
      processedRequests: requests.length,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Get all conflicts with optional filtering
   */
  function list(query: ListConflictsQuery = {}): ConflictAlert[] {
    let result = Array.from(alerts.values());
    
    if (query.status) {
      result = result.filter(a => a.status === query.status);
    }
    if (query.teamId) {
      result = result.filter(a => 
        a.labels.some(l => l.type === 'team' && l.value === query.teamId)
      );
    }
    if (query.stakeholderId) {
      result = result.filter(a => 
        a.labels.some(l => l.type === 'stakeholder' && l.value === query.stakeholderId)
      );
    }
    if (query.reviewWindowId) {
      result = result.filter(a => 
        a.labels.some(l => l.type === 'review-window' && l.value === query.reviewWindowId)
      );
    }
    
    // Sort by detection date, newest first
    result.sort((a, b) => 
      new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime()
    );
    
    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 50;
    
    return result.slice(offset, offset + limit);
  }
  
  /**
   * Get a single conflict by ID
   */
  function getById(id: string): ConflictAlert | undefined {
    return alerts.get(id);
  }
  
  /**
   * Resolve a conflict (manual resolution by conflict resolver)
   */
  function resolve(request: ResolveConflictRequest): ConflictAlert | undefined {
    const alert = alerts.get(request.conflictId);
    if (!alert) return undefined;
    
    alert.status = request.resolution === 'resolved' ? 'resolved' : 
                   request.resolution === 'acknowledged' ? 'acknowledged' : 'dismissed';
    alert.resolvedAt = new Date().toISOString();
    alert.resolvedBy = request.resolvedBy;
    
    alerts.set(alert.id, alert);
    return alert;
  }
  
  /**
   * Get conflict statistics
   */
  function getStats(): { total: number; byStatus: Record<ConflictStatus, number> } {
    const allAlerts = Array.from(alerts.values());
    const byStatus: Record<ConflictStatus, number> = {
      detected: 0,
      acknowledged: 0,
      resolved: 0,
      dismissed: 0
    };
    
    for (const alert of allAlerts) {
      byStatus[alert.status]++;
    }
    
    return {
      total: allAlerts.length,
      byStatus
    };
  }
  
  return {
    detect,
    list,
    getById,
    resolve,
    getStats
  };
}

/**
 * Default export - creates a new detector instance
 */
export default createConflictDetector;
