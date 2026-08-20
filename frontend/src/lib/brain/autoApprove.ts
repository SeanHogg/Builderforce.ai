'use client';

import {
  localStorageConfirmationPersistence,
  type ToolConfirmationPersistence,
} from '@seanhogg/builderforce-brain-embedded';

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

/**
 * This browser's storage adapter for the shared {@link useToolConfirmationGate}.
 *
 * The guarded read/write pair itself is the SHARED one — a blocked or partitioned
 * `localStorage` must degrade to "not persisted" rather than throw, and that guard has no
 * business existing twice. What stays here is the web app's POLICY: which key, and that a
 * browser with nothing stored defaults ON (see {@link BRAIN_AUTO_APPROVE_DEFAULT}).
 */
export const brainAutoApprovePersistence: ToolConfirmationPersistence =
  localStorageConfirmationPersistence(BRAIN_AUTO_APPROVE_KEY);

/** New browsers default ON; an explicit off is preserved. */
export const BRAIN_AUTO_APPROVE_DEFAULT = true;

/** Whether auto-approve is enabled. For the NON-gate consumers (the IDE artifact tools
 *  and the canvas), which read the flag outside a React render. The gate itself uses
 *  {@link useToolConfirmationGate} with {@link brainAutoApprovePersistence}. */
export function isBrainAutoApprove(): boolean {
  return brainAutoApprovePersistence.read() ?? BRAIN_AUTO_APPROVE_DEFAULT;
}

/** Persist the auto-approve mode for this browser. */
export function setBrainAutoApprove(on: boolean): void {
  brainAutoApprovePersistence.write(on);
}
