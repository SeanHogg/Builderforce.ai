/**
 * The run-start half of run-linked change sets (G19): what was dirty before the run,
 * fingerprinted, and the attribution rule that keeps a run from claiming the user's
 * pre-existing edits. Split out of `runChangeSets.ts`.
 *
 * ONE FINGERPRINT (PRD 41 §C1 step 1). Every file, of any size, is fingerprinted as
 * `sha256:<memory contentHash>` — the EOL-normalized digest the knowledge store keys
 * facts by (`nodeContentHash`, the native twin) — through the same function at start
 * and at finalization. Each file is read at most once: a file above
 * {@link STAT_HINT_MIN_BYTES} whose stat matches its knowledge stat row reuses that
 * row's hash without a read ({@link StatHashHint}). At most
 * {@link FINGERPRINT_CONCURRENCY} files are read or stat'ed at once.
 *
 * PRE-IMAGES (PRD 41 §C1.3). At baseline the BYTES of every dirty file (untracked
 * included) are kept within the run's caps (`runDelta/preimageBudget.ts`) and handed to
 * the {@link PreimageSink}, so the delta can read a file's before side after the run
 * wrote it. A file over a cap is listed in `preimageTooLarge`.
 *
 * WHOLE WORKSPACE. With `folders`, a clean git repository is recorded too (its base
 * commit is what the delta's `git show` reads), and a non-git folder's whole working set
 * is fingerprinted and pre-imaged (`kind: "folder"`), so a run there still has a delta.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { detectPendingChanges, refreshPendingChanges } from "./gitChanges";
import { normalizePath, repoName } from "./gitChangeModel";
import { runGit } from "@builderforce/agent-tools/node-git-history";
import { mapLimit } from "./gitBranchFacts";
import { nodeContentHash } from "./knowledge/nodeSha256";
import { listWorkingSet } from "./runDelta/folderWorkingSet";
import { PreimageBudget } from "./runDelta/preimageBudget";
/** Files above this size first ask the knowledge stat rows for their hash; smaller ones are simply read. */
export const STAT_HINT_MIN_BYTES = 256 * 1024;
/** At most this many files are read or stat'ed at once. */
export const FINGERPRINT_CONCURRENCY = 8;
/** The bare content hash of a fingerprint (`sha256:<hex>` → `<hex>`), as the run delta and the knowledge store key it. */
export function fingerprintHash(fingerprint) {
    return fingerprint?.startsWith("sha256:") ? fingerprint.slice("sha256:".length) : undefined;
}
async function statOf(file) {
    try {
        const st = await fs.stat(file, { bigint: true });
        if (!st.isFile())
            return undefined;
        return { size: Number(st.size), mtimeNs: st.mtimeNs, fileId: st.ino };
    }
    catch {
        return undefined; // a file that vanished or cannot be stat'ed has no fingerprint
    }
}
/** THE fingerprint read: the stat hint for a big file whose bytes are not wanted, else one read. */
async function readFile(file, st, keepBytes, hint) {
    if (!st)
        return { fingerprint: undefined };
    if (!keepBytes && hint && st.size > STAT_HINT_MIN_BYTES) {
        const reused = await hint(file, st).catch(() => undefined);
        if (reused)
            return { fingerprint: `sha256:${reused}` };
    }
    try {
        const bytes = await fs.readFile(file);
        const fingerprint = `sha256:${nodeContentHash(bytes)}`;
        return keepBytes ? { fingerprint, bytes } : { fingerprint };
    }
    catch {
        return { fingerprint: undefined };
    }
}
/** Fingerprint one file (absent or unreadable → undefined). */
export async function fingerprintFile(file, hint) {
    return (await readFile(file, await statOf(file), false, hint)).fingerprint;
}
/** Fingerprint many files, at most {@link FINGERPRINT_CONCURRENCY} at a time, in input order. */
export function fingerprintFiles(paths, hint) {
    return mapLimit(paths, FINGERPRINT_CONCURRENCY, (file) => fingerprintFile(file, hint));
}
/**
 * The baseline reading of one repository's files: each fingerprinted once, and the bytes of those the run's
 * {@link PreimageBudget} admits kept for the sink. Sizes are read first so the budget is spent in input order.
 */
async function readBaselineFiles(files, budget, hint) {
    const stats = await mapLimit(files, FINGERPRINT_CONCURRENCY, (f) => statOf(f.path));
    const decisions = stats.map((st) => budget.decide(st?.size));
    const indices = files.map((_, index) => index);
    const readings = await mapLimit(indices, FINGERPRINT_CONCURRENCY, (index) => readFile(files[index].path, stats[index], decisions[index] === "capture", hint));
    const fingerprints = {};
    const preimages = [];
    const tooLarge = [];
    files.forEach((f, index) => {
        const reading = readings[index];
        fingerprints[f.relativePath] = reading.fingerprint;
        const hash = fingerprintHash(reading.fingerprint);
        if (reading.bytes && hash)
            preimages.push({ hash, bytes: reading.bytes });
        if (decisions[index] === "too-large")
            tooLarge.push(f.relativePath);
    });
    return { fingerprints, preimages, tooLarge: tooLarge.sort() };
}
/**
 * The attribution diff, host-free: given what was dirty at baseline and what is dirty
 * now (with content hashes both times), which changes does the run truthfully own?
 * Files whose hash did not move are the user's pre-existing edits and are excluded.
 */
