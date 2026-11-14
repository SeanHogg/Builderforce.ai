/**
 * The HOST side of the Visualization panel's Knowledge view: answers each `knowledge.call`
 * (`knowledgeProtocol.ts`) from the editor's knowledge host (`knowledgeService.ts`), and
 * posts review progress and live graphs back as `knowledge.event`s.
 *
 * Also holds the focus `builderforce.openKnowledgeGraph` asked for, until the view takes it
 * (`takeFocus` on mount, or the `knowledge.focus` frame while it is open).
 */
import * as vscode from "vscode";
import { factKeyOf } from "@seanhogg/builderforce-memory/knowledge";
import { factRightsCache, humanFactBatch, readSystems } from "@builderforce/agent-tools/knowledge";
import { knowledgeBaseline } from "./knowledgeBaseline";
import { openWorkspace } from "../openWorkspace";
import { SELECTED_TENANT_KEY } from "../projectState";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import { KNOWLEDGE_EVENT, } from "./knowledgeProtocol";
import { KnowledgeFixSession } from "./knowledgeFixSession";
import { createLoadTrace } from "./knowledgeLoadTrace";
import { readLastSeen, workspaceKey, writeLastSeen } from "./knowledgeLastSeen";
import { vscodeFixPorts } from "./knowledgeFixesHost";
import { rootHistory } from "./knowledgeHistory";
import { pinpointRoot } from "./knowledgePinpointHost";
import { retryRootSync, rootSyncStatus } from "./knowledgeSync";
import { rootSymbols, SymbolsGate } from "./knowledgeSymbols";
import { tryRequestOf } from "./knowledgeTryRequestHost";
import { reviewedRoots, rootById, rootForPath } from "./knowledgeRoots";
import { KnowledgeReviewSessions } from "./knowledgeReviewSessions";
import { excludeFromReview } from "./knowledgeExclude";
import { rootIgnoreFile } from "./knowledgeFs";
import { duringReview, isRootReviewing } from "./knowledgeReplica";
import { subscribeLiveGraph } from "./knowledgeLive";
import { onIndexLevel, preemptBackground } from "./indexLevels";
import { notReviewedHere } from "./knowledgeNotHere";
import { assertWritable, packRootGraph, packScopeRows, readOnlyPack } from "./packs/packRoots";
import { linkedKnowledgeClient, linkedProject, loadGraph, log, openRoot, rootKnowledgeFiles, workspaceFolders } from "./knowledgeService";
import { getRun, listRuns } from "./review/reviewRuns";
import { createAgentRuns } from "./agentRuns";
import { localBrainApplication } from "../localFirstStore";
/** Search hits the view shows at most. */
const SEARCH_HITS = 20;
const isGraph = (answer) => !!answer && typeof answer === "object" && Array.isArray(answer.nodes) && Array.isArray(answer.edges);
/** A graph's counts for the trace: what was read, never the graph itself. */
const graphFields = (g) => ({
    nodes: g.nodes.length, edges: g.edges.length, sources: g.stats.sources, ...(g.stats.truncated ? { truncated: true } : {}),
});
let pendingFocus = null;
/** `builderforce.openKnowledgeGraph` → the view, whenever it next mounts or listens. */
export function setPendingKnowledgeFocus(frame) {
    pendingFocus = frame;
}
export class KnowledgeBridge {
    host;
    reviews;
    live = new Map();
    /** One symbols read per root at a time; an identical request shares the answer on its way. */
    symbolsGate = new SymbolsGate();
    /** The root the view last loaded — whose facts a fact action is about. */
    lastRoot;
    /** The scopes the view last listed: written beside the graph the next open paints first. */
    lastScopes;
    /** The timings of the calls the view's first paint waits on (the Diagnostics' First load section, `loadTrace`). */
    trace = createLoadTrace({ log: (line) => log("timing", line) });
    /** How the view last loaded each root; Live's refresh repeats it. */
    loadedBy = new Map();
    /** Delete rights per root, read once per graph version (the facts endpoint's viewer + authors). */
    rights = factRightsCache(async (rootId) => (await linkedKnowledgeClient(this.secrets)?.facts(rootId)) ?? null);
    /** The recent local agent runs and their findings (PRD 46), memoised per chat; the linked project's chats only. */
    agentRunsMemo;
    get agentRuns() {
        return (this.agentRunsMemo ??= createAgentRuns(localBrainApplication(this.host.ctx).persistence, () => linkedProject()?.id));
    }
    /** Apply, undo and check of a fix: the trust gate, the once-per-root confirmation, the per-root lock. */
    fixes = new KnowledgeFixSession({
        trusted: () => vscode.workspace.isTrusted,
        untrustedError: () => new Error(vscode.l10n.t("Trust this workspace before applying or checking a fix.")),
        confirmScripts: async (rootId) => (await vscode.window.showWarningMessage(vscode.l10n.t("Run this project's scripts (the fix tool, type check, tests, knip re-scan) in {0}? They run with your environment, including your credentials.", this.rootOf(rootId).rootPath), { modal: true }, vscode.l10n.t("Run scripts"))) !== undefined,
        declinedError: () => new Error(vscode.l10n.t("The scripts were not run.")),
        fixPorts: vscodeFixPorts,
    });
    constructor(host) {
        this.host = host;
        this.reviews = new KnowledgeReviewSessions(host.ctx.secrets, (e) => this.event(e), `BuilderForce for VS Code ${host.ctx.extension.packageJSON.version}`);
    }
    event(event) {
        // Wrapped, never spread: the event's own `type` must not re-address the frame.
        this.host.post({ type: KNOWLEDGE_EVENT, event });
    }
    get secrets() {
        return this.host.ctx.secrets;
    }
    /** One call's answer (the caller responds with it, or with the error). */
    async handle(call) {
        assertWritable(call, this.lastRoot);
        switch (call.op) {
            case "scopes": return this.trace.run("scopes", undefined, async () => (this.lastScopes = await this.scopes()), (rows) => ({ count: rows.length }));
            case "lastSeen": return this.trace.run("lastSeen", undefined, () => readLastSeen(this.host.ctx.globalStorageUri.fsPath, this.lastSeenKey()), (seen) => graphFields(seen.graph));
            case "load": return this.trace.run("load", call.rootId, (traced) => this.load(call, traced), (answer) => (isGraph(answer) ? graphFields(answer) : {}));
            case "loadTrace": return this.trace.snapshot();
            case "targets": return this.targets();
            case "plan":
                this.reviews.planOver(call.req, call.stream);
                return null;
            case "run": return { started: this.reviews.start(call.reviewId) };
            case "stop":
                this.reviews.stop(call.reviewId);
                return null;
            case "discard":
                this.reviews.discard(call.reviewId);
                return null;
            case "search": {
                const index = await getHostKnowledgeIndex(call.rootId);
                return (await index.search(call.q, SEARCH_HITS)).map((h) => ({ ref: h.id, score: h.score, tier: h.tier }));
            }
            case "live": {
                this.live.get(call.stream)?.();
                const stopGraph = subscribeLiveGraph(this.secrets, call.rootId, (graph, changed) => this.event({ stream: call.stream, type: "graph", graph, changed }), (id) => this.loadedBy.get(id));
                // The background indexer's level for the root rides the same stream (PRD 41 B6).
                const stopLevel = onIndexLevel(call.rootId, (status) => this.event({ stream: call.stream, type: "level", status }));
                this.live.set(call.stream, () => { stopGraph(); stopLevel(); });
                return null;
            }
            case "unlive":
                this.live.get(call.stream)?.();
                this.live.delete(call.stream);
                return null;
            case "remember": return this.remember(call.rootId, call.ref, call.content);
            case "factActions": return { canDelete: await this.canDelete(call.ref) };
            case "deleteFact": return this.deleteFact(call.ref);
            case "baseline": return this.trace.run("baseline", call.rootId, () => this.baseline(call.rootId), (b) => graphFields(b.graph));
            case "compose":
                await openWorkspace(this.host.ctx, { kind: "seed", text: call.text });
                return null;
            case "takeFocus": {
                const focus = pendingFocus;
                pendingFocus = null;
                return focus;
            }
            case "pinpoint": return pinpointRoot(this.secrets, this.rootOf(call.rootId), call.image);
            case "history": return rootHistory(this.rootOf(call.rootId).rootPath, call.rootId, { onWarn: (m) => log("history", m) });
            case "syncStatus": return this.trace.run("syncStatus", call.rootId, async () => rootSyncStatus(this.secrets, this.rootOf(call.rootId)));
            case "retrySync":
                await retryRootSync(this.secrets, this.rootOf(call.rootId));
                return null;
            case "applyFix": return this.applyFix(call.rootId, call.finding);
            case "runFixCheck": return this.fixes.check(call.rootId, this.rootOf(call.rootId).rootPath, call.check, call.finding);
            case "previewFix": return this.fixes.preview(call.rootId, this.rootOf(call.rootId).rootPath, call.finding);
            case "undoFix": return this.fixes.undo(call.rootId, this.rootOf(call.rootId).rootPath, call.fixId);
            case "cancelFixCheck":
                this.fixes.cancel(call.rootId);
                return null;
            case "tryRequest": return tryRequestOf(call.req);
            case "runs": return listRuns(rootKnowledgeFiles(this.rootOf(call.rootId)), call.rootId);
            case "agentRuns": return this.agentRuns.list();
            case "agentRunReport": {
                // The graph root's folder, so the view places an absolute path only under it; a server-only root has none.
                const report = await this.agentRuns.report(call.id);
                const root = call.rootId ? rootById(call.rootId, workspaceFolders())?.rootPath : undefined;
                return report && root ? { ...report, root } : report;
            }
            case "runRecord": return getRun(this.workspaceRoots().map(rootKnowledgeFiles), call.runId);
            case "stopRun":
                this.reviews.stopRun(call.runId);
                return null;
            case "excludeFromReview": {
                const root = this.rootOf(call.rootId);
                const open = openRoot(this.secrets, root);
                // A background indexer pass is not "a review running": it stops first, and is held off until this write ends.
                const release = await preemptBackground(call.rootId);
                try {
                    await excludeFromReview({
                        rootId: call.rootId, path: call.path, file: rootIgnoreFile(root.rootPath), isReviewing: isRootReviewing,
                        copies: async () => (await readSystems(open.manifest, call.rootId)).flatMap((s) => (s.copyOf !== undefined ? [s.path] : [])),
                        hold: (run) => duringReview(call.rootId, open.files, undefined, run),
                    });
                }
                finally {
                    release();
                }
                return null;
            }
            case "symbols": {
                const rootPath = this.rootOf(call.rootId).rootPath;
                // Traced, so the alias load (`aliases`) is a named phase of the call.
                return this.trace.run("symbols", call.rootId, (traced) => this.symbolsGate.run(call.rootId, call.fileRefs, (refs) => rootSymbols(rootPath, call.rootId, refs, undefined, undefined, traced.timer)), (records) => ({ count: records.length }));
            }
        }
    }
    /** One root's graph: a pack's, this machine's, the server's (a root no folder here holds), or "not reviewed here"; each branch a timed phase. */
    async load(call, traced) {
        this.lastRoot = call.rootId;
        const query = { ...(call.focus ? { focus: call.focus } : {}), ...(call.maxNodes ? { maxNodes: call.maxNodes } : {}) };
        traced.set({ focus: !!call.focus, ...(call.maxNodes ? { maxNodes: call.maxNodes } : {}) });
        this.loadedBy.set(call.rootId, query);
        const pack = readOnlyPack(call.rootId);
        traced.set({ via: pack ? "pack" : "local" });
        const graph = pack
            ? await traced.timer.phase("pack", () => packRootGraph(pack, query))
            : await loadGraph(this.secrets, call.rootId, query, traced.timer, (pairs) => traced.set({ nearDuplicates: pairs }));
        this.rights.loaded(call.rootId, graph?.scope.digest);
        // Only a FULL load is what the next open paints first (a focus load is a partial picture).
        if (graph && !call.focus)
            void this.rememberLastSeen(call.rootId, graph);
        // No local review of an open root: the typed "not reviewed on this machine", never the server's cut.
        if (graph || pack)
            return graph;
        // A root listed from the project that no folder here holds (a teammate's, an uploaded pack): no local tree to
        // draw from, so the server's graph is shown read-only (PRD 41 A7 rule 3). Never for a folder open here.
        const server = rootById(call.rootId, workspaceFolders()) ? undefined : linkedKnowledgeClient(this.secrets);
        if (server) {
            traced.set({ via: "server" });
            return traced.timer.phase("server", () => server.graph(call.rootId, query).catch(() => null));
        }
        traced.set({ via: "not-here" });
        return traced.timer.phase("notHere", () => notReviewedHere(this.secrets, call.rootId));
    }
    /** The last-seen file's key: this workspace's folders under the acting tenant + linked project ("local" when unlinked). */
    lastSeenKey() {
        const project = linkedProject();
        const tenant = this.host.ctx.globalState.get(SELECTED_TENANT_KEY);
        return workspaceKey(workspaceFolders(), project ? `${tenant ?? "none"}:${project.id}` : "local");
    }
    /** Writes the last full load beside the scopes the view last listed; never throws (the view waits for nothing). */
    async rememberLastSeen(rootId, graph) {
        try {
            await this.trace.run("rememberLastSeen", rootId, async () => {
                const scopes = this.lastScopes ?? await this.scopes();
                await writeLastSeen(this.host.ctx.globalStorageUri.fsPath, this.lastSeenKey(), { scopes, rootId, graph });
                return true;
            }, () => graphFields(graph));
        }
        catch (error) {
            log("lastSeen", error instanceof Error ? error.message : String(error));
        }
    }
    rootOf(rootId) {
        const root = rootById(rootId, workspaceFolders());
        if (!root)
            throw new Error(vscode.l10n.t("This folder is not open in the workspace."));
        return root;
    }
    applyFix(rootId, finding) {
        return this.fixes.apply(rootId, this.rootOf(rootId).rootPath, finding);
    }
    async scopes() {
        const client = linkedKnowledgeClient(this.secrets);
        // What this machine reviewed, linked or not. A root listed under its old id resolves to its current one (its snapshot migrated on read).
        const here = (await Promise.all([...new Set(reviewedRoots(this.host.ctx.workspaceState)
                .map((listed) => rootById(listed, workspaceFolders()))
                .filter((root) => !!root)
                .map((root) => root.rootId))].map(async (rootId) => {
            const root = rootById(rootId, workspaceFolders());
            return root ? (await openRoot(this.secrets, root).store.scopes()).filter((s) => s.rootId === rootId) : [];
        }))).flat();
        // Linked: the project's other roots (teammates', packs) are listed beside them; unreachable adds nothing.
        const there = client ? await client.scopes().catch(() => []) : [];
        const rows = [...here, ...there.filter((s) => !here.some((h) => h.rootId === s.rootId))];
        // A root no folder here holds has no local tree: it is the server's graph, shown read-only (the pack-row seam).
        const listed = rows.map((r) => ({
            rootId: r.rootId, title: r.title, packs: r.packs, ...(r.lastReviewedAt ? { lastReviewedAt: r.lastReviewedAt } : {}),
            ...(rootById(r.rootId, workspaceFolders()) ? {} : { readOnly: true, serverOnly: true }),
        }));
        return [...listed, ...packScopeRows()];
    }
    /** The root of each open workspace folder: where the run records of this window live. */
    workspaceRoots() {
        const folders = workspaceFolders();
        return folders.flatMap((f) => rootForPath(f.path, folders) ?? []);
    }
    targets() {
        const folders = workspaceFolders();
        return folders.flatMap((f) => {
            const root = rootForPath(f.path, folders);
            return root ? [{ id: root.rootId, kind: "workspace", title: root.title }] : [];
        });
    }
    async remember(rootId, ref, content) {
        const root = rootById(rootId, workspaceFolders());
        // Local first: the fact lands in the local store and, when linked, is queued for the project.
        const store = root ? openRoot(this.secrets, root).store : undefined;
        if (!store)
            throw new Error(vscode.l10n.t("This folder is not open in the workspace."));
        const scope = (await store.scopes()).find((s) => s.rootId === rootId) ?? { rootId, title: root?.title ?? rootId, packs: [] };
        await store.write(humanFactBatch({ scope, ref, content }));
        this.rights.invalidate(rootId);
        return null;
    }
    /**
     * The server's rule (PRD 38 §8.3, agent-tools `factRights`): admin, author, or an
     * authorless fact — only on the platform, where Delete exists. One facts read per graph
     * version, never one per click.
     */
    async canDelete(ref) {
        const key = factKeyOf(ref);
        if (!key || !this.lastRoot || !linkedKnowledgeClient(this.secrets))
            return false;
        return this.rights.canDelete(this.lastRoot, key);
    }
    async deleteFact(ref) {
        const key = factKeyOf(ref);
        const client = linkedKnowledgeClient(this.secrets);
        if (!key || !client)
            throw new Error(vscode.l10n.t("Only a fact on the linked project can be deleted."));
        await client.deleteFact(key);
        if (this.lastRoot)
            this.rights.invalidate(this.lastRoot);
        return null;
    }
    /**
     * Compare's "before": the root's previous review on the platform, `comparable` by memory's rules with the `reasons` it is
     * not (PRD 41 §C9; the view shows them localized); none for a local root.
     */
    async baseline(rootId) {
        const client = linkedKnowledgeClient(this.secrets);
        if (!client)
            return null;
        const scope = (await client.scopes()).find((s) => s.rootId === rootId);
        if (!scope?.previousDigest)
            return null;
        const graph = await client.graph(rootId, { at: scope.previousDigest });
        // `previousMeasured`: what the platform stored for THAT review; the after side is what the shown graph's review recorded —
        // this machine's local scope when the root is here, else the platform's latest (absent = unknown, never comparable).
        const root = rootById(rootId, workspaceFolders());
        const local = root ? (await openRoot(this.secrets, root).store.scopes()).find((s) => s.rootId === rootId) : undefined;
        const after = local
            ? { rootId, packs: local.packs, measured: local.measured, local: true }
            : { rootId, packs: scope.packs, measured: scope.measured, local: false };
        return isGraph(graph) ? knowledgeBaseline(graph, scope.previousMeasured, after) : graph ? { graph, comparable: false } : null;
    }
    dispose() {
        for (const stop of this.live.values())
            stop();
        this.live.clear();
        this.reviews.dispose();
        this.fixes.dispose();
    }
}
//# sourceMappingURL=knowledgeBridge.js.map