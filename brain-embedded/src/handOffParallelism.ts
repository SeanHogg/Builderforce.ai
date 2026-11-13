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
 *     (or owns none, or consumes an earlier task's package) onward, the coder runs them inline
 *     in plan order — order beats parallelism.
 *
 * Every child is a clone of its owner and nothing downstream restricts it, so this is where
 * slices are kept apart. Pure.
 */

// The package.json probe below is Node-only, but this module ALSO ships inside the browser
// webview bundle (the frontend's canvas closure imports brain-embedded's index). A static
// `import from 'node:…'` breaks THAT build: Vite externalizes the builtins for the browser and
// Rollup rejects the named export ("fileURLToPath is not exported by __vite-browser-external").
// So the builtins are reached lazily through createRequire, the import below is a DEFAULT import
// on purpose (defaults survive Vite's browser externalization; named imports fail the build), and
// every use sits behind a try/catch that falls back to the directory-only answers.
import nodeModule from 'node:module';
import { overlappingScopes } from '@builderforce/agent-tools';

/** What the split reads of a task. */
export interface ScopedTask {
  title: string;
  /** Free text the planner wrote — the brief counts, not just the title. */
  brief?: string;
  paths: readonly string[];
}

/**
 * An ORDER dependency between two path-disjoint tasks (chat #80006): `consumer`'s title/brief
 * consumes the package `producer` creates or changes, so the consumer must run AFTER the
 * producer even though no file overlaps. Indexes into the task array the split was given.
 */
export interface OrderDependency {
  producer: number;
  consumer: number;
  packageDir: string;
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
  /**
   * Order dependencies that staged a consumer after its producer (chat #80006). Empty/absent when
   * no task's brief consumes another task's package.
   */
  order?: OrderDependency[];
}

/**
 * Where a task's `paths` are looked for a package.json — the checkout root, derived lazily so the
 * CJS bundle (where `import.meta.url` is empty) and non-node hosts never touch it at load time.
 */
let packageLookRoot: string | null | undefined;
function lookRoot(): string | null {
  if (packageLookRoot === undefined) {
    packageLookRoot = null;
    try {
      // Node only: resolve fs/path/url through createRequire so the module also loads in a browser
      // (where `node:module` is externalized and `require` is undefined — the try/catch leaves the
      // root null and the probe below answers false).
      const require = nodeModule.createRequire(import.meta.url ?? 'file:///');
      const path = require('node:path') as typeof import('node:path');
      const { fileURLToPath } = require('node:url') as typeof import('node:url');
      packageLookRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    } catch {
      packageLookRoot = typeof process !== 'undefined' && typeof process.cwd === 'function' ? process.cwd() : null;
    }
  }
  return packageLookRoot;
}

const hasPackageJson = (dir: string): boolean => {
  const root = lookRoot();
  if (root === null) return false;
  try {
    const require = nodeModule.createRequire(import.meta.url ?? 'file:///');
    const { existsSync } = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    return existsSync(path.join(root, dir, 'package.json'));
  } catch {
    return false;
  }
};

/**
 * The package a task works in: the longest common directory prefix of its `paths` whose
 * directory holds a package.json; the deepest common parent when no prefix is a package.
 * Null for a task that owns no paths — it produces nothing another task can import.
 */
export function taskPackageDir(task: ScopedTask): string | null {
  const paths = task.paths;
  if (paths.length === 0) return null;
  const dirs = paths.map((p) => p.replace(/\\/g, '/').replace(/\/$/, '')).map((p) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.'));
  const prefix = (a: string, b: string): string => {
    if (a === b) return a;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    let end = a.slice(0, i).lastIndexOf('/');
    if (end < 0) end = 0;
    return a.slice(0, end);
  };
  let common = dirs[0]!;
  for (const d of dirs.slice(1)) common = prefix(common, d);
  let dir: string | null = common;
  for (;;) {
    if (dir === null || dir === '' || dir === '.') return common;
    if (hasPackageJson(dir)) return dir;
    const up: string = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : '.';
    if (up === dir || up === '.') return common;
    dir = up;
  }
}

const normalizeRef = (s: string): string => s.replace(/\\/g, '/').replace(/\/$/, '').toLowerCase();

/**
 * Whether `text` (a title or brief) consumes the package at `dir`: it names the directory or its
 * basename, e.g. a brief that says "imports the new RunDelta/CopiedNote exports from
 * @builderforce/knowledge-graph-view" references `packages/knowledge-graph-view`.
 */
export function referencesPackage(text: string, dir: string): boolean {
  const normText = normalizeRef(text);
  if (normText === '') return false;
  const normDir = normalizeRef(dir);
  // basename without the node:path module (the module also loads in the browser webview, where the
  // builtin is externalized): after normalization the separator is always '/', so the basename is
  // the segment after the last '/'.
  const base = normDir.slice(normDir.lastIndexOf('/') + 1);
  return normText.includes(normDir) || (base !== '' && normText.includes(base));
}

/** Text that can make a task consume another task's package: its brief first, title as fallback. */
const refText = (t: ScopedTask): string => t.brief?.trim() ? `${t.brief} ${t.title}` : t.title;

/** Slashes for {@link overlappingScopes}, which string-compares paths. */
const normPaths = (t: ScopedTask): readonly string[] => t.paths.map((p) => p.replace(/\\/g, '/'));

const scopeOf = (t: ScopedTask): { label: string; paths: readonly string[] } => ({ label: t.title, paths: normPaths(t) });

const pathDisjoint = (a: ScopedTask, b: ScopedTask): boolean =>
  overlappingScopes([scopeOf(a), scopeOf(b)]) === null;

/**
 * Order dependencies between path-DISJOINT tasks (chat #80006): a1 adds exports to a package and
 * a2/a3 import them from disjoint directories, so no path overlaps but the consumers typecheck
 * against exports that do not exist yet. Each pair where `consumer`'s brief names `producer`'s
 * package yields one dependency; pairs whose paths already overlap are left to the clash.
 */
export function computeOrderDependencies(tasks: readonly ScopedTask[]): OrderDependency[] {
  const deps: OrderDependency[] = [];
  const packageOf = tasks.map(taskPackageDir);
  for (let j = 0; j < tasks.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const packageDir = packageOf[i];
      // The repo root is not a package: a bare-filename task ('a.ts') resolves its "package" to
      // '.', whose basename is a period that matches any brief with a dot — a false dependency
      // that would force the whole plan inline. Only a real package dir can be consumed.
      if (packageDir === null || packageDir === '.' || !pathDisjoint(tasks[i]!, tasks[j]!)) continue;
      if (referencesPackage(refText(tasks[j]!), packageDir)) deps.push({ producer: i, consumer: j, packageDir });
    }
  }
  return deps;
}

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
 *
 * An ORDER dependency (chat #80006) beats parallelism the same way: a task whose brief consumes
 * the package an earlier task changes cannot run beside it or any task after that earlier one —
 * it goes inline, after the parallel stage, and everything after it follows in plan order.
 */
export function splitForParallel(tasks: readonly ScopedTask[]): ParallelSplit {
  const all = tasks.map((_, i) => i);
  const order = computeOrderDependencies(tasks);
  const consumedBefore = (index: number): boolean => order.some((d) => d.consumer === index);
  let lead = 0;
  while (
    lead < tasks.length
    && tasks[lead]!.paths.length > 0
    && !consumedBefore(lead)
    && overlappingScopes(tasks.slice(0, lead + 1).map(scopeOf)) === null
  ) lead += 1;
  const parallel = lead >= 2 ? all.slice(0, lead) : [];
  const result: ParallelSplit = { parallel, inline: all.slice(parallel.length), clash: planScopeClash(tasks) };
  if (order.length > 0) result.order = order;
  return result;
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

/** Why a consumer runs after its producer, as a sentence. */
export function describeOrder(dep: OrderDependency, titles: readonly string[]): string {
  return `"${titles[dep.consumer] ?? `#${dep.consumer + 1}`}" consumes ${dep.packageDir}, which "${titles[dep.producer] ?? `#${dep.producer + 1}`}" changes`;
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
export function splitLayoutLine(split: ParallelSplit, titles: readonly string[] = []): string {
  const why = split.clash ? ` — ${describeClash(split.clash)}, so they cannot run at the same time` : '';
  const after = split.order?.length
    ? ` — ${split.order.map((d) => describeOrder(d, titles)).join('; ')}, so the consumer runs after the producer`
    : '';
  const mode = modeOf(split);
  if (mode === 'mixed') {
    return `Side by side: task${split.parallel.length === 1 ? '' : 's'} ${taskNumbers(split.parallel)}. ` +
      `Then in order, by the coding model: task${split.inline.length === 1 ? '' : 's'} ${taskNumbers(split.inline)}${why || after}.`;
  }
  return mode === 'inline' && (split.clash || after) ? `In order, by the coding model${why || after}.` : '';
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
