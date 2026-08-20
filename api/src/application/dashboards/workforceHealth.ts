/**
 * Workforce health — the ONE answer to "who is not working, and who is drowning?"
 *
 * The three cohorts a manager actually asks about were each computable and none of
 * them was answerable in one place:
 *
 *   • OVER-ALLOCATED came from {@link computeAllocationHealth} (EMP-12) and was
 *     rendered by exactly one card, `emp.over-allocated`.
 *   • UNDER-UTILISED was latent in the same result — every member's
 *     `utilizationPct` was already computed — but nothing ever named the cohort,
 *     so the half of the question about slack had no surface at all.
 *   • IDLE was invisible to both, because allocation health is derived from
 *     members who HOLD open work: a member carrying nothing cannot appear in it.
 *     Their absence read as "healthy" when it means the opposite.
 *
 * So a manager comparing the over-allocation chart against a roster was doing the
 * join by hand, and the failure that produces is asymmetric — you notice the
 * person with twelve open tickets, you do not notice the person with none.
 *
 * This composes the two EXISTING services rather than querying anything itself:
 * {@link computeAllocationHealth} for who holds open work and how much relative to
 * their ceiling, and {@link computeMemberMetrics} for who was ACTIVE in the window
 * at all. Idle is the set difference — active in the window, holding nothing now —
 * which is why it needs both and could not live in either.
 *
 * Nothing here writes SQL: that is the metric-registry contract this feeds, and it
 * holds one layer up as well.
 */

import type { Db } from '../../infrastructure/database/connection';
import { computeAllocationHealth } from '../metrics/allocationHealth';
import { computeMemberMetrics } from '../metrics/workforceMetrics';
import type { MemberKind } from '../metrics/workforceMetrics';

/**
 * At or below this share of their WIP ceiling a member holding work is UNDER-utilised.
 *
 * Deliberately well clear of 100: the interesting cohort is "has visible slack a
 * manager could route work into", not "is not at exactly their limit". At the
 * DEFAULT_MAX_WIP of 5 this means one open ticket, occasionally two — which is the
 * shape of the answer a manager is looking for when they ask who has room.
 */
export const UNDER_UTILISED_PCT = 40;

/** One member in a cohort — enough to name them and show the reading behind it. */
export interface WorkforceHealthMember {
  memberKind: MemberKind;
  memberRef: string;
  name: string;
  /** Open, non-done tasks currently assigned. 0 for the idle cohort. */
  observedWip: number;
  /** The member's WIP ceiling (explicit profile value, or the shared default). */
  maxWip: number;
  /** observedWip / maxWip * 100, rounded. 0 for the idle cohort. */
  utilizationPct: number;
  /** Tasks this member touched inside the window — why we know they are staff, not a ghost. */
  activeInWindow: number;
}

export interface WorkforceHealthResult {
  /** Carrying more open work than their declared ceiling. */
  overAllocated: WorkforceHealthMember[];
  /** Holding work, but at or below {@link UNDER_UTILISED_PCT} of their ceiling. */
  underUtilised: WorkforceHealthMember[];
  /** Active in the window but holding NO open work right now. */
  idle: WorkforceHealthMember[];
  /** Members holding at least one open task — the denominator for the two ratios. */
  membersWithWork: number;
  /** Distinct members seen in either source: the population the cohorts partition. */
  totalMembers: number;
  /** The window (days) the activity half was read over. */
  days: number;
}

const keyOf = (kind: MemberKind, ref: string) => `${kind}:${ref}`;

/**
 * Concurrent callers for the same (tenant, window) share one computation.
 *
 * Three metric-registry entries — `people.overAllocated`, `people.underUtilised`
 * and `people.idle` — are each a pluck off this ONE result, and the composed
 * answer resolves all three at once. Without this they would fan out into three
 * identical pairs of board-wide scans for a single question.
 *
 * This is NOT a cache and deliberately has no TTL: the entry is dropped the moment
 * it settles, so it can only ever serve callers that overlapped in time with a
 * read still in flight. Cross-request caching is the read-through cache's job
 * (`getOrSetCached`, applied per metric key by the route) and stays there — a
 * second store here would be a second invalidation story nobody would remember.
 */
const inFlight = new Map<string, Promise<WorkforceHealthResult>>();

/**
 * Compute the three cohorts for a tenant.
 *
 * `days` scopes only the ACTIVITY half (who counts as staff): allocation is a
 * point-in-time reading of the board, because "is this person overloaded" is a
 * question about right now, not about the trailing month.
 */
export function computeWorkforceHealth(db: Db, tenantId: number, days: number): Promise<WorkforceHealthResult> {
  const key = `${tenantId}:${days}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  // A failed read must not poison the memo: the next caller re-reads rather than
  // inheriting a rejected promise.
  const pending = readWorkforceHealth(db, tenantId, days).finally(() => { inFlight.delete(key); });
  inFlight.set(key, pending);
  return pending;
}

async function readWorkforceHealth(db: Db, tenantId: number, days: number): Promise<WorkforceHealthResult> {
  const [allocation, members] = await Promise.all([
    computeAllocationHealth(db, tenantId),
    computeMemberMetrics(db, tenantId, days),
  ]);

  const activeByMember = new Map<string, number>();
  for (const m of members) activeByMember.set(keyOf(m.memberKind, m.memberRef), m.assignedCount);

  const holdingWork = new Set<string>();
  const overAllocated: WorkforceHealthMember[] = [];
  const underUtilised: WorkforceHealthMember[] = [];

  for (const row of allocation.members) {
    const key = keyOf(row.memberKind, row.memberRef);
    holdingWork.add(key);
    const member: WorkforceHealthMember = {
      memberKind: row.memberKind,
      memberRef: row.memberRef,
      name: row.name,
      observedWip: row.observedWip,
      maxWip: row.maxWip,
      utilizationPct: row.utilizationPct,
      activeInWindow: activeByMember.get(key) ?? 0,
    };
    // Over-allocation wins when both could apply — it cannot, arithmetically, but
    // saying so keeps the cohorts disjoint by construction rather than by luck.
    if (row.overAllocated) overAllocated.push(member);
    else if (row.utilizationPct <= UNDER_UTILISED_PCT) underUtilised.push(member);
  }

  // IDLE: active in the window, holding nothing now. Restricted to members the
  // window saw, because "everyone in the tenant with no open ticket" would sweep
  // in every departed and never-onboarded account and drown the real signal.
  const idle: WorkforceHealthMember[] = members
    .filter((m) => !holdingWork.has(keyOf(m.memberKind, m.memberRef)))
    .map((m) => ({
      memberKind: m.memberKind,
      memberRef: m.memberRef,
      name: m.memberName,
      observedWip: 0,
      maxWip: 0,
      utilizationPct: 0,
      activeInWindow: m.assignedCount,
    }));

  const everyone = new Set<string>([...holdingWork, ...activeByMember.keys()]);

  return {
    overAllocated: overAllocated.sort((a, b) => b.utilizationPct - a.utilizationPct || a.name.localeCompare(b.name)),
    underUtilised: underUtilised.sort((a, b) => a.utilizationPct - b.utilizationPct || a.name.localeCompare(b.name)),
    idle: idle.sort((a, b) => b.activeInWindow - a.activeInWindow || a.name.localeCompare(b.name)),
    membersWithWork: holdingWork.size,
    totalMembers: everyone.size,
    days,
  };
}
