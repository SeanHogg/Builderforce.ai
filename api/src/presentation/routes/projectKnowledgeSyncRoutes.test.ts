/**
 * The pack sync routes (PRD 41 A11): both doors mount them, the content type and size are checked, and the
 * use case's typed refusals reach the client as 409 / 413 / 422 with their codes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantRole } from '../../domain/shared/types';

const TENANT = 8;
const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  apply: vi.fn(),
  summary: vi.fn(),
  leaves: vi.fn(),
  have: vi.fn(),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); c.set('userId', 'u1'); c.set('role', TenantRole.DEVELOPER); await next(); },
}));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../application/knowledge/knowledgeComposition', () => ({
  knowledgePortsFor: () => ({ env: {}, db: {}, tenantId: TENANT, projectId: 3, store: {}, extracted: {}, sync: {}, graph: {}, index: {} }),
}));
vi.mock('../../application/knowledge/sync/applyKnowledgePack', () => ({ applyKnowledgePack: mocks.apply }));
vi.mock('../../application/knowledge/sync/knowledgeSyncManifest', () => ({
  manifestSummary: mocks.summary, manifestLeaves: mocks.leaves, haveBitmap: mocks.have,
  bucketIdsOf: async () => ({ rootId: 'r', buckets: [1, 2] }),
}));

import { createProjectKnowledgeRoutes } from './projectKnowledgeRoutes';
import type { FrontDoor } from '../middleware/frontDoor';
import { KnowledgeSyncError } from '../../application/knowledge/sync/knowledgeSyncPorts';
import { KnowledgeWriteError } from '../../application/knowledge/knowledgeWriteError';

const KPACK = 'application/vnd.builderforce.kpack';
const hostDoor: FrontDoor = {
  agentHost: true,
  auth: async (c, next) => {
    c.set('tenantId', TENANT); c.set('userId', 'agentHost:17'); c.set('role', TenantRole.DEVELOPER);
    c.set('machineActor', { kind: 'agent_host', agentHostId: 17, suffix: '17' });
    await next();
  },
};
const send = (body: BodyInit | null, type = KPACK, query = '') => ({ url: `/3/knowledge/sync${query}`, init: { method: 'POST', headers: { 'content-type': type }, body } });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue(true);
});

describe.each([['tenant door', () => createProjectKnowledgeRoutes({} as never)], ['agent-host door', () => createProjectKnowledgeRoutes({} as never, hostDoor)]])('POST knowledge/sync on the %s', (_name, make) => {
  it('applies a pack and answers its result', async () => {
    mocks.apply.mockResolvedValue({ applied: true, generation: 4, digest: 'd' });
    const { url, init } = send(new Uint8Array([1, 2, 3]));
    const res = await make().request(url, init);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, generation: 4, digest: 'd' });
    expect(mocks.apply.mock.calls[0]![1].body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('passes the syncId and part numbers of a multi-part pack', async () => {
    mocks.apply.mockResolvedValue({ applied: false, syncId: 'abcdefgh', received: 1, parts: 2 });
    const { url, init } = send(new Uint8Array([1]), KPACK, '?syncId=abcdefgh&part=0&parts=2');
    await make().request(url, init);
    expect(mocks.apply.mock.calls[0]![1]).toMatchObject({ syncId: 'abcdefgh', part: 0, parts: 2 });
  });

  it.each([[409, 'generation_mismatch'], [413, 'pack_too_large'], [422, 'bad_pack']] as const)('maps %i %s to a typed answer', async (status, code) => {
    mocks.apply.mockRejectedValue(new KnowledgeSyncError(status, code, 'no', { generation: 3 }));
    const { url, init } = send(new Uint8Array([1]));
    const res = await make().request(url, init);
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code, generation: 3 });
  });

  it('refuses another content type with 415 and an oversized declared body with 413 before reading it', async () => {
    const wrong = send(new Uint8Array([1]), 'application/json');
    expect((await make().request(wrong.url, wrong.init)).status).toBe(415);
    const big = send(new Uint8Array([1]));
    const res = await make().request(big.url, { ...big.init, headers: { ...big.init.headers, 'content-length': String(9 * 1024 * 1024) } });
    expect(res.status).toBe(413);
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('cuts a chunked body (no Content-Length) off at 8 MB without buffering it', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (sent++ < 12) c.enqueue(chunk); else c.close(); } });
    const res = await make().request('/3/knowledge/sync', { method: 'POST', headers: { 'content-type': KPACK }, body, duplex: 'half' } as never);
    expect(res.status).toBe(413);
    expect(sent).toBeLessThan(12);          // it stopped reading
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('answers the writer\'s own refusals with their status, not 500', async () => {
    mocks.apply.mockRejectedValue(new KnowledgeWriteError(400, 'origin_mismatch', 'origin human cannot be written by a machine'));
    const { url, init } = send(new Uint8Array([1]));
    const res = await make().request(url, init);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'origin_mismatch' });
  });

  it('answers 404 for a project that is not the tenant’s, before any port exists', async () => {
    mocks.owned.mockResolvedValue(false);
    const { url, init } = send(new Uint8Array([1]));
    expect((await make().request(url, init)).status).toBe(404);
  });

  it('serves the manifest, the leaves and the have bitmap as binary', async () => {
    mocks.summary.mockResolvedValue(new Uint8Array([9]));
    mocks.leaves.mockResolvedValue(new Uint8Array([8]));
    mocks.have.mockResolvedValue(new Uint8Array([7]));
    const r = make();
    const got = await r.request('/3/knowledge/sync/manifest?root=r');
    expect(got.headers.get('content-type')).toBe(KPACK);
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array([9]));
    expect((await r.request('/3/knowledge/sync/manifest')).status).toBe(400);
    const leaves = await r.request('/3/knowledge/sync/manifest', { method: 'POST', body: new Uint8Array([1]) });
    expect(new Uint8Array(await leaves.arrayBuffer())).toEqual(new Uint8Array([8]));
    const have = await r.request('/3/knowledge/sync/have', { method: 'POST', body: new Uint8Array([1]) });
    expect(new Uint8Array(await have.arrayBuffer())).toEqual(new Uint8Array([7]));
  });
});
