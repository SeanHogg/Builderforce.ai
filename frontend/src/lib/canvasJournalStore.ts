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

import type { CanvasAction } from './canvasActionJournal';
import { JOURNAL_LIMIT } from './canvasActionJournal';

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
