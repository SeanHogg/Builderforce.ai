/**
 * knowledgeSyncBlobs — pack sync's state and staging in the knowledge domain's own R2 store (PRD 41 A11).
 *
 *   knowledge/{t}/{p}/{root}/sync.json                       { generation, digest } — the acknowledged state
 *   knowledge/{t}/{p}/sync-stage/{syncId}/{part:06}          one part of a multi-part pack; custom metadata
 *                                                            `at` (epoch ms) is its expiry clock (1 h)
 *
 * No table, no migration: the knowledge blobs already live here (see `knowledgeBlobs.ts`).
 */
import type { Env } from '../../../env';
import { knowledgeBlobKeys, listSources } from '../knowledgeBlobs';
import { STAGE_TTL_MS, type KnowledgeSyncPort, type SyncState } from './knowledgeSyncPorts';

const seg = (s: string): string => encodeURIComponent(s);
const HEAD_CONCURRENCY = 16;
const SWEEP_PAGE = 100;

export function r2KnowledgeSync(env: Pick<Env, 'UPLOADS'>, tenantId: number, projectId: number, now: () => number = Date.now): KnowledgeSyncPort {
  const keys = knowledgeBlobKeys(tenantId, projectId);
  const base = `knowledge/${tenantId}/${projectId}`;
  const stateKey = (rootId: string): string => `${base}/${seg(rootId)}/sync.json`;
  const stagePrefix = (syncId: string): string => `${base}/sync-stage/${seg(syncId)}/`;
  const bucket = (): R2Bucket => {
    if (!env.UPLOADS) throw new Error('knowledge storage (R2) is not configured');
    return env.UPLOADS;
  };

  return {
    async state(rootId) {
      if (!env.UPLOADS) return { generation: 0, digest: '' };
      const obj = await env.UPLOADS.get(stateKey(rootId));
      if (!obj) return { generation: 0, digest: '' };
      try {
        const s = (await obj.json()) as Partial<SyncState>;
        return { generation: Number.isSafeInteger(s.generation) ? s.generation! : 0, digest: typeof s.digest === 'string' ? s.digest : '' };
      } catch {
        return { generation: 0, digest: '' };
      }
    },

    async saveState(rootId, state) {
      await bucket().put(stateKey(rootId), JSON.stringify(state), { httpMetadata: { contentType: 'application/json' } });
    },

    async sources(rootId) {
      if (!env.UPLOADS) return [];
      return listSources(env.UPLOADS, keys.sources(rootId));
    },

    async hasExtracted(hashes) {
      const b = bucket();
      const out: boolean[] = new Array(hashes.length).fill(false);
      let next = 0;
      const lane = async (): Promise<void> => {
        while (next < hashes.length) {
          const i = next++;
          out[i] = (await b.head(keys.extracted(hashes[i]!))) != null;
        }
      };
      await Promise.all(Array.from({ length: Math.min(HEAD_CONCURRENCY, hashes.length) }, lane));
      return out;
    },

    async stagePart(syncId, part, bytes) {
      await bucket().put(`${stagePrefix(syncId)}${String(part).padStart(6, '0')}`, bytes, { customMetadata: { at: String(now()) } });
    },

    async stagedParts(syncId, parts) {
      const b = bucket();
      const out: Uint8Array[] = [];
      for (let i = 0; i < parts; i++) {
        const obj = await b.get(`${stagePrefix(syncId)}${String(i).padStart(6, '0')}`);
        if (!obj) return null;
        const at = Number(obj.customMetadata?.['at']);
        if (!Number.isFinite(at) || now() - at > STAGE_TTL_MS) return null;
        out.push(new Uint8Array(await obj.arrayBuffer()));
      }
      return out;
    },

    async dropStaged(syncId) {
      const b = bucket();
      const page = await b.list({ prefix: stagePrefix(syncId), limit: 1000 });
      if (page.objects.length > 0) await b.delete(page.objects.map((o) => o.key));
    },

    async sweepStaged() {
      if (!env.UPLOADS) return;
      const options: R2ListOptions & { include?: Array<'customMetadata'> } = { prefix: `${base}/sync-stage/`, limit: SWEEP_PAGE, include: ['customMetadata'] };
      const page = await env.UPLOADS.list(options);
      const old = page.objects.filter((o) => now() - Number(o.customMetadata?.['at'] ?? 0) > STAGE_TTL_MS).map((o) => o.key);
      if (old.length > 0) await env.UPLOADS.delete(old);
    },

    async clearRoot(rootId) {
      if (env.UPLOADS) await env.UPLOADS.delete(stateKey(rootId));
    },
  };
}
