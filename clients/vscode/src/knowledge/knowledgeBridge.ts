/**
 * The HOST side of the Visualization panel's Knowledge view: answers each `knowledge.call`
 * (`knowledgeProtocol.ts`) from the editor's knowledge host (`knowledgeService.ts`), and
 * posts review progress and live graphs back as `knowledge.event`s.
 *
 * Also holds the focus `builderforce.openKnowledgeGraph` asked for, until the view takes it
 * (`takeFocus` on mount, or the `knowledge.focus` frame while it is open).
 */

import * as vscode from "vscode";
import { factKeyOf, type Finding, type KnowledgeGraph, type NodeRef } from "@seanhogg/builderforce-memory/knowledge";
import { factRightsCache, humanFactBatch, readSystems, type FactRightsCache } from "@builderforce/agent-tools/knowledge";
import { openWorkspace } from "../openWorkspace";
import { SELECTED_TENANT_KEY, getSelectedProject } from "../projectState";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import {
  KNOWLEDGE_EVENT, type KnowledgeCall, type KnowledgeEvent, type KnowledgeFixResult, type KnowledgeFocusFrame, type KnowledgeScopeRow,
  type KnowledgeTargetRow,
} from "./knowledgeProtocol";
import { KnowledgeFixSession } from "./knowledgeFixSession";
import { readLastSeen, workspaceKey, writeLastSeen } from "./knowledgeLastSeen";
import { vscodeFixPorts } from "./knowledgeFixesHost";
import { rootHistory } from "./knowledgeHistory";
import { pinpointRoot } from "./knowledgePinpointHost";
import { retryRootSync, rootSyncStatus } from "./knowledgeSync";
import { rootSymbols, SymbolsGate } from "./knowledgeSymbols";
import { tryRequestOf } from "./knowledgeTryRequestHost";
import { reviewedRoots, rootById, rootForPath, type KnowledgeRoot } from "./knowledgeRoots";
import { KnowledgeReviewSessions } from "./knowledgeReviewSessions";
import { excludeFromReview } from "./knowledgeExclude";
import { rootIgnoreFile } from "./knowledgeFs";
import { duringReview, isRootReviewing } from "./knowledgeReplica";
import { subscribeLiveGraph } from "./knowledgeLive";
import { notReviewedHere } from "./knowledgeNotHere";
import { assertWritable, packRootGraph, packScopeRows, readOnlyPack } from "./packs/packRoots";
import { linkedKnowledgeClient, loadGraph, log, openRoot, rootKnowledgeFiles, workspaceFolders, type GraphQuery } from "./knowledgeService";
import { getRun, listRuns } from "./review/reviewRuns";

/** Search hits the view shows at most. */
const SEARCH_HITS = 20;

let pendingFocus: KnowledgeFocusFrame | null = null;

/** `builderforce.openKnowledgeGraph` → the view, whenever it next mounts or listens. */
export function setPendingKnowledgeFocus(frame: KnowledgeFocusFrame): void {
  pendingFocus = frame;
}

export interface KnowledgeBridgeHost {
  ctx: vscode.ExtensionContext;
  post(msg: unknown): void;
}

export class KnowledgeBridge implements vscode.Disposable {
  private readonly reviews: KnowledgeReviewSessions;
  private readonly live = new Map<string, () => void>();
  /** One symbols read per root at a time; an identical request shares the answer on its way. */
  private readonly symbolsGate = new SymbolsGate();
  /** The root the view last loaded — whose facts a fact action is about. */
  private lastRoot: string | undefined;
  /** The scopes the view last listed: written beside the graph the next open paints first. */
  private lastScopes: KnowledgeScopeRow[] | undefined;
  /** How the view last loaded each root; Live's refresh repeats it. */
  private readonly loadedBy = new Map<string, GraphQuery>();
  /** Delete rights per root, read once per graph version (the facts endpoint's viewer + authors). */
  private readonly rights: FactRightsCache = factRightsCache(async (rootId) => (await linkedKnowledgeClient(this.secrets)?.facts(rootId)) ?? null);

  /** Apply, undo and check of a fix: the trust gate, the once-per-root confirmation, the per-root lock. */
  private readonly fixes = new KnowledgeFixSession({
    trusted: () => vscode.workspace.isTrusted,
    untrustedError: () => new Error(vscode.l10n.t("Trust this workspace before applying or checking a fix.")),
    confirmScripts: async (rootId) => (await vscode.window.showWarningMessage(
      vscode.l10n.t("Run this project's scripts (the fix tool, type check, tests, knip re-scan) in {0}? They run with your environment, including your credentials.", this.rootOf(rootId).rootPath),
      { modal: true },
      vscode.l10n.t("Run scripts"),
    )) !== undefined,
    declinedError: () => new Error(vscode.l10n.t("The scripts were not run.")),
    fixPorts: vscodeFixPorts,
  });

