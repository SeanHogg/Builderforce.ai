/**
 * learning-review-queue.store.ts — Core types, queue store, and review actions.
 *
 * Stores the in-memory review queue for extracted learnings, providing
 * approve/reject/edit/merge/lock semantics with the Builderforce approvals
 * framework integration.
 *
 * @packageDocumentation
 */

import { logDebug, logInfo, logWarn } from "../logger.js";

// ── Base types ────────────────────────────────────────────────────────────────

/** Unique learning identifier (UUID). */
export type LearningId = string;

/** Confidence threshold band driving routing behaviour (FR-3.4). */
export type ConfidenceBand = "HIGH" | "MEDIUM" | "LOW";

/** Conflict type detected against baseline (FR-4.2). */
export type ConflictType = "direct_negation" | "partial_overlap" | "temporal_supersession";

/** Resolution action for a contradicted learning (FR-4.4). */
export type ContradictionResolution =
  | "keep_new"
  | "keep_baseline"
  | "merge_reconcile"
  | "defer";

/** Status a queue item can have. */
export type LearningStatus =
  | "pending"
  | "locked"
  | "approved"
  | "rejected"
  | "merged"
  | "contradiction"
  | "auto_approved";

/**
 * Rejection reason category (FR-2.2).
 */
export type RejectionCategory =
  | "inaccurate"
  | "irrelevant"
  | "duplicate"
  | "low_confidence"
  | "spam"
  | "policy_violation"
  | "other";

/** A learning entry in the review queue. */
export interface LearningItem {
  id: LearningId;
  /** The learning text extracted from a workflow. */
  text: string;
  /** Source workflow context. */
  source: {
    workflowId: string;
    step: string;
    timestamp: string; // ISO-8601
    extractionModel: string;
  };
  /** Topic/tag annotations. */
  tags: string[];
  /** Confidence score 0.00–1.00 (FR-3.1). */
  confidenceScore: number;
  /** Explanation payload for the confidence score (FR-3.5). */
  confidenceExplanation: Record<string, number>;
  /** Current status in the queue. */
  status: LearningStatus;
  /** When this item entered the queue. */
  createdAt: string; // ISO-8601
  /** When the status last changed. */
  updatedAt: string; // ISO-8601
  /** Reviewer who claimed/locked this item. */
  lockedBy?: string;
  /** When the lock expires (ISO-8601). */
  lockExpiresAt?: string;
  /** Reviewer identity who performed the last action. */
  reviewedBy?: string;
  /** Rejection reason, populated when status === "rejected" (FR-2.2). */
  rejectionReason?: {
    text: string;
    category: RejectionCategory;
  };
  /** Conflict flags against baseline (FR-4.1–4.2). */
  conflicts: Array<{
    baselineEntryId: string;
    conflictType: ConflictType;
    similarityScore: number;
  }>;
  /** Candidate duplicate learning IDs (≥ 0.90 similarity — FR-5.2). */
  duplicateCandidates: LearningId[];
  /** Near-duplicate / related learning IDs (0.75–0.89 — FR-5.3). */
  relatedCandidates: LearningId[];
  /** Suggested group memberships (FR-6.1). */
  suggestedGroupIds: string[];
  /** Group memberships (FR-6.5). */
  groupIds: string[];
  /** Suppressed source count for exact-hash dedup (FR-5.4). */
  suppressedSourceCount: number;
  /** SLA deadline for review (ISO-8601 — FR-7.2). */
  slaDeadline?: string;
  /** Whether an SLA escaltion has been triggered. */
  slaEscalated: boolean;
  /** Original extraction text before any edits (FR-2.3). */
  originalText?: string;
}

/** A curated group of related learnings (FR-6). */
export interface LearningGroup {
  id: string;
  name: string;
  description: string;
  ownerRole: string;
  /** Learning IDs that are members of this group. */
  memberIds: LearningId[];
  /** Automated coherence score (0–1). */
  coherenceScore: number;
  createdAt: string;
  updatedAt: string;
  /** Whether this group has been published (FR-6.4). */
  published: boolean;
}

/** Queue filter parameters (FR-1.1). */
export interface QueueFilter {
  confidenceMin?: number;
  confidenceMax?: number;
  status?: LearningStatus | LearningStatus[];
  tags?: string[];
  sourceWorkflowId?: string;
  conflictStatus?: "conflicted" | "clean";
  groupId?: string;
}

