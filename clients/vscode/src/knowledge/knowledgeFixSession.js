/**
 * The extension's side of the staged fix flow: apply, undo, preview and check, with what must hold
 * across them.
 *
 *   - Untrusted workspace: apply, undo and check refuse (the preview just reports nothing).
 *   - The first script run for a root (a codemod or a check) asks the person once per session; all
 *     concurrent first runs share ONE pending question.
 *   - Apply, undo and check of one root share one lock; only ONE check runs per root at a time
 *     (a second is refused, not queued), and it can be cancelled or killed with the session.
 *   - Undo is by `fixId` only: the host recorded what the fix wrote (`knowledgeFixUndo.ts`); the
 *     webview names nothing else. An unknown or already used id is refused.
 *
 * Pure over {@link FixSessionHost}, so the bridge supplies VS Code and tests supply fakes.
 */
import { randomUUID } from "node:crypto";
import { sourcePathOf } from "@builderforce/agent-tools/knowledge";
import { ExportRemovalRefusal } from "@builderforce/agent-tools/node-symbols";
import { PathRefusal } from "./knowledgeFixPaths";
import { applyCodemod, exportNameOf, isFixableKind, serialized } from "./knowledgeFixes";
import { execCheck, resolveCheck } from "./knowledgeFixSteps";
import { fixText } from "./knowledgeFixText";
import { undoSnapshot, UndoPartial } from "./knowledgeFixUndo";
import { previewOf, runKnipReport, stillReported } from "./knowledgeKnipReport";
import { DETAIL_CAP, ShellFailure } from "./knowledgeShell";
/** Past this many changed paths the tree is not hashed (one git call each): the preview is not cached. */
const MAX_KEYED_CHANGES = 200;
const previewSlot = (rootId, findingId) => `${rootId}\0${findingId}`;
/**
 * The state of the work tree a preview was computed on: HEAD, `git status`, and the bytes of every
 * changed path. Null when it cannot be read (or is too large to hash) — such a preview is never cached.
 */
