/** Names shared by the earn path and the readers of a board's earned budget. */

/** Idempotency prefix of a board's earn row: `board-earn:<taskId>`. */
export const BOARD_EARN_PREFIX = 'board-earn:';

/** Read-through cache key of one board's budget view. */
export const boardBudgetCacheKey = (tenantId: number, boardId: string): string =>
  `board-budget:${tenantId}:${boardId}`;