export function attributeRunChanges(baseline, current) {
    const out = [];
    for (const file of current) {
        const beforeHash = baseline[file.relativePath];
        const existedAtBaseline = file.relativePath in baseline;
        if (existedAtBaseline && beforeHash === file.hash)
            continue; // pre-existing edit, untouched by the run
        out.push({
            relativePath: file.relativePath,
            status: file.status,
            ...(existedAtBaseline && beforeHash !== undefined ? { beforeHash } : {}),
            ...(file.hash !== undefined ? { afterHash: file.hash } : {}),
            attribution: existedAtBaseline ? "run-modified-existing" : "run-authored",
        });
    }
    return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
/** One git call's ceiling for the change set and the run delta (inside the delta's own budget). */
export const REPO_GIT_TIMEOUT_MS = 10_000;
/**
 * One git answer, trimmed (undefined when git could not answer or printed nothing), through agent-tools' `runGit` — the ONE git
 * runner of the change set and the run delta (argument arrays: a path is never re-quoted for a shell).
 */
export async function gitLine(cwd, args) {
    return (await runGit(cwd, args, { timeoutMs: REPO_GIT_TIMEOUT_MS })).stdout?.trim() || undefined;
}
export async function baseCommitOf(root) {
    return gitLine(root, ["rev-parse", "HEAD"]);
}
export async function repositoryIdentityOf(root) {
    return (await gitLine(root, ["config", "--get", "remote.origin.url"])) || root;
}
async function gitRepoEntry(repo, budget, opts) {
    const baseCommit = await baseCommitOf(repo.root);
    const read = await readBaselineFiles(repo.changes, budget, opts.hint);
    storePreimages(repo.root, read.preimages, opts);
    return {
        root: repo.root,
        name: repo.name,
        repository: await repositoryIdentityOf(repo.root),
        ...(repo.branch ? { branch: repo.branch } : {}),
        ...(baseCommit ? { baseCommit } : {}),
        files: read.fingerprints,
        ...(read.tooLarge.length ? { preimageTooLarge: read.tooLarge } : {}),
    };
}
/**
 * Hands the bytes to the sink WITHOUT waiting for the write: the run's first model call never waits on SQLite. The sink owns the
 * write's completion (the delta's reader waits for it, `runDeltaHost.ts`).
 */
function storePreimages(root, items, opts) {
    if (!opts.preimages || items.length === 0)
        return;
    try {
        void opts.preimages(root, items).catch((error) => opts.onPreimageError?.(error));
    }
    catch (error) {
        opts.onPreimageError?.(error);
    }
}
/** The folders the pending set does not cover: a clean git repository (by its top level), or a non-git folder. */
async function uncoveredFolders(folders, covered) {
    const out = [];
    for (const folder of folders) {
        const top = await gitLine(folder, ["rev-parse", "--show-toplevel"]);
        const root = top ? path.resolve(top) : folder;
        const key = normalizePath(root);
        if (covered.has(key))
            continue;
        covered.add(key);
        out.push({ root, git: !!top });
    }
    return out;
}
/**
 * Snapshot every workspace repository's pending work with content hashes (and the dirty
 * files' pre-images). Called at run start; the run's own edits are excluded later by the
 * attribution diff, so this can safely run on an already-dirty tree.
 */
export async function captureRunChangeBaseline(now = new Date(), opts = {}) {
    // The pending-change cache can be 15s stale. A stale "clean" snapshot would later
    // attribute the user's pre-existing dirty files to this run.
    refreshPendingChanges();
    const pending = await detectPendingChanges();
    const budget = new PreimageBudget();
    const repos = [];
    for (const repo of pending.repos)
        repos.push(await gitRepoEntry(repo, budget, opts));
    const covered = new Set(pending.repos.map((repo) => normalizePath(repo.root)));
    for (const { root, git } of await uncoveredFolders(opts.folders ?? [], covered)) {
        if (git) {
            const branch = await gitLine(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
            repos.push(await gitRepoEntry({ root, name: repoName(root), changes: [], ...(branch && branch !== "HEAD" ? { branch } : {}) }, budget, opts));
            continue;
        }
        const listed = await listWorkingSet(root);
        if (listed.files.length === 0)
            continue; // an empty or unreadable folder has nothing a run could change
        const read = await readBaselineFiles(listed.files, budget, opts.hint);
        storePreimages(root, read.preimages, opts);
        repos.push({
            root,
            name: repoName(root),
            repository: root,
            kind: "folder",
            files: read.fingerprints,
            ...(read.tooLarge.length ? { preimageTooLarge: read.tooLarge } : {}),
            ...(listed.truncated ? { truncated: true } : {}),
        });
    }
    return { capturedAt: now.toISOString(), repos };
}
//# sourceMappingURL=runChangeBaseline.js.map