/**
 * The run-cell REGISTRY and the writes every part of a run makes to its cell — the
 * single module-level store keyed by run, its LRU bound, the coalesced repaint, and the
 * trace (each event made durable through the cell's step writer as it is pushed).
 */

import type { BrainMessage } from '../types';
import type { BrainTraceEvent } from '../brainTriage';
import type { BrainRunActivity } from '../runActivity';
import { makeCell, type RunCell } from './runCell';

export const cells = new Map<number, RunCell>();

/**
 * Global run-store listeners — notified on ANY cell change (not one chat's), so a
 * view can render a CROSS-CHAT indicator of which OTHER chats are live without
 * subscribing to every chat individually. Fired from {@link emit} alongside the
 * per-cell listeners.
 */
export const storeListeners = new Set<() => void>();

/**
 * Memory bounds. Run cells are session-lived (the transcript IS the cross-turn
 * grounding), so without a cap a long session touching many chats grows the
 * module-level `Map` without limit. We keep at most {@link MAX_CELLS} cells,
 * evicting the least-recently-used **idle** ones (never an in-flight run or a
 * cell a mounted view is subscribed to); a re-visited evicted chat just rebuilds
 * its cell and reloads visible history from persistence — the same grounding
 * loss as a page reload. Per-cell, the trace and the live-append buffer are also
 * capped so a single marathon chat can't grow unbounded either.
 */
const MAX_CELLS = 50;
const MAX_TRACE_EVENTS = 500;
const MAX_APPENDED = 50;

export function getCell(chatId: number): RunCell {
  const existing = cells.get(chatId);
  if (existing) {
    // Refresh LRU recency: re-insert so this chat moves to the most-recent end
    // (Map preserves insertion order, which we use as the eviction queue).
    cells.delete(chatId);
    cells.set(chatId, existing);
    return existing;
  }
  const c = makeCell();
  cells.set(chatId, c);
  evictIdleCells(chatId);
  return c;
}

/**
 * Evict least-recently-used cells over the cap, skipping any that are still
 * running, have a mounted subscriber, or are `protectId` (the cell we just
 * created and are about to return — its subscriber attaches right after, so it
 * must not be evicted out from under the mounting view). Iterates oldest-first
 * via the Map's insertion order. When everything in range is protected the store
 * is allowed to exceed the cap rather than drop live state.
 */
export function evictIdleCells(protectId: number): void {
  if (cells.size <= MAX_CELLS) return;
  for (const [id, cell] of cells) {
    if (cells.size <= MAX_CELLS) break;
    if (id === protectId || cell.running || cell.listeners.size > 0) continue;
    cells.delete(id);
  }
}

/**
 * How long streamed tokens may accumulate before the mounted views repaint.
 * A frame's worth: a reply arrives as hundreds of deltas a second, and a repaint
 * per delta — every subscriber of the cell plus every cross-chat subscriber of
 * the store — was the hottest path in the loop. Nobody can read faster than a
 * frame, so nothing is lost by drawing once per frame.
 */
const STREAM_EMIT_MS = 32;

/** Repaint soon, coalescing every delta that lands in the meantime. Any direct
 *  `emit` before the frame flushes it first, so a phase change never trails
 *  the text it belongs to. */
export function emitStreaming(c: RunCell): void {
  if (c.emitTimer) return;
  c.emitTimer = setTimeout(() => {
    c.emitTimer = null;
    emit(c);
  }, STREAM_EMIT_MS);
}

/** Re-derive the cached snapshot and notify subscribers. */
export function emit(c: RunCell): void {
  if (c.emitTimer) {
    clearTimeout(c.emitTimer);
    c.emitTimer = null;
  }
  c.snapshot = {
    running: c.running,
    streamingText: c.streamingText,
    error: c.error,
    errorAction: c.errorAction,
    pendingConfirm: c.pendingConfirm,
    messagesEpoch: c.messagesEpoch,
    appended: c.appended,
    hasTrace: c.trace.length > 0,
    trace: c.trace,
    activity: c.activity,
    byoUnresolved: c.byoUnresolved,
    providerCap: c.providerCap,
  };
  for (const l of c.listeners) l();
  // Cross-chat subscribers (the dropdown / session-list indicators) see every
  // change too, so a run starting/finishing/pausing in a NON-mounted chat still
  // updates the "which chats are live" view.
  for (const l of storeListeners) l();
}

