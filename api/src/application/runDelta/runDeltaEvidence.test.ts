/**
 * Review follow-up 4: the evidence blob is CANONICAL (exactly the digest-covered body: no `digest`, no
 * `narrative`, sorted keys) and WRITE-ONCE (an existing blob is never replaced, and the write itself is
 * conditional on absence).
 */

import { describe, expect, it } from 'vitest';
import { delta } from '../sync/importers/__fixtures__/runDeltaFixture';
import { evidenceStoreOn, runDeltaEvidenceBody, runDeltaEvidenceKey, type EvidenceBucket } from './runDeltaEvidence';

function bucket() {
  const objects = new Map<string, string>();
  const preconditions: Array<string | null> = [];
  const b: EvidenceBucket = {
    head: async (key) => (objects.has(key) ? {} : null),
    put: async (key, value, options) => {
      preconditions.push(options.onlyIf.get('If-None-Match'));
      if (options.onlyIf.get('If-None-Match') === '*' && objects.has(key)) return null;
      objects.set(key, value);
      return {};
    },
    get: async (key) => {
      const text = objects.get(key);
      return text === undefined ? null : { json: async <T>() => JSON.parse(text) as T };
    },
  };
  return { b, objects, preconditions };
}

describe('run-delta evidence blob', () => {
  it('stores exactly the digest-covered body, canonical: no digest, no narrative, sorted keys', async () => {
    const { b, objects } = bucket();
    const d = { ...delta(), narrative: { text: 'prose', model: 'm', inputDigest: 'x' } };
    await evidenceStoreOn(b).put(7, d);
    const stored = objects.get(runDeltaEvidenceKey(7, d.digest))!;
    expect(stored).toBe(runDeltaEvidenceBody(d));
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty('narrative');
    expect(parsed).not.toHaveProperty('digest');
    expect(Object.keys(parsed)).toEqual([...Object.keys(parsed)].sort());
    // Reordering the input's keys does not change the bytes.
    const reordered = Object.fromEntries(Object.entries(d).reverse()) as typeof d;
    expect(runDeltaEvidenceBody(reordered)).toBe(stored);
  });

  it('never replaces an existing blob, and writes only on absence (If-None-Match: *)', async () => {
    const { b, objects, preconditions } = bucket();
    const store = evidenceStoreOn(b);
    const first = delta();
    await store.put(7, first);
    const before = objects.get(runDeltaEvidenceKey(7, first.digest));
    await store.put(7, { ...first, narrative: { text: 'other', model: 'm', inputDigest: 'y' }, headline: 'better' });
    expect(objects.get(runDeltaEvidenceKey(7, first.digest))).toBe(before);
    expect(preconditions).toEqual(['*']); // the second write never reached put
  });

  it('reads back the delta with its digest from the key', async () => {
    const { b } = bucket();
    const store = evidenceStoreOn(b);
    const d = delta();
    await store.put(7, d);
    expect(await store.get(7, d.digest)).toEqual(d);
    expect(await store.get(8, d.digest)).toBeNull();
  });

  it('refuses to write without a bucket (the import is retried)', async () => {
    await expect(evidenceStoreOn(undefined).put(7, delta())).rejects.toThrow(/not bound/);
  });
});
