/**
 * securityMergeGate — THE answer to "may this pull request merge, security-wise?" (PRD 08 §10).
 *
 * PURE: scans and findings in, a verdict out. No IO, so every merge path asks the same question the
 * same way and the rule is testable without a database. `securityMergeGate` judges findings alone;
 * `evaluateSecurityGate` (below) is the complete verdict every merge path uses. The paths that consult it:
 *   - `runtime/cloudFinalize.ts`        immediate auto-merge at the end of a cloud run
 *   - `repos/openTaskPullRequest.ts`    the Done-drag path
 *   - `ci/ingestRepoCiEvent.ts`         merge-on-green-CI
 *   - `repos/prMergeSweep.ts`           the manager's autonomous merge
 * Each loads the PR's scans and findings through `prSecurityGate.ts` (the one reader) and calls it.
 *
 * BLOCKER MAPS ONTO THE EXISTING SEVERITY VOCABULARY. The platform has four severities
 * (CRITICAL / HIGH / MEDIUM / LOW — `scanReportParsers.FINDING_SEVERITIES`) and `normalizeSeverity`
 * already folds a scanner's "BLOCKER" onto CRITICAL. PRD §4.4's BLOCKER therefore means: CRITICAL or
 * HIGH, i.e. "must be fixed or consciously risk-accepted before this ships". MEDIUM and LOW inform;
 * they never hold a merge.
 *
 * A finding stops blocking only by being TRIAGED (`fixed`, `accepted_risk`, `false_positive` — see
 * `VULNERABILITY_FINDING_STATUSES`). That is the human override path and it is audited like any
 * other tracker mutation.
 */
import type { FindingSeverity } from '@builderforce/sarif';

/** The severities that hold a merge. ONE definition — the gate, the incident rule and the UI read it here. */
export const BLOCKING_SEVERITIES: readonly FindingSeverity[] = ['CRITICAL', 'HIGH'];

/** Statuses that still count as unresolved. `triaged` is acknowledged, not resolved. */
export const UNRESOLVED_FINDING_STATUSES: readonly string[] = ['open', 'triaged'];

export interface GateFinding {
  id?: string;
  severity: string;
  status: string;
  title: string;
  category?: string | null;
  filePath?: string | null;
}

/**
 * WHY a PR is held, as DATA. The API returns these and the UI words them in the viewer's language
 * (`pullRequestSecurityGate.reason.<code>`); the English `message` exists for logs, the audit trail and
 * the manager journal only - it is never what a person is shown. An unknown code renders as a generic
 * "blocked by security policy", so a code added here ships safely before every client knows it.
 */
export type GateReasonCode =
  | 'scan_missing' | 'scan_pending' | 'scan_skipped' | 'scan_failed' | 'scan_truncated' | 'scan_no_segment'
  | 'no_head' | 'unpinned_allow' | 'ci_not_on_head'
  | 'open_blocker' | 'open_blocker_more'
  | 'no_pr_row' | 'no_pr_for_task' | 'no_pr_at_commit' | 'no_pr_judged'
  | 'scan_scheduled' | 'scan_unscheduled' | 'step_failed' | 'step_not_run' | 'step_unavailable';

export interface GateReason {
  code: GateReasonCode;
  /** English, for logs / audit / journal. Not user-facing. */
  message: string;
  /** SECRET | SAST | SCA | REVIEW, for the `scan_*` codes. */
  scanType?: string;
  /** `open_blocker_more`: how many further blockers are not listed. */
  count?: number;
  /** `open_blocker`: the finding's title (and file). `no_head`: the provider's reason. */
  detail?: string;
  /** `open_blocker`: CRITICAL | HIGH. */
  severity?: string;
  /** `open_blocker`: a scanner rule, or the security-review agent. */
  source?: 'scan' | 'review';
}

export const gateReason = (code: GateReasonCode, message: string, extra: Omit<GateReason, 'code' | 'message'> = {}): GateReason =>
  ({ code, message, ...extra });

/** The English messages joined - for a log line, an audit note or a journal entry. */
export const reasonMessages = (reasons: readonly GateReason[]): string => reasons.map((r) => r.message).join('; ');

export type SecurityMergeVerdict =
  /** `overridden`: allowed only because a manager accepted the risk of THIS head commit. */
  | { allow: true; overridden?: boolean }
  | { allow: false; reasons: GateReason[] };

/**
 * A verdict that CARRIES the commit it was reached for. An ALLOW cannot be constructed without one, so
 * a merge call can (and must) pin to it - `expectedHeadSha: verdict.headSha`, unconditionally, with no
 * optional spread to forget. A block carries the head when it is known (null = it could not be read).
 */
export type PinnedVerdict =
  | { allow: true; overridden?: boolean; headSha: string }
  | { allow: false; reasons: GateReason[]; headSha: string | null };

/** Attach the head commit to a verdict; an allow with no commit to pin to becomes a block. PURE. */
export function pinVerdict(v: SecurityMergeVerdict, headSha: string | null): PinnedVerdict {
  if (!v.allow) return { allow: false, reasons: v.reasons, headSha };
  if (!headSha) return { allow: false, reasons: [gateReason('unpinned_allow', 'allowed, but with no head commit to pin the merge to')], headSha: null };
  return { allow: true, ...(v.overridden ? { overridden: true } : {}), headSha };
}

