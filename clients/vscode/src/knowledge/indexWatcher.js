/**
 * The background indexer's watcher input (PRD 41 B2 step 5) — pure. A file-system watcher reports absolute paths; this
 * maps them onto the root they sit in, drops what the index never lists, and coalesces a burst: one batch per root after
 * {@link COALESCE_MS} of quiet, each path once.
 *
 * Dropped: the host's own `.builderforce/` state — `.builderforce/cache/**` (the fact store's SQLite writes would
 * otherwise wake the indexer on every write it makes) and every other state file — and the directories no review walks
 * (`KNOWLEDGE_SKIP_DIRS`: installs, builds, VCS stores). The same rules the plan walks by (`listsFile`, `isSkippedPath`).
 * Watchers drop events; the reconciling plan on activation and refocus catches what they miss.
 */
import { isSkippedPath, listsFile } from "@builderforce/agent-tools/knowledge";
import { COALESCE_MS } from "./indexBudget";
import { inside, slash } from "./knowledgeRoots";
/** Whether a root-relative path is one the index lists (a change to it is worth indexing). */
export function indexedPath(rel) {
    return rel !== "" && listsFile(rel) && !isSkippedPath(rel);
}
/** `abs` relative to `root`, or undefined when it is not strictly under it. Case-insensitive on Windows paths (drive letters). */
export function relativeUnder(root, abs, caseInsensitive = process.platform === "win32") {
    const r = slash(root);
    const a = slash(abs);
    return a.length > r.length && inside(a, r, caseInsensitive) ? a.slice(r.length + 1) : undefined;
}
/** Coalesces watcher events per root: one `onBatch(rootId, paths)` per root after {@link COALESCE_MS} of quiet. */
export class PathCoalescer {
    clock;
    onBatch;
    debounceMs;
    pending = new Map();
    timer;
    constructor(clock, onBatch, debounceMs = COALESCE_MS) {
        this.clock = clock;
        this.onBatch = onBatch;
        this.debounceMs = debounceMs;
    }
    /** Absolute paths a watcher reported under `root`. Paths outside it, or never indexed, are dropped here. */
    push(root, absPaths) {
        let added = false;
        for (const abs of absPaths) {
            const rel = relativeUnder(root.rootPath, abs);
            if (rel === undefined || !indexedPath(rel))
                continue;
            let set = this.pending.get(root.rootId);
            if (!set)
                this.pending.set(root.rootId, (set = new Set()));
            set.add(rel);
            added = true;
        }
        if (!added)
            return;
        if (this.timer !== undefined)
            this.clock.clearTimeout(this.timer);
        this.timer = this.clock.setTimeout(() => this.flush(), this.debounceMs);
    }
    flush() {
        this.timer = undefined;
        const batches = [...this.pending];
        this.pending.clear();
        for (const [rootId, paths] of batches)
            this.onBatch(rootId, [...paths].sort());
    }
    dispose() {
        if (this.timer !== undefined)
            this.clock.clearTimeout(this.timer);
        this.timer = undefined;
        this.pending.clear();
    }
}
//# sourceMappingURL=indexWatcher.js.map