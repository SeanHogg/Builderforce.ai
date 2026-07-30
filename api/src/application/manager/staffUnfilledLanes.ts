/**
 * staffUnfilledLanes — staff a BOARD's unfilled lifecycle roles once, instead of
 * rediscovering the same gap on 293 tickets one at a time.
 *
 * ── THE ARITHMETIC THAT MADE THE PER-TICKET REMEDY UNABLE TO WIN ─────────────────
 * `staffUnfilledRole` already fixes this cause correctly: it pins a capable teammate to
 * the role (or hires one) at PROJECT scope, so every ticket blocked on that role is
 * unblocked by a single write. But it was only reachable from `applyRemedy('coordinate')`
 * — a PER-TICKET remedy, inside the deep triage stage, which is
 *
 *   • capped at a handful of tickets per pass, and
 *   • the LAST stage of the pass, so it is the one shed when the budget runs out.
 *
 * Measured on project 11 (2026-07-28, api 2026.7.171): the `managed_no_role` cohort stood
 * at **293 of 678 stalled tickets** with the oldest idle 16 days, while the pass journal
 * showed `Stall triage skipped this pass` on repeat and every register row's `lastAttempt`
 * was seven hours stale against a five-minute cadence. A project-scope fix reached only
 * through a per-ticket, capped, routinely-shed stage is a fix the board cannot receive.
 *
 * The cohort's size was never the problem. Its CAUSE is per-LANE — "this stage authorises
 * a role and nobody on the roster can act as it" — and a board has a few dozen lanes, not
 * 678 tickets. Asking the question once per lane turns a 293-ticket backlog into at most a
 * couple of writes, in three queries, in well under a second.
 *
 * ── WHY IT IS SAFE TO RUN EVERY PASS ─────────────────────────────────────────────
 * It is idempotent and it is cheap. A lane whose roles all bind resolves to nothing to do,
 * and the common steady state is exactly that: one bulk authority read
 * ({@link loadBoardLaneAuthorities}, three queries for the whole board) and no writes. Only
 * an actually-unfillable role reaches {@link staffUnfilledRole}, which itself prefers
 * pinning an existing capable agent over hiring and is bounded by
 * {@link MAX_HIRES_PER_PASS} across the whole sweep.
 *
 * Deliberately NOT cached: this is a WRITE path whose whole purpose is to notice a
 * staffing gap the moment it exists, and a stale "everything is staffed" verdict would
 * reproduce precisely the standstill it exists to end.
 */
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import {
  decideManagedLaneAuthority, loadBoardLaneAuthorities,
  type LaneAuthorityInputs, type ManagedTaskScope,
} from '../kanban/managedLaneRoles';
import { MAX_HIRES_PER_PASS, staffUnfilledRole, type StaffingAction } from './staffUnfilledRole';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** What staffing one role achieved, for the manager feed. */
export interface LaneStaffingOutcome {
  roleKey: string;
  action: StaffingAction;
  agentName: string | null;
  detail: string;
}

export interface LaneStaffingResult {
  /** Distinct roles this board authorises that resolved to no agent at all. */
  unfilledRoleKeys: string[];
  /** Roles the manager actually filled this pass (pinned or hired). */
  filled: LaneStaffingOutcome[];
  /** Roles it could not fill — an unknown role key, or the hire budget was spent. */
  unfillable: LaneStaffingOutcome[];
  /** Hires made, so the caller can debit the sweep-wide budget. */
  hires: number;
  /**
   * Why the board-wide staffing sweep could not be evaluated. This must be visible:
   * returning an indistinguishable empty success hid 294 undispatchable tickets while
   * every pass appeared to find nothing to staff.
   */
  error: string | null;
}

const EMPTY: LaneStaffingResult = {
  unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0, error: null,
};

/**
 * Every role a board's lanes authorise that binds to NO agent. PURE.
 *
 * Scoped by the ticket SHAPES the board actually holds. The original version asked the
 * unconditional question only — "which roles can never bind for a plain task?" — on the
 * reasoning that a conditional requirement should be left to the per-ticket remedy so
 * this step could never hire for a role the board does not universally need. That
 * reasoning was wrong in one decisive way: the per-ticket remedy is capped and routinely
 * shed, which is the whole reason this board-scope sweep exists. Deferring the
 * conditional roles to it deferred them to nothing, and they were the ones actually
 * blocking the board (see the comment in the body for the measurement).
 *
 * Hiring for a role no ticket needs is still impossible, because the shapes come from the
 * board's own managed tickets: a role is probed only if some real ticket's type/action
 * makes its requirement apply.
 *
 * A role counts as unfilled only when EVERY approver slot carrying it is unbound, under
 * every shape — but that union is taken PER LANE, never across the board. One lane may
 * authorise the same role twice and binding it once is enough to dispatch THAT lane; a
 * different lane binding it proves nothing about this one.
 */
