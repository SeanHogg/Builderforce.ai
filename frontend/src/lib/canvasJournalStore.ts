/**
 * Where the canvas action journal survives a reload.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────────
 * The journal recorded exactly what a defect report needs and lived in a `useRef`, so
 * it died on reload — and "it did this, then I refreshed, and now it's broken" is the
 * most common shape a real bug report takes. By the time anyone filed one, the three
 * steps that explained it no longer existed anywhere.
 *
 * ── WHY sessionStorage, NOT localStorage ─────────────────────────────────────────
 * A journal is evidence about ONE person's ONE working session. `localStorage` is
 * shared across every tab on the origin, so two tabs open on the same board would
 * interleave their actions into a single record that reads as one session doing
 * things twice — a report that is worse than none. `sessionStorage` is per tab and
 * survives reload and navigation, which is exactly the lifetime of the evidence.
 *
 * Keyed by session so two boards in one tab keep separate histories, and bounded so a
 * long session cannot fill the quota and start throwing on write.
 */

import type { CanvasAction, CanvasJournal } from './canvasActionJournal';
import { JOURNAL_LIMIT, createCanvasJournal } from './canvasActionJournal';

const KEY_PREFIX = 'builderforce:canvas-journal:';

const ACTION_KINDS = new Set(['user', 'turn', 'tool', 'io', 'notice']);

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage can throw outright under a strict privacy setting. A canvas that
    // cannot keep a journal must still be a canvas.
    return null;
  }
}

/** Validate on the way IN, not on the way out: stored JSON is untrusted input the
 *  moment anything else on the origin can write it. */
function readActions(value: unknown): CanvasAction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const item = raw as Record<string, unknown>;
    if (typeof item.seq !== 'number' || typeof item.at !== 'string' || typeof item.label !== 'string') return [];
    if (typeof item.kind !== 'string' || !ACTION_KINDS.has(item.kind)) return [];
    return [{
      seq: item.seq,
      at: item.at,
      kind: item.kind as CanvasAction['kind'],
      label: item.label.slice(0, 200),
      ...(typeof item.detail === 'string' ? { detail: item.detail.slice(0, 400) } : {}),
      ...(typeof item.ok === 'boolean' ? { ok: item.ok } : {}),
      ...(typeof item.durationMs === 'number' ? { durationMs: item.durationMs } : {}),
    }];
  }).slice(-JOURNAL_LIMIT);
}

export function readStoredJournal(sessionId: string): CanvasAction[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(`${KEY_PREFIX}${sessionId}`);
    return raw ? readActions(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function writeStoredJournal(sessionId: string, actions: readonly CanvasAction[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (!actions.length) {
      store.removeItem(`${KEY_PREFIX}${sessionId}`);
      return;
    }
    store.setItem(`${KEY_PREFIX}${sessionId}`, JSON.stringify(actions.slice(-JOURNAL_LIMIT)));
  } catch {
    // A full quota must not break the board. The journal is diagnostic, and the
    // in-memory copy is still complete for this tab.
  }
}

/** The live journal of every board this page has opened, by session id. */
const liveJournals = new Map<string, CanvasJournal>();

/**
 * THE journal for one board in this page — the SAME object for every mount of that board.
 *
 * A turn outlives the component that started it (the run store holds it across a lens
 * switch, a route change, a remount), and its `brain.turn` span is closed through the
 * journal it was OPENED on. A journal per mount — hydrated from storage as COPIES of the
 * stored entries — left the remounted board reading the open span from storage while the
 * turn closed the old mount's object nobody reads any more: a turn that finished, reported
 * as one that "never completed". One journal per board per page keeps the span the turn
 * closes and the span the report reads the same object. Hydrated from this tab's storage
 * once, on first use, so a reload still carries the evidence.
 */
export function sessionCanvasJournal(sessionId: string): CanvasJournal {
  const existing = liveJournals.get(sessionId);
  if (existing) return existing;
  const journal = createCanvasJournal();
  const stored = readStoredJournal(sessionId);
  if (stored.length) journal.restore(stored);
  liveJournals.set(sessionId, journal);
  return journal;
}
