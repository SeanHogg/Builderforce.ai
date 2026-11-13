/**
 * What L3 remembers across extension-host restarts (PRD 41 B6, §12.3). The analyzers' pass was owed afresh every session, so
 * a host that died mid-pass (or was restarted by VS Code) re-owed it and re-ran it 30 s later — a crash loop. Now:
 *
 *   - the sha of the last COMPLETED pass is kept per root (`workspaceState`, beside the review records) — {@link l3StateOf};
 *   - L3 is owed only when the root's current sha differs from it (or none was kept);
 *   - a sha that CHANGES while the host runs owes L3 only once it has stood still for {@link L3_HEAD_STABLE_MS}, so a burst
 *     of commits makes one pass — {@link L3Tracker}; a pass that FAILED is not retried for the same sha this session.
 *
 * The sha is the root's latest commit (`recentCommits`, the history reader the indexer already uses): a sub-folder root only
 * moves with commits that touch it.
 */

import { recentCommits } from "@builderforce/agent-tools/node-git-history";
import { L3_HEAD_STABLE_MS, L3_RETRY_BACKOFF_MS, type Clock } from "./indexBudget";
import { hostMemento } from "./knowledgeSyncStatus";
import type { KnowledgeRoot } from "./knowledgeRoots";

/** What the L3 gate reads and writes of a root's persisted state. */
export interface L3StatePort {
  /** The root's current sha; undefined when git cannot say (not a repository). */
  head(): Promise<string | undefined>;
  /** The sha of the last completed L3 pass. */
  done(): string | undefined;
  markDone(sha: string): void;
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
  };
}

/** The answer of one look at a root's sha. */
export type L3Verdict =
  /** The sha differs from the last completed pass's and has stood still long enough. */
  | "owed"
  /** The last completed pass (or the last failed one) was at this sha. */
  | "current"
  /** The sha moved a moment ago: wait for it to settle. */
  | "settling"
  /** git cannot say: the gate's own flag decides. */
  | "unknown";

/** Decides, per look, whether the root's sha owes L3; remembers what completed. */
export class L3Tracker {
  private seen: { sha: string; since: number } | undefined;
  private looked: string | undefined;
  private failed: string | undefined;
  private retryAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly port: L3StatePort, private readonly clock: Pick<Clock, "now">,
    private readonly stableMs: number = L3_HEAD_STABLE_MS, private readonly backoffMs: number = L3_RETRY_BACKOFF_MS,
  ) {}

  async verdict(): Promise<L3Verdict> {
    const head = await this.port.head().catch(() => undefined);
    if (!head) return "unknown";
    const now = this.clock.now();
    // The session's first reading has stood since before it began; a later, different one starts the window afresh.
    if (!this.seen) this.seen = { sha: head, since: Number.NEGATIVE_INFINITY };
    else if (this.seen.sha !== head) this.seen = { sha: head, since: now };
    this.looked = head;
    if (head === this.port.done() || head === this.failed) return "current";
    if (now < this.retryAt) return "settling"; // a failed pass backs off
    return now - this.seen.since >= this.stableMs ? "owed" : "settling";
  }

  /** The pass that began at the last look finished. */
  completed(): void {
    if (this.looked) this.port.markDone(this.looked);
  }

  /**
   * The pass that began at the last look failed. An out-of-memory (`permanent`) is not retried for this sha until the host
   * restarts or the sha moves — it would die the same way; any other failure retries after {@link L3_RETRY_BACKOFF_MS}.
   */
  failedPass(permanent: boolean): void {
    if (permanent) this.failed = this.looked;
    else this.retryAt = this.clock.now() + this.backoffMs;
  }
}

/** Whether an L3 pass failed because its worker hit its heap limit (the one failure a retry on the same tree cannot cure). */
export function isWorkerOom(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  return e?.code === "ERR_WORKER_OUT_OF_MEMORY" || /memory limit|out of memory/i.test(String(e?.message ?? ""));
}
