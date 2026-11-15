/**
 * What last ran on each root, as counts the Sync panel reads WITHOUT building a graph: the
 * bridge (`knowledgeBridge.ts`) notes the graph a `live` push carried, and the last-seen
 * snapshot a `lastSeen` read returned, until a fresher one replaces it. The sync status reads
 * these counts (`knowledgeSync.ts` `lastBuilt`) instead of re-building — so opening the panel
 * never triggers a graph build.
 */

import { graphCounts, type GraphCounts } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";

/** The counts of the last graph built (or seen) per root. */
export class LastBuiltCounts {
  private readonly byRoot = new Map<string, GraphCounts>();

  /** The graph a `live` push or a full `load` carried: its counts become the root's last-built. */
  note(rootId: string, graph: KnowledgeGraph): void {
    this.byRoot.set(rootId, graphCounts(graph));
  }

  /** The last-seen snapshot's graph (a `lastSeen` read): noted only until a fresher build lands. */
  noteSnapshot(rootId: string, graph: KnowledgeGraph): void {
    if (this.byRoot.has(rootId)) return;
    this.note(rootId, graph);
  }

  /** The root's last-built counts; undefined when nothing was built or seen for it yet. */
  get(rootId: string): GraphCounts | undefined {
    return this.byRoot.get(rootId);
  }
}
