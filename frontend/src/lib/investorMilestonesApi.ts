/** Client for what the NEXT investor update would list - shown to the founder before they send. */
import { apiRequest } from './apiClient';

/** A milestone the next investor update would list. Board entries carry the board and its earned points. */
export type PendingInvestorMilestone =
  | { source: 'work_item'; id: string; title: string; reachedAt: string; key: string; projectId: number }
  | { source: 'board'; id: string; title: string; reachedAt: string; boardId: string; boardName: string; earnedPoints: number };

export interface PendingInvestorMilestones {
  /** ISO start of the window: the last sent update, or the default lookback. */
  since: string;
  until: string;
  milestones: PendingInvestorMilestone[];
  /** How many more shipped in the window than are listed. */
  moreCount: number;
}

/** What shipped since the last update. */
export const getPendingInvestorMilestones = () =>
  apiRequest<PendingInvestorMilestones>('/api/investor-updates/milestones/pending');
