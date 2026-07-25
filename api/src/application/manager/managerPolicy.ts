/**
 * managerPolicy — resolve the EFFECTIVE manager policy for a project.
 *
 * THREE TIERS, ONE PURE FOLD (migration 0363):
 *
 *   hardcoded default  ←  tenant_manager_defaults row  ←  project_manager_configs row
 *
 * The manager runs for every project by default (the tenant-wide system service).
 * A workspace can then state its own posture once (`tenant_manager_defaults`) instead
 * of repeating it per project, and a `project_manager_configs` row refines that for one
 * project: naming a manager (an AI agent or a human), pausing the manager, or tuning
 * what it may do (assign work, backfill value, re-rank) and how much PR authority it
 * has. Each tier overrides ONLY the fields it actually sets — a null/undefined column
 * means "this tier has no opinion", which is why every `tenant_manager_defaults` column
 * is nullable.
 *
 * PRECEDENCE IS NOT UNIFORMLY "LAST TIER WINS". Three fields are authority gates, and
 * for those the MOST RESTRICTIVE opinion across the tiers wins:
 *
 *   • `enabled`                  — an explicit tenant `false` is a KILL-SWITCH; a project
 *                                  row cannot re-enable the manager. It has to work this
 *                                  way: `project_manager_configs.enabled` is NOT NULL
 *                                  DEFAULT true, so every pre-existing project row
 *                                  "sets" it, and last-tier-wins would let those rows
 *                                  silently defeat the workspace switch entirely.
 *   • `allowAutoMerge`           — an explicit tenant `false` is a CEILING: no project may
 *                                  grant itself merge rights the workspace withheld.
 *   • `allowUnattendedCeremonies`— a CEILING (0364): no project may let the manager run a
 *                                  standup without its people if the workspace said no.
 *   • `allowAgentReassignment`   — a CEILING (0364): likewise for moving an absent
 *                                  human's work onto an agent.
 *   • `requireSignoffToComplete` — an explicit tenant `true` is a FLOOR: a project cannot
 *                                  opt out of a workspace-mandated review gate.
 *
 * The two ceremony GUARDRAIL NUMBERS (0364) resolve most-restrictive-wins as well, which
 * for a number means the safest value rather than the last one: `agentReassignIdleHours`
 * takes the LARGEST opinion (a project may demand more patience than the workspace, never
 * less) and `agentReassignMaxPerSession` the SMALLEST (tighter, never looser). Treating
 * them as plain overrides would let a project restore exactly the autonomy the guardrail
 * exists to withhold.
 *
 * Everything else (`prMergePolicy`, `autoAssign`, `autoBusinessValue`, `autoPrioritize`,
 * `managerType`, `managerRef`) is a plain override where the project tier wins — those
 * are tuning knobs, not permissions, so local judgement should beat a global preference.
 *
 * The fold is pure and total: every caller (the cron sweep, the run-now endpoint, the
 * MCP tool, the settings surface) resolves through the SAME function, so the backend and
 * the UI can never disagree about what the manager is allowed to do.
 */

import { normalizeManagerType, DEFAULT_MANAGER_TYPE } from './managerTypes';

/** PR authority tiers (see migration 0265). */
export type PrMergePolicy = 'immediate' | 'on_green' | 'queue';

/** Who fills the manager role for a project. */
export type ManagerKind = 'agent' | 'human' | 'system';

/**
 * ONE TIER's contribution to the policy — a partial set of opinions.
 *
 * `undefined` OR `null` both mean "this tier does not express an opinion about this
 * field", so the resolver looks at the tier below it. That equivalence is what lets the
 * all-nullable `tenant_manager_defaults` row and the mostly-NOT-NULL
 * `project_manager_configs` row feed the SAME fold without either shape needing a
 * bespoke code path — `ManagerConfigRow` is structurally assignable to this.
 */
export interface ManagerPolicyOverride {
  managerRef?: string | null;
  enabled?: boolean | null;
  prMergePolicy?: string | null;
  autoAssign?: boolean | null;
  autoBusinessValue?: boolean | null;
  autoPrioritize?: boolean | null;
  autoSchedule?: boolean | null;
  managerType?: string | null;
  requireSignoffToComplete?: boolean | null;
  allowAutoMerge?: boolean | null;
  allowUnattendedCeremonies?: boolean | null;
  allowAgentReassignment?: boolean | null;
  agentReassignIdleHours?: number | null;
  agentReassignMaxPerSession?: number | null;
}

