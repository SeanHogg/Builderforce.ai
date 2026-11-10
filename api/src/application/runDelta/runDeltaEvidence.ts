/**
 * The full run delta (evidence included) in R2, keyed by its digest (PRD 41 §C14: "evidence stays a blob in
 * R2, keyed by digest").
 *
 *   run-deltas/{tenantId}/{digest}.json
 *
 * CANONICAL AND WRITE-ONCE. The blob is exactly the body the digest covers — the delta without `digest` and
 * without `narrative` (model prose the digest deliberately excludes; the server never stores it) — serialized
 * with sorted keys (`canonicalJson`), so two payloads that share a digest store the same bytes. And it is written
 * only when absent (`If-None-Match: *`, after a `head`): an existing blob is never replaced, so no later write
 * under a digest — a retry, a replay, a narrative that differs — can change what an earlier import stored. The
 * importer recomputes the digest before it gets here, so the key is always the body's own.
 *
 * A rolled-back import leaves only a harmless orphan: its retry targets the same key.
 *
 * Retention is an object-lifecycle rule on the `run-deltas/` prefix, not a sweep: `infra/uploads/lifecycle.json`,
 * applied by `.github/scripts/uploads-lifecycle-ensure.sh` on every API deploy — 730 days, the `run_deltas` row
 * window, so a stored row never outlives its blob.
 */

import { canonicalJson } from '@seanhogg/builderforce-memory/knowledge';
import type { RunDelta } from '@builderforce/run-delta';
import type { Env } from '../../env';
import type { RunDeltaEvidenceStore } from './runDeltaPorts';

export const runDeltaEvidenceKey = (tenantId: number, digest: string): string => `run-deltas/${tenantId}/${digest}.json`;

/** The stored bytes of a delta: its digest-covered body, canonical. */
export function runDeltaEvidenceBody(delta: RunDelta): string {
  const { digest: _digest, narrative: _narrative, ...body } = delta;
  return canonicalJson(body);
}

/** The bucket surface this store uses (the Worker's `R2Bucket` satisfies it; tests pass a double). */
export interface EvidenceBucket {
  head(key: string): Promise<unknown | null>;
  put(key: string, value: string, options: { httpMetadata: { contentType: string }; onlyIf: Headers }): Promise<unknown | null>;
  get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
}

/** THROWS on put when the bucket is not bound: the import is then answered pending and retried. */
export function runDeltaEvidenceStore(env: Pick<Env, 'UPLOADS'> | undefined): RunDeltaEvidenceStore {
  return evidenceStoreOn(env?.UPLOADS as unknown as EvidenceBucket | undefined);
}

export function evidenceStoreOn(bucket: EvidenceBucket | undefined): RunDeltaEvidenceStore {
  return {
    async put(tenantId, delta) {
      if (!bucket) throw new Error('run delta evidence: UPLOADS bucket not bound');
      const key = runDeltaEvidenceKey(tenantId, delta.digest);
      if (await bucket.head(key)) return; // written once: never replaced
      // A concurrent first write loses the precondition (null): the blob it lost to has the same digest.
      await bucket.put(key, runDeltaEvidenceBody(delta), {
        httpMetadata: { contentType: 'application/json' },
        onlyIf: new Headers({ 'If-None-Match': '*' }),
      });
    },
    async get(tenantId, digest) {
      const object = await bucket?.get(runDeltaEvidenceKey(tenantId, digest));
      if (!object) return null;
      const body = await object.json<Omit<RunDelta, 'digest'>>();
      return { ...body, digest };
    },
  };
}