/** Queue sort parameters (FR-1.1). */
export interface QueueSort {
  field: "confidenceScore" | "createdAt" | "updatedAt" | "status" | "slaDeadline";
  direction: "asc" | "desc";
}

/** Paginated queue result. */
export interface PaginatedQueue {
  items: LearningItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/** Statistics about the review queue. */
export interface QueueStats {
  pending: number;
  locked: number;
  autoApproved: number;
  approved: number;
  rejected: number;
  merged: number;
  contradiction: number;
  escalated: number;
  avgConfidence: number;
  oldestPending: string | null;
}

// ── Action types ──────────────────────────────────────────────────────────────

export interface ApproveOptions {
  learningId: LearningId;
  reviewerId: string;
  /** Optional override — e.g. auto-approval system actor. */
  isAutoApproval?: boolean;
}

export interface RejectOptions {
  learningId: LearningId;
  reviewerId: string;
  reason: string;
  category: RejectionCategory;
}

export interface EditOptions {
  learningId: LearningId;
  reviewerId: string;
  newText: string;
  newTags?: string[];
  newConfidenceScore?: number;
  newConfidenceExplanation?: Record<string, number>;
}

export interface MergeOptions {
  sourceIds: LearningId[];
  targetText: string;
  targetTags: string[];
  mergedBy: string;
}

export interface LockOptions {
  learningId: LearningId;
  reviewerId: string;
  ttlMs?: number;
}

export interface ResolveContradictionOptions {
  learningId: LearningId;
  reviewerId: string;
  resolution: ContradictionResolution;
  /** Text for merge/reconcile resolution. */
  reconciledText?: string;
  /** Defer commentary. */
  deferComment?: string;
}

// ── Routing config (FR-1.5) ───────────────────────────────────────────────────

export interface RoutingRule {
  /** Match on a tag/domain prefix. */
  domainTag?: string;
  /** Lower bound for confidence band match. */
  confidenceMin?: number;
  /** Upper bound for confidence band match. */
  confidenceMax?: number;
  /** The approver pool / team key to route to. */
  routeToPool: string;
  /** If true, items matching can auto-approve when confidence >= 0.85 and policy permits. */
  allowAutoApprove?: boolean;
}

export interface ReviewQueueConfig {
  /** Default lock TTL in ms (FR-1.4). Default 15 minutes. */
  lockTtlMs?: number;
  /** SLA deadlines by confidence band (ms). */
  slaHighMs?: number;   // default 1 hour
  slaMediumMs?: number; // default 4 hours
  slaLowMs?: number;    // default 24 hours
  /** Routing rules for the approvals framework (FR-1.5). */
  routingRules?: RoutingRule[];
  /** Callback when a learning is approved (promoted to knowledge base). */
  onApproved?: (item: LearningItem) => void | Promise<void>;
  /** Callback when a contradiction is resolved. */
  onContradictionResolved?: (resolution: ResolveContradictionOptions, item: LearningItem) => void | Promise<void>;
  /** Callback when SLA escalation fires (FR-7.2). */
  onSlaEscalation?: (item: LearningItem) => void | Promise<void>;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Default lock TTL: 15 minutes. */
export const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_SLA_HIGH_MS = 1 * 60 * 60 * 1000;    // 1 hour
export const DEFAULT_SLA_MEDIUM_MS = 4 * 60 * 60 * 1000;   // 4 hours
export const DEFAULT_SLA_LOW_MS = 24 * 60 * 60 * 1000;     // 24 hours

// ── Queue store ────────────────────────────────────────────────────────────────

/**
 * In-memory learning review queue.
 *
 * All operations are synchronous and throw on invalid transitions.
 * Persistent storage is the caller's responsibility (call .snapshot()).
 */
export interface LearningReviewQueue {
  /** Clear all state. */
  reset(): void;
  /** Ingest a new learning into the queue (FR-1). */
  ingest(item: Omit<LearningItem, "id" | "createdAt" | "updatedAt" | "status" | "slaEscalated" | "suppressedSourceCount" | "duplicateCandidates" | "relatedCandidates" | "suggestedGroupIds" | "groupIds" | "conflicts"> & { id?: LearningId }): LearningItem;

