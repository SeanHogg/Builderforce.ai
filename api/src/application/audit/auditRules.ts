/**
 * Pure ticket-audit coverage rules (no DB / IO) — unit-testable.
 *
 * Given the requirements that apply to a ticket (the union of required
 * roles/diagnostics/reviews across the lanes it has reached) and the evidence that
 * work actually happened (role sign-offs, roles that performed work, diagnostics
 * run against the ticket), decide which REQUIRED requirements are unmet and whether
 * the ticket should be flagged for review.
 */
import type { RequirementKind, Responsibility } from '../kanban/types';

export interface RequirementInput {
  laneKey: string;
  laneName: string;
  kind: RequirementKind;
  ref: string;
  responsibility?: Responsibility;
  isRequired: boolean;
  description?: string;
  /** N-of-M quorum for the reviewer set at this lane; null = all required. */
  quorum?: number | null;
}

/** A requirement satisfied by an approving sign-off (a review, or a role acting as reviewer). */
function isReviewerReq(r: RequirementInput): boolean {
  return r.kind === 'review' || r.responsibility === 'reviewer';
}

export interface AuditSignals {
  /** Role keys that produced an 'approved' sign-off on this ticket. */
  approvedRoles: Set<string>;
  /** Role keys whose latest sign-off is 'changes_requested' (blocking). */
  changesRequestedRoles: Set<string>;
  /** Diagnostic tool ids that were run against this ticket. */
  ranDiagnostics: Set<string>;
  /** Diagnostic tool ids that RAN but scored BELOW the pass threshold — a ran-but-failed
   *  diagnostic must NOT satisfy its requirement (evidence-based gating, PRD §5.6). Runs
   *  with no score stay satisfied-by-existence, so this is backward-compatible. */
  failedDiagnostics: Set<string>;
  /** Role keys that actually did work on the ticket (dispatched as that role / owned it). */
  performedRoles: Set<string>;
}

export interface UnmetRequirement {
  laneKey: string;
  laneName: string;
  kind: RequirementKind;
  ref: string;
  responsibility?: Responsibility;
  /** 'missing' = never satisfied; 'changes_requested' = a reviewer asked for changes. */
  reason: 'missing' | 'changes_requested';
  description?: string;
}

/**
 * Stable identity of an audit verdict — the status plus the exact set of unmet
 * checks, order-independent. The manager re-audits every pass, so a verdict is only
 * worth journalling to the manager feed when this signature CHANGES; re-recording an
 * unchanged verdict every pass buries the feed under duplicates of the same gap.
 */
export function verdictSignature(status: string, missing: UnmetRequirement[]): string {
  return [
    status,
    ...missing
      .map((m) => `${m.laneKey}|${m.kind}|${m.ref}|${m.responsibility ?? ''}|${m.reason}`)
      .sort(),
  ].join('\n');
}

export interface CoverageResult {
  status: 'pass' | 'flagged';
  requiredCount: number;
  satisfiedCount: number;
  /** 0..100 percent of required checks satisfied (100 when nothing is required). */
  coverage: number;
  missing: UnmetRequirement[];
}

/** Is a single requirement satisfied by the observed signals? Returns the unmet
 *  reason when not, or null when satisfied. */
export function requirementUnmetReason(
  req: RequirementInput,
  signals: AuditSignals,
): 'missing' | 'changes_requested' | null {
  if (req.kind === 'diagnostic') {
    // A diagnostic that ran but scored below the pass threshold does NOT satisfy —
    // the flag stays up until it passes (or a run with no score exists = legacy).
    if (signals.failedDiagnostics.has(req.ref)) return 'missing';
    return signals.ranDiagnostics.has(req.ref) ? null : 'missing';
  }
  // review, or a role acting as a reviewer → needs an approved sign-off.
  const isReviewer = req.kind === 'review' || req.responsibility === 'reviewer';
  if (isReviewer) {
    if (signals.changesRequestedRoles.has(req.ref)) return 'changes_requested';
    return signals.approvedRoles.has(req.ref) ? null : 'missing';
  }
  // role owner / contributor → satisfied if that role performed work OR signed off.
  const performed = signals.performedRoles.has(req.ref) || signals.approvedRoles.has(req.ref);
  return performed ? null : 'missing';
}

const asUnmet = (req: RequirementInput, reason: 'missing' | 'changes_requested'): UnmetRequirement => ({
  laneKey: req.laneKey, laneName: req.laneName, kind: req.kind, ref: req.ref,
  responsibility: req.responsibility, reason, description: req.description,
});

/** Compute overall coverage; only `isRequired` requirements can flag a ticket.
 *  Reviewer requirements at a lane form a QUORUM set: with quorum N, N approvals
 *  satisfy the set (default N = the set size ⇒ all must approve, the legacy rule). */
export function computeCoverage(reqs: RequirementInput[], signals: AuditSignals): CoverageResult {
  const required = reqs.filter((r) => r.isRequired);
  const missing: UnmetRequirement[] = [];
  let satisfied = 0;
  let requiredCount = 0;

  // Non-reviewer (producer / diagnostic) requirements — per-requirement.
  for (const req of required.filter((r) => !isReviewerReq(r))) {
    requiredCount += 1;
    const reason = requirementUnmetReason(req, signals);
    if (reason == null) satisfied += 1; else missing.push(asUnmet(req, reason));
  }

  // Reviewer requirements — grouped by lane into quorum sets.
  const reviewersByLane = new Map<string, RequirementInput[]>();
  for (const req of required.filter(isReviewerReq)) {
    const list = reviewersByLane.get(req.laneKey) ?? [];
    list.push(req);
    reviewersByLane.set(req.laneKey, list);
  }
  for (const group of reviewersByLane.values()) {
    // Quorum = the smallest declared quorum in the set, capped at the set size;
    // default (no quorum set) = the set size (every reviewer must approve).
    const declared = group.map((r) => r.quorum).filter((q): q is number => typeof q === 'number' && q > 0);
    const quorum = Math.min(group.length, declared.length ? Math.min(...declared) : group.length);
    const approvedCount = group.filter((r) => !signals.changesRequestedRoles.has(r.ref) && signals.approvedRoles.has(r.ref)).length;
    requiredCount += quorum;
    const metInSet = Math.min(approvedCount, quorum);
    satisfied += metInSet;
    if (metInSet < quorum) {
      // Report the shortfall: unapproved roles, changes_requested first.
      const unapproved = group.filter((r) => !signals.approvedRoles.has(r.ref));
      const ordered = [
        ...unapproved.filter((r) => signals.changesRequestedRoles.has(r.ref)),
        ...unapproved.filter((r) => !signals.changesRequestedRoles.has(r.ref)),
      ];
      for (const req of ordered.slice(0, quorum - metInSet)) {
        missing.push(asUnmet(req, signals.changesRequestedRoles.has(req.ref) ? 'changes_requested' : 'missing'));
      }
    }
  }

  const coverage = requiredCount === 0 ? 100 : Math.round((satisfied / requiredCount) * 100);
  return {
    status: missing.length === 0 ? 'pass' : 'flagged',
    requiredCount,
    satisfiedCount: satisfied,
    coverage,
    missing,
  };
}
