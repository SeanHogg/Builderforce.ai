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
}

export interface AuditSignals {
  /** Role keys that produced an 'approved' sign-off on this ticket. */
  approvedRoles: Set<string>;
  /** Role keys whose latest sign-off is 'changes_requested' (blocking). */
  changesRequestedRoles: Set<string>;
  /** Diagnostic tool ids that were run against this ticket. */
  ranDiagnostics: Set<string>;
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

/** Compute overall coverage; only `isRequired` requirements can flag a ticket. */
export function computeCoverage(reqs: RequirementInput[], signals: AuditSignals): CoverageResult {
  const required = reqs.filter((r) => r.isRequired);
  const missing: UnmetRequirement[] = [];
  let satisfied = 0;

  for (const req of required) {
    const reason = requirementUnmetReason(req, signals);
    if (reason == null) {
      satisfied++;
    } else {
      missing.push({
        laneKey: req.laneKey,
        laneName: req.laneName,
        kind: req.kind,
        ref: req.ref,
        responsibility: req.responsibility,
        reason,
        description: req.description,
      });
    }
  }

  const requiredCount = required.length;
  const coverage = requiredCount === 0 ? 100 : Math.round((satisfied / requiredCount) * 100);
  return {
    status: missing.length === 0 ? 'pass' : 'flagged',
    requiredCount,
    satisfiedCount: satisfied,
    coverage,
    missing,
  };
}