export async function treeKey(ports) {
    if (!ports.headSha || !ports.hashObjects)
        return null;
    const [head, status] = await Promise.all([ports.headSha(), ports.status()]);
    if (!head || !status || status.length > MAX_KEYED_CHANGES)
        return null;
    const blobs = status.length > 0 ? await ports.hashObjects(status.map((e) => e.path)) : {};
    return JSON.stringify([head, status, blobs]);
}
/** A refused path or export in the person's words; anything else is passed on as it is. */
function worded(error) {
    if (error instanceof ExportRemovalRefusal) {
        const name = error.exportName;
        return new Error(error.code === "not-found" ? fixText.exportNotFound(name) : error.code === "unsupported" ? fixText.exportUnsupported(name) : fixText.exportUnparsed(name));
    }
    if (!(error instanceof PathRefusal))
        return error;
    return new Error(error.code === "outside" ? fixText.outsideFolder(error.path) : error.code === "link" ? fixText.throughLink(error.path) : fixText.isLink(error.path));
}
/** The finding's files, root-relative. */
const filesOf = (rootId, finding) => finding.nodes.flatMap((ref) => { const p = sourcePathOf(ref, rootId); return p ? [p] : []; });
export class KnowledgeFixSession {
    host;
    records = new Map();
    confirmed = new Set();
    /** One question per root at a time: concurrent first runs await the same answer. */
    asking = new Map();
    checking = new Map();
    /** `rootId\0findingId` → the preview and the {@link treeKey} it was computed on. */
    previews = new Map();
    constructor(host) {
        this.host = host;
    }
    gate() {
        if (!this.host.trusted())
            throw this.host.untrustedError();
    }
    allowScripts(rootId) {
        if (this.confirmed.has(rootId))
            return Promise.resolve();
        let pending = this.asking.get(rootId);
        if (!pending) {
            pending = (async () => {
                if (!(await this.host.confirmScripts(rootId)))
                    throw this.host.declinedError();
                this.confirmed.add(rootId);
            })().finally(() => { this.asking.delete(rootId); });
            this.asking.set(rootId, pending);
        }
        return pending;
    }
    async apply(rootId, rootPath, finding) {
        this.gate();
        await this.allowScripts(rootId);
        this.forgetPreviews(rootId);
        return applyCodemod(this.host.fixPorts(rootPath), rootId, finding, (snapshot) => {
            const fixId = randomUUID();
            this.records.set(fixId, { rootId, snapshot });
            return fixId;
        }).catch((error) => { throw worded(error); });
    }
    /** Reverts a recorded fix. An id is spent when the undo succeeds; a refused undo (diverged files) can be retried after the person sorts it out. */
    async undo(rootId, rootPath, fixId) {
        this.gate();
        const record = fixId === undefined ? undefined : this.records.get(fixId);
        if (!record || record.rootId !== rootId)
            throw new Error(fixText.unknownFix());
        await serialized(rootId, async () => {
            if (this.records.get(fixId) !== record)
                throw new Error(fixText.unknownFix());
            // Whatever the undo manages to revert, the previews were computed on the tree before it.
            this.forgetPreviews(rootId);
            try {
                await undoSnapshot(this.host.fixPorts(rootPath), record.snapshot);
            }
            catch (error) {
                // The files are back; only the branch switch failed. The id is spent either way.
                if (error instanceof UndoPartial)
                    this.records.delete(fixId);
                throw worded(error);
            }
            this.records.delete(fixId);
        });
    }
    /**
     * What the fix would remove, from knip's own report. Reported only when the person has already
     * allowed scripts for the root (a preview must not raise a modal on its own); otherwise null and
     * the view lists the finding's files.
     *
     * Cached per root and finding AGAINST THE TREE it was computed on ({@link treeKey}): any edit,
     * apply or undo moves the key, so a stale removal list is never shown. A tree that cannot be
     * keyed is never cached. A knip failure is logged and answers null (the view lists the files).
     */
    async preview(rootId, rootPath, finding) {
        if (!this.host.trusted() || !this.confirmed.has(rootId))
            return null;
        const slot = previewSlot(rootId, finding.id);
        const tree = await treeKey(this.host.fixPorts(rootPath)).catch(() => null);
        const cached = this.previews.get(slot);
        if (tree !== null && cached?.tree === tree)
            return cached.preview;
        try {
            const report = await runKnipReport(rootPath);
            const preview = { files: previewOf(report, finding.kind, filesOf(rootId, finding), exportNameOf(finding)) };
            if (tree !== null)
                this.previews.set(slot, { tree, preview });
            else
                this.previews.delete(slot);
            return preview;
        }
        catch (error) {
            this.previews.delete(slot);
            (this.host.log ?? console.warn)(`[knowledge fix] knip preview failed for ${rootPath}: ${error instanceof Error ? error.message : String(error)}`);
            return null;
        }
    }
    /** Drops every cached preview of a root (its tree just moved under them). */
    forgetPreviews(rootId) {
        for (const slot of [...this.previews.keys()])
            if (slot.startsWith(`${rootId}\0`))
                this.previews.delete(slot);
    }
    /** Runs one check. A second check for the same root while one is running or waiting is refused. */
    async check(rootId, rootPath, check, finding) {
        this.gate();
        if (this.checking.has(rootId))
            throw new Error(fixText.checkRunning());
        const control = new AbortController();
        this.checking.set(rootId, control);
        try {
            if (check === "rescan")
                return await this.rescan(rootId, rootPath, finding, control.signal);
            const command = await resolveCheck(rootPath, check);
            if (!command)
                return { status: "skipped" };
            await this.allowScripts(rootId);
            return await serialized(rootId, () => execCheck(rootPath, command, control.signal));
        }
        finally {
            this.checking.delete(rootId);
        }
    }
    /** The re-scan: knip's report again, over the changed tree; passes when the finding's files are no longer in it. Kinds without a codemod have nothing to re-scan. */
    async rescan(rootId, rootPath, finding, signal) {
        if (!finding || !isFixableKind(finding.kind))
            return { status: "skipped" };
        await this.allowScripts(rootId);
        return serialized(rootId, async () => {
            try {
                const left = stillReported(await runKnipReport(rootPath, signal), finding.kind, filesOf(rootId, finding), exportNameOf(finding));
                return left.length === 0 ? { status: "pass" } : { status: "fail", detail: fixText.rescanStill(left.join(", ")).slice(0, DETAIL_CAP) };
            }
            catch (error) {
                const why = error instanceof ShellFailure ? `${error.message}${error.output ? `\n${error.output}` : ""}` : error instanceof Error ? error.message : String(error);
                return { status: "fail", detail: why.slice(-DETAIL_CAP) };
            }
        });
    }
    /** Stops the running check of a root (and its whole process tree). */
    cancel(rootId) {
        this.checking.get(rootId)?.abort();
    }
    dispose() {
        for (const control of this.checking.values())
            control.abort();
        this.checking.clear();
    }
}
//# sourceMappingURL=knowledgeFixSession.js.map