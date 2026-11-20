/**
 * Which status words mean a linked ticket is FINISHED — per ticket kind, as DATA.
 *
 * Every kind a chat can be tied to speaks its own status vocabulary: a task lane closes
 * at `done`, a spec at `complete`, a roadmap item at `shipped`, an initiative at
 * `completed`, an objective at `achieved`. `TASK_CLOSED_STATUSES` only knows the task
 * lanes, so before this registry a non-task container whose status was still active
 * (an initiative `active` with every child task done) passed a raw 100 through, and a
 * spec `complete` was "open" to every task-lane check.
 *
 * This is the ONE registry: the progress rule (`effectiveTicketProgress`), the chat
 * rollup's cancelled skip (`isExcludedFromChatHealth`), the api's ticket health and list
 * filters, and the VS Code rail all read it. Each list cites the schema column / status
 * constant it is derived from — add a word here only when that source gains one.
 *
 * - `closed`: the item is finished; its ring reads 100 whatever its raw figure says.
 * - `cancelled`: closed WITHOUT delivery — a subset of `closed` that the chat rollup
 *   skips like a cancelled lane (removed work, not remaining work).
 *
 * The shared cancelled spellings (`cancelled`, `canceled`) are closed-and-cancelled for
 * EVERY kind, so a free-form status column (portfolio, initiative) that someone set to
 * `cancelled` keeps the skip it always had.
 *
 * A kind that is not listed here has no declared vocabulary: it is closed only by the
 * task lanes' words (`isClosedTaskStatus`) and is never capped.
 */

import {
  isCancelledTaskStatus,
  isClosedTaskStatus,
  TASK_CANCELLED_STATUSES,
  TASK_CLOSED_STATUSES,
} from "./taskClosedState.js";

/** One kind's finished-status words (lower case). */
export interface TicketStatusVocabulary {
  /** Statuses that mean the item is finished. Includes every word in `cancelled`. */
  readonly closed: readonly string[];
  /** Finished without delivery: skipped by the chat rollup like a cancelled lane. */
  readonly cancelled: readonly string[];
}

/** The task lanes (task, gap and epic all live in the `tasks` table). */
const TASK_TABLE: TicketStatusVocabulary = { closed: TASK_CLOSED_STATUSES, cancelled: TASK_CANCELLED_STATUSES };

/**
 * A team ceremony session (retrospective, planning-poker session). Source: api
 * `domain/agile/ceremonySession.ts` — `CEREMONY_SESSION_STATUSES` (active | completed |
 * cancelled) plus the legacy read spellings `closed` / `archived` that older rows carry.
 * That module derives its `CEREMONY_SESSION_DONE` from this list.
 */
export const CEREMONY_SESSION_CLOSED_STATUSES: readonly string[] = ["completed", "cancelled", "closed", "archived"];

// `cancelled` is closed-and-cancelled for every kind via the shared spellings, so it is
// not repeated in a kind's lists below.
const CEREMONY_SESSION: TicketStatusVocabulary = { closed: CEREMONY_SESSION_CLOSED_STATUSES, cancelled: [] };

// ── Full status vocabularies of the free-form (varchar) status columns ──────────────
// The ONE source of truth for what a write may set (the api's create/update tools take
// their `status` enum from these) AND for which of those words mean "closed" (picked
// below with `pick`, which only compiles for a member of the vocabulary).

/** api schema/delivery.ts `portfolios.status`. */
export const PORTFOLIO_STATUSES = ["active", "archived"] as const;
/** api schema/delivery.ts `initiatives.status`. */
export const INITIATIVE_STATUSES = ["proposed", "active", "completed", "archived"] as const;
/** api schema/delivery.ts `objectives.status` (also the objectives.create/update tool enum). */
export const OBJECTIVE_STATUSES = ["active", "achieved", "missed", "archived"] as const;
/** Roadmap item lifecycle (the roadmap panel's choices; `shipped` is the publish marker, api productRoutes.ts). */
export const ROADMAP_STATUSES = ["planned", "in_progress", "shipped", "cancelled"] as const;
/** Legacy delivered spellings older roadmap rows carry; still accepted as input and read as closed. */
export const ROADMAP_LEGACY_DELIVERED_STATUSES = ["done", "complete", "completed", "released"] as const;

/** A subset of `vocabulary` — only members compile, so a closed list cannot name a word the column never holds. */
function pick<T extends string>(_vocabulary: readonly T[], ...words: T[]): readonly string[] {
  return words;
}

/**
 * Every status a write may set, per kind whose status column is free-form text. Unknown
 * values are rejected by {@link parseTicketStatus}: a typo such as an initiative set to
 * `done` would otherwise never read as closed (stuck at the claimed-complete rung).
 */
