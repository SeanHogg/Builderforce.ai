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
import { L3_HEAD_STABLE_MS, L3_RETRY_BACKOFF_MS } from "./indexBudget";
import { hostMemento } from "./knowledgeSyncStatus";
/** The workspaceState key of a root's last completed sha. */
export const l3DoneKey = (rootId) => `builderforce.knowledge.l3Done.${rootId}`;
/** The persisted state of one root (memory only before activation hands the memento in, and in tests). */
export function l3StateOf(root, seams = {}) {
    const key = l3DoneKey(root.rootId);
    const memento = seams.memento ?? hostMemento;
    const headOf = seams.head ?? (async (rootPath) => (await recentCommits(rootPath, 1))[0]?.sha);
    let kept;
    return {
        head: () => headOf(root.rootPath),
        done: () => {
            const stored = memento()?.get(key);
            return typeof stored === "string" ? stored : kept;
        },
        markDone(sha) {
            kept = sha;
            void Promise.resolve(memento()?.update(key, sha)).catch(() => undefined);
        },
    };
}
/** Decides, per look, whether the root's sha owes L3; remembers what completed. */
export class L3Tracker {
    port;
    clock;
    stableMs;
    backoffMs;
    seen;
    looked;
    failed;
    retryAt = Number.NEGATIVE_INFINITY;
    constructor(port, clock, stableMs = L3_HEAD_STABLE_MS, backoffMs = L3_RETRY_BACKOFF_MS) {
        this.port = port;
        this.clock = clock;
        this.stableMs = stableMs;
        this.backoffMs = backoffMs;
    }
    async verdict() {
        const head = await this.port.head().catch(() => undefined);
        if (!head)
            return "unknown";
        const now = this.clock.now();
        // The session's first reading has stood since before it began; a later, different one starts the window afresh.
        if (!this.seen)
            this.seen = { sha: head, since: Number.NEGATIVE_INFINITY };
        else if (this.seen.sha !== head)
            this.seen = { sha: head, since: now };
        this.looked = head;
        if (head === this.port.done() || head === this.failed)
            return "current";
        if (now < this.retryAt)
            return "settling"; // a failed pass backs off
        return now - this.seen.since >= this.stableMs ? "owed" : "settling";
    }
    /** The pass that began at the last look finished. */
    completed() {
        if (this.looked)
            this.port.markDone(this.looked);
    }
    /**
     * The pass that began at the last look failed. An out-of-memory (`permanent`) is not retried for this sha until the host
     * restarts or the sha moves — it would die the same way; any other failure retries after {@link L3_RETRY_BACKOFF_MS}.
     */
    failedPass(permanent) {
        if (permanent)
            this.failed = this.looked;
        else
            this.retryAt = this.clock.now() + this.backoffMs;
    }
}
/** Whether an L3 pass failed because its worker hit its heap limit (the one failure a retry on the same tree cannot cure). */
export function isWorkerOom(error) {
    const e = error;
    return e?.code === "ERR_WORKER_OUT_OF_MEMORY" || /memory limit|out of memory/i.test(String(e?.message ?? ""));
}
//# sourceMappingURL=l3Persist.js.map