/**
 * WHICH TASKS OF A HAND-OFF RUN SIDE BY SIDE — and why the rest do not.
 *
 * A slice that owns a parent directory blocks every slice beneath it. VS Code chat #70776:
 * task 1 owned `src/surface`, tasks 2–4 owned `src/surface/style`, `src/surface/features` and
 * one test under it. The old all-or-nothing rule saw the overlap, threw the clash away, and the
 * whole plan went inline silently — the planner was never told, so it never narrowed the paths,
 * and a plan whose overlap came LAST lost the parallelism its earlier tasks could have had.
 *
 * Two answers live here:
 *   • the clash itself ({@link planScopeClash}), named back to the planner ONCE so it can narrow
 *     each task's paths to what it actually changes ({@link scopeClashCorrective});
 *   • the split of a plan that still overlaps ({@link splitForParallel}): the leading tasks that
 *     own paths and are mutually disjoint run side by side; from the first task that overlaps
 *     (or owns none) onward, the coder runs them inline in plan order — order beats parallelism.
 *
 * Every child is a clone of its owner and nothing downstream restricts it, so this is where
 * slices are kept apart. Pure.
 */

import { overlappingScopes } from '@builderforce/agent-tools';

/** What the split reads of a task. */
export interface ScopedTask {
  title: string;
  paths: readonly string[];
}

/** Two tasks that claim the same path: `a` and `b` are titles, `path` the overlap. */
export interface ScopeClash {
  a: string;
  b: string;
  path: string;
}

/** How one plan is carried out. */
export type HandOffMode = 'parallel' | 'inline' | 'mixed';

export interface ParallelSplit {
  /** Indexes of the tasks that run side by side, in plan order (empty or 2+). */
  parallel: number[];
  /** Indexes of the tasks the coder implements itself, in plan order. */
  inline: number[];
  /** The first overlap among the tasks that own paths — what kept the plan from running fully parallel. */
  clash: ScopeClash | null;
}

const scopeOf = (t: ScopedTask): { label: string; paths: readonly string[] } => ({ label: t.title, paths: t.paths });

/** The first overlap among the tasks that own paths, or null when they are all disjoint. */
export function planScopeClash(tasks: readonly ScopedTask[]): ScopeClash | null {
  return overlappingScopes(tasks.filter((t) => t.paths.length > 0).map(scopeOf));
}

/**
 * Whether the WHOLE plan can run side by side: two or more tasks, every one owning paths, and
 * no two owning the same file.
 */
export function canRunInParallel(tasks: readonly ScopedTask[]): boolean {
  if (tasks.length < 2 || tasks.some((t) => t.paths.length === 0)) return false;
  return planScopeClash(tasks) === null;
}

/**
 * Split a plan for the host that can fan out. ORDER BEATS PARALLELISM: a plan's order is the
 * planner's sequencing, so a task may only run beside the tasks BEFORE it. The run takes the
 * longest leading run of tasks that each own paths and are mutually disjoint; if that is two or
 * more, they run side by side, and every task from the first one that overlaps (or owns no paths)
 * onward goes to the coder inline, in plan order, after them. Anything shorter is all inline.
 *
 * So a parent-directory task FIRST (chat #70776) keeps the whole plan inline — its children must
 * not start before it — and an overlapping task LAST still lets the disjoint ones before it fan out.
 */
export function splitForParallel(tasks: readonly ScopedTask[]): ParallelSplit {
  const all = tasks.map((_, i) => i);
  let lead = 0;
  while (
    lead < tasks.length
    && tasks[lead]!.paths.length > 0
    && overlappingScopes(tasks.slice(0, lead + 1).map(scopeOf)) === null
  ) lead += 1;
  const parallel = lead >= 2 ? all.slice(0, lead) : [];
  return { parallel, inline: all.slice(parallel.length), clash: planScopeClash(tasks) };
}

/** How a plan was carried out: which tasks ran side by side, which the coder took, and the overlap that decided it. */
export interface HandOffDecision {
  mode: HandOffMode;
  parallelTasks: string[];
  inlineTasks: string[];
  clash: ScopeClash | null;
}

/** The trace labels: the decision, and the one-time corrective for an overlapping plan. */
export const HAND_OFF_MODE_LABEL = 'hand_off.mode';
export const HAND_OFF_CLASH_LABEL = 'hand_off.scope_clash';

/** The decision as one sentence for the run's record. */
export function handOffModeSentence(d: HandOffDecision): string {
  const why = d.clash ? ` (${describeClash(d.clash)})` : '';
  if (d.mode === 'parallel') return `All ${d.parallelTasks.length} tasks ran side by side as coding sub-agents.`;
  if (d.mode === 'mixed') return `${d.parallelTasks.length} task(s) ran side by side as coding sub-agents; ${d.inlineTasks.length} went to the coding model inline${why}.`;
  return `All ${d.inlineTasks.length} task(s) went to the coding model inline${why}.`;
}

/** The mode a split names. */
export function modeOf(split: Pick<ParallelSplit, 'parallel' | 'inline'>): HandOffMode {
  if (split.parallel.length === 0) return 'inline';
  return split.inline.length === 0 ? 'parallel' : 'mixed';
}

/** Why the plan cannot run fully side by side, as a sentence. */
export function describeClash(clash: ScopeClash): string {
  return `"${clash.a}" and "${clash.b}" both own ${clash.path}`;
}

/** Task numbers as the plan lists them ("2, 3 and 4"). */
function taskNumbers(indexes: readonly number[]): string {
  const n = indexes.map((i) => String(i + 1));
  return n.length <= 1 ? n.join('') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/**
 * Which tasks run side by side and which in order, and why — the line the chat's plan carries
 * under its header. Empty for a plan that runs wholly one way with nothing to explain.
 */
export function splitLayoutLine(split: ParallelSplit): string {
  const why = split.clash ? ` — ${describeClash(split.clash)}, so they cannot run at the same time` : '';
  const mode = modeOf(split);
  if (mode === 'mixed') {
    return `Side by side: task${split.parallel.length === 1 ? '' : 's'} ${taskNumbers(split.parallel)}. ` +
      `Then in order, by the coding model: task${split.inline.length === 1 ? '' : 's'} ${taskNumbers(split.inline)}${why}.`;
  }
  return mode === 'inline' && split.clash ? `In order, by the coding model${why}.` : '';
}

/**
 * The corrective handed to the planner the first time its plan overlaps: which two tasks, which
 * path, and what to change. Said once per run — a second overlapping plan is carried out as is.
 */
export function scopeClashCorrective(clash: ScopeClash): string {
  return `hand_off not filed: the tasks cannot run side by side — ${describeClash(clash)}. ` +
    'Narrow each task\'s paths to the files and directories it actually changes: a parent directory that contains another task\'s paths blocks parallel work. ' +
    'Then call hand_off again with the same tasks. If they genuinely share files, call it again unchanged: every task from the first overlapping one onward then runs inline, in plan order, after any tasks before it.';
}