export const isBlockingSeverity = (severity: string): boolean =>
  (BLOCKING_SEVERITIES as readonly string[]).includes(severity.toUpperCase());

/** Whether one finding holds the merge: unresolved AND of a blocking severity. */
export function isBlockingFinding(f: Pick<GateFinding, 'severity' | 'status'>): boolean {
  return UNRESOLVED_FINDING_STATUSES.includes(f.status) && isBlockingSeverity(f.severity);
}

/** Cap on reasons surfaced, so a PR with hundreds of findings produces a readable message. */
const MAX_REASONS = 5;

export function securityMergeGate(openFindings: readonly GateFinding[]): SecurityMergeVerdict {
  const blocking = openFindings.filter(isBlockingFinding);
  if (blocking.length === 0) return { allow: true };
  const reasons = blocking.slice(0, MAX_REASONS).map((f) => {
    const where = f.filePath ? ` (${f.filePath})` : '';
    const source = f.category === 'SECURITY' ? 'review' as const : 'scan' as const;
    const severity = f.severity.toUpperCase();
    return gateReason('open_blocker', `${severity} ${source === 'review' ? 'security review' : 'scan'} finding: ${f.title}${where}`, {
      severity, source, detail: `${f.title}${where}`,
    });
  });
  if (blocking.length > MAX_REASONS) {
    const more = blocking.length - MAX_REASONS;
    reasons.push(gateReason('open_blocker_more', `…and ${more} more blocking finding(s)`, { count: more }));
  }
  return { allow: false, reasons };
}

// ── completeness: a verdict needs the scans to have actually run, on THIS commit ─────────────────

/** Every one of these must be completed, untruncated and scoped for the commit being merged. */
export const REQUIRED_SCAN_TYPES = ['SECRET', 'SAST', 'SCA', 'REVIEW'] as const;

export interface GateScanRow {
  scanType: string;
  status: string;
  truncated: boolean;
  headSha: string | null;
  segmentId: string | null;
  /** When the row last changed - lets the sweep tell a crashed scan from one still running. */
  updatedAt?: Date | null;
}
export interface GateFindingRow extends GateFinding { headSha: string | null }

export interface SecurityGateInput {
  /** The PR's head commit NOW (from the provider). Null = it could not be read, which blocks. */
  currentHeadSha: string | null;
  /** ALL of the PR's scan rows, any commit — rows for another commit are stale and ignored. */
  scans: readonly GateScanRow[];
  /** ALL of the PR's findings with the commit of the scan that found them. */
  findings: readonly GateFindingRow[];
  /** Head commits a manager has explicitly accepted the risk of. */
  overrideShas: readonly string[];
}

/** Why one required scan type does not count as complete for the commit, or null when it does. */
function incompleteReason(type: string, rows: readonly GateScanRow[]): GateReason | null {
  const scanType = type;
  if (rows.length === 0) return gateReason('scan_missing', `${type} scan has not run for this commit`, { scanType });
  if (rows.some((r) => r.status === 'completed' && !r.truncated && r.segmentId)) return null;
  const r = rows[rows.length - 1]!;
  if (r.status === 'completed' && !r.segmentId) return gateReason('scan_no_segment', `${type} scan has no segment, so it cannot be trusted`, { scanType });
  if (r.status === 'completed') return gateReason('scan_truncated', `${type} scan was incomplete (it did not see the whole change)`, { scanType });
  if (r.status === 'skipped') return gateReason('scan_skipped', `${type} scan was skipped`, { scanType });
  if (r.status === 'failed') return gateReason('scan_failed', `${type} scan failed`, { scanType });
  return gateReason('scan_pending', `${type} scan is still pending`, { scanType });
}

/**
 * Why the four required scans do not (yet) cover `input.currentHeadSha`: empty when all four completed,
 * untruncated and scoped. Also what decides whether SOC 2 "scanned + reviewed" evidence may be written. PURE.
 */
export function incompleteScanReasons(input: Pick<SecurityGateInput, 'currentHeadSha' | 'scans'>): GateReason[] {
  const head = input.currentHeadSha;
  if (!head) return [gateReason('no_head', 'the PR head commit could not be read, so its scans cannot be matched to it')];
  const atHead = input.scans.filter((s) => s.headSha === head);
  const reasons: GateReason[] = [];
  for (const type of REQUIRED_SCAN_TYPES) {
    const why = incompleteReason(type, atHead.filter((s) => s.scanType === type));
    if (why) reasons.push(why);
  }
  return reasons;
}

/**
 * THE complete verdict (PRD 08 §10): allow only when, for the PR's CURRENT head commit, all four scans
 * completed untruncated AND no blocking finding of that commit is open - or a manager accepted the
 * risk of exactly this commit. Anything absent, skipped, failed, truncated, pending, scoped to a
 * different commit, or unreadable blocks, with a named reason. PURE.
 */
export function evaluateSecurityGate(input: SecurityGateInput): SecurityMergeVerdict {
  const head = input.currentHeadSha;
  if (!head) return { allow: false, reasons: incompleteScanReasons(input) };
  if (input.overrideShas.includes(head)) return { allow: true, overridden: true };

  const reasons = incompleteScanReasons(input);
  const verdict = securityMergeGate(input.findings.filter((f) => f.headSha === head));
  if (!verdict.allow) reasons.push(...verdict.reasons);
  return reasons.length === 0 ? { allow: true } : { allow: false, reasons };
}