  // ── Queue querying (FR-1.1, FR-1.2) ─────────────────────────────────────
  list(filter?: QueueFilter, sort?: QueueSort, page?: number, pageSize?: number): PaginatedQueue;
  getById(id: LearningId): LearningItem | undefined;
  stats(): QueueStats;

  // ── Review actions (FR-2) ────────────────────────────────────────────────
  approve(opts: ApproveOptions): LearningItem;
  reject(opts: RejectOptions): LearningItem;
  edit(opts: EditOptions): LearningItem;
  merge(opts: MergeOptions): LearningItem[];
  lock(opts: LockOptions): LearningItem;
  unlock(learningId: LearningId, reviewerId: string): LearningItem;
  /** Release expired locks (FR-1.4). Call periodically or on each list(). */
  releaseExpiredLocks(): number;

  // ── Contradiction resolution (FR-4) ──────────────────────────────────────
  resolveContradiction(opts: ResolveContradictionOptions): LearningItem;

  // ── Group management (FR-6) ──────────────────────────────────────────────
  createGroup(name: string, description?: string, ownerRole?: string): LearningGroup;
  getGroup(id: string): LearningGroup | undefined;
  listGroups(): LearningGroup[];
  renameGroup(id: string, name: string): LearningGroup;
  updateGroupDescription(id: string, description: string): LearningGroup;
  addToGroup(groupId: string, learningIds: LearningId[]): LearningGroup;
  removeFromGroup(groupId: string, learningIds: LearningId[]): LearningGroup;
  deleteGroup(id: string): void;
  publishGroup(id: string): LearningGroup;
  unpublishGroup(id: string): LearningGroup;

  // ── Routing (FR-1.5) ─────────────────────────────────────────────────────
  setRoutingRules(rules: RoutingRule[]): void;
  resolveRouting(learningId: LearningId): RoutingRule | undefined;

  // ── Snapshot / restore ───────────────────────────────────────────────────
  snapshot(): { items: LearningItem[]; groups: LearningGroup[] };
  restore(data: { items: LearningItem[]; groups: LearningGroup[] }): void;

