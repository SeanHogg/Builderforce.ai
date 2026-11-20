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
 * EVERY kind, so they are not repeated in a kind's lists: `cancelled` is a value of every
 * write vocabulary below (portfolio, initiative, objective, roadmap), and "cancel
 * initiative X" keeps the rollup skip a cancelled task lane has.
 *
 * The write vocabularies (`TICKET_STATUS_VALUES`) are the values a write may store; the
 * api's tools and REST trackers accept nothing else (`checkTicketStatus`), apart from the
 * per-kind aliases (`TICKET_STATUS_ALIASES`) that are stored as the word they stand for.
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
export const PORTFOLIO_STATUSES = ["active", "archived", "cancelled"] as const;
/** api schema/delivery.ts `initiatives.status`. */
export const INITIATIVE_STATUSES = ["proposed", "active", "completed", "archived", "cancelled"] as const;
/** api schema/delivery.ts `objectives.status` (also the objectives.create/update tool enum). */
export const OBJECTIVE_STATUSES = ["active", "achieved", "missed", "archived", "cancelled"] as const;
/** Roadmap item lifecycle (the roadmap panel's choices; `shipped` is the publish marker, api productRoutes.ts). */
export const ROADMAP_STATUSES = ["planned", "in_progress", "shipped", "cancelled"] as const;
/** Legacy delivered spellings older roadmap rows carry: read as closed, and accepted as INPUT but stored as `shipped`. */
export const ROADMAP_LEGACY_DELIVERED_STATUSES = ["done", "complete", "completed", "released"] as const;

export type InitiativeStatus = (typeof INITIATIVE_STATUSES)[number];
type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

/** A subset of `vocabulary` — only members compile, so a closed list cannot name a word the column never holds. */
function pick<T extends string>(_vocabulary: readonly T[], ...words: T[]): readonly string[] {
  return words;
}

/**
 * Every status a write may STORE, per kind whose status column is free-form text — what the
 * api's create/update tools advertise. Unknown values are rejected by {@link checkTicketStatus}:
 * a typo such as an initiative set to `done` would otherwise never read as closed (stuck at
 * the claimed-complete rung).
 */
export const TICKET_STATUS_VALUES = {
  portfolio: PORTFOLIO_STATUSES,
  initiative: INITIATIVE_STATUSES,
  objective: OBJECTIVE_STATUSES,
  roadmap: ROADMAP_STATUSES,
} as const satisfies Readonly<Record<string, readonly string[]>>;

export type TicketStatusKind = keyof typeof TICKET_STATUS_VALUES;

/** Input spellings a kind still accepts, mapped to the value that is stored. */
export const TICKET_STATUS_ALIASES: Readonly<Partial<Record<TicketStatusKind, Readonly<Record<string, string>>>>> = {
  roadmap: Object.fromEntries(ROADMAP_LEGACY_DELIVERED_STATUSES.map((word) => [word, "shipped" satisfies RoadmapStatus])),
};

/** The outcome of checking a status a write wants to set (see {@link checkTicketStatus}). */
export type TicketStatusCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Check a status a write wants to set on a `kind` item, without throwing — for a caller that
 * answers a refusal itself (an HTTP 400).
 *
 * - `current` (an update): a status equal to the stored one (case-insensitively) is not a
 *   change, so it passes through as the stored value untouched — a row carrying an
 *   off-vocabulary legacy status stays editable.
 * - A value of the kind's vocabulary comes back lower-cased; an alias (a legacy roadmap
 *   `released`) comes back as the value it stands for (`shipped`).
 * - Anything else — or a null status — is refused with a message naming the allowed values.
 */
export function checkTicketStatus(kind: TicketStatusKind, raw: unknown, current?: string | null): TicketStatusCheck {
  if (raw === null || raw === undefined) return { ok: false, error: `${kind} status cannot be null` };
  const value = norm(String(raw));
  if (current != null && value === norm(current)) return { ok: true, value: current };
  const allowed: readonly string[] = TICKET_STATUS_VALUES[kind];
  if (allowed.includes(value)) return { ok: true, value };
  const alias = TICKET_STATUS_ALIASES[kind]?.[value];
  if (alias) return { ok: true, value: alias };
  return { ok: false, error: `${kind} status must be one of: ${allowed.join(", ")} (got "${String(raw)}")` };
}

/**
 * Validate a status a write wants to set on a `kind` item: the value to store, or throws an
 * Error naming the allowed values ({@link checkTicketStatus}, same `current` rule).
 */
export function parseTicketStatus(kind: TicketStatusKind, raw: unknown, current?: string | null): string {
  const checked = checkTicketStatus(kind, raw, current);
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
  // Legacy delivered spellings are still read as closed: older rows carry them.
  roadmap: { closed: [...pick(ROADMAP_STATUSES, "shipped"), ...ROADMAP_LEGACY_DELIVERED_STATUSES], cancelled: [] },
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
