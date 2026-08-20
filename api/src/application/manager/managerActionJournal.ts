/**
 * managerActionJournal — the ONE way a manager decision reaches `manager_actions`,
 * and the rule that stops an unchanging verdict being written on every pass.
 *
 * ── WHY THIS IS ITS OWN LEAF MODULE ──────────────────────────────────────────────
 * `recordManagerAction` used to live in ManagerService.ts, which is also where every
 * stage that writes one lives. The change-detecting variant below has to READ the feed
 * before it writes to it, so keeping it there would have made the manager's largest
 * module import itself through a helper. It sits in a leaf store for exactly the reason
 * `managerPolicyStore.ts` does, and ManagerService re-exports both so every existing
 * `from './ManagerService'` import keeps resolving.
 *
 * ── EVENTS vs STATES ─────────────────────────────────────────────────────────────
 * A manager pass runs every five minutes. Half of what it journals is an EVENT — it
 * scored a ticket, it merged a PR, it started a run — and an event is worth a row every
 * time it happens. The other half is a STATE: "three stages on this board authorise no
 * role", "this PR is ready but merge authority is withheld". A state re-journalled every
 * pass is not information; it is the same sentence 288 times a day per project.
 *
 * Measured on project 11, 2026-07-31 (api 2026.7.195): the identical `assign` verdict —
 * "3 stages on this board authorise NO role … 317 tickets …" — appears 3× in the last 30
 * decisions, first 07:55:06, last 09:00:02, with nothing about the board having changed
 * in between. It crowds real decisions out of the 30-item feed and the 200-row window,
 * and `manager_actions` is the table already growing ~3.5k rows a day on one project on a
 * deliberately-Free Neon tier. The diagnostics report raises it as `decision_loop`: "a
 * decision re-taken every pass is a loop the manager cannot exit on its own".
 *
 * {@link recordManagerActionOnChange} is the fix: the caller fingerprints the verdict,
 * and the row is written only when that fingerprint differs from the last one journalled
 * for the same state. The fingerprint is the CONTRACT — it must carry every input the
 * verdict was computed from (the lanes, their counts, the reason), so that a genuine
 * change re-arms the journal instead of being suppressed as "already said".
 *
 * ── WHY THE OTHER TWO DEDUPES ARE NOT MIGRATED ONTO THIS ─────────────────────────
 * Two "state, not event" dedupes already exist and neither is duplicating this logic:
 * the ticket audit compares against the verdict stored on `ticket_audits`, and the PR
 * loop's `merge_blocked` dedupe reads counters from a grouped scan it makes anyway. Both
 * get their previous state for free from data the stage already holds. Routing them
 * through this helper would ADD a query per call to replace a comparison that costs
 * nothing — a regression, not a consolidation. This one exists because the board-staffing
 * verdict is stored nowhere else: the feed is its only record.
 */
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { managerActions } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** The columns every manager decision carries. */
export interface ManagerActionInput {
  tenantId: number;
  projectId: number;
  taskId?: number | null;
  runTaskId?: number | null;
  actionType: string;
  summary: string;
  detail?: unknown;
  /**
   * The PULL REQUEST this action was about (0383). REQUIRED in practice for every
   * PR action write — the PR loop's ceilings and its queue order count on this column,
   * and a PR action journalled without it is invisible to both, which is exactly the
   * unbounded merge loop 0383 documents.
   */
  prId?: string | null;
}

/** Append a manager decision to the audit feed. Best-effort. `runTaskId` links the
 *  decision to the board task representing a manual run (null for cron sweeps). */
export async function recordManagerAction(db: Db, a: ManagerActionInput): Promise<void> {
  try {
    await db.insert(managerActions).values(rowFor(a));
  } catch (error) {
    /* the audit feed is best-effort — a write miss must not fail the pass */
    reportCaughtError(error, {
      source: 'application/manager/managerActionJournal.ts', operation: 'recordManagerAction',
    });
  }
}

/**
 * A stable, short identity for a verdict. PURE.
 *
 * The parts are joined and hashed rather than stored verbatim because a verdict like the
 * board-staffing one is a few hundred characters and `manager_actions.detail` is capped at
 * 4000 — a fingerprint that can be truncated away is a fingerprint that silently stops
 * matching, which would restore the every-pass duplicate it exists to prevent.
 *
 * Caller-supplied ORDER is part of the identity, so callers must sort anything set-like
 * before passing it (see `laneStaffingFingerprint`).
 */
