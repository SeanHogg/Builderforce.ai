/**
 * Chat MODE, UI side — "am I asking a question, or asking for work to be done?"
 *
 * Two modes per conversation (see `brain-embedded/src/chatMode.ts` for what each one
 * MEANS to the model, and migration 0409 for where the choice is stored):
 *
 *   • `chat` — read, reason, answer. Where an unreadable stored value rests.
 *   • `work` — create the ticket, scope it, link it to this conversation, and dispatch
 *     an agent to run it. What a NEW conversation opens in.
 *
 * This module owns the two things the model-facing package must NOT: the option list
 * the UI renders, and the WORK OPTIONS — a small catalogue of the jobs people actually
 * hand over. Picking one seeds the composer with a COMPLETE brief rather than a topic.
 *
 * ── WHY THE BRIEFS ARE LONG ──────────────────────────────────────────────────────
 * A one-line seed ("audit my spreadsheet") produces a turn that asks three clarifying
 * questions, because it genuinely is ambiguous. The briefs here are written the way a
 * good delegation is written — what to look at, what counts as a finding, what to do
 * about it, and where to stop and check in — so the very first turn can do real work.
 * They are a starting point the user edits, not a message to send verbatim, which is
 * why the composer drops the caret at the END of the seeded text (`focusToken`).
 *
 * Labels/hints/briefs are localized (`brain.modes.*`, `brain.workOptions.<id>.*`); the
 * ids are stable, non-translatable keys.
 */

export { CHAT_MODES, NEW_CHAT_MODE, RESTING_CHAT_MODE, CHAT_MODE_ICON, isChatMode, normalizeChatMode } from '@seanhogg/builderforce-brain-embedded';
export type { ChatMode } from '@seanhogg/builderforce-brain-embedded';

/**
 * A job a user can hand over in Work mode. `id` keys the localized label, hint and
 * brief; `icon` is decorative.
 *
 * Deliberately generic across the platform rather than tied to one surface: these are
 * the shapes of delegated work (audit something, chase something, produce something,
 * fix something), not a second copy of the capability catalogue — a capability says
 * what ARTIFACT a chat makes, a work option says what JOB is being handed over.
 */
export interface WorkOptionDef {
  id: WorkOptionId;
  icon: string;
}

export type WorkOptionId =
  | 'audit_spreadsheet'
  | 'review_draft'
  | 'chase_blockers'
  | 'triage_backlog'
  | 'research_and_brief'
  | 'ship_fix';

const WORK_OPTIONS: readonly WorkOptionDef[] = [
  { id: 'audit_spreadsheet', icon: '🧮' },
  { id: 'review_draft', icon: '📝' },
  { id: 'chase_blockers', icon: '🚧' },
  { id: 'triage_backlog', icon: '🗂' },
  { id: 'research_and_brief', icon: '🔎' },
  { id: 'ship_fix', icon: '🔧' },
];

/** Every work option, in display order. */
export function workOptions(): readonly WorkOptionDef[] {
  return WORK_OPTIONS;
}
