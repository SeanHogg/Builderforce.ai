/**
 * Conflict Detection Rules and Alerts - Main Entry Point
 * 
 * This module provides the Conflict Detection system for the Builderforce.ai platform.
 * It includes:
 * - Conflict detection engine
 * - Conflict alert entity with factory methods
 * - Conflict rule specification
 * - REST API endpoints for conflict detection and management
 * - Type definitions
 */

export {
  ConflictAlert,
  ConflictSeverity,
  ConflictStatus,
  PriorityLevel,
  ListConflictsQuery,
  ResolveConflictRequest
} from './conflict-alert.entity.js';

export type {
  Stakeholder,
  Team,
  PriorityRequest,
  ConflictingPriorities,
  ConflictKey,
  ConflictRule,
  ConflictAlert as IConflictAlert,
  DetectConflictsRequest,
  DetectConflictsResponse
} from './conflict-rule.spec.js';

export {
  ConflictAlertFactory,
  generateConflictKey,
  parseConflictKey,
  buildConflictingPriorities
} from './conflict-alert.entity.js';

export {
  ConflictDetectionService,
  conflictDetectionService
} from './conflict-detector.service.js';

export {
  registerConflictDetectionRoutes,
  ConflictRuleSpec
} from './api.js';

export {
  CONFLICT_RULE_SPEC,
  validateRequestsForConflictDetection,
  evaluateAgainstRule,
  getRuleSpecification
} from './conflict-rule.spec.js';

export * from './types.js';

/**
 * Quick start example
 * 
 * Example usage:
 * 
 * ```typescript
 * import { ConflictDetectionService } from './conflict-detector.service.js';
 * import { registerConflictDetectionRoutes } from './api.js';
 * 
 * // Initialize service
 * const detector = new ConflictDetectionService();
 * 
 * // Register API routes
 * fastify.register(registerConflictDetectionRoutes, {
 *   prefix: '/api/conflicts'
 * });
 * 
 * // Detect conflicts
 * const result = detector.detectConflicts({
 *   requests: [
 *     {
 *       id: 'req-001',
 *       title: 'Increase feature capacity',
 *       priority: 'P0',
 *       stakeholderId: 'alice',
 *       stakeholder: { name: 'Alice', role: 'Product Manager' },
 *       teamId: 'engineering',
 *       team: { name: 'Engineering' },
 *       createdAt: new Date().toISOString()
 *     },
 *     {
 *       id: 'req-002',
 *       title: 'Database scaling',
 *       priority: 'P0',
 *       stakeholderId: 'bob',
 *       stakeholder: { name: 'Bob', role: 'Engineering Manager' },
 *       teamId: 'engineering',
 *       team: { name: 'Engineering' },
 *       createdAt: new Date().toISOString()
 *     }
 *   ]
 * });
 * 
 * console.log('Conflicts detected:', result.conflicts);
 * ```
 */

// Version
export const VERSION = '1.0.0';

// Rule specification (re-export for convenience)
export const CONFLICT_RULE = CONFLICT_RULE_SPEC;