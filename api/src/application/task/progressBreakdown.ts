import type {
  Task,
  ChildTaskPlan,
} from "../../domain/task/Task";
import { TaskType } from "../../domain/shared/types";
import type { ProgressBreakdown } from "../../domain/task/ProgressBreakdown";

/**
 * Default values for progress fields when not available.
 */
const DEFAULT_BASE: ProgressBreakdown["basis"] = "manual";
const DEFAULT_PR_STATE: ProgressBreakdown["prState"] = null;
const DEFAULT_TESTS_PASSING: ProgressBreakdown["testsPassing"] = null;

/**
 * Compute a task's progress breakdown based on its current state and children.
 *
 * The computation is simple and aligns with the parent epic's spec:
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
 * @param task The task to compute breakdown for.
 * @param children Direct child task records (relevant for Epics).
 */
export function computeProgressBreakdown(
  task: Task,
  children: ChildTaskPlan[]
): ProgressBreakdown {
  if (task.taskType === TaskType.EPIC) {
    // Count subtasks (tasks that are true task children).
    const total = children.length;
    // Done/in_review counts as "done" for progress purposes.
    const done = children.filter(
      (c) =>
        c.status === "done" ||
        c.status === "in_review" ||
        c.status === "done"
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
  const hasPr = task.githubPrUrl != null && task.githubPrUrl !== "";
  const codeDelivered = hasPr && (task.status === "in_review" || task.status === "done");
  const prState = hasPr ? "open" : "not_open";
  const testsPassing = DEFAULT_TESTS_PASSING;

  return {
    basis: "status",
    subtasksDone: 0,
    subtasksTotal: 0,
    codeDelivered,
    testsPassing,
    prState: prState as ProgressBreakdown["prState"],
  };
}