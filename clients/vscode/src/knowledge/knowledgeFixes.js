/**
 * `applyFix` (PRD 38, Option B+ Contract 4): only the finding kinds that have a
 * deterministic codemod are applied here ({@link CODEMODS}). Every other kind rejects, and the
 * view falls back to `onCompose`.
 *
 *   unused-export  the per-export remover (`removeExportFromSource`, `@builderforce/agent-tools/node-symbols`)
 *                  removes ONLY the export the finding names (`params.name`), never the file's other
 *                  unused exports (PRD 41 WS9);
 *   unused-file    the pinned knip `--fix --fix-type files` (`knipRemoveFilesCommand`).
 *
 * A codemod may touch more than the finding (knip fixes the whole project), so the fix is guarded and SCOPED:
 *
 *   precondition  the work tree must be COMPLETELY clean (`git status --porcelain=v1 -z
 *                 --untracked-files=all` is empty: nothing modified, staged or untracked),
 *                 the repo must have a HEAD commit, and no editor under the root may hold
 *                 unsaved changes. Any git failure refuses - a failed read is never "clean";
 *   one at a time per root (a second fix waits for the first);
 *   during        the person's saves under the root are recorded;
 *   after         ALWAYS (also when knip fails or times out): every changed path the finding
 *                 does not name is put back from HEAD (files knip created are deleted) -
 *                 unless the person saved it during the run, which is kept and reported as a
 *                 conflict. A restore that fails rejects loudly.
 *
 * Because the tree was clean, HEAD IS the state before, so nothing of the person's is lost.
 */
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { knipRemoveFilesCommand } from "@builderforce/agent-tools";
import { sourcePathOf } from "@builderforce/agent-tools/knowledge";
import { runGit } from "@builderforce/agent-tools/node-git-history";
import { removeExportFromSource } from "@builderforce/agent-tools/node-symbols";
import { symbolGrammarOptions } from "../workspaceSymbols";
import { assertInsideRoot } from "./knowledgeFixPaths";
import { runShell } from "./knowledgeShell";
import { fixText } from "./knowledgeFixText";
import { snapshotFix } from "./knowledgeFixUndo";
/** The one export an `unused-export` finding names (`params.name`); absent on a finding that covers the whole file. */
export const exportNameOf = (finding) => (typeof finding.params?.name === "string" && finding.params.name ? finding.params.name : undefined);
/** The finding kinds a codemod exists for. */
const CODEMODS = {
    "unused-export": {
        prepare(finding, wanted) {
            const name = exportNameOf(finding);
            // A finding from before names were badged covers every export of the file: no single export to remove.
            if (!name || wanted.size !== 1)
                throw new Error(fixText.noExportName());
            const [path] = wanted;
            return (ports) => ports.removeExport(path, name);
        },
    },
    "unused-file": { prepare: () => (ports) => ports.run(knipRemoveFilesCommand()) },
};
const KNIP_TIMEOUT_MS = 10 * 60_000;
export const isFixableKind = (kind) => kind in CODEMODS;
/** `git status --porcelain=v1 -z` output as entries, the prefix of the root inside the repo removed. Pure. */
export function parseStatusZ(out, prefix) {
    const fields = out.split("\0");
    const entries = [];
    const rel = (p) => (prefix && p.startsWith(prefix) ? p.slice(prefix.length) : p);
    for (let i = 0; i < fields.length; i++) {
        const field = fields[i];
        if (field.length < 4)
            continue;
        const code = field.slice(0, 2);
        entries.push({ code, path: rel(field.slice(3)) });
        // A rename or copy carries its origin as the next field.
        if (code[0] === "R" || code[0] === "C" || code[1] === "R" || code[1] === "C") {
            const origin = fields[++i];
            if (origin)
                entries.push({ code: " D", path: rel(origin) });
        }
    }
    return entries;
}
/** Did knip actually run? Exit 0, or exit 1 with a report on stdout and no launcher/npm failure. */
export function knipRanOk(code, stdout, stderr) {
    if (code === 0)
        return true;
    if (code !== 1)
        return false;
    if (/npm (ERR|error)|command not found|is not recognized|ENOENT|Cannot find (module|package)|ERR_MODULE_NOT_FOUND/i.test(`${stderr}\n${stdout}`))
        return false;
    return stdout.trim().length > 0;
}
const locks = new Map();
/** Runs `work` after every earlier fix of the same root finished. */
export function serialized(rootId, work) {
    const run = (locks.get(rootId) ?? Promise.resolve()).catch(() => undefined).then(work);
    locks.set(rootId, run);
    void run.finally(() => { if (locks.get(rootId) === run)
        locks.delete(rootId); }).catch(() => undefined);
    return run;
}
/** Applies the finding's codemod. `record` (when the host can undo) stores the snapshot taken under the lock and returns the id the result carries. */
export function applyCodemod(ports, rootId, finding, record) {
    const codemod = CODEMODS[finding.kind];
    if (!codemod)
        return Promise.reject(new Error(fixText.noAutomaticFix(finding.kind)));
    const wanted = new Set(finding.nodes.flatMap((ref) => {
        const path = sourcePathOf(ref, rootId);
        return path ? [path] : [];
    }));
    if (wanted.size === 0)
        return Promise.reject(new Error(fixText.noFileOfFolder()));
    let apply;
    try {
        apply = codemod.prepare(finding, wanted);
    }
    catch (error) {
        return Promise.reject(error);
    }
    return serialized(rootId, () => fix(ports, wanted, apply, fixBranchName(finding, wanted, new Date()), record));
}
/**
 * `fix/<kind>-<slug>-<yyyymmddhhmmss>-<hash>`: the kind, the first file's name, the time to the second
 * and a hash of the finding id, so two fixes of one finding (or two findings on one file) never
 * collide on a branch name. Pure.
 */