  constructor(private readonly host: KnowledgeBridgeHost) {
    this.reviews = new KnowledgeReviewSessions(host.ctx.secrets, (e) => this.event(e), `BuilderForce for VS Code ${host.ctx.extension.packageJSON.version as string}`);
  }

  private event(event: KnowledgeEvent): void {
    // Wrapped, never spread: the event's own `type` must not re-address the frame.
    this.host.post({ type: KNOWLEDGE_EVENT, event });
  }

  private get secrets(): vscode.SecretStorage {
    return this.host.ctx.secrets;
  }

  /** One call's answer (the caller responds with it, or with the error). */
  async handle(call: KnowledgeCall): Promise<unknown> {
    assertWritable(call, this.lastRoot);
    switch (call.op) {
      case "scopes": return (this.lastScopes = await this.scopes());
      case "lastSeen": return readLastSeen(this.host.ctx.globalStorageUri.fsPath, this.lastSeenKey());
      case "load": {
        this.lastRoot = call.rootId;
        const query: GraphQuery = { ...(call.focus ? { focus: call.focus } : {}), ...(call.maxNodes ? { maxNodes: call.maxNodes } : {}) };
        this.loadedBy.set(call.rootId, query);
        const pack = readOnlyPack(call.rootId);
        const graph = pack ? await packRootGraph(pack, query) : await loadGraph(this.secrets, call.rootId, query);
        this.rights.loaded(call.rootId, graph?.scope.digest);
        // Only a FULL load is what the next open paints first (a focus load is a partial picture).
        if (graph && !call.focus) void this.rememberLastSeen(call.rootId, graph);
        // No local review of an open root: the typed "not reviewed on this machine", never the server's cut.
        if (graph || pack) return graph;
        // A root listed from the project that no folder here holds (a teammate's, an uploaded pack): no local tree to
        // draw from, so the server's graph is shown read-only (PRD 41 A7 rule 3). Never for a folder open here.
        const server = rootById(call.rootId, workspaceFolders()) ? undefined : linkedKnowledgeClient(this.secrets);
        if (server) return server.graph(call.rootId, query).catch(() => null);
        return notReviewedHere(this.secrets, call.rootId);
      }
      case "targets": return this.targets();
      case "plan": this.reviews.planOver(call.req, call.stream); return null;
      case "run": return { started: this.reviews.start(call.reviewId) };
      case "stop": this.reviews.stop(call.reviewId); return null;
      case "discard": this.reviews.discard(call.reviewId); return null;
      case "search": {
        const index = await getHostKnowledgeIndex(call.rootId);
        return (await index.search(call.q, SEARCH_HITS)).map((h) => ({ ref: h.id, score: h.score, tier: h.tier }));
      }
      case "live": {
        this.live.get(call.stream)?.();
        this.live.set(call.stream, subscribeLiveGraph(this.secrets, call.rootId, (graph, changed) => this.event({ stream: call.stream, type: "graph", graph, changed }), (id) => this.loadedBy.get(id)));
        return null;
      }
      case "unlive": this.live.get(call.stream)?.(); this.live.delete(call.stream); return null;
      case "remember": return this.remember(call.rootId, call.ref, call.content);
      case "factActions": return { canDelete: await this.canDelete(call.ref) };
      case "deleteFact": return this.deleteFact(call.ref);
      case "baseline": return this.baseline(call.rootId);
      case "compose": await openWorkspace(this.host.ctx, { kind: "seed", text: call.text }); return null;
      case "takeFocus": { const focus = pendingFocus; pendingFocus = null; return focus; }
      case "pinpoint": return pinpointRoot(this.secrets, this.rootOf(call.rootId), call.image);
      case "history": return rootHistory(this.rootOf(call.rootId).rootPath, call.rootId, { onWarn: (m) => log("history", m) });
      case "syncStatus": return rootSyncStatus(this.secrets, this.rootOf(call.rootId));
      case "retrySync": await retryRootSync(this.secrets, this.rootOf(call.rootId)); return null;
      case "applyFix": return this.applyFix(call.rootId, call.finding);
      case "runFixCheck": return this.fixes.check(call.rootId, this.rootOf(call.rootId).rootPath, call.check, call.finding);
      case "previewFix": return this.fixes.preview(call.rootId, this.rootOf(call.rootId).rootPath, call.finding);
      case "undoFix": return this.fixes.undo(call.rootId, this.rootOf(call.rootId).rootPath, call.fixId);
      case "cancelFixCheck": this.fixes.cancel(call.rootId); return null;
      case "tryRequest": return tryRequestOf(call.req);
      case "runs": return listRuns(rootKnowledgeFiles(this.rootOf(call.rootId)), call.rootId);
      case "runRecord": return getRun(this.workspaceRoots().map(rootKnowledgeFiles), call.runId);
      case "stopRun": this.reviews.stopRun(call.runId); return null;
      case "excludeFromReview": {
        const root = this.rootOf(call.rootId);
        const open = openRoot(this.secrets, root);
        await excludeFromReview({
          rootId: call.rootId, path: call.path, file: rootIgnoreFile(root.rootPath), isReviewing: isRootReviewing,
          copies: async () => (await readSystems(open.manifest, call.rootId)).flatMap((s) => (s.copyOf !== undefined ? [s.path] : [])),
          hold: (run) => duringReview(call.rootId, open.files, undefined, run),
        });
        return null;
      }
      case "symbols": {
        const rootPath = this.rootOf(call.rootId).rootPath;
        return this.symbolsGate.run(call.rootId, call.fileRefs, (refs) => rootSymbols(rootPath, call.rootId, refs));
      }
    }
  }

