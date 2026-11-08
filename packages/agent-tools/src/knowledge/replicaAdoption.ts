/**
 * knowledge/replicaAdoption.ts — the ONE rule for when a host's pump may delete what only the server holds.
 *
 * A root id is shared across a project (the web's, an on-prem agent's), so a host whose local store has never COMPLETED a
 * review of the root can start with an empty store on a root another host already synced. Its pump would reconcile
 * subtractively and tombstone every leaf it does not hold. Until a review of the root has finished here, the root stays
 * ADDITIVE: the pump sends what this host wrote and never deletes a leaf for being absent locally.
 */

import type { KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';

/** True unless the local store holds a COMPLETED review of the root (its scope record carries the review's digest or time). */
export async function shouldStayAdditive(local: KnowledgeStore, rootId: string): Promise<boolean> {
    const record = (await local.scopes()).find((s) => s.rootId === rootId);
    return !(record && (record.lastDigest || record.lastReviewedAt));
}