export function unfilledRolesForBoard(
  lanes: Iterable<LaneAuthorityInputs>,
  shapes: readonly ManagedTaskScope[] = [],
): string[] {
  // EVALUATE AGAINST THE TICKET SHAPES ACTUALLY ON THE BOARD, not one synthetic ticket.
  //
  // This used to ask `decideManagedLaneAuthority(inputs, {})` — a single empty task — and
  // that silently hid a whole class of role. Lane requirements are filtered by
  // `requirementApplies`, which scopes them by `ticketType` and by an optional `condition`
  // (`is_security`, `has_ui_change`, `is_data_change`). Against `{}` the task type
  // defaults to 'task' and the action type is undefined, so EVERY requirement scoped to
  // another ticket type and EVERY conditional requirement evaluated false. Their roles
  // were therefore never reported unfilled, never staffed, and never even named in the
  // manager feed.
  //
  // The result was a board sweep that answered "everything binds" while the tickets said
  // otherwise: project 11 held `managed_no_role` at 293 of 673 stalled tickets for days
  // with only 3 `assign` decisions in a whole day, because a security ticket's reviewer
  // or a frontend ticket's UI approver is invisible to a probe that is neither.
  //
  // The empty shape stays in the set so an unconditional requirement is still covered on
  // a board with no tickets at all. The cross-product is small and pure — a few dozen
  // lanes by a handful of distinct shapes, no IO — and the caller passes shapes it has
  // already loaded.
  // ── THE UNION IS PER LANE, NOT PER BOARD ─────────────────────────────────────────
  //
  // The board-wide `bound` set was the second reason this sweep reported "everything
  // binds" while the tickets said otherwise, and it survived the shape fix above because
  // it hides in the same loop. Binding has TWO sources (`bindStaffedAgentsToRoles`): the
  // workspace ROSTER, which is board-wide, and the LANE's own staffed agents, which are
  // not. So a role bound on one lane by an agent staffed to that lane was recorded as
  // bound for the WHOLE board — and every other lane authorising the same role, with no
  // roster candidate and no staffing of its own, was filtered right back out of the
  // unfilled set. The project-scope pin that would have fixed those lanes (the roster is
  // where `staffUnfilledRole` writes) was therefore never made.
  //
  // Measured on project 11, 2026-07-29 (api 2026.7.180, i.e. WITH the shape fix live):
  // `managed_no_role` standing at 294 of 670 stalled tickets, oldest idle 17 days, while
  // this stage journalled ZERO `assign` decisions in 429 decisions that day — the exact
  // signature of a sweep that believes it has nothing to do. The stalled tickets sat on
  // `ready` (Requirements & Design) owing `product-owner`, a role bound elsewhere on the
  // board by a lane-staffed agent.
  //
  // Within ONE lane the union is still right: binding is shape-independent, and a lane
  // that authorises a role twice dispatches on either binding.
  const probes: ManagedTaskScope[] = [{}, ...shapes];
  const unfilled = new Set<string>();
  for (const inputs of lanes) {
    const bound = new Set<string>();
    const unbound = new Set<string>();
    for (const shape of probes) {
      const authority = decideManagedLaneAuthority(inputs, shape);
      for (const approver of authority.approvers) {
        if (approver.agentRef) bound.add(approver.roleKey);
        else unbound.add(approver.roleKey);
      }
    }
    for (const roleKey of unbound) if (!bound.has(roleKey)) unfilled.add(roleKey);
  }
  return [...unfilled].sort();
}

/**
 * The DISTINCT ticket shapes a board actually holds. PURE.
 *
 * Deduplicated because requirement applicability depends only on (taskType, actionType) —
 * 678 tickets collapse to a handful of pairs, which is what keeps the probe above a
 * trivial pure loop rather than a per-ticket sweep.
 */