/** The persisted config shape (a `project_manager_configs` row projection). */
export interface ManagerConfigRow {
  managerRef: string | null;
  enabled: boolean;
  prMergePolicy: string;
  autoAssign: boolean;
  autoBusinessValue: boolean;
  autoPrioritize: boolean;
  /** Manager scheduling authority (0364). Optional so a row projected before the
   *  migration lands still type-checks (folded to the default by the resolver). */
  autoSchedule?: boolean;
  /** The manager's domain type (see managerTypes.ts). Defaults to 'general'. */
  managerType: string;
  /** Gate autonomous completion/merge on unanimous role sign-off (0362). Optional so a
   *  row projected before the migration lands still type-checks (folded to the safe
   *  default by {@link resolveEffectiveManagerPolicy}). */
  requireSignoffToComplete?: boolean;
  /** Grant of autonomous merge authority for THIS project (0363). Nullable in the DB on
   *  purpose: null = "inherit the workspace tier" (which itself falls back to the
   *  hardcoded `false`), so a project that has never had an opinion is not pinned to one. */
  allowAutoMerge?: boolean | null;
  /** Ceremony autonomy for THIS project (0364) — all nullable, all meaning "inherit". */
  allowUnattendedCeremonies?: boolean | null;
  allowAgentReassignment?: boolean | null;
  agentReassignIdleHours?: number | null;
  agentReassignMaxPerSession?: number | null;
}

/**
 * The workspace tier — a `tenant_manager_defaults` row projection (0363). Every field is
 * nullable because NULL is the meaningful "no workspace opinion" state; the row exists
 * only to carry the opinions an operator actually expressed.
 */
export interface TenantManagerDefaultsRow {
  enabled: boolean | null;
  prMergePolicy: string | null;
  autoAssign: boolean | null;
  autoBusinessValue: boolean | null;
  autoPrioritize: boolean | null;
  autoSchedule: boolean | null;
  requireSignoffToComplete: boolean | null;
  allowAutoMerge: boolean | null;
  allowUnattendedCeremonies: boolean | null;
  allowAgentReassignment: boolean | null;
  agentReassignIdleHours: number | null;
  agentReassignMaxPerSession: number | null;
}

export interface EffectiveManagerPolicy {
  /** Whether the manager acts on this project at all. */
  enabled: boolean;
  /** Assignee-encoded designated manager, or null for the system service. */
  managerRef: string | null;
  /** Derived from managerRef — 'system' when none is named. */
  managerKind: ManagerKind;
  prMergePolicy: PrMergePolicy;
  autoAssign: boolean;
  autoBusinessValue: boolean;
  autoPrioritize: boolean;
  /**
   * May the manager place unscheduled tickets on the TIMELINE (0364) — write start/due
   * windows in rank order, honouring the `task_dependencies` DAG?
   *
   * Deliberately separate from {@link autoPrioritize}: ranking answers "what first",
   * scheduling answers "WHEN". Nothing used to answer the second question at all, so
   * the manager's own urgency term (`prioritize.urgencyScore`) scored a due-date column
   * that was null on every ticket in the system.
   *
   * A tuning knob, not a permission — the project tier wins. It only ever fills a
   * ticket that has NEITHER date; a human-set date is never overwritten.
   */
  autoSchedule: boolean;
  /** The manager's domain type id: a built-in ('general' | 'delivery' | 'qa' |
   *  'service_desk' | 'devops') or a `role:<key>` custom-role type. */
  managerType: string;
  /**
   * Self-governance precondition (migration 0362). When true — the default — the
   * manager may complete a ticket and merge its PR autonomously ONLY once every
   * REQUIRED participation slot has signed off. A ticket with no required slots never
   * qualifies (see `signoffGate.ts`, which fails closed on an empty manifest), so
   * "nobody reviewed it" can never read as "everybody approved it".
   *
   * False restores the pre-0362 behaviour: complete + squash-merge with no sign-off
   * verification at all. That is a deliberate, auditable opt-out, not a default.
   */
  requireSignoffToComplete: boolean;
  /**
   * MERGE AUTHORITY — may the manager merge a PR unattended at all (migration 0363)?
   *
   * Deliberately SEPARATE from {@link prMergePolicy}, which only answers HOW a permitted
   * merge happens (right away vs. once CI is green vs. hold in a queue). Before 0363 the
   * two were conflated: merge authority was inferred from `prMergePolicy !== 'queue'`, so
   * the default-configured manager squash-merged into a default branch with nobody
   * having granted it that. Writing to someone else's main branch is the most
   * consequential thing the manager does, so it is now false unless a tier says
   * otherwise, and the grant is visible in the config that made it.
   *
   * Enforced in `ManagerService.coordinatePullRequests` alongside — not instead of —
   * {@link requireSignoffToComplete}: BOTH must pass before a merge. When this is false
   * an otherwise-ready PR is journalled to `manager_actions` as 'merge_blocked' so
   * withheld authority is visible on the surface rather than a silent skip.
   */
  allowAutoMerge: boolean;

