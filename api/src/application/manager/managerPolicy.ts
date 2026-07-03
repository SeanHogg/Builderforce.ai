/**
 * managerPolicy — resolve the EFFECTIVE manager policy for a project.
 *
 * The manager runs for every project by default (the tenant-wide system service).
 * A `project_manager_configs` row OVERRIDES that default: it can name a manager
 * (an AI agent or a human), disable the manager for the project, or tune what it's
 * allowed to do (assign work, backfill value, re-rank) and how much PR authority it
 * has. This pure resolver folds an optional row over the tenant default so every
 * caller (the sweep, the run-now endpoint, the surface) sees one consistent policy.
 */

/** PR authority tiers (see migration 0265). */
export type PrMergePolicy = 'immediate' | 'on_green' | 'queue';

/** Who fills the manager role for a project. */
export type ManagerKind = 'agent' | 'human' | 'system';

/** The persisted config shape (a `project_manager_configs` row projection). */
export interface ManagerConfigRow {
  managerRef: string | null;
  enabled: boolean;
  prMergePolicy: string;
  autoAssign: boolean;
  autoBusinessValue: boolean;
  autoPrioritize: boolean;
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
}

/** The tenant default applied when a project has no explicit manager config row. */
export const DEFAULT_MANAGER_POLICY: EffectiveManagerPolicy = {
  enabled: true,
  managerRef: null,
  managerKind: 'system',
  prMergePolicy: 'immediate',
  autoAssign: true,
  autoBusinessValue: true,
  autoPrioritize: true,
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

/** Fold an optional config row over the tenant default into one effective policy. */
export function resolveEffectiveManagerPolicy(row: ManagerConfigRow | null | undefined): EffectiveManagerPolicy {
  if (!row) return { ...DEFAULT_MANAGER_POLICY };
  const managerRef = row.managerRef?.trim() || null;
  return {
    enabled: row.enabled,
    managerRef,
    managerKind: resolveManagerKind(managerRef),
    prMergePolicy: normalizePrMergePolicy(row.prMergePolicy),
    autoAssign: row.autoAssign,
    autoBusinessValue: row.autoBusinessValue,
    autoPrioritize: row.autoPrioritize,
  };
}
