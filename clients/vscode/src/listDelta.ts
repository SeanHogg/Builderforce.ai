/**
 * The relay's list delta — ONE rule for every list a `run.sync` frame carries (the run's
 * trace and its appended messages), used by the host to cut a frame and by the webview to
 * apply it.
 *
 * Both lists grow at the tail and are trimmed from the head once past their bound, and
 * the store keeps each item's identity while doing so. So what changed since the last
 * frame is always "the head moved forward by `drop`, then `items` were appended": found
 * by locating the last-sent TAIL in the current list (the old head may be what was
 * trimmed). A list that was replaced (or a sink that is new) is resent whole, as `from: 0`.
 *
 * The webview keeps its prior array when nothing changed. Every frame is a new message,
 * so without that a 32 ms streaming frame handed the transcript a fresh trace and a fresh
 * appended list — the whole settled timeline re-mapped and re-sorted per frame, and the
 * appended splice re-rendered the chat surface a second time.
 */

/** What was last sent of a list: its length, its first and its last item. */
export interface SentList<T> {
  len: number;
  first: T | undefined;
  /** Optional so hand-built bookkeeping (a test's `{ len, first }`) still types; without
   *  it only growth from an unmoved head is trusted. */
  tail?: T | undefined;
}

export interface ListDelta<T> {
  /** Items the receiver drops from the head of what it holds. */
  drop: number;
  /** How many of the receiver's items (after the drop) are kept; 0 = `items` is the whole list. */
  from: number;
  items: T[];
}

export function sentOf<T>(list: readonly T[]): SentList<T> {
  return { len: list.length, first: list[0], tail: list[list.length - 1] };
}

/** The host side: what `list` adds to what this sink was last sent. */
export function listDelta<T>(list: readonly T[], last: SentList<T> | undefined): ListDelta<T> {
  if (last && last.len > 0) {
    // Bookkeeping without a tail can only vouch for growth from an unmoved head.
    const from = last.tail === undefined
      ? (list[0] === last.first && last.len <= list.length ? last.len : 0)
      : list.lastIndexOf(last.tail as T) + 1;
    const drop = last.len - from;
    if (from > 0 && drop >= 0 && (drop > 0 || list[0] === last.first)) {
      return { drop, from, items: list.slice(from) };
    }
  }
  return { drop: 0, from: 0, items: list.slice() };
}

/**
 * The webview side: `prior` moved on by one delta — the SAME array when nothing changed.
 * Null when `prior` is not what the sender thinks it sent (the webview's store evicted
 * the cell between runs): the caller asks for the list whole instead of building a short one.
 */
export function applyListDelta<T>(prior: T[], delta: ListDelta<T>): T[] | null {
  const { drop, from, items } = delta;
  if (from === 0) return items.length === 0 && prior.length === 0 ? prior : items;
  if (prior.length !== drop + from) return null;
  if (drop === 0 && items.length === 0) return prior;
  return [...prior.slice(drop), ...items];
}
