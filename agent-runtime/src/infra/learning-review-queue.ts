/**
 * learning-review-queue.ts — Core types, queue store, and review actions.
 *
 * Implements the human-in-the-loop review system for extracted learnings
 * (FR-1 through FR-7 of the Learning Review Queue PRD):
 *   - Paginated, filterable/sortable review queue (FR-1)
 *   - Approve / Reject / Edit / Merge / Lock (FR-2, FR-1.4)
 *   - Routing via Builderforce approval-gate (FR-1.5)
 *   - Group management (FR-6)
 *   - SLA tracking with escalation (FR-7)
 *
 * Does NOT own:
 *   - Extraction / ingestion  → assumed to call queue.ingest()
 *   - Knowledge-base storage  → approved learnings are promoted via callbacks
 *   - Audit log persistence    → all actions are written via approvalGate audit trail
 */

import { logDebug, logInfo, logWarn } from "../logger.js";
import { approvalGate } from "./approval-gate.js";

// ── Public re-exports ──────────────────────────────────────────────────────────

export {
  type ApprovalAction,
  type ApproveOptions,
  type EditOptions,
  type MergeOptions,
  type RejectOptions,
  type LearningReviewQueue,
  type QueueStats,
  createLearningReviewQueue,
  DEFAULT_LOCK_TTL_MS,
  DEFAULT_SLA_HIGH_MS,
  DEFAULT_SLA_LOW_MS,
  DEFAULT_SLA_MEDIUM_MS,
} from "./learning-review-queue.store.js";