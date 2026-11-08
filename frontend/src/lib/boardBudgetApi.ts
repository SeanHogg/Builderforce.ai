/** Client for `GET /api/boards/:boardId/budget` - a board's earned budget. */
import { apiRequest } from './apiClient';

export interface BoardBudgetStatementRow {
  id: number;
  amount: number;
  kind: string;
  memo: string | null;
  occurredAt: string;
}

export interface BoardBudgetMilestone {
  boardId: string;
  boardName: string;
  milestone: string;
  reachedAt: string;
  earnedPoints: number;
}

export interface BoardBudget {
  /** Points earned by Done tickets. */
  balance: number;
  /** Run cost on the board's project, in USD cents. */
  spentUsdCents: number;
  statement: BoardBudgetStatementRow[];
  milestones: BoardBudgetMilestone[];
}

export const boardBudgetApi = {
  get: (boardId: string): Promise<BoardBudget> =>
    apiRequest<BoardBudget>(`/api/boards/${encodeURIComponent(boardId)}/budget`),
};
