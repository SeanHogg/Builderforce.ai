import { describe, expect, it } from 'vitest';
import { encodePack, KPACK_CONTENT_TYPE, manifestTree, ZERO_DIGEST } from '@seanhogg/builderforce-memory/knowledge/pack';
import { createKnowledgeClient } from './client.js';
import { KnowledgeSyncBadPackError, KnowledgeSyncConflictError, KnowledgeSyncTooLargeError } from './types.js';

const reply = (body: BodyInit | null, status = 200, headers: Record<string, string> = {}) => new Response(body, { status, headers });
const json = (value: unknown, status = 200) => reply(JSON.stringify(value), status, { 'content-type': 'application/json' });

function clientWith(handler: (path: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const client = createKnowledgeClient({ projectId: 5, fetch: async (path, init) => { calls.push({ path, init }); return handler(path, init); } });
  return { client, calls };
}

describe('client.sync (PRD 41 A11)', () => {
  it('POSTs the pack as application/vnd.builderforce.kpack and returns the ack', async () => {
    const { client, calls } = clientWith(() => json({ ok: true, applied: true, generation: 3, digest: 'd' }));
    const ack = await client.sync('r', { bytes: new Uint8Array([1, 2, 3]) });
    expect(ack).toEqual({ applied: true, generation: 3, digest: 'd' });
    expect(calls[0]!.path).toBe('/api/projects/5/knowledge/sync');
    expect((calls[0]!.init!.headers as Record<string, string>)['Content-Type']).toBe(KPACK_CONTENT_TYPE);
  });

  it('sends syncId, part and parts for a multi-part pack and reports a staged part', async () => {
    const { client, calls } = clientWith(() => json({ ok: true, applied: false, received: 1, parts: 3 }));
    expect(await client.sync('r', { bytes: new Uint8Array([1]), syncId: 'abcdefgh', part: 0, parts: 3 })).toEqual({ applied: false, received: 1, parts: 3 });
    expect(calls[0]!.path).toBe('/api/projects/5/knowledge/sync?syncId=abcdefgh&part=0&parts=3');
  });

  it('maps 409, 413 and 422 to typed errors that keep status and code', async () => {
    const mk = (status: number, code: string, extra: object = {}) => clientWith(() => json({ error: 'no', code, ...extra }, status)).client.sync('r', { bytes: new Uint8Array([1]) });
    const conflict = await mk(409, 'generation_mismatch', { generation: 9, digest: 'abc' }).catch((e) => e);
    expect(conflict).toBeInstanceOf(KnowledgeSyncConflictError);
    expect(conflict).toMatchObject({ status: 409, code: 'generation_mismatch', generation: 9, digest: 'abc' });
    const big = await mk(413, 'pack_too_large').catch((e) => e);
    expect(big).toBeInstanceOf(KnowledgeSyncTooLargeError);
    expect(big.status).toBe(413);
    const bad = await mk(422, 'bad_pack').catch((e) => e);
    expect(bad).toBeInstanceOf(KnowledgeSyncBadPackError);
    expect(bad).toMatchObject({ status: 422, code: 'bad_pack' });
  });

  it('keeps a 429 as a plain error with its Retry-After for the pump to wait out', async () => {
    const { client } = clientWith(() => reply('{}', 429, { 'retry-after': '2', 'content-type': 'application/json' }));
    await expect(client.sync('r', { bytes: new Uint8Array([1]) })).rejects.toMatchObject({ status: 429, retryAfterMs: 2000 });
  });

  it('reads the manifest: generation, root digest and bucket digests', async () => {
    const tree = manifestTree([{ key: 'f:a', digest: 'x' }]);
    const body = await encodePack({ rootId: 'r', baseGeneration: 4, targetDigest: tree.root, buckets: tree.buckets });
    const { client, calls } = clientWith(() => reply(body as unknown as BodyInit));
    expect(await client.syncManifest('r')).toEqual({ generation: 4, digest: tree.root, buckets: tree.buckets });
    expect(calls[0]!.path).toBe('/api/projects/5/knowledge/sync/manifest?root=r');
  });

  it('answers have per (hash, sourceRef) in the order asked, from the server bitmap over the rows sorted by sourceRef', async () => {
    const h = 'a'.repeat(64);
    const asked = [{ hash: h, sourceRef: 'src:r::c.ts' }, { hash: h, sourceRef: 'src:r::a.ts' }, { hash: h, sourceRef: 'src:r::b.ts' }];
    // sorted order a, b, c; the server holds a's and c's entries (a hash held under another root answers 0 for this root's ref)
    const { client } = clientWith(() => reply(new Uint8Array([0b101]) as unknown as BodyInit));
    expect(await client.syncHave('r', asked)).toEqual([true, true, false]);
  });

  it('keeps the error code of a 422 (bad_pack, not_owned) so the pump can tell a defect from a refusal', async () => {
    const { client } = clientWith(() => json({ error: 'a tombstone names a key this root never synced', code: 'not_owned' }, 422));
    await expect(client.sync('r', { bytes: new Uint8Array([1]) })).rejects.toMatchObject({ status: 422, code: 'not_owned' });
  });

  it('writeRows posts rows only, stamped with the root, to the single writer', async () => {
    const { client, calls } = clientWith(() => json({ ok: true }));
    await client.writeRows('r', { facts: [{ key: 'note:1', content: 'c', source: 's', importance: 0.5, origin: 'human', fileAnchors: [] }], relations: [] });
    expect(calls[0]!.path).toBe('/api/projects/5/knowledge/write');
    expect(JSON.parse(calls[0]!.init!.body as string)).toMatchObject({ root: 'r', facts: [{ key: 'note:1' }], relations: [] });
  });

  it('reads leaves back', async () => {
    const body = await encodePack({ rootId: 'r', baseGeneration: 2, targetDigest: ZERO_DIGEST, leaves: [{ key: 'f:a', digest: 'd'.repeat(64) }] });
    const { client } = clientWith(() => reply(body as unknown as BodyInit));
    expect(await client.syncLeaves('r', [3])).toEqual({ generation: 2, leaves: [{ key: 'f:a', digest: 'd'.repeat(64) }] });
  });
});
