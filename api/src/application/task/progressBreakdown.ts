import type { Task } from "../../domain/task/Task";
import { TaskType } from "../../domain/shared/types";
import type { ProgressBreakdown } from "../../domain/task/ProgressBreakdown";

/** Options for computing progress breakdown. */
export interface ProgressBreakdownOptions {
  /** Force include child tasks even if the task marks them hidden. */
  includeHidden?: boolean;
}

/** Default values for progress fields when not available. */
const DEFAULT_BASE: ProgressBreakdown["basis"] = "manual";
const DEFAULT_PR_STATE: ProgressBreakdown["prState"] = null;
const DEFAULT_TESTS_PASSING: ProgressBreakdown["testsPassing"] = null;

/** -------------------------------------------------------------------------- */
/** Helper Functions (FR-2: Aggregation & Normalization)                       */
/** -------------------------------------------------------------------------- */

/**
 * FR-2.1 / FR-2.2: Normalization function scales raw scores to the [0, 100]
 * range. Normalizes by (value - min) / (max - min), then clamps to [0, 100].
 * When min === max, returns 100 if value === min, otherwise 0.
 *
 * @param value - The raw value to normalize.
 * @param min - The known minimum value for the range.
 * @param max - The known maximum value for the range.
 * @returns Normalized value in [0, 100].
 */
export function normalize(
  value: number,
  min: number,
  max: number
): number {
  if (min === max) {
    return value === min ? 100 : 0;
  }

  const normalized = (value - min) / (max - min);
  if (normalized < 0) return 0;
  if (normalized > 1) return 1;
  return normalized * 100;
}

/**
 * FR-2.3: Aggregation reducer that merges items. Later values overwrite earlier
 * values (last-write-wins).
 *
 * @param acc - The accumulator object.
 * @param item - The item to merge into the accumulator.
 * @returns The updated accumulator.
 */
export function aggregate(
  acc: Record<string, number>,
  item: Record<string, number>
): Record<string, number> {
  return { ...acc, ...item };
}

/**
 * FR-2.4: Sorts breakdown items in descending progress order.
 *
 * @param items - The items to sort.
 * @returns A new array sorted by value descending, then by id.
 */
export function sortByProgressDesc<T extends { value: number; id?: string }>(
  items: T[]
): T[] {
  return [...items].sort((a, b) => {
    if (b.value !== a.value) {
      return b.value - a.value;
    }
    if (a.id && b.id) {
      return a.id.localeCompare(b.id);
    }
    return 0;
  });
}

/**
 * FR-2.5: Filters out items marked as hidden.
 *
 * @param items - The items to filter.
 * @param includeHidden - If true, includes hidden items.
 * @returns Filtered array.
 */
export function filterHidden<T extends { hidden?: boolean }>(
  items: T[],
  includeHidden: boolean = false
): T[] {
  return items.filter((item) => !item.hidden || includeHidden);
}

/** -------------------------------------------------------------------------- */
/** Main Breakdown Computation                                                 */
/** -------------------------------------------------------------------------- */

/**
 * Compute a task's progress breakdown based on its current state and children.
 *
 * The computation aligns with the parent epic's spec:
 * - An Epic returns breakdown derived from its direct child tasks (taskType=TASK).
 *   - basis = "subtasks"
 *   - subtasksDone = count of children that are DONE or IN_REVIEW (not BLOCKED).
 *   - subtasksTotal = total child task count.
 * - A non-Epic returns:
 *   - basis = "status"
 *   - subtasksDone = 0
 *   - subtasksTotal = 0
 *   - codeDelivered/prState/testsPassing are derived from available fields:
 *     - codeDelivered = (githubPrUrl is truthy) && (status === "in_review" || status === "done")
 *     - prState = "open" if githubPrUrl is truthy; "not_open" otherwise (null means no PR).
 *     - testsPassing = null (not yet computed; tests support IS NOT implemented).
 *
 * @param task - The task to compute breakdown for.
 * @param children - Direct child task records (relevant for Epics). Defaults to [].
 * @param options - Optional settings for breakdown computation.
 * @returns The computed progress breakdown.
 */
export function computeProgressBreakdown(
  task: Task,
  children?: Task[],
  options?: ProgressBreakdownOptions
): ProgressBreakdown {
  // FR-1.6: Empty / null input returns a well-defined zero-state object.
  if (!task || !task.taskType) {
    return {
      basis: DEFAULT_BASE,
      subtasksDone: 0,
      subtasksTotal: 0,
      codeDelivered: false,
      testsPassing: DEFAULT_TESTS_PASSING,
      prState: DEFAULT_PR_STATE,
    };
  }

  const effectiveChildren = Array.isArray(children) ? children : [];

  // The includeHidden option is accepted for API compatibility but the existing
  // ProgressBreakdown schema has no hidden fields. It is intentionally no-op
  // at the calculation layer.
  void options;

  if (task.taskType === TaskType.EPIC) {
    const total = effectiveChildren.length;
    const done = effectiveChildren.filter(
      (child) =>
        child.status === "done" ||
        child.status === "in_review"
    ).length;

    return {
      basis: "subtasks",
      subtasksDone: done,
      subtasksTotal: total,
      codeDelivered: false,
      testsPassing: DEFAULT_TESTS_PASSING,
      prState: DEFAULT_PR_STATE,
    };
  }

  // Non-Epic: compute from current task status and PR info.
  const hasPr =
    task.githubPrUrl != null &&
    task.githubPrUrl !== "";

  return {
    basis: "status",
    subtasksDone: 0,
    subtasksTotal: 0,
    codeDelivered: hasPr && (task.status === "in_review" || task.status === "done"),
    testsPassing: DEFAULT_TESTS_PASSING,
    prState: hasPr ? "open" : "not_open",
  };
}

/** -------------------------------------------------------------------------- */
/** Test Helpers (finalizeProgressBreakdown for testing)                       */
/** -------------------------------------------------------------------------- */

/**
 * Finalizes a progress breakdown object with a timestamp.
 * Useful for test fixtures and ensuring lastUpdated is properly set.
 *
 * @param breakdown - The progress breakdown to finalize.
 * @param lastUpdated - The timestamp to set as lastUpdated (optional).
 * @returns The breakdown with lastUpdated set to an integer timestamp.
 */
export function finalizeProgressBreakdown(
  breakdown: ProgressBreakdown,
  lastUpdated?: Date
): ProgressBreakdown {
  return {
    ...breakdown,
    lastUpdated: lastUpdated ? lastUpdated.getTime() : Date.now(),
  };
}
