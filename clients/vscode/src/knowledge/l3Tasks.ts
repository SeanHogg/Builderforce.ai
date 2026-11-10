/**
 * Queued L3 work for the background indexer's L3 gate (PRD 41 B6, §12.3): heavy, deferrable tasks — today the run delta's
 * analyzer phase (`runDelta/analyzers/l3Phase.ts`) — that run like the indexer's own analyzer pass: only when the person
 * is idle and on mains power, never beside another long pass on the root, ONE at a time (`RootIndexer.runL3Task`).
 *
 * A task is claimed by the indexer whose root holds its repository (or that the repository holds: a monorepo subfolder
 * opened on its own). With no indexer running (auto-index off), or none for the repository, a task runs at once,
 * detached: it is never lost.
 */

export interface L3Task {
  /** The repository the task measures (absolute). */
  root: string;
  run(signal: AbortSignal): Promise<void>;
}

const queue: L3Task[] = [];
/** Each running indexer's root paths. */
const runners = new Set<() => readonly string[]>();

const norm = (p: string): string => {
  const n = p.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^[A-Za-z]:/.test(n) ? n.toLowerCase() : n;
};
const related = (a: string, b: string): boolean => a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

/** Runs a task with no gate (no indexer runs it). */
function runNow(task: L3Task): void {
  void task.run(new AbortController().signal).catch(() => undefined);
}

const claimed = (root: string): boolean => [...runners].some((roots) => roots().some((r) => related(norm(root), norm(r))));

/** Queues a task for the L3 gate of the indexer that holds its repository (or runs it now when none does). */
export function queueL3Task(task: L3Task): void {
  if (!claimed(task.root)) { runNow(task); return; }
  queue.push(task);
}

/** The next task of a root, removed from the queue. */
export function takeL3Task(rootPath: string): L3Task | undefined {
  const at = queue.findIndex((t) => related(norm(t.root), norm(rootPath)));
  return at < 0 ? undefined : queue.splice(at, 1)[0];
}

/** Puts a task the gate stopped (a keystroke) back at the head of the queue. */
export function requeueL3Task(task: L3Task): void {
  queue.unshift(task);
}

/** An indexer runs the L3 gate for these roots; the returned call stops it — what no indexer claims any more runs now. */
export function registerL3Runner(roots: () => readonly string[]): () => void {
  runners.add(roots);
  return () => {
    runners.delete(roots);
    for (const task of queue.filter((t) => !claimed(t.root))) {
      queue.splice(queue.indexOf(task), 1);
      runNow(task);
    }
  };
}

/** For tests. */
export function pendingL3Tasks(): number {
  return queue.length;
}
