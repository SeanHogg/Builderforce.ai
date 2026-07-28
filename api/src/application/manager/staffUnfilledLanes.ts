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
  decideManagedLaneAuthority, loadBoardLaneAuthorities, type LaneAuthorityInputs,
} from '../kanban/managedLaneRoles';
import { MAX_HIRES_PER_PASS, staffUnfilledRole, type StaffingAction } from './staffUnfilledRole';

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
}

const EMPTY: LaneStaffingResult = { unfilledRoleKeys: [], filled: [], unfillable: [], hires: 0 };

/**
 * Every role a board's lanes authorise that binds to NO agent. PURE.
 *
 * Scoped with an EMPTY task ({@link decideManagedLaneAuthority} filters requirements by
 * ticket type/condition) deliberately: a board-level sweep asks the unconditional
 * question, "which of this lane's roles can never bind?". A requirement that only applies
 * to security tickets is skipped here and left to the per-ticket remedy, so this step can
 * never hire for a role the board does not universally need.
 *
 * A role counts as unfilled only when EVERY approver slot carrying it is unbound: one lane
 * may authorise the same role twice, and binding it once is enough to dispatch.
 */
export function unfilledRolesForBoard(lanes: Iterable<LaneAuthorityInputs>): string[] {
  const bound = new Set<string>();
  const unbound = new Set<string>();
  for (const inputs of lanes) {
    const authority = decideManagedLaneAuthority(inputs, {});
    for (const approver of authority.approvers) {
      if (approver.agentRef) bound.add(approver.roleKey);
      else unbound.add(approver.roleKey);
    }
  }
  return [...unbound].filter((roleKey) => !bound.has(roleKey)).sort();
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
  },
): Promise<LaneStaffingResult> {
  try {
    const lanes = await loadBoardLaneAuthorities(db, {
      tenantId: args.tenantId, projectId: args.projectId, boardId: args.boardId, env,
    });
    const unfilledRoleKeys = unfilledRolesForBoard(lanes.values());
    if (unfilledRoleKeys.length === 0) return EMPTY;

    const result: LaneStaffingResult = { unfilledRoleKeys, filled: [], unfillable: [], hires: 0 };
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
  } catch {
    // A staffing sweep that cannot read the board is not a reason to abandon the pass;
    // the per-ticket remedy still covers the same cause, more slowly.
    return EMPTY;
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