  /**
   * MAY A CEREMONY BE CONDUCTED WITHOUT ITS HUMANS (migration 0364)?
   *
   * A scheduled standup opens whether or not anyone shows up — that part is just a
   * calendar. This decides what happens NEXT when the room stays empty:
   *
   *   • false (the default) — the session is concluded as `abandoned` with
   *     close_reason 'no_humans'. Nothing is reassigned and no agent work is
   *     dispatched on its behalf. The ceremony is still RECORDED, so the history
   *     shows a standup nobody attended — which is the signal a team actually needs.
   *   • true — the manager conducts it solo: resolves attendance, applies the
   *     reassignment rules below, dispatches agent-owned work, and closes it with
   *     close_reason 'unattended'.
   *
   * Not granted by default for the same reason as {@link allowAutoMerge}: business
   * transacted in a room containing none of the people it concerns is authority a
   * workspace hands over on purpose or not at all.
   */
  allowUnattendedCeremonies: boolean;

  /**
   * MAY A CEREMONY MOVE A HUMAN'S TICKET ONTO AN AGENT (migration 0364)?
   *
   * Missing a standup is normal and is never, on its own, sufficient — see
   * `ceremonyAttendance.selectReassignments`, which additionally requires the ticket
   * to have sat untouched past {@link agentReassignIdleHours} and caps the whole
   * thing at {@link agentReassignMaxPerSession}. False (the default) means an absent
   * owner keeps their work however stale it is.
   */
  allowAgentReassignment: boolean;

  /**
   * THE CONDITION on {@link allowAgentReassignment}: how many hours a ticket must have
   * sat untouched before an absent owner's claim on it lapses. Folded
   * most-restrictive-wins — the LARGEST opinion across the tiers.
   */
  agentReassignIdleHours: number;

  /** Hard bound on reassignments ONE ceremony may make. Folded most-restrictive-wins —
   *  the SMALLEST opinion across the tiers. */
  agentReassignMaxPerSession: number;
}

/**
 * The hardcoded floor of the three-tier fold — what the manager does for a project with
 * no workspace defaults row AND no project config row. Both tiers above it override only
 * the fields they set, so this is also the value any field falls back to when nobody has
 * an opinion about it.
 */
export const DEFAULT_MANAGER_POLICY: EffectiveManagerPolicy = {
  enabled: true,
  managerRef: null,
  managerKind: 'system',
  prMergePolicy: 'immediate',
  autoAssign: true,
  autoBusinessValue: true,
  autoPrioritize: true,
  // On by default (0364): placing already-owned work on a timeline is reversible, writes
  // only to tickets with NO dates, and without it every dated surface stays empty.
  autoSchedule: true,
  managerType: DEFAULT_MANAGER_TYPE,
  // Safe by default: autonomous completion requires unanimous sign-off (0362).
  requireSignoffToComplete: true,
  // NOT granted by default (0363). Grooming, ranking and assignment are reversible;
  // merging into a default branch is not. Authority must be handed over on purpose.
  allowAutoMerge: false,
  // NOT granted by default (0364). An empty standup is recorded, never acted on.
  allowUnattendedCeremonies: false,
  // NOT granted by default (0364). An absent owner keeps their work.
  allowAgentReassignment: false,
  // Two full working days of silence before an absent owner's claim can lapse — long
  // enough that a normal absence (a day off, one missed standup) never reaches it.
  agentReassignIdleHours: 48,
  // A standup that quietly re-homed a whole sprint would be indistinguishable from a bug.
  agentReassignMaxPerSession: 3,
};

const VALID_PR_POLICIES: ReadonlySet<string> = new Set(['immediate', 'on_green', 'queue']);

/** Normalize an arbitrary PR-policy string, defaulting to the tenant default. */
export function normalizePrMergePolicy(v: unknown): PrMergePolicy {
  return typeof v === 'string' && VALID_PR_POLICIES.has(v)
    ? (v as PrMergePolicy)
    : DEFAULT_MANAGER_POLICY.prMergePolicy;
}

/**
 * Classify a manager designation. 'u:' = human; 'c:' (cloud agent) / 'h:' (host
 * agent) = agent; null/blank = the system service. Mirrors task-owner encoding so
 * "a manager" is the same concept a human manager or an AI agent both fill.
 */
