import { useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';

/**
 * How many nodes the transcript renders at once, and how many more each "Show earlier" /
 * "Show newer" adds. A long agent chat holds thousands of steps (one reported chat: 529
 * messages and 4,535 run steps); rendering every one of them on each step and every
 * streamed token froze the panel. Nothing is dropped from the data.
 */
export const TIMELINE_PAGE_SIZE = 150;

/** How many nodes above a revealed message its page starts, so it reads in context. */
const REVEAL_LEAD = 10;

/** The rendered slice `[start, end)` of `length` nodes. */
export interface RenderRange {
  start: number;
  end: number;
}

/**
 * Where the window is, by node KEY (never a count — a count slides as a live run appends,
 * scrolling away the rows the reader asked for). `startKey` null = the newest page;
 * `endKey` null = up to the newest node.
 */
export interface WindowAnchor {
  startKey: string | null;
  endKey: string | null;
}

/**
 * The slice to render. Default: the newest page. Once the reader moved it, the anchors
 * hold it. A message asked to be revealed outside the slice gets a page AROUND it (never
 * everything from it to the newest node — that brought the freeze back), until the reader
 * moves the window again. Pure.
 */
export function renderRange(keys: readonly string[], anchor: WindowAnchor, revealIndex: number): RenderRange {
  const length = keys.length;
  const newest = Math.max(0, length - TIMELINE_PAGE_SIZE);
  const at = (key: string | null) => (key === null ? -1 : keys.indexOf(key));
  const anchoredStart = at(anchor.startKey);
  const anchoredEnd = at(anchor.endKey);
  const start = anchoredStart >= 0 ? Math.min(anchoredStart, newest) : newest;
  const end = anchoredEnd >= 0 ? Math.max(anchoredEnd + 1, Math.min(length, start + TIMELINE_PAGE_SIZE)) : length;
  if (revealIndex >= 0 && (revealIndex < start || revealIndex >= end)) {
    const from = Math.max(0, revealIndex - REVEAL_LEAD);
    return { start: from, end: Math.min(length, from + TIMELINE_PAGE_SIZE) };
  }
  return { start, end };
}

/** The last key in `[0, end)` that outlives this render — the live streaming bubble's key
 *  disappears when its turn settles, so a window must never be pinned to it. */
function lastStableKey(keys: readonly string[], end: number): string | null {
  for (let i = end - 1; i >= 0; i--) if (keys[i] !== 'streaming') return keys[i]!;
  return null;
}

const NEWEST: WindowAnchor = { startKey: null, endKey: null };

/**
 * The transcript's render window: the slice to render, and the controls that move it.
 *
 * Bounded by construction: following the tail is always the newest page; a window the
 * reader expanded is pinned at BOTH ends, so a live run appending below it shows a
 * "Show newer" count instead of growing it. A reveal is applied ONCE per nonce — the
 * window then holds wherever that left it, and a later step never snaps it back.
 * Another chat (or coming back to this one) opens on its newest page. Keeps the reader's
 * place when older rows are prepended above them.
 */
export function useRenderWindow<N extends { key: string }>(
  nodes: readonly N[],
  conversationKey: unknown,
  reveal: { index: number; nonce: number } | null,
  scrollRef: RefObject<HTMLDivElement | null>,
) {
  const [state, setState] = useState<{ conversation: unknown; anchor: WindowAnchor; seenReveal: number | null }>(
    { conversation: conversationKey, anchor: NEWEST, seenReveal: null },
  );
  const keys = useMemo(() => nodes.map((n) => n.key), [nodes]);

  // Another conversation: its newest page. (Adjusted during render, so the switch never
  // paints the previous chat's window.)
  let current = state;
  if (current.conversation !== conversationKey) {
    current = { conversation: conversationKey, anchor: NEWEST, seenReveal: current.seenReveal };
    setState(current);
  }

  // A NEW reveal: page around it (or leave the window be, when it is already in view) and
  // record its nonce, so it is never applied again.
  const pending = reveal && reveal.nonce !== current.seenReveal ? reveal : null;
  if (pending) {
    const shown = renderRange(keys, current.anchor, -1);
    const inView = pending.index >= shown.start && pending.index < shown.end;
    const around = renderRange(keys, current.anchor, pending.index);
    current = {
      ...current,
      seenReveal: pending.nonce,
      anchor: inView ? current.anchor : { startKey: keys[around.start] ?? null, endKey: around.end >= keys.length ? null : lastStableKey(keys, around.end) },
    };
    setState(current);
  }
  const range = renderRange(keys, current.anchor, -1);

  const fromBottom = useRef<number | null>(null);
  const move = useCallback((next: WindowAnchor, keepPlace: boolean) => {
    const el = scrollRef.current;
    if (keepPlace && el) fromBottom.current = el.scrollHeight - el.scrollTop;
    setState((prev) => ({ ...prev, conversation: conversationKey, anchor: next }));
  }, [scrollRef, conversationKey]);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && fromBottom.current != null) el.scrollTop = el.scrollHeight - fromBottom.current;
    fromBottom.current = null;
  }, [scrollRef, range.start]);

  // Expanding upward pins the bottom where it is now (bounded: new nodes queue under
  // "Show newer"); paging down to the end returns to following the newest page.
  const pinnedEnd = lastStableKey(keys, range.end);
  const earlier = range.start > 0
    ? { count: Math.min(range.start, TIMELINE_PAGE_SIZE), show: () => move({ startKey: keys[Math.max(0, range.start - TIMELINE_PAGE_SIZE)] ?? null, endKey: pinnedEnd }, true) }
    : null;
  const newer = range.end < keys.length
    ? {
        count: Math.min(keys.length - range.end, TIMELINE_PAGE_SIZE),
        show: () => {
          const end = range.end + TIMELINE_PAGE_SIZE;
          move(end >= keys.length ? NEWEST : { startKey: keys[range.start] ?? null, endKey: lastStableKey(keys, end) }, false);
        },
        latest: () => move(NEWEST, false),
      }
    : null;
  return { visible: nodes.slice(range.start, range.end), earlier, newer };
}