/**
 * Publish the in-flight step. Called on ENTRY to each phase — the whole point is
 * that the user sees the step while it runs, not after. Emits so every mounted
 * surface repaints; the value is small and phase changes are rare relative to
 * token deltas, so this costs nothing measurable.
 */
export function setActivity(c: RunCell, activity: BrainRunActivity | null): void {
  c.activity = activity;
  emit(c);
}

export function pushTrace(c: RunCell, ev: BrainTraceEvent): void {
  c.trace.push(ev);
  c.persistStep?.(ev);
  // Bound a single run's trace so a long tool-chain can't grow without limit.
  if (c.trace.length > MAX_TRACE_EVENTS) {
    const dropped = c.trace.length - MAX_TRACE_EVENTS;
    c.trace.splice(0, dropped);
    c.runTraceFrom = Math.max(0, c.runTraceFrom - dropped);
  }
  emit(c);
}

/** The trace events THIS run produced — see {@link RunCell.runTraceFrom}. */
export function runTrace(c: RunCell): BrainTraceEvent[] {
  return c.trace.slice(c.runTraceFrom);
}

/**
 * The run ENDED BADLY — record that where a reload can still see it.
 *
 * A run's terminal error lived only in `c.error`, an in-memory field on the cell.
 * Every tool step along the way was durable, so a failed run rehydrated as a
 * transcript that performed a dozen steps and then simply stopped, with nothing
 * saying why — indistinguishable from the reply having been lost. That silence
 * is the part a person cannot act on.
 *
 * Best-effort, like every other step: if the failure WAS the persistence layer,
 * this write can fail too and the run is no worse off. Most failures are not
 * (a 4xx, an exhausted loop, a connection back by the time the run unwinds), and
 * for those the reopened chat now ends with a reason instead of a cliff.
 *
 * ONE row per failure: when the step that threw already recorded this same failure
 * (a failed completion writes `llm.complete` → "Error: not_signed_in" before it
 * rethrows), that row IS the durable reason — a second "not_signed_in" row under it
 * only doubled the error on every surface.
 */
export function recordRunFailure(c: RunCell, label: string, message: string): void {
  const last = runTrace(c).at(-1);
  if (last?.isError && typeof last.result === 'string' && last.result.endsWith(message)) return;
  pushTrace(c, {
    ts: nowIso(),
    category: 'error',
    label,
    result: message,
    isError: true,
  });
}

/**
 * Record a freshly-persisted assistant message for live splice-in and bump the
 * epoch. The buffer is capped to the most recent {@link MAX_APPENDED}: any older
 * entries were already merged into mounted views (merge is id-keyed), and a
 * late-mounting view loads full history from persistence — so trimming is safe
 * and keeps a marathon chat's cell bounded. (Cap ≫ a single run's max turns, so
 * nothing is ever trimmed before delivery within one run.)
 */
export function recordAppended(c: RunCell, msg: BrainMessage): void {
  const next = [...c.appended, msg];
  c.appended = next.length > MAX_APPENDED ? next.slice(next.length - MAX_APPENDED) : next;
  c.messagesEpoch += 1;
}

export function nowMs(): number {
  return typeof Date !== 'undefined' ? Date.now() : 0;
}

export function nowIso(): string {
  return typeof Date !== 'undefined' ? new Date().toISOString() : '';
}

/** Fold a comma-separated provider header into one of the cell's accumulated sets,
 *  replacing it only when it GROWS — so a mounted banner appears the moment a provider
 *  is first reported, and a repeat report repaints nothing. */
function accrueProviders(c: RunCell, field: 'byoUnresolved' | 'providerCap', raw: string | undefined): void {
  if (!raw) return;
  const before = c[field].length;
  const next = new Set(c[field]);
  for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) next.add(p);
  if (next.size !== before) c[field] = [...next];
}

/** `x-builderforce-byo-unresolved`: connected accounts the gateway could not use. */
export function accrueByoUnresolved(c: RunCell, raw: string | undefined): void {
  accrueProviders(c, 'byoUnresolved', raw);
}

/** `x-builderforce-provider-cap`: BYO providers whose usage cap was hit. */
export function accrueProviderCap(c: RunCell, raw: string | undefined): void {
  accrueProviders(c, 'providerCap', raw);
}