export function distinctTaskShapes(
  tasks: readonly { taskType?: string | null; actionType?: string | null }[],
): ManagedTaskScope[] {
  const seen = new Map<string, ManagedTaskScope>();
  for (const t of tasks) {
    const taskType = t.taskType ?? null;
    const actionType = t.actionType ?? null;
    const key = `${taskType ?? ''}|${actionType ?? ''}`;
    if (!seen.has(key)) seen.set(key, { taskType, actionType });
  }
  return [...seen.values()];
}

/**
 * Fill every role this project's board authorises but cannot bind.
 *
 * Never throws — a staffing failure must leave the pass running, exactly as the per-ticket
 * remedy does.
 */
export async function staffUnfilledLanes(
  env: Env,
  db: Db,
  args: {
    tenantId: number;
    projectId: number;
    boardId: string;
    /** Hires already made this sweep, so the budget spans every project in the tick. */
    hiresUsed?: number;
    maxHires?: number;
    /** The distinct ticket shapes on this board — see {@link unfilledRolesForBoard}.
     *  The caller already holds the managed set, so this costs no query. Omitted ⇒ the
     *  unconditional probe only, which is the pre-0382 behaviour. */
    taskShapes?: readonly ManagedTaskScope[];
  },
): Promise<LaneStaffingResult> {
  try {
    const lanes = await loadBoardLaneAuthorities(db, {
      tenantId: args.tenantId, projectId: args.projectId, boardId: args.boardId, env,
    });
    const unfilledRoleKeys = unfilledRolesForBoard(lanes.values(), args.taskShapes ?? []);
    if (unfilledRoleKeys.length === 0) return EMPTY;

    const result: LaneStaffingResult = {
      unfilledRoleKeys, filled: [], unfillable: [], hires: 0, error: null,
    };
    const maxHires = args.maxHires ?? MAX_HIRES_PER_PASS;
    for (const roleKey of unfilledRoleKeys) {
      const staffed = await staffUnfilledRole(env, db, {
        tenantId: args.tenantId,
        projectId: args.projectId,
        roleKey,
        hiresUsed: (args.hiresUsed ?? 0) + result.hires,
        maxHires,
      });
      const outcome: LaneStaffingOutcome = {
        roleKey,
        action: staffed.action,
        agentName: staffed.agentName,
        detail: staffed.detail,
      };
      if (staffed.action === 'hired') result.hires += 1;
      if (staffed.action === 'escalate') result.unfillable.push(outcome);
      else result.filled.push(outcome);
    }
    return result;
  } catch (error) {
    // A staffing sweep that cannot read the board is not a reason to abandon the pass;
    // the per-ticket remedy still covers the same cause, more slowly. It IS a reason to
    // journal the failure: the former empty result was indistinguishable from "all roles
    // are staffed" and concealed the exact project-wide defect this sweep owns.
    reportCaughtError(error, {
      source: 'application/manager/staffUnfilledLanes.ts',
      operation: 'staffUnfilledLanes',
      context: { tenantId: args.tenantId, projectId: args.projectId, boardId: args.boardId },
    });
    return {
      ...EMPTY,
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
    };
  }
}

/**
 * One plain sentence for the manager feed, or '' when there was nothing to say. PURE.
 *
 * Names the COHORT effect rather than the write, because that is the fact a reader needs:
 * a pinned role is uninteresting; "every ticket waiting on Architect can now dispatch" is
 * the thing that changed.
 */
export function describeLaneStaffing(result: LaneStaffingResult): string {
  if (result.error) {
    return `Could not inspect or staff this board's lifecycle roles: ${result.error}. `
      + 'Per-ticket recovery remains available, but the board-wide staffing gap needs attention.';
  }
  if (result.filled.length === 0 && result.unfillable.length === 0) return '';
  const parts: string[] = [];
  if (result.filled.length) {
    const names = result.filled
      .map((f) => `${f.roleKey}${f.agentName ? ` → ${f.agentName}` : ''}${f.action === 'hired' ? ' (hired)' : ''}`)
      .join(', ');
    parts.push(
      `Staffed ${result.filled.length} lifecycle role${result.filled.length === 1 ? '' : 's'} this board authorises but could not fill (${names}) — `
      + 'every ticket held at those stages can now be dispatched with a role attribution.',
    );
  }
  if (result.unfillable.length) {
    parts.push(
      `${result.unfillable.length} role${result.unfillable.length === 1 ? '' : 's'} still cannot be filled automatically `
      + `(${result.unfillable.map((u) => u.roleKey).join(', ')}) — a human needs to staff or correct them.`,
    );
  }
  return parts.join(' ');
}
