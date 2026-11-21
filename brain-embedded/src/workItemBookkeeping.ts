/**
 * WORK-ITEM BOOKKEEPING — the ticket / task / kanban tools (account `builtin_tasks_*`, `builtin_tickets_*`, `builtin_kanban_*`
 * and the editor's device-local `ticket-*`), and the request language that asks for them.
 *
 * A write through one of these records work on the board; it never changes the code a CHANGE request asked for. So a run asked
 * to "fix the regression" whose only successful writes were `ticket-create`, `ticket-move` and `builtin_tasks_update` has had no
 * EFFECT (VS Code chat #165961, which the diagnostics scored "healthy"), unless the person asked for the board work itself
 * ({@link asksForWorkItems}). ONE definition, read by the run's effect accounting (`runEffect.ts`) and the open-work hold's
 * progress test (`runStore/openLinkedWorkHold.ts`), so "a ticket write" cannot mean two things.
 *
 * Pure strings; safe in every bundle.
 */

import { isReadOnlyPlatformTool } from './chatWorkLinking';
import { SERVER_TICKET_LINK_TOOL } from './ticketToolVocabulary';

/** The work-item tool family (account and device): ticket, task and kanban tools, reads and writes alike. */
const WORK_ITEM_TOOL = /^(builtin_(tasks|tickets|kanban)_|ticket[-_.])/i;

/** The device-local ticket READS (`ticket-list`, `ticket-get`, …); the account's reads are classified by suffix. */
const LOCAL_TICKET_READ = /^ticket[-_.](list|get|search|read)/i;

/** Is `name` a work-item tool (a ticket, task or kanban tool — read or write — or the link of a ticket to the chat)? */
export function isWorkItemTool(name: string): boolean {
  return WORK_ITEM_TOOL.test(name) || name === SERVER_TICKET_LINK_TOOL;
}

/** Is `name` a work-item WRITE — a ticket / task / kanban create, move or update, on the account or the device (`ticket-create`)? */
export function isWorkItemWrite(name: string): boolean {
  return isWorkItemTool(name) && !isReadOnlyPlatformTool(name) && !LOCAL_TICKET_READ.test(name);
}

/**
 * TICKETING language — a filing verb with a ticket noun ("create associated tickets", "file one task per row", "open a separate
 * issue for each"). Data, not logic. `open` counts only with a determiner, so "the open issues" / "open items" never do.
 */
export const TICKETING_INTENTS: readonly RegExp[] = [
  /\b(?:create|file|raise|log)\s+(?:[\w'-]+\s+){0,3}?(?:tickets?|tasks?|issues?)\b/i,
  /\bopen\s+(?:an?|one|new|separate|individual)\s+(?:[\w'-]+\s+){0,2}?(?:tickets?|tasks?|issues?)\b/i,
];

/** Does `text` ask for board work itself (filing tickets / tasks)? Then a work-item write IS the requested effect. */
export function asksForWorkItems(text: string | null | undefined): boolean {
  const t = text ?? '';
  return TICKETING_INTENTS.some((p) => p.test(t));
}
