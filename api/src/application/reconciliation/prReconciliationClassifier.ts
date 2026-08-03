/** Pure, deterministic PR/ticket classifier used by both scheduled and manual runs. */

export type ReconciliationClassification =
  | 'ready_for_review'
  | 'keep'
  | 'repair'
  | 'infrastructure_failure'
  | 'close_candidate'
  | 'human_review';

export type ReconciliationAction =
  | 'review'
  | 'wait'
  | 'repair_pr'
  | 'repair_infrastructure'
  | 'close'
  | 'investigate';

export interface ReconciliationCheck {
  name: string;
  state: string;
  detailsUrl?: string | null;
}

export interface ReconciliationPrInput {
  number: number;
  title: string;
  body: string;
  headBranch: string;
  isDraft: boolean;
  changedFiles: number;
  additions: number;
  deletions: number;
  mergeable: string;
  mergeStateStatus: string;
  checks: ReconciliationCheck[];
}

export interface ReconciliationTicketInput {
  id: number;
  status: string;
  completedAt: Date | null;
}

export interface ReconciliationDecision {
  classification: ReconciliationClassification;
  recommendedAction: ReconciliationAction;
  confidence: 'high' | 'medium' | 'low';
  reasonCodes: string[];
  checkSummary: {
    total: number;
    failed: number;
    pending: number;
    successful: number;
    sharedInfrastructureFailures: string[];
    changeSpecificFailures: string[];
  };
}

const FAILED_STATES = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);
const PENDING_STATES = new Set(['PENDING', 'QUEUED', 'IN_PROGRESS', 'EXPECTED', 'WAITING', 'REQUESTED']);

/** A red deployment preview shared across hundreds of unrelated PRs is not evidence their changes are bad. */
export const SHARED_INFRASTRUCTURE_CHECKS = new Set([
  'Workers Builds: builderforce-frontend',
]);

export function extractTaskId(...sources: Array<string | null | undefined>): number | null {
  for (const source of sources) {
    if (!source) continue;
    const matches = [
      /\btask\s*#\s*(\d+)\b/i,
      /\bbuilderforce[\/_-]+task[\/_-]+(\d+)\b/i,
      /\b(?:task|ticket)[\/_-]+(\d+)\b/i,
    ];
    for (const pattern of matches) {
      const match = source.match(pattern);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function summarizeChecks(checks: ReconciliationCheck[]): ReconciliationDecision['checkSummary'] {
  const failed = checks.filter((c) => FAILED_STATES.has(c.state.toUpperCase()));
  const pending = checks.filter((c) => PENDING_STATES.has(c.state.toUpperCase()));
  const shared = failed.filter((c) => SHARED_INFRASTRUCTURE_CHECKS.has(c.name)).map((c) => c.name);
  return {
    total: checks.length,
    failed: failed.length,
    pending: pending.length,
    successful: Math.max(0, checks.length - failed.length - pending.length),
    sharedInfrastructureFailures: [...new Set(shared)],
    changeSpecificFailures: [...new Set(failed.filter((c) => !SHARED_INFRASTRUCTURE_CHECKS.has(c.name)).map((c) => c.name))],
  };
}

const abandonedTicket = (status: string): boolean =>
  /(?:cancel(?:led)?|duplicate|wontfix|won't fix|not[_ -]?planned|rejected|archived)/i.test(status);

export function classifyPullRequest(args: {
  pr: ReconciliationPrInput;
  taskId: number | null;
  ticket: ReconciliationTicketInput | null;
  duplicateOpenPrNumbers: number[];
}): ReconciliationDecision {
  const { pr, taskId, ticket, duplicateOpenPrNumbers } = args;
  const checkSummary = summarizeChecks(pr.checks);
  const decision = (
    classification: ReconciliationClassification,
    recommendedAction: ReconciliationAction,
    confidence: ReconciliationDecision['confidence'],
    ...reasonCodes: string[]
  ): ReconciliationDecision => ({ classification, recommendedAction, confidence, reasonCodes, checkSummary });

  if (pr.changedFiles === 0 && pr.additions === 0 && pr.deletions === 0) {
    return decision('close_candidate', 'close', 'high', 'empty_pull_request');
  }
  if (duplicateOpenPrNumbers.length > 1) {
    return decision('human_review', 'investigate', 'high', 'multiple_open_prs_for_ticket');
  }
  if (taskId == null) {
    return decision('human_review', 'investigate', 'high', 'missing_ticket_reference');
  }
  if (!ticket) {
    return decision('human_review', 'investigate', 'high', 'referenced_ticket_not_found');
  }
  if (abandonedTicket(ticket.status)) {
    return decision('close_candidate', 'close', 'high', 'ticket_abandoned', `ticket_status:${ticket.status}`);
  }
  // Current status is authoritative. A DONE ticket cannot retain an open PR: the
  // delivery lifecycle has already finalized, so that PR is stale cleanup. Do not
  // use completedAt here—a reopened ticket intentionally retains its historical
  // completion timestamp and must remain actionable in its current lane.
  if (ticket.status.toLowerCase() === 'done') {
    return decision('close_candidate', 'close', 'high', 'done_ticket_has_stale_open_pr');
  }
  if (pr.mergeable === 'CONFLICTING' || pr.mergeStateStatus === 'DIRTY') {
    return decision('repair', 'repair_pr', 'high', 'merge_conflict');
  }
  if (checkSummary.changeSpecificFailures.length > 0) {
    return decision('repair', 'repair_pr', 'high', 'change_specific_checks_failed');
  }
  if (checkSummary.sharedInfrastructureFailures.length > 0) {
    return decision('infrastructure_failure', 'repair_infrastructure', 'high', 'shared_infrastructure_check_failed');
  }
  if (pr.isDraft) return decision('keep', 'wait', 'high', 'draft_pull_request');
  if (checkSummary.pending > 0) return decision('keep', 'wait', 'high', 'checks_pending');
  if (checkSummary.total === 0) return decision('human_review', 'investigate', 'medium', 'no_check_evidence');
  return decision('ready_for_review', 'review', 'high', 'all_checks_successful');
}