export function stateFingerprint(parts: readonly unknown[]): string {
  // FNV-1a, 32-bit. Not a security primitive — it distinguishes one verdict from the
  // next, and a collision costs one suppressed duplicate rather than a wrong decision.
  let h = 0x811c9dc5;
  const text = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p) ?? 'null')).join('');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** How the fingerprint is carried in `detail`, and how it is read back out. */
const STATE_KEY_FIELD = '_stateKey';
const FINGERPRINT_FIELD = '_fingerprint';

/**
 * Journal a STATE — but only when it differs from the last one recorded for the same
 * `stateKey`. Returns true when a row was written.
 *
 * The previous fingerprint is read back off the newest matching row rather than kept in
 * memory or in KV: the pass is a fresh Worker invocation every five minutes, so the feed
 * itself has to be the memory. The lookup is one indexed read
 * (`idx_manager_actions_feed`) against a write it usually replaces.
 *
 * FAILS OPEN. Anything unexpected — an unparsable row, a read error, a different state at
 * the head — records the action. A duplicated decision is noise; a suppressed one is a
 * board defect nobody is told about, and that trade is not close.
 */
export async function recordManagerActionOnChange(
  db: Db,
  a: ManagerActionInput & {
    /** Identifies WHICH state this is, so two states sharing an action type cannot
     *  suppress each other. Stored alongside the fingerprint and compared with it. */
    stateKey: string;
    /** The verdict's identity — see {@link stateFingerprint}. */
    fingerprint: string;
  },
): Promise<boolean> {
  try {
    const [previous] = await db
      .select({ detail: managerActions.detail })
      .from(managerActions)
      .where(and(
        eq(managerActions.tenantId, a.tenantId),
        eq(managerActions.projectId, a.projectId),
        eq(managerActions.actionType, a.actionType),
        a.taskId == null ? isNull(managerActions.taskId) : eq(managerActions.taskId, a.taskId),
        // PR reconciliation can legitimately journal many unlinked PRs (task_id
        // null). Scope state dedupe to the PR when the caller supplies one, or the
        // latest orphan PR would make every sibling look like a changed state.
        ...(a.prId !== undefined
          ? [a.prId == null ? isNull(managerActions.prId) : eq(managerActions.prId, a.prId)]
          : []),
      ))
      .orderBy(desc(managerActions.createdAt))
      .limit(1);
    if (previous?.detail && readMarker(previous.detail, STATE_KEY_FIELD) === a.stateKey
      && readMarker(previous.detail, FINGERPRINT_FIELD) === a.fingerprint) {
      return false;
    }
    await db.insert(managerActions).values(rowFor(a, { stateKey: a.stateKey, fingerprint: a.fingerprint }));
    return true;
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/manager/managerActionJournal.ts', operation: 'recordManagerActionOnChange',
    });
    return false;
  }
}

/**
 * The newest decision of a given kind, HOWEVER OLD.
 *
 * ── THE READ THAT HAD TO MOVE WITH THE WRITE ─────────────────────────────────────
 * Deduping a state fixes the feed and breaks every reader that was scanning the feed
 * for it. Measured one pass after {@link recordManagerActionOnChange} shipped
 * (project 11, 2026-07-31T11:26Z, api 2026.7.198): the diagnostics report's whole
 * board-staffing block read
 *
 *   "(no board-staffing decision in the last 30 — the sweep found nothing to staff,
 *    or it did not run)"
 *
 * while 306 tickets sat in stages that authorise no role — the exact contradiction that
 * block exists to catch, manufactured by the fix that stopped the duplicate. A verdict
 * written once is not less true than one written 288 times a day; it is just no longer
 * inside a 30-row window, so the reader has to ask for it by name.
 *
 * Board-scope decisions only (`task_id is null`) — a per-ticket row of the same type is a
 * different thing entirely, and mixing them is how a staffing verdict would be answered
 * by an owner assignment. Index-backed by `idx_manager_actions_feed`.
 */
export interface ManagerStateDecision {
  actionType: string;
  summary: string;
  detail: string | null;
  createdAt: Date;
}

