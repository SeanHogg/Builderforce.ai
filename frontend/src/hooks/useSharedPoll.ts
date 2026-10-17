/**
 * ONE poll shared by every component that reads the same resource.
 *
 * {@link usePolledResource} is per component: two components reading the same
 * endpoint run two loops. That is right for a panel-scoped read and wrong for a
 * shell-level signal that the header, a launcher badge and a drawer all show at
 * once, or for a badge rendered on every row of a table — N readers became N
 * requests per tick. A shared poll is created ONCE at module level per resource
 * and every reader subscribes to it:
 *
 *   • one loop per key (e.g. per project, per marketplace side), ref-counted — the
 *     first subscriber starts it, the last one stops it;
 *   • the {@link usePolledResource} rules, held at module level: no tick while the
 *     tab is hidden and one load on return, never two loads of a key in flight,
 *     a rejected load doubles the wait (capped), a success resets it;
 *   • `nextDelayMs` lets a resource pick its cadence from what it just read (quick
 *     while something is live, lazy when idle);
 *   • `refresh(param)` forces a load (`fresh: true`), coalesced with one in flight.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { backoffDelay, isDocumentHidden, MAX_BACKOFF_FACTOR } from '@/lib/polling/pollPolicy';

/** A poll is keyed by a primitive (a project id, a marketplace side) — one loop per value. */
export type SharedPollParam = string | number | null | undefined;

export interface SharedPollConfig<P extends SharedPollParam, T> {
  /** The value every key starts with (and every disabled reader sees). */
  initial: T;
  /** Read the resource. Throw to signal a failure (keeps the last value, backs off). */
  load: (param: P, opts: { fresh: boolean }) => Promise<T>;
  /** The wait after a successful load. */
  nextDelayMs: (value: T) => number;
  /** Ceiling of the failure backoff. Default eight times the first `nextDelayMs(initial)`. */
  maxDelayMs?: number;
}

export interface SharedPoll<P extends SharedPollParam, T> {
  initial: T;
  subscribe: (param: P, listener: () => void) => () => void;
  get: (param: P) => T;
  refresh: (param: P) => void;
}

interface Slot<P extends SharedPollParam, T> {
  param: P;
  value: T;
  listeners: Set<() => void>;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  pendingFresh: boolean;
  delay: number;
}

const isHidden = isDocumentHidden;

export function createSharedPoll<P extends SharedPollParam, T>(config: SharedPollConfig<P, T>): SharedPoll<P, T> {
  const keyOf = (param: P) => `${typeof param}:${String(param)}`;
  const slots = new Map<string, Slot<P, T>>();
  const baseDelay = config.nextDelayMs(config.initial);
  const maxDelay = config.maxDelayMs ?? baseDelay * MAX_BACKOFF_FACTOR;
  let visibilityBound = false;

  const emit = (slot: Slot<P, T>) => { for (const l of slot.listeners) l(); };

  const schedule = (slot: Slot<P, T>) => {
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    if (slot.listeners.size === 0) return;
    slot.timer = setTimeout(() => {
      slot.timer = null;
      // A hidden tab stops here; the visibility listener restarts the loop.
      if (isHidden()) return;
      void run(slot, false).then(() => schedule(slot));
    }, slot.delay);
  };

  const run = async (slot: Slot<P, T>, fresh: boolean): Promise<void> => {
    if (slot.listeners.size === 0) return;
    if (slot.inFlight) {
      if (fresh) slot.pendingFresh = true;
      return;
    }
    slot.inFlight = true;
    try {
      const next = await config.load(slot.param, { fresh });
      slot.delay = config.nextDelayMs(next);
      if (!Object.is(next, slot.value)) {
        slot.value = next;
        emit(slot);
      }
    } catch {
      slot.delay = backoffDelay(slot.delay, baseDelay, maxDelay);
    } finally {
      slot.inFlight = false;
    }
    if (slot.pendingFresh) {
      slot.pendingFresh = false;
      await run(slot, true);
    }
  };

  const onVisibility = () => {
    if (isHidden()) return;
    for (const slot of slots.values()) void run(slot, false).then(() => schedule(slot));
  };

  const bind = () => {
    if (visibilityBound || typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', onVisibility);
    visibilityBound = true;
  };
  const unbindIfIdle = () => {
    if (!visibilityBound || slots.size > 0 || typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', onVisibility);
    visibilityBound = false;
  };

  return {
    initial: config.initial,
    subscribe(param, listener) {
      const key = keyOf(param);
      let slot = slots.get(key);
      const isNew = !slot;
      if (!slot) {
        slot = { param, value: config.initial, listeners: new Set(), timer: null, inFlight: false, pendingFresh: false, delay: baseDelay };
        slots.set(key, slot);
      }
      slot.listeners.add(listener);
      bind();
      if (isNew && !isHidden()) {
        const s = slot;
        void run(s, false).then(() => schedule(s));
      }
      return () => {
        const s = slots.get(key);
        if (!s) return;
        s.listeners.delete(listener);
        if (s.listeners.size > 0) return;
        if (s.timer) clearTimeout(s.timer);
        s.timer = null;
        slots.delete(key);
        unbindIfIdle();
      };
    },
    get(param) {
      return slots.get(keyOf(param))?.value ?? config.initial;
    },
    refresh(param) {
      const slot = slots.get(keyOf(param));
      if (slot) void run(slot, true);
    },
  };
}

const noopSubscribe = () => () => undefined;

/**
 * Read a shared poll from a component. `enabled: false` neither subscribes nor
 * starts a loop, and reads the poll's initial value.
 */
export function useSharedPoll<P extends SharedPollParam, T>(poll: SharedPoll<P, T>, param: P, enabled = true): { value: T; refresh: () => void } {
  const subscribe = useCallback((listener: () => void) => poll.subscribe(param, listener), [poll, param]);
  const getSnapshot = useCallback(() => poll.get(param), [poll, param]);
  const getInitial = useCallback(() => poll.initial, [poll]);
  const value = useSyncExternalStore(enabled ? subscribe : noopSubscribe, enabled ? getSnapshot : getInitial, getInitial);
  const refresh = useCallback(() => poll.refresh(param), [poll, param]);
  return { value, refresh };
}
