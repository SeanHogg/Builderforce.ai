export const STAKEHOLDER_ALIGNMENT_QUESTIONS = [
  { key: 'priorities_clear', prompt: 'Are project priorities clear and agreed?', weight: 25 },
  { key: 'competing_p0s_reconciled', prompt: 'Have competing P0 priorities been reconciled?', weight: 20 },
  { key: 'approvers_current', prompt: 'Are all required approvers current and available?', weight: 15 },
  { key: 'conflicts_within_sla', prompt: 'Are active conflicts within the 48-hour sign-off window?', weight: 20 },
  { key: 'delivery_reflects_priorities', prompt: 'Does current delivery work reflect the agreed priorities?', weight: 20 },
] as const;

export type StakeholderQuestionKey = (typeof STAKEHOLDER_ALIGNMENT_QUESTIONS)[number]['key'];
export type StakeholderAnswer = 'yes' | 'no' | 'unknown';

export interface StakeholderHealthProfileInput {
  projectId: number;
  answers: Record<StakeholderQuestionKey, StakeholderAnswer>;
}

export type StakeholderResponse = 'approve' | 'approve_with_comment' | 'block';
export type StakeholderReviewState = 'draft' | 'submitted' | 'in_review' | 'approved' | 'blocked' | 'escalated' | 'agreed';

export interface PrioritySubmissionInput {
  stakeholderRef: string;
  teamScope: string;
  priorityKey: string;
  rationale?: string;
  submittedAt: Date;
}

export interface DetectedStakeholderConflict {
  signature: string;
  teamScope: string;
  priorityKeys: string[];
  stakeholderRefs: string[];
  summary: string;
}
