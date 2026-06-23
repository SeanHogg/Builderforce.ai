'use client';

/**
 * Single source of truth for the Brain's "Auto-approve actions" mode.
 *
 * The toggle (rendered in BrainPanel) controls TWO surfaces that must agree:
 *   1. The generic human-in-the-loop confirm gate (`needsConfirm`) — skips the
 *      per-mutation Approve/Cancel prompt.
 *   2. The IDE's artifact tools (`generate_prd` / `generate_tasks`) — which open
 *      their OWN review modal. Without reading this flag they prompted even with
 *      auto-approve on, e.g. "create 10 project tasks via a modal" after the user
 *      had explicitly turned the gate off.
 *
 * Persisted per-browser in localStorage so it survives reloads and is shared by
 * every co-mounted Brain surface (page, drawer, IDE panel).
 */

export const BRAIN_AUTO_APPROVE_KEY = 'brain.autoApprove';

/** Whether auto-approve is currently enabled for this browser. */
export function isBrainAutoApprove(): boolean {
  try {
    return localStorage.getItem(BRAIN_AUTO_APPROVE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the auto-approve mode for this browser. */
export function setBrainAutoApprove(on: boolean): void {
  try {
    localStorage.setItem(BRAIN_AUTO_APPROVE_KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}
