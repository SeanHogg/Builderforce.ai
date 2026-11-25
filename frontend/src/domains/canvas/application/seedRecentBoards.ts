/**
 * Recent-board seeding on sign-in: put the person's most recent workspace boards on the device so they
 * open offline, instead of only the boards they happened to open here before.
 *
 * Bounded on purpose — at most {@link RECENT_BOARD_SEED_LIMIT} boards, one read each, only for boards
 * the device does not hold (a held replica is never overwritten: it may carry unsent edits). The reads
 * are REST today; once the pull projection serves Canvas records (WC-G009) this fan-out is replaced by
 * the pull itself. A board that fails to seed is counted and reported, and does not stop the rest.
 */

/** How many recent boards are seeded (the design's approved limit, 2026-11-24). */
export const RECENT_BOARD_SEED_LIMIT = 20;

export interface SeedRecentBoardsDeps {
  /** The person's most recent active boards, newest first. */
  list: () => Promise<ReadonlyArray<{ id: string }>>;
  /** The board ids this device already holds. */
  heldIds: () => Promise<ReadonlySet<string>>;
  /** Read one board from the server and put it in the replica. */
  seed: (boardId: string) => Promise<unknown>;
  /** Where a failed seed is reported. */
  report: (scope: string, error: unknown) => void;
}

export interface SeedRecentBoardsResult {
  seeded: number;
  failed: number;
}

export async function seedRecentBoards(deps: SeedRecentBoardsDeps): Promise<SeedRecentBoardsResult> {
  const [recent, held] = await Promise.all([deps.list(), deps.heldIds()]);
  const missing = recent.slice(0, RECENT_BOARD_SEED_LIMIT).filter((board) => !held.has(board.id));
  // Bounded fan-out (at most RECENT_BOARD_SEED_LIMIT reads); each outcome is judged on its own.
  const outcomes = await Promise.allSettled(missing.map((board) => deps.seed(board.id)));
  let failed = 0;
  outcomes.forEach((outcome, index) => {
    if (outcome.status === 'fulfilled') return;
    failed += 1;
    deps.report(`seedRecentBoards:${missing[index]!.id}`, outcome.reason);
  });
  return { seeded: missing.length - failed, failed };
}