export async function latestStateDecision(
  db: Db,
  args: { tenantId: number; projectId: number; actionType: string },
): Promise<ManagerStateDecision | null> {
  const [row] = await db
    .select({
      actionType: managerActions.actionType,
      summary: managerActions.summary,
      detail: managerActions.detail,
      createdAt: managerActions.createdAt,
    })
    .from(managerActions)
    .where(and(
      eq(managerActions.tenantId, args.tenantId),
      eq(managerActions.projectId, args.projectId),
      eq(managerActions.actionType, args.actionType),
      isNull(managerActions.taskId),
    ))
    .orderBy(desc(managerActions.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Read a marker back out of a stored `detail`.
 *
 * By REGEX, not `JSON.parse`: `detail` is truncated to 4000 characters on write, so a
 * long payload is stored as invalid JSON and any parse of it throws. The markers are
 * serialised first (see {@link rowFor}), which puts them inside the surviving prefix of
 * every row however long the rest of the payload is.
 */
function readMarker(detail: string, field: string): string | null {
  return new RegExp(`"${field}":"([^"]*)"`).exec(detail)?.[1] ?? null;
}

/**
 * Action types whose `detail` is READ BACK by code, not just displayed.
 *
 * ── WHY THIS REGISTRY EXISTS ─────────────────────────────────────────────────────
 * `manager_actions` measured 593 MB holding ~24 MB of real data, and the driver is the
 * every-5-minute cross-tenant sweep writing a `detail` blob — up to 4000 characters —
 * on rows nothing ever reads. Dropping it for cron feed rows is the fix.
 *
 * The obvious rule ("drop `detail` whenever `run_task_id IS NULL`") is WRONG and would
 * have been a silent correctness bug: `merge_blocked` is written by the cron pass with a
 * null `run_task_id`, and the PR loop's ceiling counts blocked reports with
 * `detail NOT LIKE '%"reason":"conflict_exhausted"%'` (ManagerService). Drop that
 * payload and every historical block reads as still-terminal, which withholds merge
 * authority on a backlog that should have revived.
 *
 * So retention is declared per action type here, rather than inferred from a column that
 * only correlates with it. Add a type to this set the moment anything starts PARSING its
 * detail — {@link managerActionJournal.test.ts} pins the one case that exists.
 */
const DETAIL_READING_ACTIONS: ReadonlySet<string> = new Set([
  // ManagerService's PR-loop ceiling greps this row's detail for `conflict_exhausted`.
  'merge_blocked',
]);

/**
 * Whether this row's `detail` payload is worth storing.
 *
 * Retained when ANY of:
 *  • it is a STATE row — the fingerprint markers in `detail` ARE the dedupe contract
 *    ({@link recordManagerActionOnChange}); drop them and every state re-journals
 *    on every pass, which is the bloat this module already exists to prevent;
 *  • something parses this action type's detail ({@link DETAIL_READING_ACTIONS});
 *  • it belongs to a MANUAL run (`runTaskId` set) — a human asked for that pass and is
 *    entitled to the full record of it. These are rare and bounded, unlike the sweep.
 *
 * Otherwise the row is a cron FEED row: its `summary` (kept, capped at 500) is what the
 * feed shows, and the JSON blob under it is decoration nobody reads.
 */
export function retainsDetail(a: ManagerActionInput, isState: boolean): boolean {
  return isState || DETAIL_READING_ACTIONS.has(a.actionType) || a.runTaskId != null;
}

function rowFor(a: ManagerActionInput, state?: { stateKey: string; fingerprint: string }) {
  return {
    tenantId: a.tenantId,
    projectId: a.projectId,
    taskId: a.taskId ?? null,
    prId: a.prId ?? null,
    runTaskId: a.runTaskId ?? null,
    actionType: a.actionType,
    summary: a.summary.slice(0, 500),
    detail: retainsDetail(a, state != null) ? serializeDetail(a.detail, state) : null,
  };
}

function serializeDetail(
  detail: unknown,
  state?: { stateKey: string; fingerprint: string },
): string | null {
  if (state == null) return detail !== undefined ? JSON.stringify(detail).slice(0, 4000) : null;
  // Markers FIRST so they survive the 4000-character truncation — see {@link readMarker}.
  const payload = isPlainObject(detail) ? detail : detail === undefined ? {} : { detail };
  return JSON.stringify({
    [STATE_KEY_FIELD]: state.stateKey,
    [FINGERPRINT_FIELD]: state.fingerprint,
    ...payload,
  }).slice(0, 4000);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/* ─────────────────────────────────────────────────────────────────────────────
 * THE PR ACTION VOCABULARY.
 *
 * These moved out of ManagerService when the PR merge loop became its own registry
 * sweep (`application/repos/prMergeSweep.ts`). They belong here for the same reason
 * `recordManagerAction` does: they are the journal's own vocabulary, and both the
 * merge sweep that WRITES them and the manager pass that READS the result now need
 * them — a shared constant in the leaf store, rather than either importing the
 * other.
 * ───────────────────────────────────────────────────────────────────────────── */

/** `manager_actions.action_type` for "PR is ready but merge authority is withheld"
 *  (0363). Its own type — not 'flag' — so the surface can say "waiting on a human to
 *  merge" and the dedupe query can find prior reports for a PR in one indexed lookup.
 *  Must fit `action_type varchar(24)`. */
export const MERGE_BLOCKED_ACTION = 'merge_blocked';

/**
 * `manager_actions.action_type` for "the provider REFUSED this merge" (0381).
 *
 * Its own type for the same reason `merge_blocked` is: it must be COUNTABLE. The refusal
 * used to be journalled as a generic 'flag', which meant nothing could tell one PR's
 * third failed merge from any of the 1,770 other flags that project files in a day — so
 * the attempt was never counted and the merge was retried every five minutes forever.
 * Measured on project 11, 2026-07-28: "Could not merge PR #29 … Pull Request is not
 * mergeable" four times in the last thirty decisions, one per pass, indefinitely.
 */
export const MERGE_FAILED_ACTION = 'merge_failed';

/**
 * `manager_actions.action_type` for "this PR's branch conflicts with its base" (0381).
 *
 * Also promoted out of 'flag', and for a second reason beyond counting: it is the only
 * record that the manager TOUCHED a conflicting PR at all. The sync path writes
 * `sync_pr`, but a PR that conflicts never reaches the sync — so with the conflict
 * hidden inside 'flag' the fair-rotation ordering below would read every conflicting PR
 * as "never acted on" and pin it to the front of the queue on every pass, which is
 * precisely the starvation it exists to end.
 */
export const PR_CONFLICT_ACTION = 'pr_conflict';

/**
 * The action types that count as "the manager did PR work on this ticket".
 *
 * The rotation orders by the newest of these, so the set has to be exactly the actions a
 * PR pass can take and nothing else — including a general type like 'flag' would make
 * every ticket look recently touched and collapse the ordering to arbitrary again.
 */
export const PR_ACTION_TYPES = [
  'sync_pr', 'merge_pr', MERGE_BLOCKED_ACTION, MERGE_FAILED_ACTION, PR_CONFLICT_ACTION,
] as const;


/**
 * How many pull requests LANDED for this project since `since` — the manager pass's
 * READ of work it no longer does itself.
 *
 * ── WHY THE PASS READS THIS INSTEAD OF MERGING ───────────────────────────────────
 * The merge loop used to be stage 4b of the pass, and it was 93% of the pass's measured
 * wall-clock (project 11, 2026-07-30: `pr: 28839ms` of a 30888ms pass) — mechanical,
 * provider-bound, high-volume work whose cadence has nothing to do with ranking or
 * triage, starving every stage behind it. It is now its own registry sweep
 * (`application/repos/prMergeSweep.ts`) with its own budget, so the pass cannot be
 * starved by PR volume BY CONSTRUCTION rather than by a tuned window.
 *
 * The pass still reports `prsMerged` on its closing row, because "what landed" is part
 * of what a manager accounts for. It gets that number from the journal the sweep writes
 * — one indexed COUNT on `(tenant_id, project_id, action_type)` — instead of doing the
 * work to be able to say it.
 */
export async function countPrMergesSince(
  db: Db,
  args: { tenantId: number; projectId: number; since: Date | null },
): Promise<number> {
  // No previous pass to measure from → nothing to attribute to this window. Reporting a
  // project's all-time merge count on its first pass would read as "this pass merged 40".
  if (!args.since) return 0;
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(managerActions)
      .where(and(
        eq(managerActions.tenantId, args.tenantId),
        eq(managerActions.projectId, args.projectId),
        eq(managerActions.actionType, 'merge_pr'),
        gte(managerActions.createdAt, args.since),
      ));
    return Number(row?.n ?? 0);
  } catch (error) {
    reportCaughtError(error, {
      source: 'application/manager/managerActionJournal.ts', operation: 'countPrMergesSince',
    });
    return 0;
  }
}