export const TICKET_STATUS_VALUES = {
  portfolio: PORTFOLIO_STATUSES,
  initiative: INITIATIVE_STATUSES,
  objective: OBJECTIVE_STATUSES,
  roadmap: [...ROADMAP_STATUSES, ...ROADMAP_LEGACY_DELIVERED_STATUSES],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type TicketStatusKind = keyof typeof TICKET_STATUS_VALUES;

/** The outcome of checking a status a write wants to set (see {@link checkTicketStatus}). */
export type TicketStatusCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Check a status a write wants to set on a `kind` item, without throwing — for a caller
 * that answers a refusal itself (an HTTP 400). The value comes back lower-cased; a
 * refusal names the allowed values.
 */
export function checkTicketStatus(kind: TicketStatusKind, raw: unknown): TicketStatusCheck {
  const allowed: readonly string[] = TICKET_STATUS_VALUES[kind];
  const value = norm(typeof raw === "string" ? raw : String(raw));
  return allowed.includes(value)
    ? { ok: true, value }
    : { ok: false, error: `${kind} status must be one of: ${allowed.join(", ")} (got "${String(raw)}")` };
}

/**
 * Validate a status a write wants to set on a `kind` item: returns it lower-cased, or
 * throws an Error naming the allowed values ({@link checkTicketStatus}).
 */
export function parseTicketStatus(kind: TicketStatusKind, raw: unknown): string {
  const checked = checkTicketStatus(kind, raw);
  if (!checked.ok) throw new Error(checked.error);
  return checked.value;
}

/** Kind → its finished-status words. Keys are the chat ticket kinds (api `TICKET_KINDS`). */
export const TICKET_CLOSED_STATES: Readonly<Record<string, TicketStatusVocabulary>> = {
  // agent-loop `taskClosedState.ts` TASK_CLOSED_STATUSES / TASK_CANCELLED_STATUSES.
  task: TASK_TABLE,
  gap: TASK_TABLE,
  epic: TASK_TABLE,
  portfolio: { closed: pick(PORTFOLIO_STATUSES, "archived"), cancelled: [] },
  initiative: { closed: pick(INITIATIVE_STATUSES, "completed", "archived"), cancelled: [] },
  // A MISSED objective is over without delivering, so it is skipped like a cancelled lane
  // rather than counted done (its own ring still reads 100: it is closed).
  objective: { closed: pick(OBJECTIVE_STATUSES, "achieved", "missed", "archived"), cancelled: pick(OBJECTIVE_STATUSES, "missed") },
  roadmap: { closed: pick(TICKET_STATUS_VALUES.roadmap, "shipped", ...ROADMAP_LEGACY_DELIVERED_STATUSES), cancelled: [] },
  // api schema/kernel.ts `specStatusEnum`: draft | ready | in_progress | complete (a pg
  // enum, so the api test asserts this word is one of its values).
  spec: { closed: ["complete"], cancelled: [] },
  retro: CEREMONY_SESSION,
  poker: CEREMONY_SESSION,
};

const CLOSED_BY_KIND = new Map(
  Object.entries(TICKET_CLOSED_STATES).map(([kind, v]) => [kind, { closed: new Set(v.closed), cancelled: new Set(v.cancelled) }]),
);

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/** True when `kind` declares its own status vocabulary in {@link TICKET_CLOSED_STATES}. */
export function hasTicketStatusVocabulary(kind: string | null | undefined): boolean {
  return CLOSED_BY_KIND.has(norm(kind));
}

/**
 * Is a `kind` ticket in `status` finished? Per the kind's declared words; the shared
 * cancelled spellings are closed for every kind. A kind with no declared vocabulary
 * (or none given) is closed only by the task lanes' words.
 */
export function isClosedTicketStatus(kind: string | null | undefined, status: string | null | undefined): boolean {
  const vocab = CLOSED_BY_KIND.get(norm(kind));
  if (!vocab) return isClosedTaskStatus(status);
  return vocab.closed.has(norm(status)) || isCancelledTaskStatus(status);
}

/**
 * Is a `kind` ticket in `status` finished WITHOUT delivery (skipped by the chat rollup)?
 * The shared cancelled spellings for every kind, plus the kind's own cancelled words.
 */
export function isCancelledTicketStatus(kind: string | null | undefined, status: string | null | undefined): boolean {
  if (isCancelledTaskStatus(status)) return true;
  return CLOSED_BY_KIND.get(norm(kind))?.cancelled.has(norm(status)) ?? false;
}
