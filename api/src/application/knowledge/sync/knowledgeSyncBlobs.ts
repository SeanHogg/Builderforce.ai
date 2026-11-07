/**
 * knowledgeSyncBlobs — pack sync's staging, bundle writes and generation reads over the knowledge domain's own
 * stores (PRD 41 A11).
 *
 *   knowledge/{t}/sync-stage/{p}/{actor}/{syncId}/{part:06}   one EARLIER part of a multi-part pack; custom metadata
 *                                                             `at` (epoch ms) is its expiry clock (1 h). Under the
 *                                                             tenant, beside the numeric project folders, so no root
 *                                                             name can collide with it; keyed by the actor, so
 *                                                             one person's `syncId` is never another's.
 *   knowledge/{t}/extracted-bundles/{digest}                  a pack's extracted bodies, one object (knowledgeBundles.ts)
 *   knowledge_sync_roots (Postgres)                           the generation and digest; an older `sync.json` object
 *                                                             is copied into it on first read and deleted
 *
 * Object writes per sync: one per earlier part (the last part rides the request that applies the pack), ONE bundle,
 * and one immutable review snapshot when the scope records a new digest.
 */
import type { Env } from '../../../env';
import { reportCaughtError } from '../../observability/caughtErrorReporter';
import type { Bundle } from '../knowledgeBundles';
import { knowledgeBlobKeys, listRootSources } from '../knowledgeBlobs';
import type { KnowledgeLedgerPort } from '../knowledgeLedger';
import { KnowledgeSyncError, STAGE_TTL_MS, type KnowledgeSyncPort, type SyncState } from './knowledgeSyncPorts';

const seg = (s: string): string => encodeURIComponent(s);
const DELETE_BATCH = 1000;

export function r2KnowledgeSync(
  env: Pick<Env, 'UPLOADS'>, tenantId: number, projectId: number, ledger: KnowledgeLedgerPort, now: () => number = Date.now,
): KnowledgeSyncPort {
  const keys = knowledgeBlobKeys(tenantId, projectId);
  const legacyStateKey = (rootId: string): string => `knowledge/${tenantId}/${projectId}/${seg(rootId)}/sync.json`;
  const stageRoot = `knowledge/${tenantId}/sync-stage/${projectId}/`;
  const stagePrefix = (actor: string, syncId: string): string => `${stageRoot}${seg(actor)}/${seg(syncId)}/`;
  const partKey = (actor: string, syncId: string, part: number): string => `${stagePrefix(actor, syncId)}${String(part).padStart(6, '0')}`;
  const bucket = (): R2Bucket => {
    if (!env.UPLOADS) throw new Error('knowledge storage (R2) is not configured');
    return env.UPLOADS;
  };

  /** The `sync.json` an older version wrote: copied into the roots table, then deleted. */
  async function migrateLegacyState(rootId: string, over: KnowledgeLedgerPort): Promise<SyncState | null> {
    if (!env.UPLOADS) return null;
    const obj = await env.UPLOADS.get(legacyStateKey(rootId));
    if (!obj) return null;
    let state: SyncState = { generation: 0, digest: '' };
    try {
      const s = (await obj.json()) as Partial<SyncState>;
      state = { generation: Number.isSafeInteger(s.generation) ? s.generation! : 0, digest: typeof s.digest === 'string' ? s.digest : '' };
    } catch (error) {
      // an unreadable object is generation 0
      reportCaughtError(error, { source: 'application/knowledge/sync/knowledgeSyncBlobs.ts', operation: 'migrateLegacyState', level: 'warning', context: { rootId } });
    }
    if (state.generation > 0) await over.roots.seed(rootId, state);
    await env.UPLOADS.delete(legacyStateKey(rootId));
    return state;
  }

  return {
    async state(rootId, over) {
      const l = over ?? ledger;
      const row = await l.roots.get(rootId);
      if (row) return row;
      return (await migrateLegacyState(rootId, l)) ?? { generation: 0, digest: '' };
    },

    sources: (rootId, over) => listRootSources(env.UPLOADS, over ?? ledger, tenantId, projectId, rootId),

    // One indexed query, no object probe: the sweep is the only deleter and it deletes only bundles no index row names.
    heldEntries: (pairs, over) => (over ?? ledger).index.holds(pairs),

    async putBundle(bundle: Bundle) {
      await bucket().put(bundle.key, bundle.bytes, { httpMetadata: { contentType: 'application/json' } });
    },

    async snapshotReview(rootId, digest, sources) {
      const b = bucket();
      const key = keys.review(rootId, digest);
      // Immutable per digest: a digest names exactly these sources, so a second writer has nothing to add.
      if (await b.head(key)) return;
      const sorted = [...sources].sort((a, c) => (a.path < c.path ? -1 : a.path > c.path ? 1 : a.hash < c.hash ? -1 : a.hash > c.hash ? 1 : 0));
      await b.put(key, JSON.stringify(sorted), { httpMetadata: { contentType: 'application/json' } });
    },

    async stagePart(actor, syncId, part, bytes) {
      await bucket().put(partKey(actor, syncId, part), bytes, { customMetadata: { at: String(now()) } });
    },

    // The parts come back as the separate buffers they were staged in: the codec inflates them as one stream (never joined).
    async stagedParts(actor, syncId, parts, maxBytes) {
      const b = bucket();
      const out: Uint8Array[] = [];
      let total = 0;
      for (let i = 0; i < parts; i++) {
        const obj = await b.get(partKey(actor, syncId, i));
        if (!obj) return null;
        const at = Number(obj.customMetadata?.['at']);
        if (!Number.isFinite(at) || now() - at > STAGE_TTL_MS) return null;
        // Summed as they load: a pack past the cap is refused before anything is joined.
        total += obj.size;
        if (total > maxBytes) throw new KnowledgeSyncError(413, 'pack_too_large', `the parts of this pack add up past ${maxBytes} bytes`);
        out.push(new Uint8Array(await obj.arrayBuffer()));
      }
      return out;
    },

    async dropStaged(actor, syncId) {
      const b = bucket();
      const page = await b.list({ prefix: stagePrefix(actor, syncId), limit: 1000 });
      if (page.objects.length > 0) await b.delete(page.objects.map((o) => o.key));
    },

    async sweepStaged() {
      if (!env.UPLOADS) return;
      const options: R2ListOptions & { include?: Array<'customMetadata'> } = { prefix: stageRoot, limit: 100, include: ['customMetadata'] };
      const page = await env.UPLOADS.list(options);
      const old = page.objects.filter((o) => now() - Number(o.customMetadata?.['at'] ?? 0) > STAGE_TTL_MS).map((o) => o.key);
      if (old.length > 0) await env.UPLOADS.delete(old);
    },

    async deleteLegacySources(rootId, sourceIds) {
      if (!env.UPLOADS) return;
      const all = sourceIds.map((id) => keys.source(rootId, id));
      for (let i = 0; i < all.length; i += DELETE_BATCH) await env.UPLOADS.delete(all.slice(i, i + DELETE_BATCH));
    },

    async clearRoot(rootId) {
      // One transaction under the project's sync lock: a pack of this root can neither interleave nor see a half-cleared root.
      await ledger.exclusive(async (locked) => {
        await locked.leaves.clear(rootId);
        await locked.buckets.clear(rootId);
        await locked.roots.clear(rootId);
      });
      if (env.UPLOADS) await env.UPLOADS.delete(legacyStateKey(rootId));
    },
  };
}