  /** The last-seen file's key: this workspace's folders under the acting tenant + linked project ("local" when unlinked). */
  private lastSeenKey(): string {
    const project = getSelectedProject();
    const tenant = this.host.ctx.globalState.get<number>(SELECTED_TENANT_KEY);
    return workspaceKey(workspaceFolders(), project ? `${tenant ?? "none"}:${project.id}` : "local");
  }

  /** Writes the last full load beside the scopes the view last listed; never throws (the view waits for nothing). */
  private async rememberLastSeen(rootId: string, graph: KnowledgeGraph): Promise<void> {
    try {
      const scopes = this.lastScopes ?? await this.scopes();
      await writeLastSeen(this.host.ctx.globalStorageUri.fsPath, this.lastSeenKey(), { scopes, rootId, graph });
    } catch (error) {
      log("lastSeen", error instanceof Error ? error.message : String(error));
    }
  }

  private rootOf(rootId: string): KnowledgeRoot {
    const root = rootById(rootId, workspaceFolders());
    if (!root) throw new Error(vscode.l10n.t("This folder is not open in the workspace."));
    return root;
  }

  private applyFix(rootId: string, finding: Finding): Promise<KnowledgeFixResult> {
    return this.fixes.apply(rootId, this.rootOf(rootId).rootPath, finding);
  }

  private async scopes(): Promise<KnowledgeScopeRow[]> {
    const client = linkedKnowledgeClient(this.secrets);
    // What this machine reviewed, linked or not. A root listed under its old id resolves to its current one (its snapshot migrated on read).
    const here = (await Promise.all([...new Set(reviewedRoots(this.host.ctx.workspaceState)
      .map((listed) => rootById(listed, workspaceFolders()))
      .filter((root): root is NonNullable<typeof root> => !!root)
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
      ...(rootById(r.rootId, workspaceFolders()) ? {} : { readOnly: true as const, serverOnly: true as const }),
    }));
    return [...listed, ...packScopeRows()];
  }

  /** The root of each open workspace folder: where the run records of this window live. */
  private workspaceRoots(): KnowledgeRoot[] {
    const folders = workspaceFolders();
    return folders.flatMap((f) => rootForPath(f.path, folders) ?? []);
  }

  private targets(): KnowledgeTargetRow[] {
    const folders = workspaceFolders();
    return folders.flatMap((f) => {
      const root = rootForPath(f.path, folders);
      return root ? [{ id: root.rootId, kind: "workspace" as const, title: root.title }] : [];
    });
  }

  private async remember(rootId: string, ref: string, content: string): Promise<null> {
    const root = rootById(rootId, workspaceFolders());
    // Local first: the fact lands in the local store and, when linked, is queued for the project.
    const store = root ? openRoot(this.secrets, root).store : undefined;
    if (!store) throw new Error(vscode.l10n.t("This folder is not open in the workspace."));
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
  private async canDelete(ref: string): Promise<boolean> {
    const key = factKeyOf(ref as NodeRef);
    if (!key || !this.lastRoot || !linkedKnowledgeClient(this.secrets)) return false;
    return this.rights.canDelete(this.lastRoot, key);
  }

  private async deleteFact(ref: string): Promise<null> {
    const key = factKeyOf(ref as NodeRef);
    const client = linkedKnowledgeClient(this.secrets);
    if (!key || !client) throw new Error(vscode.l10n.t("Only a fact on the linked project can be deleted."));
    await client.deleteFact(key);
    if (this.lastRoot) this.rights.invalidate(this.lastRoot);
    return null;
  }

  /** Compare's "before": the root's previous review on the platform; none for a local root. */
  private async baseline(rootId: string): Promise<{ graph: unknown } | null> {
    const client = linkedKnowledgeClient(this.secrets);
    if (!client) return null;
    const previous = (await client.scopes()).find((s) => s.rootId === rootId)?.previousDigest;
    if (!previous) return null;
    const graph = await client.graph(rootId, { at: previous });
    return graph ? { graph } : null;
  }

  dispose(): void {
    for (const stop of this.live.values()) stop();
    this.live.clear();
    this.reviews.dispose();
    this.fixes.dispose();
  }
}