  /** Mark SLA-escalated items. Returns the count of newly escalated. */
  checkSla(): number;
}

// ── Implementation ────────────────────────────────────────────────────────────

function generateId(): LearningId {
  return `lrn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

function cloneItem(item: LearningItem): LearningItem {
  return JSON.parse(JSON.stringify(item)) as LearningItem;
}

export function createLearningReviewQueue(config?: ReviewQueueConfig): LearningReviewQueue {
  const items = new Map<LearningId, LearningItem>();
  const groups = new Map<string, LearningGroup>();
  let groupCounter = 0;
  const lockTtlMs = config?.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  const slaHighMs = config?.slaHighMs ?? DEFAULT_SLA_HIGH_MS;
  const slaMediumMs = config?.slaMediumMs ?? DEFAULT_SLA_MEDIUM_MS;
  const slaLowMs = config?.slaLowMs ?? DEFAULT_SLA_LOW_MS;
  const routingRules: RoutingRule[] = config?.routingRules ?? [];

  // ── Helper: get band from score ────────────────────────────────────────────
  function bandFromScore(score: number): ConfidenceBand {
    if (score >= 0.85) return "HIGH";
    if (score >= 0.60) return "MEDIUM";
    return "LOW";
  }

  function slaMsFromBand(band: ConfidenceBand): number {
    if (band === "HIGH") return slaHighMs;
    if (band === "MEDIUM") return slaMediumMs;
    return slaLowMs;
  }

  // ── Helper: set SLA on item ─────────────────────────────────────────────────
  function setSla(item: LearningItem): void {
    const band = bandFromScore(item.confidenceScore);
    const slaMs = slaMsFromBand(band);
    item.slaDeadline = new Date(Date.now() + slaMs).toISOString();
  }

  // ── Helper: clone item for audit ────────────────────────────────────────────
  function auditLog(
    item: LearningItem,
    actionType: string,
    reviewerId: string,
    beforeState?: Partial<LearningItem>,
  ): void {
    // Persist to the Builderforce approvals audit log via the existing
    // approvalGate mechanism — fire-and-forget (best-effort, non-fatal).
    logDebug(
      `[learning-review-queue] audit: ${actionType} by ${reviewerId} on ${item.id}`,
    );

    // The approvals framework's audit trail gets a structured entry.
    // In a production deployment this also routes through approvalGate.request()
    // when the actionType requires human sign-off; all actions log here.
    try {
      void approvalGate.request({
        kind: "feedback",
        actionType: `learning.${actionType}`,
        description: `${actionType} learning ${item.id} by ${reviewerId}`,
        metadata: {
          learningId: item.id,
          reviewerId,
          beforeState,
          afterState: { text: item.text, status: item.status, tags: item.tags },
          timestamp: isoNow(),
        },
        timeoutMs: 5_000,
      }).catch(() => {
        /* best-effort audit */
      });
    } catch {
      /* never throw from audit */
    }
  }

  // ── Queue operations ────────────────────────────────────────────────────────

  const queue: LearningReviewQueue = {
    reset() {
      items.clear();
      groups.clear();
      groupCounter = 0;
    },

    ingest(partial) {
      const now = isoNow();
      const id = partial.id ?? generateId();
      const band = bandFromScore(partial.confidenceScore);
      const slaMs = slaMsFromBand(band);

      const item: LearningItem = {
        id,
        text: partial.text,
        source: partial.source,
        tags: partial.tags ?? [],
        confidenceScore: partial.confidenceScore,
        confidenceExplanation: partial.confidenceExplanation ?? {},
        status: partial.confidenceScore >= 0.85 && config?.routingRules?.some(r => r.allowAutoApprove)
          ? "auto_approved"
          : "pending",
        createdAt: now,
        updatedAt: now,
        conflicts: [],
        duplicateCandidates: [],
        relatedCandidates: [],
        suggestedGroupIds: [],
        groupIds: [],
        suppressedSourceCount: 0,
        slaEscalated: false,
        slaDeadline: new Date(Date.now() + slaMs).toISOString(),
      };

      items.set(id, item);

      if (item.status === "auto_approved") {
        logInfo(`[learning-review-queue] auto-approved learning ${id} (confidence ${partial.confidenceScore})`);
        auditLog(item, "auto_approve", "system");
        if (config?.onApproved) {
          void Promise.resolve(config.onApproved(cloneItem(item))).catch(() => {});
        }
      } else {
        logDebug(`[learning-review-queue] ingested learning ${id} with status ${item.status}`);
      }

      return cloneItem(item);
    },

    list(filter, sort, page = 1, pageSize = 50) {
      let result = Array.from(items.values());

      // Apply filter
      if (filter) {
        if (filter.confidenceMin !== undefined) {
          result = result.filter((i) => i.confidenceScore >= filter.confidenceMin!);
        }
        if (filter.confidenceMax !== undefined) {
          result = result.filter((i) => i.confidenceScore <= filter.confidenceMax!);
        }
        if (filter.status) {
          const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
          result = result.filter((i) => statuses.includes(i.status));
        }
        if (filter.tags && filter.tags.length > 0) {
          result = result.filter((i) =>
            filter.tags!.some((t) => i.tags.includes(t)),
          );
        }
        if (filter.sourceWorkflowId) {
          result = result.filter((i) => i.source.workflowId === filter.sourceWorkflowId);
        }
        if (filter.conflictStatus === "conflicted") {
          result = result.filter((i) => i.conflicts.length > 0);
        } else if (filter.conflictStatus === "clean") {
          result = result.filter((i) => i.conflicts.length === 0);
        }
        if (filter.groupId) {
          result = result.filter((i) => i.groupIds.includes(filter.groupId!));
        }
      }

      // Sort
      if (sort) {
        const dir = sort.direction === "desc" ? -1 : 1;
        result.sort((a, b) => {
          let cmp = 0;
          switch (sort.field) {
            case "confidenceScore":
              cmp = a.confidenceScore - b.confidenceScore;
              break;
            case "createdAt":
              cmp = a.createdAt.localeCompare(b.createdAt);
              break;
            case "updatedAt":
              cmp = a.updatedAt.localeCompare(b.updatedAt);
              break;
            case "status":
              cmp = a.status.localeCompare(b.status);
              break;
            case "slaDeadline":
              cmp = (a.slaDeadline ?? "").localeCompare(b.slaDeadline ?? "");
              break;
          }
          return dir * cmp;
        });
      } else {
        // Default: newest first
        result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      }

      const total = result.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const start = (page - 1) * pageSize;
      const paged = result.slice(start, start + pageSize);

      return {
        items: paged.map(cloneItem),
        total,
        page,
        pageSize,
        totalPages,
      };
    },

    getById(id) {
      const item = items.get(id);
      return item ? cloneItem(item) : undefined;
    },

    stats() {
      const allItems = Array.from(items.values());
      const pending_items = allItems.filter((i) => i.status === "pending");
      const locked_items = allItems.filter((i) => i.status === "locked");
      const autoApproved = allItems.filter((i) => i.status === "auto_approved");

      const avgConfidence =
        allItems.length > 0
          ? allItems.reduce((sum, i) => sum + i.confidenceScore, 0) / allItems.length
          : 0;

      const oldest = pending_items.length > 0
        ? pending_items.reduce((a, b) => (a.createdAt < b.createdAt ? a : b)).createdAt
        : null;

      return {
        pending: pending_items.length,
        locked: locked_items.length,
        autoApproved: autoApproved.length,
        approved: allItems.filter((i) => i.status === "approved").length,
        rejected: allItems.filter((i) => i.status === "rejected").length,
        merged: allItems.filter((i) => i.status === "merged").length,
        contradiction: allItems.filter((i) => i.conflicts.length > 0).length,
        escalated: allItems.filter((i) => i.slaEscalated).length,
        avgConfidence: Math.round(avgConfidence * 100) / 100,
        oldestPending: oldest,
      };
    },

    approve(opts) {
      const item = items.get(opts.learningId);
      if (!item) throw new Error(`Learning not found: ${opts.learningId}`);
      if (item.status === "approved" || item.status === "auto_approved") {
        return cloneItem(item); // idempotent
      }
      if (item.status === "rejected" || item.status === "merged") {
        throw new Error(`Cannot approve learning in status ${item.status}`);
      }
      if (item.status === "contradiction") {
        throw new Error(`Cannot approve a contradicted learning; resolve contradiction first`);
      }

      const before: Partial<LearningItem> = { status: item.status };
      item.status = opts.isAutoApproval ? "auto_approved" : "approved";
      item.reviewedBy = opts.reviewerId;
      item.updatedAt = isoNow();
      item.lockedBy = undefined;
      item.lockExpiresAt = undefined;

      auditLog(item, opts.isAutoApproval ? "auto_approve" : "approve", opts.reviewerId, before);

      if (config?.onApproved) {
        void Promise.resolve(config.onApproved(cloneItem(item))).catch(() => {});
      }

      return cloneItem(item);
    },

    reject(opts) {
      const item = items.get(opts.learningId);
      if (!item) throw new Error(`Learning not found: ${opts.learningId}`);
      if (item.status === "rejected" || item.status === "merged") {
        return cloneItem(item); // idempotent
      }
      if (item.status === "approved") {
        throw new Error(`Cannot reject an already-approved learning`);
      }

      const before: Partial<LearningItem> = { status: item.status };
      item.status = "rejected";
      item.reviewedBy = opts.reviewerId;
      item.rejectionReason = { text: opts.reason, category: opts.category };
      item.updatedAt = isoNow();
      item.lockedBy = undefined;
      item.lockExpiresAt = undefined;

      auditLog(item, "reject", opts.reviewerId, before);
      return cloneItem(item);
    },

    edit(opts) {
      const item = items.get(opts.learningId);
      if (!item) throw new Error(`Learning not found: ${opts.learningId}`);
      if (item.status === "merged" || item.status === "rejected") {
        throw new Error(`Cannot edit learning in status ${item.status}`);
      }

      const before: Partial<LearningItem> = { text: item.text, tags: [...item.tags] };

      // Preserve original on first edit (FR-2.3)
      if (!item.originalText) {
        item.originalText = item.text;
      }

      item.text = opts.newText;
      if (opts.newTags) item.tags = opts.newTags;
      if (opts.newConfidenceScore !== undefined) item.confidenceScore = opts.newConfidenceScore;
      if (opts.newConfidenceExplanation) item.confidenceExplanation = opts.newConfidenceExplanation;
      item.reviewedBy = opts.reviewerId;
      item.updatedAt = isoNow();

      auditLog(item, "edit", opts.reviewerId, before);
      return cloneItem(item);
    },

    merge(opts) {
      if (opts.sourceIds.length < 2) {
        throw new Error("Merge requires at least 2 source learnings");
      }

      const sourceItems: LearningItem[] = [];
      for (const id of opts.sourceIds) {
        const si = items.get(id);
        if (!si) throw new Error(`Source learning not found: ${id}`);
        if (si.status === "merged") throw new Error(`Source ${id} is already merged`);
        if (si.status === "rejected") throw new Error(`Source ${id} is rejected — cannot merge`);
        sourceItems.push(si);
      }

      const now = isoNow();
      const mergedId = generateId();
      const maxConfidence = Math.max(...sourceItems.map((s) => s.confidenceScore));
      const unionTags = [...new Set(sourceItems.flatMap((s) => s.tags))];
      const allSourceIds = sourceItems.flatMap((s) => s.id);

      // Create the canonical merged entry (FR-2.4)
      const merged: LearningItem = {
        id: mergedId,
        text: opts.targetText,
        source: {
          workflowId: sourceItems[0]!.source.workflowId,
          step: "merged",
          timestamp: now,
          extractionModel: "human_curation",
        },
        tags: [...new Set([...opts.targetTags, ...unionTags])],
        confidenceScore: maxConfidence,
        confidenceExplanation: { merged_from: sourceItems.length, max_confidence: maxConfidence },
        status: "pending",
        createdAt: now,
        updatedAt: now,
        conflicts: [],
        duplicateCandidates: [],
        relatedCandidates: [],
        suggestedGroupIds: [
          ...new Set(sourceItems.flatMap((s) => s.suggestedGroupIds)),
        ],
        groupIds: [...new Set(sourceItems.flatMap((s) => s.groupIds))],
        suppressedSourceCount: 0,
        slaEscalated: false,
        slaDeadline: undefined,
      };
      setSla(merged);
      items.set(mergedId, merged);

      // Mark sources as merged (FR-2.4)
      const clones: LearningItem[] = [];
      for (const si of sourceItems) {
        const before: Partial<LearningItem> = { status: si.status };
        si.status = "merged";
        si.updatedAt = now;
        clones.push(cloneItem(si));
        auditLog(si, "merged_into", opts.mergedBy, { ...before, mergedIntoId: mergedId });
      }

      logInfo(`[learning-review-queue] merged ${opts.sourceIds.length} learnings into ${mergedId}`);
      auditLog(merged, "merge_result", opts.mergedBy, { sourceIds: opts.sourceIds });

      return [merged, ...clones];
    },

    lock(opts) {
      const item = items.get(opts.learningId);
      if (!item) throw new Error(`Learning not found: ${opts.learningId}`);
      if (item.status === "approved" || item.status === "auto_approved") {
        throw new Error(`Cannot lock an approved learning`);
      }
      if (item.status === "rejected" || item.status === "merged") {
        throw new Error(`Cannot lock a ${item.status} learning`);
      }

      // Check existing lock
      if (item.lockedBy && item.lockExpiresAt) {
        if (item.lockedBy === opts.reviewerId) {
          // Extend own lock
          const ttl = opts.ttlMs ?? lockTtlMs;
          item.lockExpiresAt = new Date(Date.now() + ttl).toISOString();
          item.updatedAt = isoNow();
          return cloneItem(item);
        }
        // Someone else's lock — is it still valid?
        if (new Date(item.lockExpiresAt).getTime() > Date.now()) {
          throw new Error(`Learning ${opts.learningId} is locked by ${item.lockedBy} until ${item.lockExpiresAt}`);
        }
        // Expired — fall through to claim
      }

      const ttl = opts.ttlMs ?? lockTtlMs;
      item.lockedBy = opts.reviewerId;
      item.lockExpiresAt = new Date(Date.now() + ttl).toISOString();
      item.status = "pending"; // re-activate if it was expired
      item.updatedAt = isoNow();

      auditLog(item, "lock", opts.reviewerId);
      return cloneItem(item);
    },

    unlock(learningId, reviewerId) {
      const item = items.get(learningId);
      if (!item) throw new Error(`Learning not found: ${learningId}`);
      if (!item.lockedBy) throw new Error(`Learning ${learningId} is not locked`);
      if (item.lockedBy !== reviewerId && reviewerId !== "admin") {
        throw new Error(`Learning ${learningId} is locked by ${item.lockedBy}, not ${reviewerId}`);
      }

      item.lockedBy = undefined;
      item.lockExpiresAt = undefined;
      item.updatedAt = isoNow();

      auditLog(item, "unlock", reviewerId);
      return cloneItem(item);
    },

    releaseExpiredLocks() {
      const now = Date.now();
      let count = 0;
      for (const item of items.values()) {
        if (item.lockedBy && item.lockExpiresAt) {
          if (new Date(item.lockExpiresAt).getTime() <= now) {
            item.lockedBy = undefined;
            item.lockExpiresAt = undefined;
            item.updatedAt = isoNow();
            count++;
          }
        }
      }
      if (count > 0) logDebug(`[learning-review-queue] released ${count} expired locks`);
      return count;
    },

    resolveContradiction(opts) {
      const item = items.get(opts.learningId);
      if (!item) throw new Error(`Learning not found: ${opts.learningId}`);

      const before: Partial<LearningItem> = { status: item.status, conflicts: [...item.conflicts] };

      switch (opts.resolution) {
        case "keep_new":
          // Deprecate baseline (the item is accepted, conflicts cleared)
          item.conflicts = [];
          item.status = "pending";
          break;
        case "keep_baseline":
          // Reject the new learning (FR-4.4)
          item.status = "rejected";
          item.rejectionReason = {
            text: "Baseline retained; contradicts existing knowledge",
            category: "inaccurate",
          };
          break;
        case "merge_reconcile": {
          if (!opts.reconciledText) {
            throw new Error("Reconciled text required for merge_reconcile resolution");
          }
          // Produce a reconciled canonical entry
          const reconciled: LearningItem = cloneItem(item);
          reconciled.id = generateId();
          reconciled.text = opts.reconciledText;
          reconciled.conflicts = [];
          reconciled.status = "pending";
          reconciled.createdAt = isoNow();
          reconciled.updatedAt = isoNow();
          reconciled.originalText = item.text;
          setSla(reconciled);
          items.set(reconciled.id, reconciled);
          // Mark original as merged
          item.status = "merged";
          item.updatedAt = isoNow();
          logInfo(`[learning-review-queue] reconciled contradiction: ${opts.learningId} → ${reconciled.id}`);
          auditLog(reconciled, "reconcile", opts.reviewerId, { ...before, resolution: opts.resolution });
          if (config?.onContradictionResolved) {
            void Promise.resolve(config.onContradictionResolved(opts, cloneItem(reconciled))).catch(() => {});
          }
          return cloneItem(reconciled);
        }
        case "defer":
          // Escalate with commentary; keep in contradiction status
          item.updatedAt = isoNow();
          logWarn(`[learning-review-queue] contradiction deferred by ${opts.reviewerId}: ${opts.deferComment ?? ""}`);
          auditLog(item, "contradiction_defer", opts.reviewerId, before);
          return cloneItem(item);
        default:
          throw new Error(`Unknown resolution: ${opts.resolution}`);
      }

      item.updatedAt = isoNow();
      item.reviewedBy = opts.reviewerId;
      auditLog(item, `contradiction_${opts.resolution}`, opts.reviewerId, before);

      if (config?.onContradictionResolved) {
        void Promise.resolve(config.onContradictionResolved(opts, cloneItem(item))).catch(() => {});
      }

      return cloneItem(item);
    },

    // ── Group operations (FR-6) ─────────────────────────────────────────────

    createGroup(name, description = "", ownerRole = "knowledge_curator") {
      const id = `grp_${++groupCounter}_${Date.now().toString(36)}`;
      const group: LearningGroup = {
        id,
        name,
        description,
        ownerRole,
        memberIds: [],
        coherenceScore: 0,
        createdAt: isoNow(),
        updatedAt: isoNow(),
        published: false,
      };
      groups.set(id, group);
      logDebug(`[learning-review-queue] created group ${id}: ${name}`);
      return { ...group };
    },

    getGroup(id) {
      const g = groups.get(id);
      return g ? { ...g } : undefined;
    },

    listGroups() {
      return Array.from(groups.values()).map((g) => ({ ...g }));
    },

    renameGroup(id, name) {
      const g = groups.get(id);
      if (!g) throw new Error(`Group not found: ${id}`);
      g.name = name;
      g.updatedAt = isoNow();
      return { ...g };
    },

    updateGroupDescription(id, description) {
      const g = groups.get(id);
      if (!g) throw new Error(`Group not found: ${id}`);
      g.description = description;
      g.updatedAt = isoNow();
      return { ...g };
    },

    addToGroup(groupId, learningIds) {
      const g = groups.get(groupId);
      if (!g) throw new Error(`Group not found: ${groupId}`);

      for (const lid of learningIds) {
        const item = items.get(lid);
        if (!item) throw new Error(`Learning not found: ${lid}`);
        if (!g.memberIds.includes(lid)) {
          g.memberIds.push(lid);
        }
        if (!item.groupIds.includes(groupId)) {
          item.groupIds.push(groupId);
          item.updatedAt = isoNow();
        }
      }
      g.updatedAt = isoNow();
      return { ...g };
    },

    removeFromGroup(groupId, learningIds) {
      const g = groups.get(groupId);
      if (!g) throw new Error(`Group not found: ${groupId}`);

      for (const lid of learningIds) {
        g.memberIds = g.memberIds.filter((m) => m !== lid);
        const item = items.get(lid);
        if (item) {
          item.groupIds = item.groupIds.filter((gid) => gid !== groupId);
          item.updatedAt = isoNow();
        }
      }
      g.updatedAt = isoNow();
      return { ...g };
    },

    deleteGroup(id) {
      const g = groups.get(id);
      if (!g) return;
      // Remove group membership from all member learnings
      for (const lid of g.memberIds) {
        const item = items.get(lid);
        if (item) {
          item.groupIds = item.groupIds.filter((gid) => gid !== id);
        }
      }
      groups.delete(id);
    },

    publishGroup(id) {
      const g = groups.get(id);
      if (!g) throw new Error(`Group not found: ${id}`);
      if (g.memberIds.length === 0) throw new Error(`Cannot publish empty group ${id}`);
      g.published = true;
      g.updatedAt = isoNow();
      logInfo(`[learning-review-queue] published group ${id}: ${g.name}`);
      return { ...g };
    },

    unpublishGroup(id) {
      const g = groups.get(id);
      if (!g) throw new Error(`Group not found: ${id}`);
      g.published = false;
      g.updatedAt = isoNow();
      return { ...g };
    },

    // ── Routing (FR-1.5) ────────────────────────────────────────────────────

    setRoutingRules(rules) {
      routingRules.length = 0;
      routingRules.push(...rules);
    },

    resolveRouting(learningId) {
      const item = items.get(learningId);
      if (!item) return undefined;

      // Find the first matching rule
      for (const rule of routingRules) {
        if (rule.domainTag && !item.tags.some((t) => t.startsWith(rule.domainTag!))) {
          continue;
        }
        if (rule.confidenceMin !== undefined && item.confidenceScore < rule.confidenceMin) {
          continue;
        }
        if (rule.confidenceMax !== undefined && item.confidenceScore > rule.confidenceMax) {
          continue;
        }
        return { ...rule };
      }
      return undefined;
    },

    // ── Snapshot ──────────────────────────────────────────────────────────────

    snapshot() {
      return {
        items: Array.from(items.values()).map(cloneItem),
        groups: Array.from(groups.values()).map((g) => ({ ...g })),
      };
    },

    restore(data) {
      items.clear();
      groups.clear();
      for (const item of data.items) {
        items.set(item.id, cloneItem(item));
      }
      for (const g of data.groups) {
        groups.set(g.id, { ...g });
      }
    },

    checkSla() {
      const now = Date.now();
      let escalated = 0;
      for (const item of items.values()) {
        if (item.slaEscalated) continue;
        if (
          (item.status === "pending" || item.status === "locked" || item.status === "contradiction") &&
          item.slaDeadline &&
          new Date(item.slaDeadline).getTime() <= now
        ) {
          item.slaEscalated = true;
          item.updatedAt = isoNow();
          escalated++;
          logWarn(`[learning-review-queue] SLA breached for learning ${item.id}`);
          auditLog(item, "sla_escalation", "system");
          if (config?.onSlaEscalation) {
            void Promise.resolve(config.onSlaEscalation(cloneItem(item))).catch(() => {});
          }
        }
      }
      return escalated;
    },
  };

  return queue;
}