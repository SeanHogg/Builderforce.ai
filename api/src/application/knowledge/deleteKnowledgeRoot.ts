/**
 * deleteKnowledgeRoot — `DELETE …/knowledge/scopes/:rootId` (PRD 40, OD-2): removes an
 * UPLOADED PACK from the project it was uploaded to. A pack is a knowledge root marked by
 * its `pack:` host segment ({@link isPackRootId}). Who may remove one is `packAccess`'s call,
 * made by the route before this runs.
 *
 * Deletion is by PROVENANCE, never by path. `writeKnowledge` stamps a pack root's id as the
 * `source` of every fact the pack wrote, so removal deletes exactly the rows with that
 * source (each batch: its `fact:` relations, then the facts), the relations with an end under
 * `src:<root>::`, the root's source objects (by their key prefix — no extracted lookup, so a
 * source whose blob is gone goes too), its code-analysis pointer and its scope row, then bumps
 * the knowledge version ONCE. A human, agent or linked-repo fact on the same path is never touched.
 *
 * An upload that stopped part way may have no scope row: the provenance delete runs anyway, and
 * the answer is 404 only when there was no scope AND nothing was deleted.
 *
 * Reviewed roots are NOT deletable here: the root id must be a pack's (400 otherwise).
 */
import { isPackRootId } from '@builderforce/agent-tools';
import type { Env } from '../../env';
import type { KnowledgeGraphDeps } from './getKnowledgeGraph';
import { bumpKnowledgeVersion } from './knowledgeVersion';
import type { KnowledgeSyncPort } from './sync/knowledgeSyncPorts';

export interface DeleteRootDeps {
  env: Env;
  /** The project's knowledge ports (store, extracted cache, analysis) — already tenant-bound. */
  graph: KnowledgeGraphDeps;
  /** Pack sync's state: the root's `sync.json` goes with it (its source rows go with `deleteRootSources`). Extracted-index rows are content-addressed and shared, so they stay; their bundles are swept by age. */
  sync?: KnowledgeSyncPort;
}

export type DeleteRootResult =
  | { ok: true; facts: number; relations: number; sources: number }
  | { ok: false; status: 400 | 404; error: string };

export async function deleteKnowledgeRoot(deps: DeleteRootDeps, rootId: string): Promise<DeleteRootResult> {
  const { graph } = deps;
  if (!isPackRootId(rootId)) return { ok: false, status: 400, error: 'only an uploaded knowledge pack can be removed' };
  const hadScope = (await graph.store.scope(rootId)) != null;

  let bump = true;
  try {
    // Relations of the sources first, then (per batch) each fact's relations and the facts:
    // a failure part way leaves nothing dangling and a retry resumes from what is left.
    const underRoot = await graph.store.deleteRelationsUnder(rootId);
    const { keys, relations: onFacts } = await graph.store.deleteFactsBySource(rootId);
    const sources = await graph.extracted.deleteRootSources(rootId);
    await graph.analysis.clear(rootId);
    await deps.sync?.clearRoot(rootId);
    const scopeDeleted = await graph.store.deleteScope(rootId);
    if (!hadScope && !scopeDeleted && underRoot + onFacts + keys.length + sources === 0) {
      bump = false;
      return { ok: false, status: 404, error: 'unknown knowledge root' };
    }
    return { ok: true, facts: keys.length, relations: underRoot + onFacts, sources };
  } finally {
    // ONE bump for the whole removal — also when it failed part-way (what was deleted must not stay cached).
    if (bump) await bumpKnowledgeVersion(deps.env, graph.tenantId, graph.projectId);
  }
}