export function resolveManagerKind(managerRef: string | null | undefined): ManagerKind {
  const ref = managerRef?.trim();
  if (!ref) return 'system';
  if (ref.startsWith('u:')) return 'human';
  if (ref.startsWith('c:') || ref.startsWith('h:')) return 'agent';
  return 'system';
}

/** A manager designation decoded into the three task-owner columns (exactly one is
 *  set, or none for the system service). Mirrors the 'u:'/'c:'/'h:' assignee encoding
 *  so a manager run task is owned by the same human/agent that runs the backlog. */
export interface ManagerAssignee {
  assignedUserId: string | null;
  assignedAgentRef: string | null;
  assignedAgentHostId: number | null;
}

/** Decode a manager designation ref into task-owner columns. Unknown/blank → none. */
export function resolveManagerAssignee(managerRef: string | null | undefined): ManagerAssignee {
  const none: ManagerAssignee = { assignedUserId: null, assignedAgentRef: null, assignedAgentHostId: null };
  const ref = managerRef?.trim();
  if (!ref) return none;
  const sep = ref.indexOf(':');
  if (sep < 1) return none;
  const kind = ref.slice(0, sep);
  const val = ref.slice(sep + 1).trim();
  if (!val) return none;
  if (kind === 'u') return { ...none, assignedUserId: val };
  if (kind === 'c') return { ...none, assignedAgentRef: val };
  if (kind === 'h') {
    const hostId = Number(val);
    return Number.isFinite(hostId) ? { ...none, assignedAgentHostId: hostId } : none;
  }
  return none;
}

// ── the fold primitives ─────────────────────────────────────────────────────
//
// Each takes the tiers in ASCENDING precedence order (tenant, then project) and is
// total: an all-silent tier list resolves to the hardcoded default.

/** Last tier with an opinion wins. Used for the tuning knobs. */
function lastSet<T>(fallback: T, ...values: (T | null | undefined)[]): T {
  let out = fallback;
  for (const v of values) if (v !== undefined && v !== null) out = v;
  return out;
}

/**
 * MOST RESTRICTIVE opinion wins, where `false` is the restrictive one — a permission.
 * If NO tier has an opinion the hardcoded default stands; otherwise every tier that
 * does have one must agree, so an explicit `false` anywhere is a hard ceiling that a
 * lower tier cannot re-grant.
 */
function narrowestGrant(fallback: boolean, ...values: (boolean | null | undefined)[]): boolean {
  const set = values.filter((v): v is boolean => v !== undefined && v !== null);
  return set.length === 0 ? fallback : set.every((v) => v === true);
}

/**
 * MOST RESTRICTIVE opinion wins, where `true` is the restrictive one — an obligation.
 * Mirror image of {@link narrowestGrant}: an explicit `true` anywhere is a floor no
 * other tier can relax.
 */
function strictestObligation(fallback: boolean, ...values: (boolean | null | undefined)[]): boolean {
  const set = values.filter((v): v is boolean => v !== undefined && v !== null);
  return set.length === 0 ? fallback : set.some((v) => v === true);
}

/**
 * MOST RESTRICTIVE opinion wins for a GUARDRAIL NUMBER (0364) — the numeric analogue of
 * {@link narrowestGrant}. `pick` says which direction is the safe one: `Math.max` for a
 * threshold that must be waited out (a bigger number is more patient), `Math.min` for a
 * cap (a smaller number does less).
 *
 * Plain last-tier-wins would be wrong here for the same reason it is wrong for the
 * permissions: a project could restore precisely the autonomy the workspace guardrail
 * exists to withhold, just by writing a looser number. Non-finite and out-of-range values
 * are dropped rather than coerced, so a malformed column can never widen a bound.
 */
function tightestBound(
  fallback: number,
  pick: (a: number, b: number) => number,
  values: (number | null | undefined)[],
  range: { min: number; max: number },
): number {
  const set = values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= range.min && v <= range.max,
  );
  // The arrow is load-bearing: `reduce(Math.min)` would hand Math.min the accumulator,
  // the value, the INDEX and the ARRAY, and the array coerces to NaN — silently
  // collapsing every guardrail to NaN and disabling the bound it exists to enforce.
  return set.length === 0 ? fallback : set.reduce((a, b) => pick(a, b));
}

/** Bounds on the ceremony guardrail numbers. A stored value outside these is ignored. */
export const AGENT_REASSIGN_IDLE_HOURS_RANGE = { min: 1, max: 24 * 90 } as const;
export const AGENT_REASSIGN_MAX_PER_SESSION_RANGE = { min: 0, max: 50 } as const;

