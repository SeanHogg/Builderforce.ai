/**
 * The run's view of its TICKETS — read from the run's own trace and from its chat's listing: which tickets the run filed,
 * created and moved (and to which lane, last), which it therefore OWNS, and the ONE listing read every ticket backstop goes through.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * Four places listed a chat's tickets, each with its own catch (two of them silent). And a chat's links are not the run's work:
 * a chat collects every ticket anyone linked to it, so a close-out that moved "every in_review ticket linked to the chat" would
 * close someone else's review the moment this run shipped. The backstops act only on {@link runOwnedTicketRefs}.
 *
 * Pure readers plus one listing call: the backstops that MOVE tickets (`runBackstops.ts`) import from here, never the reverse.
 */

import { syncIdText } from '@builderforce/local-first';
import type { BrainTraceEvent } from '../brainTriage';
import { CHAT_TICKET_LIST_TOOL } from '../chatWorkLinking';
import { errorMessage } from '../pageEngines/types';
import { isLocalTicketCreateLabel, SERVER_TICKET_CREATE_TOOL } from '../ticketToolVocabulary';
import { isFailedToolResult } from '../toolFailure';
import { entityIdsOf } from '../toolResultRecord';
import { bounded } from './deadline';
import { nowIso } from './runCells';
import type { BrainRunRequest } from './runTypes';

/** A status change by either vocabulary: the editor's `ticket-move` or the account's `builtin_tasks_update`. */
const MOVE_LABEL = /^(ticket[-_.]move|builtin_tasks_update)$/i;

/** A recorded tool step that succeeded. */
export const stepSucceeded = (ev: BrainTraceEvent): boolean => ev.category === 'tool' && !ev.isError && !isFailedToolResult(ev.result);

/** One ticket THIS run created: its ref, every id it is known by, and the create's args. */
export interface TicketFiling {
  /** Its LocalId, else its SyncId as text — the ref it is moved by. */
  ref: string;
  /** Its account id as text, when the create answered one. */
  syncRef: string | null;
  /** Every id it is known by (local and account). */
  ids: string[];
  args: Record<string, unknown>;
  /** Filed on the device (`ticket-create`), not through the account's create. */
  local: boolean;
  /** Filed by the run's hand-off (`reason: 'hand_off'`), not by the model mid-run. */
  handOff: boolean;
}

/** Every ticket this run created — the device's `ticket-create` and the account's `builtin_tasks_create` — in the order filed, once each. */
export function ticketsCreatedInRun(trace: readonly BrainTraceEvent[]): TicketFiling[] {
  const filings: TicketFiling[] = [];
  for (const ev of trace) {
    const local = isLocalTicketCreateLabel(ev.label);
    if (!stepSucceeded(ev) || (!local && ev.label !== SERVER_TICKET_CREATE_TOOL)) continue;
    const args = (ev.args ?? {}) as Record<string, unknown>;
    const { localId, syncId } = entityIdsOf(ev.result);
    const syncRef = syncId != null ? syncIdText(syncId) : null;
    const ref = localId ?? syncRef;
    if (!ref || filings.some((f) => f.ref === ref)) continue;
    filings.push({ ref, syncRef, ids: [localId, syncRef].filter((id): id is string => id != null), args, local, handOff: args.reason === 'hand_off' });
  }
  return filings;
}

/**
 * The device-local tickets THIS run's HAND-OFF filed — the tickets the run's own work stands for. A follow-up or bug ticket the
 * model files mid-run is NOT one: the close-out never moves it. The account's chat listing cannot see a ticket that has not
 * synced, so the run's own record is the only place they can be read from.
 */
export function localTicketFilings(trace: readonly BrainTraceEvent[]): TicketFiling[] {
  return ticketsCreatedInRun(trace).filter((f) => f.local && f.handOff);
}

/** The refs of {@link localTicketFilings}, in the order filed. */
export function localTicketsFiledInRun(trace: readonly BrainTraceEvent[]): string[] {
  return localTicketFilings(trace).map((f) => f.ref);
}

/** One successful status move, with its position in the trace. */
export interface TicketMove {
  status: string;
  at: number;
}

/** The last successful status move of each ticket this run moved, keyed by the id the move named (as text). */
export function ticketMovesInRun(trace: readonly BrainTraceEvent[]): Map<string, TicketMove> {
  const moved = new Map<string, TicketMove>();
  trace.forEach((ev, at) => {
    if (!stepSucceeded(ev) || !MOVE_LABEL.test(ev.label)) return;
    const a = (ev.args ?? {}) as { id?: unknown; status?: unknown };
    if ((typeof a.id === 'string' || typeof a.id === 'number') && typeof a.status === 'string') moved.set(String(a.id).trim(), { status: a.status, at });
  });
  return moved;
}

/** The lane a ticket known by `ids` was LAST moved to this run — the latest move by trace position across all of its ids. */
export function latestStatus(moves: ReadonlyMap<string, TicketMove>, ids: readonly string[]): string | undefined {
  let latest: TicketMove | undefined;
  for (const id of ids) {
    const move = moves.get(id);
    if (move && (!latest || move.at > latest.at)) latest = move;
  }
  return latest?.status;
}

/**
 * The tickets THIS run owns, by id as text: its delta ticket, every ticket a `from_delta` it made attached to or minted, every
 * ticket it moved, and every ticket it created (device or account; by local id and by account id).
 */
export function runOwnedTicketRefs(trace: readonly BrainTraceEvent[], deltaTicketId: number | null = null): Set<string> {
  const owned = new Set<string>();
  if (deltaTicketId != null) owned.add(String(deltaTicketId));
  for (const ev of trace) {
    if (ev.label !== 'builtin_tickets_from_delta' || !stepSucceeded(ev)) continue;
    const taskId = (ev.args as { taskId?: unknown } | undefined)?.taskId;
    if (typeof taskId === 'number' || typeof taskId === 'string') owned.add(String(taskId).trim());
    const { syncId } = entityIdsOf(ev.result);
    if (syncId != null) owned.add(syncIdText(syncId));
  }
  for (const id of ticketMovesInRun(trace).keys()) owned.add(id);
  for (const filing of ticketsCreatedInRun(trace)) for (const id of filing.ids) owned.add(id);
  return owned;
}

/** Where a listing failure is reported, and under which label. */
export interface ListingReport {
  note?: (ev: BrainTraceEvent) => void;
  label: string;
  /** What the caller does without the listing, said on the note. */
  consequence: string;
  /** Stop waiting after this long: a hung listing is reported like a failed one. Absent ⇒ the caller bounds the wait itself. */
  timeoutMs?: number;
}

/**
 * List the tickets linked to a chat through the run's tool runner. A thrown call or a failed result is REPORTED on the run
 * (`report.note`) and answered with null — never a silent skip, never a throw.
 */
export async function listChatTickets(req: Pick<BrainRunRequest, 'runTool'>, chatId: number, report: ListingReport): Promise<unknown | null> {
  if (!req.runTool) return null;
  let listed: unknown;
  try {
    const call = req.runTool(CHAT_TICKET_LIST_TOOL, { chatId });
    listed = await (report.timeoutMs != null ? bounded(report.timeoutMs, call) : call);
  } catch (e) {
    listed = { ok: false, error: errorMessage(e) };
  }
  if (!isFailedToolResult(listed)) return listed;
  const why = (listed as { error?: unknown } | null)?.error;
  report.note?.({
    ts: nowIso(), category: 'message', label: report.label, args: { chatId },
    result: `The chat's linked tickets could not be listed${typeof why === 'string' ? ` (${why})` : ''}: ${report.consequence}`,
  });
  return null;
}
