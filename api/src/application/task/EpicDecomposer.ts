import { Task } from '../../domain/task/Task';
import { TaskPriority } from '../../domain/shared/types';

/**
 * One planned child task produced by decomposing an Epic. The decomposer only
 * decides the *shape* of the work (title/description/priority + optional
 * fan-out assignee); TaskService is responsible for materialising these into
 * real `tasks` rows linked back to the Epic.
 *
 * Assignee fields mirror the mutual-exclusion rule on a task: a child is fanned
 * out to EITHER a human (`assignedUserId`) OR an agent (host / cloud ref), never
 * more than one. All three are optional — an unassigned child lands in the
 * backlog for a human to triage.
 */
export interface ChildTaskPlan {
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  assignedUserId?: string | null;
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;
}

/** Verdict from assessing whether an agent-assigned task is really an Epic. */
export interface DecompositionPlan {
  /** True when the task is too large to execute directly and should become an Epic. */
  isEpic: boolean;
  /** The child tasks to fan out (only meaningful when `isEpic`). */
  children: ChildTaskPlan[];
}

/**
 * Port for the agent reasoning step that runs when a task is assigned to an
 * agent: a BA-style agent assesses scope and, if the item is really an Epic,
 * returns the child breakdown. Swap a real LLM-backed implementation in here
 * (e.g. an `ideProxy(env)` completion that returns a structured plan) without
 * touching the TaskService fan-out machinery.
 */
export interface EpicDecomposer {
  assess(task: Task): Promise<DecompositionPlan>;
}

/**
 * MINIMAL IMPLEMENTATION (deterministic, no LLM).
 *
 * Stands in for the agent reasoning step so the data-model + fan-out path is
 * fully exercised and tested today. Heuristic: a task whose description contains
 * an explicit checklist (markdown `- [ ]` / `- ` / numbered `1.` lines) is
 * treated as an Epic and each list item becomes a child task. No checklist →
 * not an Epic (the agent executes it directly).
 *
 * Replace `assess` with an LLM call (returning the same `DecompositionPlan`
 * shape) to get real BA-style scope assessment; the rest of the pipeline is
 * production-ready.
 */
export const heuristicEpicDecomposer: EpicDecomposer = {
  async assess(task: Task): Promise<DecompositionPlan> {
    const children = parseChecklist(task.description);
    return { isEpic: children.length >= 2, children };
  },
};

/** Pull checklist-style lines out of a markdown description into child plans. */
function parseChecklist(description: string | null): ChildTaskPlan[] {
  if (!description) return [];
  const out: ChildTaskPlan[] = [];
  for (const raw of description.split('\n')) {
    const line = raw.trim();
    // `- [ ] item`, `- [x] item`, `- item`, `* item`, or `1. item`
    const m = line.match(/^(?:[-*]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)(.+)$/);
    const item = m?.[1]?.trim();
    if (item) out.push({ title: item.slice(0, 500) });
  }
  return out;
}