/**
 * THE resolver — fold the tiers into one effective policy.
 *
 * `hardcoded default ← tenant ← project`, each overriding only the fields it sets, with
 * the three authority gates resolved most-restrictive-wins (see the file header for the
 * rule and why `enabled` in particular has to work that way). Pure and total: safe to
 * call with no tiers, one tier, or both, and the only place this precedence exists.
 */
export function resolveTieredManagerPolicy(tiers: {
  tenant?: ManagerPolicyOverride | null;
  project?: ManagerPolicyOverride | null;
}): EffectiveManagerPolicy {
  const tenant = tiers.tenant ?? null;
  const project = tiers.project ?? null;
  const d = DEFAULT_MANAGER_POLICY;

  // A designation is a project-tier concept (the workspace tier has no manager_ref
  // column), so the project's value — including an explicit null meaning "the system
  // service" — is simply the answer whenever the project tier is present.
  const managerRef = lastSet<string | null>(d.managerRef, tenant?.managerRef, project?.managerRef)?.trim() || null;

  return {
    // Authority gates — most restrictive tier wins.
    enabled: narrowestGrant(d.enabled, tenant?.enabled, project?.enabled),
    allowAutoMerge: narrowestGrant(d.allowAutoMerge, tenant?.allowAutoMerge, project?.allowAutoMerge),
    // A row projected before 0362/0363 backfill carries `undefined`, which reads as "no
    // opinion" here — so a pre-migration read falls back to the SAFE default and can
    // never widen authority.
    requireSignoffToComplete: strictestObligation(
      d.requireSignoffToComplete, tenant?.requireSignoffToComplete, project?.requireSignoffToComplete,
    ),

    // Ceremony autonomy (0364) — the two grants are ceilings like allowAutoMerge, and the
    // two guardrail numbers resolve to the safest opinion rather than the nearest one.
    allowUnattendedCeremonies: narrowestGrant(
      d.allowUnattendedCeremonies, tenant?.allowUnattendedCeremonies, project?.allowUnattendedCeremonies,
    ),
    allowAgentReassignment: narrowestGrant(
      d.allowAgentReassignment, tenant?.allowAgentReassignment, project?.allowAgentReassignment,
    ),
    // Longest wait wins: a project may be more patient than the workspace, never less.
    agentReassignIdleHours: tightestBound(
      d.agentReassignIdleHours, Math.max,
      [tenant?.agentReassignIdleHours, project?.agentReassignIdleHours],
      AGENT_REASSIGN_IDLE_HOURS_RANGE,
    ),
    // Smallest cap wins: a project may be tighter than the workspace, never looser.
    agentReassignMaxPerSession: tightestBound(
      d.agentReassignMaxPerSession, Math.min,
      [tenant?.agentReassignMaxPerSession, project?.agentReassignMaxPerSession],
      AGENT_REASSIGN_MAX_PER_SESSION_RANGE,
    ),

    // Tuning knobs — nearest (project) tier wins.
    managerRef,
    managerKind: resolveManagerKind(managerRef),
    prMergePolicy: normalizePrMergePolicy(lastSet<string>(d.prMergePolicy, tenant?.prMergePolicy, project?.prMergePolicy)),
    autoAssign: lastSet(d.autoAssign, tenant?.autoAssign, project?.autoAssign),
    autoBusinessValue: lastSet(d.autoBusinessValue, tenant?.autoBusinessValue, project?.autoBusinessValue),
    autoPrioritize: lastSet(d.autoPrioritize, tenant?.autoPrioritize, project?.autoPrioritize),
    autoSchedule: lastSet(d.autoSchedule, tenant?.autoSchedule, project?.autoSchedule),
    managerType: normalizeManagerType(lastSet<string>(d.managerType, tenant?.managerType, project?.managerType)),
  };
}

/**
 * Fold a project config row over the hardcoded default — the two-tier shorthand, kept
 * for callers that have no workspace row to hand (and so that "no tenant tier" stays a
 * legal, tested state). Delegates to {@link resolveTieredManagerPolicy}; there is no
 * second copy of the precedence rules.
 */
export function resolveEffectiveManagerPolicy(row: ManagerConfigRow | null | undefined): EffectiveManagerPolicy {
  return resolveTieredManagerPolicy({ project: row ?? null });
}

/**
 * The policy a project with NO config row of its own gets — the workspace posture on its
 * own. Backs the "these are your defaults" summary on the settings surface, so the UI
 * reads the resolved values from the same fold instead of re-deriving them.
 */
export function resolveTenantManagerDefaults(
  row: TenantManagerDefaultsRow | null | undefined,
): EffectiveManagerPolicy {
  return resolveTieredManagerPolicy({ tenant: row ?? null });
}
