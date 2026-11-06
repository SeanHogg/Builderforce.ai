/**
 * The browser hosts' "last seen" memory (the view's `KnowledgeGraphSource.lastSeen`): what a
 * project showed last time, kept in memory for the page's life so a reopened view paints on its
 * first frame while the fresh read runs. Module-level (it must outlive the view's source, which is
 * recreated per mount), keyed by project and root; nothing is persisted. At most
 * {@link LAST_SEEN_MAX_GRAPHS} graphs are kept (least recently used out), so a long session over many
 * projects stays bounded. Nothing in this package signals a sign-out or tenant switch, so a host that
 * can detect one calls {@link claimLastSeenMemory} there (the web: the knowledge surface; Rovr: its session).
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeGraphSource, KnowledgeScopeSummary } from '@builderforce/knowledge-graph-view';

type Seen = { scopes: KnowledgeScopeSummary[]; rootId: string; graph: KnowledgeGraph };

/** The most graphs kept at once. */
export const LAST_SEEN_MAX_GRAPHS = 8;

/** Insertion order IS recency: a read or write re-inserts its key at the end. */
const graphs = new Map<string, KnowledgeGraph>();
const lastRoot = new Map<number, string>();
const scopesOf = new Map<number, KnowledgeScopeSummary[]>();

/** Forgets everything (sign-out, tenant switch). */
export function clearLastSeenMemory(): void {
  graphs.clear();
  lastRoot.clear();
  scopesOf.clear();
}

let owner: string | null = null;

/**
 * Claims the memory for an identity (`null` = nobody signed in). Another person, another workspace
 * or a sign-out clears what the previous identity left, so one person's last graph is never painted
 * for the next. Claiming for the identity that already owns it changes nothing. THE one copy: the
 * web and Rovr both call it.
 */
export function claimLastSeenMemory(identity: string | null): void {
  if (identity === owner) return;
  if (owner !== null) clearLastSeenMemory();
  owner = identity;
}

/** The identity key of a session: the person within the workspace; null when either is missing. */
export function lastSeenIdentity(user: string | number | null | undefined, tenant: string | number | null | undefined): string | null {
  return user !== null && user !== undefined && tenant !== null && tenant !== undefined ? `${tenant}:${user}` : null;
}

export interface LastSeenMemory {
  /** The scopes listing a fresh `scopes()` read answered. */
  scopes(found: KnowledgeScopeSummary[]): void;
  /** A FULL load (no focus) succeeded: this graph is what the next open paints first. */
  loaded(rootId: string, graph: KnowledgeGraph | null, focused: boolean): void;
  read: NonNullable<KnowledgeGraphSource['lastSeen']>;
}

export function lastSeenMemory(projectId: number): LastSeenMemory {
  return {
    scopes: (found) => { scopesOf.set(projectId, found); },
    loaded(rootId, graph, focused) {
      if (!graph || focused) return;
      const key = `${projectId}:${rootId}`;
      graphs.delete(key);
      graphs.set(key, graph);
      lastRoot.set(projectId, rootId);
      while (graphs.size > LAST_SEEN_MAX_GRAPHS) graphs.delete(graphs.keys().next().value as string);
    },
    async read(): Promise<Seen | null> {
      const rootId = lastRoot.get(projectId);
      const key = `${projectId}:${rootId}`;
      const graph = rootId ? graphs.get(key) : undefined;
      if (!rootId || !graph) return null;
      graphs.delete(key);
      graphs.set(key, graph);
      const scopes = scopesOf.get(projectId) ?? [{ rootId, title: rootId, packs: graph.scope.packs }];
      return { scopes, rootId, graph };
    },
  };
}
