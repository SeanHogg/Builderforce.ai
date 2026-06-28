/**
 * Categorical investment-ALLOCATION taxonomy — the ONE source of truth shared by
 * the deriver, the allocation rollup, the goals tracker, and any UI label (DRY).
 *
 * This is the INVESTMENT axis (where is engineering time going?), orthogonal to
 * {@link ../llm/actionTypes ACTION_TYPES} (the TECHNICAL axis, what kind of work).
 * A closed enum keeps the rollup dense and the goals comparable; the column is a
 * plain varchar so the set is extensible later without a migration.
 *
 *   innovation — net-new product/feature value (the differentiating spend)
 *   ktlo       — keep-the-lights-on: maintenance, bugfix, tests, CI, upgrades
 *   support    — customer/incident/operational support work
 *   tech_debt  — refactors / restructuring that pay down debt
 *   other      — uncategorized
 *
 * Allocation is DERIVED for free from the already-computed action_type plus light
 * task signals — no extra LLM call, no workflow change ("tracked automatically").
 * A PM can override the stored value (source = 'manual').
 */

import { type ActionType, normalizeActionType } from './actionTypes';

export const ALLOCATION_CATEGORIES = [
  'innovation',
  'ktlo',
  'support',
  'tech_debt',
  'other',
] as const;

export type AllocationCategory = (typeof ALLOCATION_CATEGORIES)[number];

export const DEFAULT_ALLOCATION_CATEGORY: AllocationCategory = 'other';

const ALLOCATION_SET: ReadonlySet<string> = new Set(ALLOCATION_CATEGORIES);

/** Coerce/guard any value to a valid {@link AllocationCategory}, default 'other'. */
export function normalizeAllocationCategory(s: unknown): AllocationCategory {
  return typeof s === 'string' && ALLOCATION_SET.has(s)
    ? (s as AllocationCategory)
    : DEFAULT_ALLOCATION_CATEGORY;
}

/** Human label for an allocation category — used by the allocation lens. */
export function allocationCategoryLabel(c: AllocationCategory): string {
  switch (c) {
    case 'innovation': return 'Innovation';
    case 'ktlo':       return 'Keep the lights on';
    case 'support':    return 'Support';
    case 'tech_debt':  return 'Tech debt';
    case 'other':      return 'Other';
  }
}

/** Map an {@link ActionType} to its default investment category. The technical
 *  axis is the strongest free signal: net-new build (UI/API/SQL) defaults to
 *  innovation; maintenance work (bugfix/tests/docs/CI/migration) to KTLO; a
 *  refactor pays down tech debt. */
const ACTION_TO_ALLOCATION: Record<ActionType, AllocationCategory> = {
  sql:            'innovation',
  frontend_ui:    'innovation',
  backend_api:    'innovation',
  refactor:       'tech_debt',
  bugfix:         'ktlo',
  tests:          'ktlo',
  docs:           'ktlo',
  devops_ci:      'ktlo',
  data_migration: 'ktlo',
  other:          'other',
};

/** Keyword hints that override the action-type default — caught from the task
 *  title/description/source so an explicitly-labelled support/incident ticket
 *  lands in `support` even if its code work looks like a feature. */
const SUPPORT_HINT = /\b(support|incident|outage|hotfix|on[- ]?call|escalation|customer issue|sev[ -]?\d)\b/i;
const INNOVATION_HINT = /\b(new feature|prototype|spike|experiment|innovation|greenfield|mvp|r&d)\b/i;
const TECH_DEBT_HINT = /\b(tech debt|refactor|cleanup|clean up|deprecat|migrate off|re-?architect|debt)\b/i;

export interface AllocationSignal {
  actionType?: string | null;
  title?: string | null;
  description?: string | null;
  source?: string | null;
}

/**
 * Deterministically derive the investment category from a task's signals — free,
 * stable, and unit-testable (no LLM). Keyword hints win over the action-type
 * default so an explicit label is honored; otherwise the action-type mapping
 * applies; `other` is the floor.
 */
export function deriveAllocationCategory(t: AllocationSignal): AllocationCategory {
  const text = `${t.title ?? ''} ${t.description ?? ''} ${t.source ?? ''}`;
  if (SUPPORT_HINT.test(text)) return 'support';
  if (TECH_DEBT_HINT.test(text)) return 'tech_debt';
  if (INNOVATION_HINT.test(text)) return 'innovation';
  return ACTION_TO_ALLOCATION[normalizeActionType(t.actionType)];
}

/** GAAP-conservative default capitalization for a category: only net-new
 *  development (innovation) capitalizes by default; maintenance/support/debt are
 *  expensed. Used when a task has no explicit cost_class (0225) yet — the PM can
 *  still override per task. Drives the capitalizable-cost half of the lens (EMP-18). */
export function defaultCostClassFor(c: AllocationCategory): 'capex' | 'opex' {
  return c === 'innovation' ? 'capex' : 'opex';
}