export function fixBranchName(finding, wanted, now) {
    const first = [...wanted][0] ?? "";
    const clean = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const slug = clean((first.split("/").pop() ?? "").replace(/\.[^.]*$/, "")).slice(0, 24);
    let h = 5381;
    for (const c of finding.id)
        h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
    const stamp = now.toISOString().replace(/\D/g, "").slice(0, 14);
    return `fix/${clean(finding.kind)}-${slug ? slug + "-" : ""}${stamp}-${h.toString(36).padStart(6, "0").slice(0, 8)}`;
}
async function fix(ports, wanted, apply, branchName, record) {
    if (!(await ports.hasHead()))
        throw new Error(fixText.noCommit());
    const before = await ports.status();
    if (before === undefined)
        throw new Error(fixText.statusUnreadable());
    if (before.length > 0) {
        throw new Error(fixText.treeChanges(`${before.slice(0, 3).map((e) => e.path).join(", ")}${before.length > 3 ? ", ..." : ""}`));
    }
    const buffers = ports.dirtyBuffers();
    if (buffers.length > 0)
        throw new Error(fixText.saveFirst(buffers.slice(0, 3).join(", ")));
    // Branch first (the tree is clean, so nothing is carried that is not the fix). A failure applies in place AND is reported.
    const origin = ports.createBranch ? await ports.currentBranch?.() : undefined;
    const made = ports.createBranch ? await ports.createBranch(branchName) : undefined;
    const branch = made?.ok ? branchName : undefined;
    const branchError = made && !made.ok ? made.reason : undefined;
    const leaveBranch = async () => { if (branch && origin)
        await ports.switchTo?.(origin); };
    const watch = ports.watchSaves();
    let runError;
    let saved = [];
    let outcome;
    let restoreError;
    try {
        await apply(ports);
    }
    catch (error) {
        runError = error;
    }
    finally {
        saved = watch.stop();
        try {
            outcome = await settle(ports, wanted, new Set(saved));
        }
        catch (error) {
            restoreError = error;
        }
    }
    if (restoreError !== undefined) {
        const why = restoreError instanceof Error ? restoreError.message : String(restoreError);
        await leaveBranch().catch(() => undefined);
        throw new Error(fixText.notUndoneCleanly(why));
    }
    if (runError !== undefined) {
        await leaveBranch().catch(() => undefined);
        throw runError;
    }
    const { changed, conflicts } = outcome;
    /** Back to where the person started, and the fix branch (no commits: it IS the origin) deleted. True when both held. */
    const abandonBranch = async () => {
        if (!branch || !origin || !ports.switchTo)
            return false;
        const back = await ports.switchTo(origin).catch(() => undefined);
        if (!back?.ok)
            return false;
        await ports.deleteBranch?.(branch).catch(() => undefined);
        return true;
    };
    // The codemod changed nothing the finding names: an undo-capable host would hold no record, so no
    // empty fix branch is left behind.
    if (record && changed.length === 0) {
        const kept = branch && !(await abandonBranch());
        return { ...(kept ? { branch } : {}), ...(branchError ? { branchError } : {}), changed, ...(conflicts.length > 0 ? { conflicts } : {}) };
    }
    let fixId;
    if (record) {
        try {
            const snapshot = await snapshotFix(ports, changed, branch ? origin : undefined);
            // A host that CAN snapshot (headSha + hashObjects) but got none: git failed, so there is no undo.
            if (!snapshot && ports.headSha && ports.hashObjects)
                throw new Error(fixText.headUnreadable());
            fixId = snapshot ? record(snapshot) : undefined;
        }
        catch (error) {
            // No undo record: never leave the fix applied on its branch. Revert it, then ALWAYS try to
            // go back and drop the branch; the message says what actually happened.
            const why = error instanceof Error ? error.message : String(error);
            let revertError;
            let back = false;
            try {
                await revertPaths(ports, changed);
            }
            catch (failure) {
                revertError = failure;
            }
            finally {
                back = await abandonBranch().catch(() => false);
            }
            const message = revertError !== undefined
                ? fixText.notRecordedRevertFailed(why, revertError instanceof Error ? revertError.message : String(revertError))
                : !branch
                    ? fixText.notRecordedReverted(why)
                    : back
                        ? fixText.notRecorded(why)
                        : fixText.notRecordedStillOnBranch(branch, why);
            // The snapshot's failure is the message; the revert's (when it failed too) rides as the cause.
            throw Object.assign(new Error(message), { cause: revertError ?? error });
        }
    }
    return { ...(branch ? { branch } : {}), ...(branchError ? { branchError } : {}), ...(fixId ? { fixId } : {}), changed, ...(conflicts.length > 0 ? { conflicts } : {}) };
}
/** Puts these root-relative paths back to HEAD (a file the codemod created is deleted). */
async function revertPaths(ports, paths) {
    const want = new Set(paths);
    const entries = ((await ports.status()) ?? []).filter((e) => want.has(e.path));
    const restore = entries.filter((e) => e.code !== "??").map((e) => e.path);
    const remove = entries.filter((e) => e.code === "??").map((e) => e.path);
    if (restore.length > 0)
        await ports.restore(restore);
    if (remove.length > 0)
        await ports.remove(remove);
}
/** After the codemod: put every stray change back (except what the person saved) and report what stayed. */
async function settle(ports, wanted, saved) {
    const after = await ports.status();
    if (after === undefined)
        throw new Error(fixText.statusUnreadableAfter());
    const changed = [];
    const conflicts = [];
    const restore = [];
    const remove = [];
    for (const entry of after) {
        if (wanted.has(entry.path)) {
            changed.push(entry.path);
            continue;
        }
        if (saved.has(entry.path)) {
            conflicts.push(entry.path);
            continue;
        }
        if (entry.code === "??")
            remove.push(entry.path);
        else
            restore.push(entry.path);
    }
    if (restore.length > 0)
        await ports.restore(restore);
    if (remove.length > 0)
        await ports.remove(remove);
    return { changed, conflicts };
}
/** The git, file and shell ports of a folder; the editor-bound ones (`dirtyBuffers`, `watchSaves`) come from the caller. */
export function nodeFixPorts(rootPath) {
    const orThrow = async (args) => {
        const run = await runGit(rootPath, args);
        if (run.stdout === undefined)
            throw new Error(fixText.gitFailed(args[0] ?? "", run.stderr ? `: ${run.stderr.trim().slice(0, 300)}` : ""));
        return run.stdout;
    };
    return {
        async hasHead() {
            return (await runGit(rootPath, ["rev-parse", "--verify", "HEAD"])).stdout !== undefined;
        },
        async createBranch(name) {
            const run = await runGit(rootPath, ["switch", "-c", name]);
            return run.stdout !== undefined ? { ok: true } : { ok: false, reason: (run.stderr ?? "").trim().slice(0, 300) };
        },
        async currentBranch() {
            const run = await runGit(rootPath, ["symbolic-ref", "--short", "-q", "HEAD"]);
            return run.stdout?.trim() || undefined;
        },
        async switchTo(branch) {
            const run = await runGit(rootPath, ["switch", branch]);
            return run.stdout !== undefined ? { ok: true } : { ok: false, reason: (run.stderr ?? "").trim().slice(0, 300) };
        },
        async deleteBranch(name) {
            // `-d` (not `-D`): git refuses a branch with commits not on HEAD, so only an empty fix branch goes.
            const run = await runGit(rootPath, ["branch", "-d", name]);
            return run.stdout !== undefined ? { ok: true } : { ok: false, reason: (run.stderr ?? "").trim().slice(0, 300) };
        },
        async status() {
            const prefix = await runGit(rootPath, ["rev-parse", "--show-prefix"]);
            const out = await runGit(rootPath, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
            if (prefix.stdout === undefined || out.stdout === undefined)
                return undefined;
            return parseStatusZ(out.stdout, prefix.stdout.trim());
        },
        run: (command) => runShell(command, rootPath, { ok: knipRanOk, timeoutMs: KNIP_TIMEOUT_MS }),
        async removeExport(path, name) {
            await assertInsideRoot(rootPath, path);
            const file = join(rootPath, path);
            const content = await readFile(file, "utf8");
            // Refuses (file untouched) rather than guess: see `exportRemoval.ts`.
            const { source } = await removeExportFromSource(path, content, name, symbolGrammarOptions());
            if (source !== content)
                await writeFile(file, source, "utf8");
        },
        // Literal pathspecs: a name like `app/[id]/page.tsx` or `a*.ts` is that file, never a glob.
        async restore(paths) {
            for (const p of paths)
                await assertInsideRoot(rootPath, p);
            await orThrow(["--literal-pathspecs", "checkout", "HEAD", "--", ...paths]);
        },
        async remove(paths) {
            for (const p of paths)
                await assertInsideRoot(rootPath, p);
            for (const p of paths)
                await rm(join(rootPath, p), { force: true });
        },
        async headSha() {
            const out = await runGit(rootPath, ["rev-parse", "--verify", "HEAD"]);
            return out.stdout?.trim() || undefined;
        },
        async hashObjects(paths) {
            const out = {};
            for (const p of paths) {
                await assertInsideRoot(rootPath, p);
                const run = await runGit(rootPath, ["hash-object", "--", p]);
                out[p] = run.stdout?.trim() || "missing";
            }
            return out;
        },
        async inHead(paths) {
            const run = await runGit(rootPath, ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", "HEAD", "--", ...paths]);
            if (run.stdout === undefined)
                throw new Error(fixText.lsTreeFailed());
            return new Set(run.stdout.split("\0").filter((x) => x !== ""));
        },
        async unstage(paths) {
            await orThrow(["--literal-pathspecs", "rm", "-r", "-f", "--cached", "--ignore-unmatch", "--", ...paths]);
        },
    };
}
//# sourceMappingURL=knowledgeFixes.js.map