/**
 * The approval gate primitive — "may this act proceed, or must a human say yes
 * first?", answered once for every class of gated act.
 *
 * Extracted from `runtime/executionApprovalGate.ts`, which had grown the whole
 * decision inline for `task.execution`: scan the recent approvals of one
 * actionType, find the latest one that names this SUBJECT, honour an approved
 * and unexpired verdict, REUSE an outstanding pending request rather than
 * stacking a duplicate, and otherwise open one. Gating a workflow run needed
 * exactly that sequence again, and a second copy is how two gates come to
 * disagree about what "already approved" means — the reuse rule in particular is
 * the one a re-implementation forgets, and forgetting it turns one blocked act
 * into an approval queue full of identical rows.
 *
 * The primitive owns the DECISION and the row. What is being gated, when it is
 * gated at all, and what happens on approval stay with the caller: this module
 * knows nothing about tasks, workflows or priorities.
 *
 * Application layer on purpose — `Db` + drizzle only, never Hono — so a system
 * caller (a lane trigger, a cron sweep) can gate without a request context.
 */
import { and, desc, eq } from 'drizzle-orm';
import { approvals } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/** How many recent rows of one actionType the gate scans for this subject. */
const SUBJECT_SCAN_LIMIT = 100;

export type ApprovalGateVerdict =
  | { allowed: true; reason: 'approved' }
  | { allowed: false; approvalId: string; status: 'pending'; reason: string; opened: boolean };

/** The row the gate writes when nothing stands for this subject yet. */
export interface PendingApprovalDraft {
  description: string;
  /** Serialised alongside the subject key; the caller's replay context. */
  metadata?: Record<string, unknown>;
  requestedBy?: string | null;
  agentHostId?: number | null;
  cloudAgentRef?: string | null;
  /**
   * When the request goes stale. Without one `runApprovalExpirySweep` can never
   * escalate it, so a forgotten approval blocks its subject silently and forever.
   */
  expiresAt?: Date | null;
}

export interface ApprovalGateRequest {
  tenantId: number;
  /** The `approvals.action_type` this class of act uses, e.g. 'workflow.run'. */
  actionType: string;
  /** The metadata key naming WHICH act inside the class, e.g. 'taskId'. */
  subjectKey: string;
  /** The subject's identity. Compared as a string so numeric and uuid ids share one path. */
  subjectId: string | number;
  /** Said back to the caller while the request is outstanding. */
  pendingReason: string;
  /** Said back to the caller on the request that opened it. */
  openedReason: string;
  /** Built only when a new request is actually needed. */
  draft: () => PendingApprovalDraft | Promise<PendingApprovalDraft>;
}

/**
 * The subject an approval names, as a string, or null when its metadata carries
 * none. Tolerates a number written where a string was expected (and vice versa),
 * because both shapes are already in the table.
 */
export function approvalSubjectRef(metadata: string | null, subjectKey: string): string | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as Record<string, unknown>;
    const value = parsed[subjectKey];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  } catch {
    return null;
  }
}

/**
 * Rule on one gated act, opening a pending approval when it may not proceed.
 *
 * Callers decide WHETHER to gate before calling; reaching this function means the
 * act is gated. Returns `{ allowed: true }` only on an approved, unexpired
 * verdict for this exact subject.
 */
export async function resolveApprovalGate(
  db: Db,
  request: ApprovalGateRequest,
): Promise<ApprovalGateVerdict> {
  const now = new Date();
  const recent = await db
    .select({
      id: approvals.id,
      status: approvals.status,
      metadata: approvals.metadata,
      expiresAt: approvals.expiresAt,
      createdAt: approvals.createdAt,
    })
    .from(approvals)
    .where(and(eq(approvals.tenantId, request.tenantId), eq(approvals.actionType, request.actionType)))
    .orderBy(desc(approvals.createdAt))
    .limit(SUBJECT_SCAN_LIMIT);

  const subject = String(request.subjectId);
  const latest = recent.find((row) => approvalSubjectRef(row.metadata, request.subjectKey) === subject);
  if (latest && (!latest.expiresAt || latest.expiresAt > now)) {
    if (latest.status === 'approved') return { allowed: true, reason: 'approved' };
    if (latest.status === 'pending') {
      return {
        allowed: false,
        approvalId: latest.id,
        status: 'pending',
        reason: request.pendingReason,
        opened: false,
      };
    }
  }

  const draft = await request.draft();
  const approvalId = crypto.randomUUID();
  await db.insert(approvals).values({
    id: approvalId,
    tenantId: request.tenantId,
    agentHostId: draft.agentHostId ?? null,
    cloudAgentRef: draft.cloudAgentRef ?? null,
    requestedBy: draft.requestedBy ?? null,
    kind: 'approval',
    actionType: request.actionType,
    description: draft.description,
    // The subject key is written by the gate, never by the caller's metadata, so
    // the value this function reads back is always the value it matched on.
    metadata: JSON.stringify({ ...(draft.metadata ?? {}), [request.subjectKey]: request.subjectId }),
    status: 'pending',
    expiresAt: draft.expiresAt ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return {
    allowed: false,
    approvalId,
    status: 'pending',
    reason: request.openedReason,
    opened: true,
  };
}
