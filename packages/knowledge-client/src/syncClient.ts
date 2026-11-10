/**
 * The knowledge client's pack-sync calls (PRD 41 A11): one BFKP request per pack; the replica pump owns backoff, so no
 * retry here. Split from `client.ts`, which re-exports them on the client it builds.
 *
 *   sync          POST …/knowledge/sync (one pack or one ordered part)
 *   syncManifest  GET  …/sync/manifest      the root digest and the 4,096 bucket digests
 *   syncLeaves    POST …/sync/manifest      the leaves of the buckets asked for
 *   syncHave      POST …/sync/have          which `(hash, sourceRef)` pairs the project already holds
 *
 * 409 / 413 / 422 are typed errors; their status and code are kept, so generic handling still works.
 */
import { decodePack, encodePack, KPACK_CONTENT_TYPE, normalizePack, ZERO_DIGEST, type Pack } from '@seanhogg/builderforce-memory/knowledge/pack';
import { errorOf } from './httpError.js';
import {
  KnowledgeApiError, KnowledgeSyncBadPackError, KnowledgeSyncConflictError, KnowledgeSyncTooLargeError,
  type SyncAck, type SyncHavePair, type SyncManifest, type SyncPart,
} from './types.js';

export interface SyncClient {
  sync(rootId: string, part: SyncPart): Promise<SyncAck>;
  syncManifest(rootId: string): Promise<SyncManifest>;
  syncGeneration(rootId: string): Promise<{ generation: number; digest: string }>;
  syncLeaves(rootId: string, bucketIds: readonly number[]): Promise<{ generation: number; leaves: Array<{ key: string; digest: string }> }>;
  syncHave(rootId: string, pairs: readonly SyncHavePair[]): Promise<boolean[]>;
}

export function createSyncClient(base: string, doFetch: (url: string, init?: RequestInit) => Promise<Response>): SyncClient {
  /** The sync routes' refusals as typed errors. */
  const failure = async (res: Response): Promise<KnowledgeApiError> => {
    const err = await errorOf(res.clone());
    let detail: { generation?: unknown; digest?: unknown; hashes?: unknown } = {};
    try { detail = (await res.json()) as typeof detail; } catch { /* a non-JSON body has no detail */ }
    if (res.status === 409) {
      return new KnowledgeSyncConflictError(err.code, err.message,
        typeof detail.generation === 'number' ? detail.generation : undefined, typeof detail.digest === 'string' ? detail.digest : undefined,
        Array.isArray(detail.hashes) ? detail.hashes.filter((h): h is string => typeof h === 'string') : undefined);
    }
    if (res.status === 413 && (err.code === 'pack_too_large' || err.code === 'payload_too_large')) return new KnowledgeSyncTooLargeError(err.code, err.message);
    if (res.status === 422) return new KnowledgeSyncBadPackError(err.message, err.code);
    return err;
  };

  const call = async (path: string, init: RequestInit): Promise<Response> => {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, init);
    } catch (error) {
      throw new KnowledgeApiError(0, 'network', error instanceof Error ? error.message : String(error));
    }
    if (!res.ok) throw await failure(res);
    return res;
  };

  const kpack = async (rootId: string, fields: Partial<Pack>): Promise<BodyInit> =>
    (await encodePack({ rootId, baseGeneration: 0, targetDigest: ZERO_DIGEST, ...fields })) as unknown as BodyInit;

  return {
    async sync(_rootId, part) {
      const q = new URLSearchParams();
      if (part.syncId) q.set('syncId', part.syncId);
      if (part.part !== undefined) q.set('part', String(part.part));
      if (part.parts !== undefined) q.set('parts', String(part.parts));
      const query = q.size > 0 ? `?${q.toString()}` : '';
      const res = await call(`/knowledge/sync${query}`, { method: 'POST', headers: { 'Content-Type': KPACK_CONTENT_TYPE }, body: part.bytes as unknown as BodyInit });
      const body = (await res.json()) as { applied?: boolean; reconcile?: boolean; generation?: number; digest?: string; received?: number; parts?: number };
      return body.applied
        ? { applied: true, generation: body.generation ?? 0, digest: body.digest ?? '', ...(body.reconcile ? { reconcile: true as const } : {}) }
        : { applied: false, received: body.received ?? 0, parts: body.parts ?? 0 };
    },

    async syncManifest(rootId) {
      const res = await call(`/knowledge/sync/manifest?root=${encodeURIComponent(rootId)}`, { method: 'GET', headers: { Accept: KPACK_CONTENT_TYPE } });
      const pack = await decodePack(new Uint8Array(await res.arrayBuffer()));
      return { generation: pack.baseGeneration, digest: pack.targetDigest, buckets: pack.buckets ?? [] };
    },

    async syncGeneration(rootId) {
      const res = await call(`/knowledge/sync/manifest?root=${encodeURIComponent(rootId)}&view=generation`, { method: 'GET', headers: { Accept: 'application/json' } });
      const body = (await res.json()) as { generation?: number; digest?: string };
      return { generation: body.generation ?? 0, digest: body.digest ?? '' };
    },

    async syncLeaves(rootId, bucketIds) {
      const body = await kpack(rootId, { leaves: bucketIds.map((b) => ({ key: `b:${b}`, digest: ZERO_DIGEST })) });
      const res = await call('/knowledge/sync/manifest', { method: 'POST', headers: { 'Content-Type': KPACK_CONTENT_TYPE }, body });
      const pack = await decodePack(new Uint8Array(await res.arrayBuffer()));
      return { generation: pack.baseGeneration, leaves: pack.leaves ?? [] };
    },

    async syncHave(rootId, pairs) {
      if (pairs.length === 0) return [];
      // The answer's bit i is the i-th row of the codec's DECODED order (rows sorted by sourceRef): the order the codec gives
      // `stale` rows is the order we map the bits back through, so both sides read one ordering.
      const rows = normalizePack({ rootId, baseGeneration: 0, targetDigest: ZERO_DIGEST, stale: pairs.map((p) => ({ sourceRef: p.sourceRef, hash: p.hash })) }).stale ?? [];
      const res = await call('/knowledge/sync/have', { method: 'POST', headers: { 'Content-Type': KPACK_CONTENT_TYPE }, body: await kpack(rootId, { stale: rows }) });
      const bits = new Uint8Array(await res.arrayBuffer());
      const held = new Map(rows.map((r, i) => [`${r.sourceRef}\u0000${r.hash}`, ((bits[i >> 3] ?? 0) >> (i & 7) & 1) === 1] as const));
      return pairs.map((p) => held.get(`${p.sourceRef}\u0000${p.hash}`) === true);
    },
  };
}
