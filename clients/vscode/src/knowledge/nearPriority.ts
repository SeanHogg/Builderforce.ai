/**
 * The background indexer's queue priority for one root (PRD 41 B6 "Scheduling"): open in an editor, visible, within 2
 * import hops of an open file (`near`, by the root's fact graph), recently committed, the rest. Pure.
 *
 * The near set is memoised per open set and per IMPORT-GRAPH version: only a `structure` change moves the import graph,
 * so a body or comment edit never recomputes it.
 */

import type { FactKind } from "./indexLevels";
import { PRIORITY } from "./indexScheduler";

export interface NearPriorityDeps {
  /** The file's editor priority (open, visible, else rest) — {@link PRIORITY}. */
  priorityOf(path: string): number;
  /** Root-relative paths of the files open in editors: the near level's seeds. Absent ⇒ no near level. */
  openPaths?(): readonly string[];
  /** The files within 2 import hops of the seeds. Absent ⇒ no near level. */
  near?(seeds: readonly string[]): ReadonlySet<string>;
}

const EMPTY: ReadonlySet<string> = new Set();

export class NearPriority {
  private memo: { key: string; version: number; set: ReadonlySet<string> } | undefined;
  private importsVersion = 0;

  constructor(private readonly deps: NearPriorityDeps) {}

  /** The editor's priority, else near an open file, else recently committed (`recent`), else the rest. */
  priorityOf(path: string, recent: ReadonlySet<string>): number {
    let priority = this.deps.priorityOf(path);
    if (priority > PRIORITY.near && this.nearOpen().has(path)) priority = PRIORITY.near;
    return recent.has(path) ? Math.min(priority, PRIORITY.recent) : priority;
  }

  /** Facts moved: the near set is re-read only when the import graph (`structure`) did. */
  factsChanged(kinds: readonly FactKind[]): void {
    if (kinds.includes("structure")) this.importsVersion += 1;
  }

  private nearOpen(): ReadonlySet<string> {
    const seeds = this.deps.openPaths?.() ?? [];
    if (seeds.length === 0 || !this.deps.near) return EMPTY;
    const key = [...seeds].sort().join("\u0000");
    if (this.memo?.key !== key || this.memo.version !== this.importsVersion) {
      this.memo = { key, version: this.importsVersion, set: this.deps.near(seeds) };
    }
    return this.memo.set;
  }
}
