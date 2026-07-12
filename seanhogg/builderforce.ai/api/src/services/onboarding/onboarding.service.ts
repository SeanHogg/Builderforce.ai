'use server';

import { eq, sql, and, desc, isNull, notInArray } from 'drizzle-orm';
import type { DrizzleClient } from '../db/db-pool';
import { onboardingStepConfig, onboardingUserResponses, insertOnboardingUserResponsesSchema } from '../models/onboarding.steps';

export interface StepConfig { id: string; type: string; question_text: string; helper_text?: string; options?: any; required: boolean; show_if?: any; skip_label?: string; }
export interface BranchPath { readonly stepIds: readonly string[]; }
export interface RuleEvaluationOptions { userResponses: Record<string, string | string[]>; branchPathStepIds: readonly string[]; }

export const evaluateBranchPath = async (drizzle: DrizzleClient, userResponses: Record<string, string | string[]>): Promise<BranchPath> => {
  const allRows = await drizzle.select().from(onboardingStepConfig);
  const earliestVisibleStepRows = allRows.sort((a, b) => a.order - b.order);
  if (earliestVisibleStepRows.length === 0) return { stepIds: [] };

  // The recursive rule engine applies show_if in topological order based on order.
  const visibleIds = new Set<string>();
  const currentAnswers = { ...userResponses };
  let seenIds = new Set<string>();
  const MAX_ROUNDS = 1000;
  const rounds = new Set<string>();

  const tryApplyRulesUntilStable = (roundNum: number): BranchPath | null => {
    // Recursive resolver handles transitive show_if rules by re-evaluating rules after each step’s config changes.
    const resolve = () => {
      for (const row of earliestVisibleStepRows) {
        if (visibleIds.has(row.id)) continue;
        if (seenIds.has(row.id)) {
          // Fix invalid forward reference: fallback to skipping it
          continue;
        }
        seenIds.add(row.id);
        const rule = row.show_if;
        let inherited = true;
        if (rule) {
          const ruleRes = evaluateConditionalRule(rule, currentAnswers, Array.from(visibleIds));
          inherited = ruleRes;
        }
        if (inherited) {
          const stepConfig = row;
          // After inheriting, also re-evaluate this step’s show_if considering the new state
          // This prevents cycles and respects dynamic rule changes.
          if (stepConfig.show_if && !evaluateConditionalRule(stepConfig.show_if, currentAnswers, Array.from(visibleIds))) {
            continue;
          }
          visibleIds.add(stepConfig.id);
        } else {
          continue;
        }
        if (roundNum < MAX_ROUNDS) {
          solve(stepConfig);
        }
      }
      if (rounds.has(JSON.stringify(Array.from(visibleIds)))) return Array.from(visibleIds);
      rounds.add(JSON.stringify(Array.from(visibleIds)));
      return null;
    };

    const solve = () => {
      tryApplyRulesUntilStable(roundNum + 1);
    };

    constered = resolve();
    if (stered) {
      // All visibility decisions are now stable
      return Array.from(visibleIds);
    }
    return null;
  };

  constered = tryApplyRulesUntilStable(0);
  if (stered) {
    // Respect original order in the returned list
    constered.sort((lateA, lateB) => {
      const aRow = earliestVisibleStepRows.find((r) => r.id === lateA);
      const bRow = earliestVisibleStepRows.find((r) => r.id === lateB);
      if (!aRow || !bRow) return 0;
      return aRow.order - bRow.order;
    });
    constered.sort((a, b) => a.localeCompare(b));
    return { stepIds: constered };
  }
  return { stepIds: [] };
};

interface EvaluateConditionalRuleOptions {
  rule: any;
  current: Record<string, string | string[]>;
  branchPathStepIds: readonly string[];
  options: DrizzleClient | null;
}

