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
  /**
   * Role keys whose ANCHORED PRD SECTION is authored (`PRD_ROLE_SECTIONS`).
   *
   * For a SPEC role the written section IS the deliverable, and until this signal
   * existed the audit had no way to see it: participation was verified from sign-offs, a
   * pull request and child tasks, so a Business Analyst who authored the whole
   * Requirements section satisfied nothing by doing so and its producer requirement
   * stayed unmet.
   *
   * Producer requirements only. A REVIEWER still needs a recorded verdict — writing your
   * own Review section is not a review, and letting a section satisfy a reviewer slot
   * would reopen exactly the rubber-stamp hole `no_contribution` closes.
   */
  sectionAuthoredRoles: Set<string>;
  /**
   * Per-role → the member refs that signed off AS that role (`memberRef` values from the
   * ledger, keyed by `roleKey`). The audit's capability re-check reads this: a sign-off
   * by a member that is NOT role-capable does not satisfy the requirement (default-deny
   * inside the engine, mirroring the HTTP/MCP write path). Populated by
   * {@link ticketAuditService.gatherSignals}; absent ⇒ capability is not re-checked.
   */
  signedOffRoles?: Map<string, Set<string>>;
  /**
   * Per-role → the member refs (agents + humans) role-capable of acting AS that role on
   * this ticket's project. Lets a gap answer \"who COULD have signed\" — the evidence
   * half of per-role verification. Populated by the audit caller.
   */
  roleCapableRefs?: Map<string, Set<string>>;
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
  /** Evidence detail for the gap (§5.6/§10): which roles signed off vs which could, so the
   *  audit reads WHY a requirement is unmet, not just THAT it is. */
  evidence?: {
    signedOffBy: string[];
    capableOfRole: string[];
    performedBy: string[];
    sectionAuthoredBy: string[];
  };
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

/**
 * Per-role capability re-check (PRD §5.9/FR-9, default-deny inside the engine).
 *
 * The HTTP + MCP write paths already refuse a sign-off by a non-role-capable member,
 * but rows can reach the ledger from a migration backfill or an older bug — and the
 * audit engine must not let such a row satisfy a requirement just because it exists.
 * When the caller supplied per-role signer + capability maps, an approval counts only
 * if at least one signer is role-capable. When the maps are absent (pure-rule callers,
 * legacy tests) the engine keeps its membership-only behaviour, so this is additive.
 */
function hasCapableSigner(roleKey: string, signals: AuditSignals): boolean {
  const capable = signals.roleCapableRefs?.get(roleKey);
  const signed = signals.signedOffRoles?.get(roleKey);
  if (!capable || !signed) return true;
  for (const ref of signed) if (capable.has(ref)) return true;
  return false;
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
  // review, or a role acting as a reviewer → needs an approved sign-off by a
  // ROLE-CAPABLE member (the capability re-check, not just any ledger row).
  const isReviewer = req.kind === 'review' || req.responsibility === 'reviewer';
  if (isReviewer) {
    if (signals.changesRequestedRoles.has(req.ref)) return 'changes_requested';
    return signals.approvedRoles.has(req.ref) && hasCapableSigner(req.ref, signals) ? null : 'missing';
  }
  // role owner / contributor → satisfied if that role performed work, signed off (as a
  // role-capable member), OR authored its anchored PRD section (for a spec role, that
  // section IS the deliverable — see {@link AuditSignals.sectionAuthoredRoles}).
  const signedOff = signals.approvedRoles.has(req.ref) && hasCapableSigner(req.ref, signals);
  const performed = signals.performedRoles.has(req.ref)
    || signedOff
    || signals.sectionAuthoredRoles.has(req.ref);
  return performed ? null : 'missing';
}

const asUnmet = (
  req: RequirementInput,
  reason: 'missing' | 'changes_requested',
  evidence?: UnmetRequirement['evidence'],
): UnmetRequirement => ({
  laneKey: req.laneKey, laneName: req.laneName, kind: req.kind, ref: req.ref,
  responsibility: req.responsibility, reason, description: req.description,
  ...(evidence ? { evidence } : {}),
});

/**
 * Per-role evidence snapshot for a gap (PRD §5.6/§10): which members signed off as
 * this role, which are role-capable of it, and which performed / authored it. Pure —
 * reads only the coarse `AuditSignals` sets, so a gap reads WHY it is unmet (the
 * signer was not role-capable, or nobody signed though capable members exist), not
 * just THAT it is unmet. Empty arrays are dropped from the stored JSON.
 */
function evidenceFor(req: RequirementInput, signals: AuditSignals): UnmetRequirement['evidence'] {
  const arr = (s: Set<string> | undefined): string[] => (s ? [...s].sort() : []);
  const signed = arr(signals.signedOffRoles?.get(req.ref));
  const evidence: UnmetRequirement['evidence'] = {
    signedOffBy: signed,
    capableOfRole: arr(signals.roleCapableRefs?.get(req.ref)),
    performedBy: arr(signals.performedRoles).filter((r) => r === req.ref),
    sectionAuthoredBy: arr(signals.sectionAuthoredRoles).filter((r) => r === req.ref),
  };
  return (signed.length || evidence.capableOfRole.length || evidence.performedBy.length || evidence.sectionAuthoredBy.length)
    ? evidence
    : undefined;
}

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
    if (reason == null) satisfied += 1; else missing.push(asUnmet(req, reason, evidenceFor(req, signals)));
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
        missing.push(asUnmet(req, signals.changesRequestedRoles.has(req.ref) ? 'changes_requested' : 'missing', evidenceFor(req, signals)));
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
