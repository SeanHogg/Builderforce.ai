/**
 * Conflict Detection Rules and Alerts - Main Entry Point
 *
 * Implements the PRD deliverables:
 * - Conflict detection engine (ConflictDetectionService)
 * - Conflict rule spec (CONFLICT_RULE_SPEC / CONFLICT_RULE_SPEC_EXTENDED)
 * - Conflict alert entity + DTO (ConflictAlert, ConflictAlertFactory, ConflictKey, ...)
 * - Conflict detection + list APIs (registerConflictDetectionRoutes)
 * - OpenAPI docs, sample payloads
 */

import { CONFLICT_RULE_SPEC } from './conflict-rule.spec.js';

// ── Entity / factory ──────────────────────────────────────────────────────────
export {
  ConflictAlertFactory,
  generateConflictKey,
  parseConflictKey,
  buildConflictingPriorities,
  ConflictSeverity as ConflictSeverityConst,
  ConflictStatus as ConflictStatusConst,
  PriorityLevel as PriorityLevelConst,
} from './conflict-alert.entity.js';

// ── Types / DTOs ──────────────────────────────────────────────────────────────
export type {
  ConflictAlert,
  ConflictKey,
  ConflictingPriorities,
  Stakeholder,
  Team,
  PriorityLevel,
  ConflictStatus,
  ConflictSeverity,
  PriorityRequest,
  DetectConflictsRequest,
  DetectConflictsResponse,
  ListConflictsQuery,
  ResolveConflictRequest,
  ResolveConflictResponse,
  ConflictRule,
  GetConflictResponse,
  ListConflictsResponse,
  ApiResponse,
  ApiSuccessResponse,
  ApiErrorResponse,
  HealthCheckResponse,
} from './types.js';

// ── Service ───────────────────────────────────────────────────────────────────
export {
  ConflictDetectionService,
  conflictDetectionService,
  clearConflictStore,
  getConflictStore,
} from './conflict-detector.service.js';

// ── API ───────────────────────────────────────────────────────────────────────
export {
  registerConflictDetectionRoutes,
  schemas,
  getRuleSpecification,
  ConflictRuleSpec,
  CONFLICT_RULE_SPEC,
} from './api.js';

// ── Rule spec ─────────────────────────────────────────────────────────────────
export {
  CONFLICT_RULE_SPEC as CONFLICT_RULE_SPEC_FROM_RULE_MODULE,
  CONFLICT_RULE_SPEC_EXTENDED,
  comparePriorities,
  isPriorityAtOrAbove,
  validateRequestsForConflictDetection,
  parseReviewWindow,
  windowsOverlap,
  evaluateAgainstRule,
  type ReviewWindow,
} from './conflict-rule.spec.js';

// ── Version + convenience alias ───────────────────────────────────────────────
export const VERSION = '1.0.0';

/**
 * Convenience alias matching earlier docs: canonical rule.
 */
export const CONFLICT_RULE = CONFLICT_RULE_SPEC;
