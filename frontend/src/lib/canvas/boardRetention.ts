/**
 * WHICH kept boards the stage may let go of.
 *
 * `CanvasStage` keeps every opened board mounted so a trip away and back costs nothing —
 * no re-fetch, no re-fit, the Brain turn still running. Kept without a bound, that is
 * every board of a long session holding its own runtime: an App surface's preview, its
 * polls, its presence socket. This is the bound.
 *
 * A board is released only when releasing it loses nothing:
 *   • never the board on stage;
 *   • never one with a Brain turn in flight — the turn streams into that instance;
 *   • never a board held only in this browser (`local`): it is the work most at risk,
 *     and its instance is the cheapest thing to keep;
 *   • never one that left the stage less than {@link RELEASE_IDLE_MS} ago — autosave is
 *     a short debounce behind the last edit, and a board that has been off stage this
 *     long has written it.
 * Of the rest, the least recently on stage go first, and only as many as the cap needs.
 */

/** Boards kept mounted at once, the one on stage included. */
export const KEPT_BOARD_CAP = 3;

/** How long a board must have been off stage before it may be released. */
export const RELEASE_IDLE_MS = 5_000;

export interface RetainedBoard {
  sessionId: string;
  persistence: 'local' | 'server';
}

export function boardKey(board: RetainedBoard): string {
  return `${board.persistence}:${board.sessionId}`;
}

export interface RetentionState {
  /** `boardKey` of the board on stage, or null. */
  activeKey: string | null;
  /** When each kept board last LEFT the stage, by `boardKey`. Absent = never left. */
  leftAt: ReadonlyMap<string, number>;
  /** Boards with a Brain turn in flight, by session id. */
  busy: Readonly<Record<string, boolean>>;
  now: number;
  cap?: number;
}

export interface RetentionDecision {
  /** `boardKey`s to release now. */
  release: string[];
  /** When the next board becomes releasable, if the stage is still over its cap. */
  recheckAt: number | null;
}

export function boardsToRelease(opened: readonly RetainedBoard[], state: RetentionState): RetentionDecision {
  const cap = state.cap ?? KEPT_BOARD_CAP;
  const over = opened.length - cap;
  if (over <= 0) return { release: [], recheckAt: null };

  const eligible = opened
    .map((board) => ({ key: boardKey(board), board, left: state.leftAt.get(boardKey(board)) }))
    .filter(({ key, board, left }) => key !== state.activeKey
      && board.persistence === 'server'
      && !state.busy[board.sessionId]
      && left != null)
    .sort((a, b) => a.left! - b.left!);

  const release = eligible
    .filter(({ left }) => state.now - left! >= RELEASE_IDLE_MS)
    .slice(0, over)
    .map(({ key }) => key);

  const waiting = eligible.filter(({ key }) => !release.includes(key));
  const recheckAt = release.length < over && waiting.length > 0
    ? Math.min(...waiting.map(({ left }) => left! + RELEASE_IDLE_MS))
    : null;
  return { release, recheckAt };
}
