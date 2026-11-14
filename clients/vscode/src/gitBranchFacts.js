/**
 * Read-only git facts about a repository's branches — which exist, how far each is
 * ahead of / behind the base, and whether merging it would conflict or change nothing —
 * for the one-call ticket branch review (`ticketBranchTool.ts`).
 *
 * Every question here is a git PLUMBING query run with `execFile` (no shell, so no
 * quoting or injection surface), and nothing here writes the working tree: the only
 * ref-touching call is `fetch`, which updates remote-tracking refs and nothing else.
 * The merge check uses `git merge-tree --write-tree` (git ≥ 2.38), which computes a merge
 * entirely in the object store — no checkout, no index, no conflict markers on disk.
 */
import { execFile } from "child_process";
import { promisify } from "util";
const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const FETCH_TIMEOUT_MS = 90_000;
const MAX_BUFFER = 8 * 1024 * 1024;
export class GitRepo {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    async git(args, timeout = GIT_TIMEOUT_MS) {
        try {
            const { stdout } = await execFileAsync("git", args, { cwd: this.dir, timeout, maxBuffer: MAX_BUFFER, windowsHide: true });
            return { ok: true, code: 0, stdout: String(stdout) };
        }
        catch (e) {
            const err = e;
            return { ok: false, code: typeof err.code === "number" ? err.code : -1, stdout: String(err.stdout ?? "") };
        }
    }
    async isRepo() {
        const r = await this.git(["rev-parse", "--is-inside-work-tree"]);
        return r.ok && r.stdout.trim() === "true";
    }
    /** Refresh remote-tracking refs. False when there is no `origin` or it is unreachable. */
    async fetch() {
        return (await this.git(["fetch", "--prune", "--quiet", "origin"], FETCH_TIMEOUT_MS)).ok;
    }
    async exists(ref) {
        return (await this.git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok;
    }
    /**
     * The ref to compare against: the caller's `baseBranch` when it resolves, else the
     * remote's default branch (`origin/HEAD` → `origin/main`), else a local main/master.
     * The REMOTE copy is preferred so the review reflects what has actually landed.
     */
    async resolveBase(baseBranch) {
        const candidates = [];
        if (baseBranch)
            candidates.push(`origin/${baseBranch}`, baseBranch);
        const head = await this.git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
        if (head.ok && head.stdout.trim())
            candidates.push(head.stdout.trim());
        candidates.push("origin/main", "main", "origin/master", "master");
        for (const c of candidates)
            if (await this.exists(c))
                return c;
        return null;
    }
    /** Every local branch and every `origin` branch, one entry per name. */
    async branches() {
        const r = await this.git(["for-each-ref", "--format=%(refname)%09%(committerdate:iso-strict)", "refs/heads", "refs/remotes/origin"]);
        if (!r.ok)
            return [];
        const byName = new Map();
        for (const line of r.stdout.split(/\r?\n/)) {
            const [ref, committedAt] = line.split("\t");
            if (!ref)
                continue;
            if (ref.startsWith("refs/heads/")) {
                const name = ref.slice("refs/heads/".length);
                byName.set(name, { name, ref, committedAt: committedAt ?? "", remoteOnly: false });
            }
            else if (ref.startsWith("refs/remotes/origin/")) {
                const name = ref.slice("refs/remotes/origin/".length);
                if (name === "HEAD" || byName.has(name))
                    continue;
                byName.set(name, { name, ref, committedAt: committedAt ?? "", remoteOnly: true });
            }
        }
        return [...byName.values()];
    }
    /** Ahead/behind and a no-checkout merge check of `ref` into `base`. */
    async compare(base, ref) {
        const counts = await this.git(["rev-list", "--left-right", "--count", `${base}...${ref}`]);
        const [behind, ahead] = counts.ok ? counts.stdout.trim().split(/\s+/).map((n) => Number(n) || 0) : [0, 0];
        if (!counts.ok)
            return { ahead: 0, behind: 0, merge: "unknown", conflictFiles: [] };
        if (ahead === 0)
            return { ahead, behind, merge: "in_base", conflictFiles: [] };
        const merged = await this.git(["merge-tree", "--write-tree", "--name-only", "--no-messages", base, ref]);
        const lines = merged.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (merged.ok) {
            const baseTree = await this.git(["rev-parse", `${base}^{tree}`]);
            const same = baseTree.ok && lines[0] === baseTree.stdout.trim();
            return { ahead, behind, merge: same ? "in_base" : "clean", conflictFiles: [] };
        }
        // Exit 1 is git's "merged with conflicts": line 1 is the tree, the rest the conflicted paths.
        if (merged.code === 1 && lines.length > 0) {
            return { ahead, behind, merge: "conflicts", conflictFiles: [...new Set(lines.slice(1))] };
        }
        return { ahead, behind, merge: "unknown", conflictFiles: [] };
    }
}
/** Run `fn` over `items` with at most `limit` in flight — git processes are not free. */
export async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
        while (next < items.length) {
            const i = next++;
            out[i] = await fn(items[i]);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
}
//# sourceMappingURL=gitBranchFacts.js.map