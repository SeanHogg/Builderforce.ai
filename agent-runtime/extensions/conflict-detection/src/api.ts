/**
 * Conflict Detection API
 * REST API endpoints for conflict detection and management
 */

import type { 
  StakeholderRequest, 
  ConflictDetectionResult,
  ConflictAlert,
  ListConflictsQuery,
  ResolveConflictRequest
} from './types.js';
import { createConflictDetector } from './conflict-detector.service.js';

/**
 * Request-scoped API instance
 * Each API call gets its own detector to avoid shared state
 */
export function createConflictApi() {
  const detector = createConflictDetector();
  
  /**
   * POST /conflicts/detect
   * Trigger conflict detection on the provided requests
   */
  async function detectConflicts(
    requests: StakeholderRequest[],
    options?: { rules?: string[] }
  ): Promise<ConflictDetectionResult> {
    return detector.detect(requests, options);
  }
  
  /**
   * GET /conflicts
   * List conflicts with optional filtering
   */
  async function listConflicts(query: ListConflictsQuery = {}): Promise<{
    conflicts: ConflictAlert[];
    total: number;
    query: ListConflictsQuery;
  }> {
    const conflicts = detector.list(query);
    const stats = detector.getStats();
    
    return {
      conflicts,
      total: stats.total,
      query
    };
  }
  
  /**
   * GET /conflicts/:id
   * Get a specific conflict by ID
   */
  async function getConflict(id: string): Promise<ConflictAlert | null> {
    const conflict = detector.getById(id);
    return conflict || null;
  }
  
  /**
   * POST /conflicts/:id/resolve
   * Manually resolve a conflict (conflict resolver action)
   */
  async function resolveConflict(
    id: string,
    request: Omit<ResolveConflictRequest, 'conflictId'>
  ): Promise<ConflictAlert | null> {
    return detector.resolve({
      conflictId: id,
      ...request
    });
  }
  
  /**
   * GET /conflicts/stats
   * Get conflict statistics
   */
  async function getStats(): Promise<{
    total: number;
    byStatus: Record<string, number>;
  }> {
    return detector.getStats();
  }
  
  return {
    detectConflicts,
    listConflicts,
    getConflict,
    resolveConflict,
    getStats
  };
}

/**
 * Default export
 */
export default createConflictApi;
