/**
 * The HOST side of the Visualization panel's Knowledge view: answers each `knowledge.call`
 * (`knowledgeProtocol.ts`) from the editor's knowledge host (`knowledgeService.ts`), and
 * posts review progress and live graphs back as `knowledge.event`s.
 *
 * Also holds the focus `builderforce.openKnowledgeGraph` asked for, until the view takes it
 * (`takeFocus` on mount, or the `knowledge.focus` frame while it is open).
 */

import * as vscode from "vscode";
import { factKeyOf, type NodeRef } from "@seanhogg/builderforce-memory/knowledge";
import { factRightsCache, humanFactBatch, type FactRightsCache } from "@builderforce/agent-tools/knowledge";
import { openWorkspace } from "../openWorkspace";
import { getHostKnowledgeIndex } from "./index/hostKnowledgeIndex";
import {
  KNOWLEDGE_EVENT, type KnowledgeCall, type KnowledgeEvent, type KnowledgeFocusFrame, type KnowledgeScopeRow,
  type KnowledgeTargetRow,
} from "./knowledgeProtocol";
import { reviewedRoots, rootById, rootForPath } from "./knowledgeRoots";
import { KnowledgeReviewSessions } from "./knowledgeReviewSessions";
import { subscribeLiveGraph } from "./knowledgeLive";
import { linkedKnowledgeClient, loadGraph, openRoot, workspaceFolders } from "./knowledgeService";

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
  /** The root the view last loaded — whose facts a fact action is about. */
  private lastRoot: string | undefined;
  /** Delete rights per root, read once per graph version (the facts endpoint's viewer + authors). */
  private readonly rights: FactRightsCache = factRightsCache(async (rootId) => (await linkedKnowledgeClient(this.secrets)?.facts(rootId)) ?? null);

  constructor(private readonly host: KnowledgeBridgeHost) {
    this.reviews = new KnowledgeReviewSessions(host.ctx.secrets, (e) => this.event(e));
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
    switch (call.op) {
      case "scopes": return this.scopes();
      case "load": {
        this.lastRoot = call.rootId;
        const graph = await loadGraph(this.secrets, call.rootId, { ...(call.focus ? { focus: call.focus } : {}), ...(call.maxNodes ? { maxNodes: call.maxNodes } : {}) });
        this.rights.loaded(call.rootId, graph?.scope.digest);
        return graph;
      }
      case "targets": return this.targets();
      case "plan": return this.reviews.plan(call.req);
      case "run": return { started: this.reviews.start(call.reviewId) };
      case "stop": this.reviews.stop(call.reviewId); return null;
      case "discard": this.reviews.discard(call.reviewId); return null;
      case "search": {
        const index = await getHostKnowledgeIndex(call.rootId);
        return (await index.search(call.q, SEARCH_HITS)).map((h) => ({ ref: h.id, score: h.score, tier: h.tier }));
      }
      case "live": {
        this.live.get(call.stream)?.();
        this.live.set(call.stream, subscribeLiveGraph(this.secrets, call.rootId, (graph, changed) => this.event({ stream: call.stream, type: "graph", graph, changed })));
        return null;
      }
      case "unlive": this.live.get(call.stream)?.(); this.live.delete(call.stream); return null;
      case "remember": return this.remember(call.rootId, call.ref, call.content);
      case "factActions": return { canDelete: await this.canDelete(call.ref) };
      case "deleteFact": return this.deleteFact(call.ref);
      case "baseline": return this.baseline(call.rootId);
      case "compose": await openWorkspace(this.host.ctx, { kind: "seed", text: call.text }); return null;
      case "takeFocus": { const focus = pendingFocus; pendingFocus = null; return focus; }
    }
  }

  private async scopes(): Promise<KnowledgeScopeRow[]> {
    const client = linkedKnowledgeClient(this.secrets);
    const rows = client
      ? await client.scopes()
      // A root listed under its old id resolves to its current one (its snapshot migrated on read).
      : (await Promise.all([...new Set(reviewedRoots(this.host.ctx.workspaceState)
        .map((listed) => rootById(listed, workspaceFolders()))
        .filter((root): root is NonNullable<typeof root> => !!root)
        .map((root) => root.rootId))].map(async (rootId) => {
        const root = rootById(rootId, workspaceFolders());
        return root ? (await openRoot(this.secrets, root).store.scopes()).filter((s) => s.rootId === rootId) : [];
      }))).flat();
    return rows.map((r) => ({ rootId: r.rootId, title: r.title, packs: r.packs, ...(r.lastReviewedAt ? { lastReviewedAt: r.lastReviewedAt } : {}) }));
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
    const client = linkedKnowledgeClient(this.secrets);
    const store = client?.store ?? (root ? openRoot(this.secrets, root).store : undefined);
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
  }
}