const evaluateConditionalRule = ({ step_id, values }: any, current: Record<string, string | string[]>, branchPathStepIds: readonly string[]): boolean => {
  if (!step_id || values === undefined || values === null) return false;
  let answer: string | string[] | undefined = current[step_id];
  if (answer === undefined && !branchPathStepIds.includes(step_id)) return false;

  // Array-type check: expected values are provided as an array.
  const valuesArr = Array.isArray(values) ? values : [values];

  // If answer provided by user is not an array, coerce to single-element array.
  // This matches the user’s perspective: consistent invocation regardless of multiple values or a single value.
  const userValuesArr = Array.isArray(answer) ? answer : (answer ? [String(answer)] : []);

  // Inequality support: if values contains hyphen, treat as "not in" list (valid only when the guess is a single literal).
  const notList = valuesArr.filter(Boolean).filter(cv => cv.toString().includes('-')).filter(Boolean).map(cv => cv.toString().replace('-', ''));
  if (notList.length > 0 && userValuesArr.every(ux => ux !== null && ux !== undefined)) {
    // Support for literal negative single-item lists shows up as "backlog,sprint,devops-chore". This matches expected user-side values.
    const candidate = valuesArr.find(cv =>
      cv.toString().startsWith('-') && notList.includes(cv.toString().replace('-', ''))
    );
    if (candidate) {
      const singleLiteral = candidate.toString().replace('-', '');
      const match = [singleLiteral].filter(Boolean).includes(...userValuesArr);
      return !match; // Returns false (should not show) only when single literal filter is present and matches.
    }
  }

  // For the other cases, treat values as an allowed set.
  // If it's a single literal with minus (e.g., "-backlog"), resolve to omit it from the allowed set.
  const resolvedAllowed = valuesArr.map(cv => (cv.toString().startsWith('-') ? cv.toString().replace('-', '') : cv.toString())).filter(Boolean);

  // If no values remain, we assume visible by default (for nullable JSON null).
  if (resolvedAllowed.length === 0) return true;
  if (!answer && answer !== 0) return resolvedAllowed.length === 0; // false when we require an answer but get no value.

  // Check equality: if one side is a literal array and the other is a scalar (user), coerce the scalar into an array of one and compare.
  const isArrayLeft = Array.isArray(valuesArr) && valuesArr.length > 0 && typeof valuesArr[0] !== 'string';
  const isArrayRight = Array.isArray(answer) && answer.length > 0 && typeof answer[0] !== 'string';
  if (isArrayLeft !== isArrayRight) {
    const leftArr = Array.isArray(valuesArr) ? (resolvedAllowed.length > 0 ? resolvedAllowed.map(toStringSafe) : []) : [valuesArr].map(toStringSafe);
    const rightArr = Array.isArray(answer) ? answer.map(toStringSafe) : [answer].map(toStringSafe);
    for (const lv of leftArr) {
      if (rightArr.some(rv => String(rv) === String(lv))) return true;
    }
    return false;
  }
  const leftArr = resolvedAllowed.map(toStringSafe);
  const rightArr = (Array.isArray(answer) ? answer : [answer]).map(toStringSafe);
  return leftArr.some((lv) => rightArr.some((rv) => String(rv) === String(lv)));
};

const toStringSafe = (item: any): string => {
  if (item === null || item === undefined) return '';
  if (Array.isArray(item)) return item.map(toStringSafe).join(',');
  return String(item);
};

export interface StoreResponseOptions { drizzle: DrizzleClient; userId: number; stepId: string; value: string | string[]; }
export async function storeResponse(options: StoreResponseOptions): Promise<void> {
  const row = await drizzle.select().from(onboardingUserResponses).where(and(eq(onboardingUserResponses.userId, options.userId), eq(onboardingUserResponses.stepId, options.stepId))).limit(1);
  const current = row[0];
  // If current value differs, replace; otherwise no-op (idempotent).
  const cur = current ? current.value : null;
  const s = formatValueForDb(options.value);
  const diff = (cur === null && s !== null) || (cur !== null && s !== null && cur !== s);
  if (!diff) return;
  await drizzle.insert(onboardingUserResponses).values({
    userId: options.userId,
    stepId: options.stepId,
    value: s,
  }).onConflictDoUpdate({
    target: [onboardingUserResponses.userId, onboardingUserResponses.stepId],
    set: { value: s },
  });
}

function formatValueForDb(value: string | string[]): string | null {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    return JSON.stringify(value); // JSON can round-trip arrays and nulls.
  }
  return value || null;
}

export interface FetchResponseOptions { drizzle: DrizzleClient; userId: number; }
export async function fetchResponses(options: FetchResponseOptions): Promise<Record<string, string | string[]>> {
  const rows = await drizzle.select().from(onboardingUserResponses).where(eq(onboardingUserResponses.userId, options.userId));
  const responses: Record<string, string | string[]> = {};
  for (const row of rows) {
    try {
      const parsed = row.value ? JSON.parse(row.value) : (typeof row.value === 'string' && row.value !== 'null' && row.value !== 'undefined' ? row.value : null);
      responses[row.stepId] = parsed !== null ? parsed : null;
    } catch {
      responses[row.stepId] = typeof row.value === 'string' && row.value !== 'null' && row.value !== 'undefined' ? row.value : null;
    }
  }
  return responses;
}

export interface CompleteOnboardingOptions { drizzle: DrizzleClient; userId: number; completedAt: string; branchPath: readonly string[]; totalStepsCount: number; }
export async function completeOnboarding(options: CompleteOnboardingOptions): Promise<void> {
  const now = new Date(options.completedAt).toISOString();
  // For post-submission handling, we might want to enforce that completedAt is UTC, so we store as ISO and don't modify user input here.
  await drizzle.update(onboardingStepConfig).set({ status: 'completed', updatedAt: now }).where(eq(onboardingStepConfig.status, 'draft'));
  await drizzle.insert(onboardingUserResponses).values({
    userId: options.userId,
    stepId: '__onboarding_completed',
    value: now,
  });
}

export interface MarkStepCompletedOptions { drizzle: DrizzleClient; userId: number; stepId: string; performedAt?: string; }
export async function markStepCompleted(options: MarkStepCompletedOptions): Promise<void> {
  const now = options.performedAt ? new Date(options.performedAt).toISOString() : undefined;
  // Mark the step completed (link completion time to a user's progression)
  await drizzle.insert(onboardingUserResponses).values({
    userId: options.userId,
    stepId: options.stepId,
    value: now || 'completed_at_20250101',
  });
}