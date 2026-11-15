/**
 * A RUNNING root's change batch as a bounded PATCH read from the changed files' extracted output
 * (PRD 38 §4.5, `knowledgeLive.ts`) — never a graph rebuild per change. The shared `watchFileEdits`
 * (the folder's watcher, or the background indexer's changed facts) already re-extracted each edited
 * file at its NEW content hash and marked what was judged from it STALE (§5.2): the builder reads
 * that fresh extract from the store's cache and diffs it against the extract the graph on screen was
 * built from (the file's hash before the batch), so the view applies only what moved.
 *
 *   - one patch = one batch of changed files, built strictly after the previous one (the caller
 *     chains its `build` calls): each diffs against the hashes the last one advanced, never against
 *     a base a later patch has already passed;
 *   - a file is `files` + `stale` (its judged knowledge no longer matches the file — the graph on
 *     screen still holds its OLD extract, which the next whole-graph refresh replaces); a deleted
 *     file drops its nodes and its own file node; nothing of an unreviewed path is touched;
 *   - `rebase`/`baseNow`/`useBase` pin the content hashes the whole-graph refresh starts from, so a
 *     patch built after a refresh diffs against the picture on screen, not a stale one.
 */

import { currentFileHashes } from "@builderforce/agent-tools/knowledge";
import type { IngestManifest } from "@seanhogg/builderforce-memory/ingest";
import { srcRef, type Extracted, type KnowledgeStore, type NodeRef } from "@seanhogg/builderforce-memory/knowledge";
import type { KnowledgeGraphPatch } from "./knowledgeProtocol";

/**
 * A batch this size (a branch switch, a formatter over the tree) is not patched file by file:
 * `knowledgeLive` asks the throttled whole-graph refresh for it instead.
 */
export const PATCH_MAX_FILES = 50;

/** The root's record the patch builder reads through: the local store's extract cache and review manifest. */
export interface LivePatchPorts {
  rootId: string;
  /** Only the extract cache is read (`getExtracted`); a test hands a narrow stand-in. */
  store: Pick<KnowledgeStore, "getExtracted">;
  manifest: IngestManifest;
}

const refOf = (rootId: string, path: string): NodeRef => srcRef(rootId, path) as NodeRef;

/** The extract of one source ref out of a cache entry that may hold several files of the same content hash. */
function ownExtract(rootId: string, path: string, entry: Extracted[] | undefined): Extracted | undefined {
  const ref = refOf(rootId, path);
  return entry?.find((e) => e.sourceRef === ref);
}

/**
 * Turns a root's edited-file batches into {@link KnowledgeGraphPatch}es. Constructed per live
 * subscription; `rebase` re-reads the store's current hashes as the base, and each `build` advances
 * the base to the batch it just pushed.
 */
export class LivePatchBuilder {
  /** The hashes the LAST patch or refresh built from: the next `build` diffs against these. */
  private base: Promise<Map<string, string>> | undefined;

  constructor(private readonly ports: LivePatchPorts) {}

  /** The content hashes the store holds now (the edited files' new ones): the base a refresh starts from. */
  baseNow(): Promise<Map<string, string>> {
    return currentFileHashes(this.ports.manifest, this.ports.rootId);
  }

  /**
   * A whole-graph refresh just landed: the next patch diffs against the hashes IT built from
   * (passed by the caller), not against the base the previous patch advanced.
   */
  useBase(base: Map<string, string>): void {
    this.base = Promise.resolve(base);
  }

  /** Re-reads the store's current hashes as the base (the subscription's start, a re-seed). */
  async rebase(): Promise<void> {
    this.base = Promise.resolve(await this.baseNow());
  }

  /**
   * The patch for one change batch. `paths` are the root-relative edited files; `changed` is every
   * path the live overlay tracks (the batch plus the working tree's pending changes). The patch's
   * `files`/`stale` name refs (`src:<rootId>::<path>`); its `changed` rides along root-relative.
   * The base advances to the batch's current hashes, so the next patch diffs against this one.
   */
  async build(paths: readonly string[], changed: readonly string[]): Promise<KnowledgeGraphPatch> {
    const { rootId, store } = this.ports;
    const before = new Map(await (this.base ??= this.baseNow()));
    const current = await this.baseNow();

    const touched = [...new Set(paths.map((p) => p.replace(/\\/g, "/")))];
    const files: string[] = [];
    const stale: string[] = [];
    const removedNodes: string[] = [];
    const upsertNodes: KnowledgeGraphPatch["upsertNodes"] = [];
    const removedEdges: KnowledgeGraphPatch["removedEdges"] = [];
    const upsertEdges: KnowledgeGraphPatch["upsertEdges"] = [];

    for (const path of touched) {
      const ref = refOf(rootId, path);
      const refKey = String(ref);
      const nowHash = current.get(path);
      const wasHash = before.get(path);
      if (nowHash === undefined || nowHash === "") {
        // The file is gone (an edit records '' as its hash): every node its old extract named
        // (its own file node included) leaves the screen.
        if (wasHash === undefined) continue; // an unreviewed path: nothing of it is on screen
        const oldExtract = ownExtract(rootId, path, await store.getExtracted?.(wasHash));
        removedNodes.push(refKey, ...(oldExtract?.nodes.map((n) => String(n.ref)) ?? []));
        continue;
      }
      if (nowHash === wasHash) continue; // already on screen at this hash (a re-read): nothing moves
      if (wasHash === undefined) continue; // an unreviewed path: nothing of it is on screen
      files.push(refKey);
      stale.push(refKey); // the graph still holds the old extract: its judged knowledge no longer matches
      const [oldExtract, newExtract] = await Promise.all([
        store.getExtracted?.(wasHash).then((e) => ownExtract(rootId, path, e)),
        store.getExtracted?.(nowHash).then((e) => ownExtract(rootId, path, e)),
      ]);
      if (!newExtract) continue; // the new extract has not reached the cache yet: nothing of it is upserted
      // Upsert everything the fresh extract names; drop the old extract's nodes/edges it does not re-state.
      const newNodeRefs = new Set(newExtract.nodes.map((n) => String(n.ref)));
      const newEdgeKeys = new Set(newExtract.edges.map((e) => `${String(e.from)}→${String(e.to)}:${e.kind}`));
      upsertNodes.push(...newExtract.nodes);
      upsertEdges.push(...newExtract.edges);
      for (const node of oldExtract?.nodes ?? []) {
        if (!newNodeRefs.has(String(node.ref))) removedNodes.push(String(node.ref));
      }
      for (const edge of oldExtract?.edges ?? []) {
        if (!newEdgeKeys.has(`${String(edge.from)}→${String(edge.to)}:${edge.kind}`)) {
          removedEdges.push({ from: String(edge.from), to: String(edge.to), kind: edge.kind });
        }
      }
    }

    // The base advances to what this patch pushed: the next batch diffs against these hashes.
    this.base = Promise.resolve(current);

    return { rootId, files, removedNodes, upsertNodes, removedEdges, upsertEdges, stale, changed: [...changed] };
  }
}
