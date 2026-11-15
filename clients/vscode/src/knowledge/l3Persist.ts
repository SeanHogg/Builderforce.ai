/**
 * What L3 remembers across extension-host restarts (PRD 41 B6, §12.3). L3 runs only when a person asks for it (`l3Gate.ts`),
 * and a request on a tree the last completed pass already saw has nothing to do:
 *
 *   - the sha of the last COMPLETED pass is kept per root (`workspaceState`, beside the review records) — {@link l3StateOf};
 *   - a request is owed a pass only when the root's current sha differs from it (or none was kept, or git cannot say);
 *   - a root whose pass took the host down, or failed permanently, is quarantined by its crash guard (`l3CrashGuard.ts`):
 *     {@link L3StatePort.blocked} says so before a pass starts.
 *
 * The sha is the root's latest commit (`recentCommits`, the history reader the indexer already uses): a sub-folder root only
 * moves with commits that touch it.
 */

import { recentCommits } from "@builderforce/agent-tools/node-git-history";
import { l3BlockedFor } from "./l3CrashGuard";
import { hostMemento } from "./knowledgeSyncStatus";
import type { KnowledgeRoot } from "./knowledgeRoots";

/** What the L3 gate reads and writes of a root's persisted state. */
export interface L3StatePort {
  /** The root's current sha; undefined when git cannot say (not a repository). */
  head(): Promise<string | undefined>;
  /** The sha of the last completed L3 pass. */
  done(): string | undefined;
  markDone(sha: string): void;
  /**
   * Why L3 must not start on this root — or, with `rel`, on its sub-folder root `rel` — at `head` (the crash guard's quarantine
   * of that root or of this one), or undefined. Absent ⇒ never blocked here.
   */
  blocked?(head: string | undefined, rel?: string): Promise<string | undefined>;
}

/** The workspaceState key of a root's last completed sha. */
export const l3DoneKey = (rootId: string): string => `builderforce.knowledge.l3Done.${rootId}`;

/** The persisted state of one root (memory only before activation hands the memento in, and in tests). */
export function l3StateOf(root: Pick<KnowledgeRoot, "rootId" | "rootPath">, seams: { head?: (rootPath: string) => Promise<string | undefined>; memento?: () => { get<T>(key: string): T | undefined; update(key: string, value: unknown): Thenable<void> } | undefined } = {}): L3StatePort {
  const key = l3DoneKey(root.rootId);
  const memento = seams.memento ?? hostMemento;
  const headOf = seams.head ?? (async (rootPath: string) => (await recentCommits(rootPath, 1))[0]?.sha);
  let kept: string | undefined;
  return {
    head: () => headOf(root.rootPath),
    done: () => {
      const stored = memento()?.get<unknown>(key);
      return typeof stored === "string" ? stored : kept;
    },
    markDone(sha) {
      kept = sha;
      void Promise.resolve(memento()?.update(key, sha)).catch(() => undefined);
    },
    blocked: (head, rel) => l3BlockedFor(rel ? `${root.rootId}:${rel}` : root.rootId, rel, head ?? null, seams.memento ? { memento: seams.memento } : undefined),
  };
}

/** The answer of one look at a root's sha. */
export type L3Verdict =
  /** The sha differs from the last completed pass's (or none was kept): a request runs a pass. */
  | "owed"
  /** The last completed pass was at this sha. */
  | "current"
  /** git cannot say: the gate's own flag decides. */
  | "unknown";

/** Decides, per look, whether the root's sha owes L3; remembers what completed. */
export class L3Tracker {
  private looked: string | undefined;

  constructor(private readonly port: L3StatePort) {}

  async verdict(): Promise<L3Verdict> {
    const head = await this.port.head().catch(() => undefined);
    this.looked = head;
    if (!head) return "unknown";
    return head === this.port.done() ? "current" : "owed";
  }

  /** Why L3 must not start — on the root, or with `rel` on its sub-folder root — at the sha of the last look, or undefined. */
  blocked(rel?: string): Promise<string | undefined> {
    return this.port.blocked?.(this.looked, rel) ?? Promise.resolve(undefined);
  }

  /** The pass that began at the last look finished. */
  completed(): void {
    if (this.looked) this.port.markDone(this.looked);
  }
}
