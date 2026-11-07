/**
 * The knowledge routes (PRD 38 §4.8): tenancy is refused before any port exists, the
 * write and upload bounds answer 413/400, and `maxNodes` reaches the use case capped.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';

const TENANT = 8;
const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  ports: vi.fn(),
  graph: vi.fn(),
  putAnalysis: vi.fn(async () => undefined),
  upsertRelations: vi.fn(async (rows: unknown[]) => rows.length),
  scopes: vi.fn(async () => []),
  deleteRoot: vi.fn(),
  role: { value: 'developer' as string },
  /** The stored scope of the pack under test (null = none yet). */
  scopeRow: { value: null as null | { rootId: string; title: string; packs: string[]; provenance?: { uploadedBy?: string } } },
  facts: vi.fn(),
  superadmin: vi.fn(async () => false),
  upsertFact: vi.fn(async () => true),
  judgeCost: vi.fn(),
  judge: vi.fn(),
  version: { n: 0 },
  bump: vi.fn(async () => { mocks.version.n += 1; }),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); c.set('userId', 'u1'); c.set('role', mocks.role.value); await next(); },
}));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../application/knowledge/knowledgeComposition', () => ({ knowledgePortsFor: mocks.ports }));
vi.mock('../../application/knowledge/knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));
vi.mock('../../application/knowledge/knowledgePerception', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/knowledge/knowledgePerception')>()),
  putAnalysisSnapshot: mocks.putAnalysis,
}));
vi.mock('../../application/knowledge/listKnowledge', () => ({ listKnowledgeScopes: mocks.scopes, listKnowledgeFacts: mocks.facts }));
vi.mock('../../application/knowledge/deleteKnowledgeRoot', () => ({ deleteKnowledgeRoot: mocks.deleteRoot }));
vi.mock('../../application/knowledge/judgeCostEstimate', () => ({ judgeCostFor: mocks.judgeCost }));
vi.mock('../../application/knowledge/judgeKnowledge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/knowledge/judgeKnowledge')>()),
  judgeKnowledge: mocks.judge,
}));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: mocks.superadmin }));
vi.mock('../../application/llm/projectFactsWrite', async () => ({ upsertProjectFact: mocks.upsertFact, upsertProjectFacts: (await import('../../application/knowledge/factWriterMock.test-util')).batchOverSingle(mocks.upsertFact as never), deleteProjectFact: vi.fn() }));
vi.mock('../../application/knowledge/getKnowledgeGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/knowledge/getKnowledgeGraph')>()),
  getKnowledgeGraph: mocks.graph,
}));

import { createProjectKnowledgeRoutes } from './projectKnowledgeRoutes';
import type { FrontDoor } from '../middleware/frontDoor';
import { errorHandler } from '../middleware/errorHandler';

const db = {} as never;
const routes = () => createProjectKnowledgeRoutes(db);
/** The bulk route's schema refusal throws `RequestValidationError`, which the app answers
 *  through `app.onError(errorHandler)` (see index.ts); the sub-router alone has no error
 *  handler, so mount one for the tests that assert a 400. */
const appWithErrors = () => {
  const app = new Hono<HonoEnv>();
  app.onError(errorHandler);
  app.route('/', routes());
  return app;
};
/** The agent-host key door, as `hostKeyAuth` publishes a host's identity. */
const hostDoor: FrontDoor = {
  agentHost: true,
  auth: async (c, next) => {
    c.set('tenantId', TENANT);
    c.set('userId', 'agentHost:17');
    c.set('role', TenantRole.DEVELOPER);
    c.set('machineActor', { kind: 'agent_host', agentHostId: 17, suffix: '17' });
    await next();
  },
};
const hostRoutes = () => createProjectKnowledgeRoutes(db, hostDoor);
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.owned.mockResolvedValue(true);
  mocks.role.value = TenantRole.DEVELOPER;
  mocks.scopeRow.value = null;
  mocks.superadmin.mockResolvedValue(false);
  mocks.ports.mockImplementation((_env: unknown, _db: unknown, tenantId: number, projectId: number) => ({
    env: {}, db, tenantId, projectId,
    store: {
      upsertRelations: mocks.upsertRelations, scopes: vi.fn(async () => []), factAuthor: vi.fn(async () => undefined),
      scope: vi.fn(async () => mocks.scopeRow.value), upsertScope: vi.fn(async () => undefined),
      factSources: vi.fn(async () => new Map()), humanRelationKeys: vi.fn(async () => new Set()),
    },
    extracted: { setSource: vi.fn(), snapshotReview: vi.fn() },
    graph: { repo: { linked: async () => ({ rootId: 'cloud:r1:' }) } },
    index: {},
    ledger: { index: { drop: vi.fn(async () => undefined) } },
  }));
  mocks.graph.mockResolvedValue({ scope: { rootId: 'r', packs: [], digest: 'd' }, nodes: [], edges: [], findings: [], stats: {} });
});

const relation = (i: number) => ({ from: `fact:claim:${i}`, to: 'src:r::a.md', kind: 'about', weight: 1, origin: 'model', sourceHash: 'h1' });

describe('project knowledge routes', () => {
  it('refuses a project outside the caller’s tenant before composing any port', async () => {
    mocks.owned.mockResolvedValue(false);
    const res = await routes().request('/42/knowledge/scopes', {}, {});
    expect(res.status).toBe(404);
    expect(mocks.owned).toHaveBeenCalledWith(expect.anything(), db, TENANT, 42);
    expect(mocks.ports).not.toHaveBeenCalled();
  });

  it('serves scopes for a member’s project', async () => {
    const res = await routes().request('/42/knowledge/scopes', {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ scopes: [] });
  });

  it('removes an uploaded pack root, passing the decoded root id to the use case', async () => {
    mocks.deleteRoot.mockResolvedValue({ ok: true, facts: 2, relations: 1, sources: 3 });
    const res = await routes().request(`/42/knowledge/scopes/${encodeURIComponent('pack:my-docs-1a2b3c4d')}`, { method: 'DELETE' }, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, facts: 2 });
    expect(mocks.deleteRoot).toHaveBeenCalledWith(expect.anything(), 'pack:my-docs-1a2b3c4d');
  });

  it('answers the use case’s refusal of a reviewed root with 400', async () => {
    mocks.deleteRoot.mockResolvedValue({ ok: false, status: 400, error: 'only an uploaded knowledge pack can be removed' });
    const res = await routes().request(`/42/knowledge/scopes/${encodeURIComponent('web:folder-1')}`, { method: 'DELETE' }, {});
    expect(res.status).toBe(400);
  });

  describe('who may remove or replace a pack (uploader, manager, superadmin)', () => {
    const pack = (uploadedBy: string) => ({ rootId: 'pack:x-1a2b3c4d', title: 'x', packs: [], provenance: { uploadedBy } });
    const remove = (r = routes()) => r.request('/42/knowledge/scopes/pack%3Ax-1a2b3c4d', { method: 'DELETE' }, {});
    const upload = (r = routes()) => r.request('/42/knowledge/write', post({ root: 'pack:x-1a2b3c4d', facts: [], relations: [] }), {});
    beforeEach(() => mocks.deleteRoot.mockResolvedValue({ ok: true, facts: 0, relations: 0, sources: 0 }));

    it('lets the uploader remove and replace their own pack', async () => {
      mocks.scopeRow.value = pack('u1');
      expect((await remove()).status).toBe(200);
      expect((await upload()).status).toBe(200);
    });

    it('refuses another developer, touching nothing', async () => {
      mocks.scopeRow.value = pack('someone-else');
      expect((await remove()).status).toBe(403);
      expect((await upload()).status).toBe(403);
      expect(mocks.deleteRoot).not.toHaveBeenCalled();
    });

    it('lets a manager remove and replace', async () => {
      mocks.role.value = TenantRole.MANAGER;
      mocks.scopeRow.value = pack('someone-else');
      expect((await remove()).status).toBe(200);
      expect((await upload()).status).toBe(200);
    });

    it('lets a superadmin remove and replace', async () => {
      mocks.superadmin.mockResolvedValue(true);
      mocks.scopeRow.value = pack('someone-else');
      expect((await remove()).status).toBe(200);
      expect((await upload()).status).toBe(200);
    });

    it.each([TenantRole.VIEWER, TenantRole.CONTRIBUTOR])('refuses a %s: remove (not the uploader) and upload', async (role) => {
      mocks.role.value = role;
      mocks.scopeRow.value = pack('someone-else');
      expect((await remove()).status).toBe(403);
      mocks.scopeRow.value = null;
      expect((await upload()).status).toBe(403);
    });

    it('refuses the host-key door (no person) for remove and upload', async () => {
      expect((await remove(hostRoutes())).status).toBe(403);
      expect((await upload(hostRoutes())).status).toBe(403);
      expect(mocks.deleteRoot).not.toHaveBeenCalled();
    });

    it('lets a developer upload a brand-new pack', async () => {
      expect((await upload()).status).toBe(200);
    });
  });

  it('refuses a root removal for a project outside the tenant', async () => {
    mocks.owned.mockResolvedValue(false);
    const res = await routes().request('/42/knowledge/scopes/pack%3Ax-1a2b3c4d', { method: 'DELETE' }, {});
    expect(res.status).toBe(404);
    expect(mocks.deleteRoot).not.toHaveBeenCalled();
  });

  it('refuses a hand-made, malformed pack root (too long, no hash) on remove and on write with 400 invalid_pack_root', async () => {
    const long = `pack:${'x'.repeat(200)}`;
    const del = await routes().request(`/42/knowledge/scopes/${encodeURIComponent(long)}`, { method: 'DELETE' }, {});
    expect(del.status).toBe(400);
    expect(await del.json()).toMatchObject({ code: 'invalid_pack_root' });
    const write = await routes().request('/42/knowledge/write', post({ root: long, facts: [] }), {});
    expect(write.status).toBe(400);
    expect(await write.json()).toMatchObject({ code: 'invalid_pack_root' });
    expect(mocks.deleteRoot).not.toHaveBeenCalled();
  });

  it('refuses a scope provenance string over 255 chars with 400', async () => {
    const scope = { rootId: 'pack:x-1', title: 'x', packs: [], provenance: { reviewedBy: 'a'.repeat(256) } };
    const res = await appWithErrors().request('/42/knowledge/write', post({ scope }), {});
    expect(res.status).toBe(400);
  });

  it('answers a write of more than 500 rows with 413', async () => {
    const res = await routes().request('/42/knowledge/write', post({ relations: Array.from({ length: 501 }, (_, i) => relation(i)) }), {});
    expect(res.status).toBe(413);
    expect(mocks.upsertRelations).not.toHaveBeenCalled();
  });

  it("answers origin 'extracted' with 400", async () => {
    const res = await routes().request('/42/knowledge/write', post({ relations: [{ ...relation(1), origin: 'extracted' }] }), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'extracted_not_stored' });
  });

  it('writes a bounded batch through the single writer', async () => {
    const res = await routes().request('/42/knowledge/write', post({ relations: [relation(1)] }), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, relationsWritten: 1 });
  });

  it('answers an analysis snapshot over 2 MB with 413, storing nothing', async () => {
    const snapshot = {
      version: 1, id: 's', capturedAt: '2026-10-28T00:00:00Z', source: {}, tools: [], edges: [], issues: [],
      nodes: Array.from({ length: 2200 }, (_, i) => `src/${String(i).padStart(4, '0')}/${'x'.repeat(1000)}.ts`),
    };
    const res = await routes().request('/42/code-analysis/abc123', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    }, {});
    expect(res.status).toBe(413);
    expect(mocks.putAnalysis).not.toHaveBeenCalled();
  });

  it('answers extracted output over 1 MB with 413', async () => {
    const big = [{ sourceRef: 'src:r::a.md', sourceHash: 'h', nodes: [], edges: [], keys: [{ ref: 'src:r::a.md', key: 'x'.repeat(400) }] }];
    const body = JSON.stringify(Array.from({ length: 3000 }, () => big[0]));
    const res = await routes().request('/42/knowledge/extracted/h1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body }, {});
    expect(res.status).toBe(413);
  });

  it('answers extracted output whose entries are not at the uploaded hash with 400, storing nothing', async () => {
    const put = vi.fn();
    mocks.ports.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
      env: {}, db, tenantId, projectId, store: { markRelationsStale: vi.fn() }, extracted: { get: vi.fn(async () => undefined), put },
    }));
    const entry = { sourceRef: 'src:r::a.md', sourceHash: 'other', nodes: [], edges: [], keys: [] };
    const res = await routes().request('/42/knowledge/extracted/h1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify([entry]) }, {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'source_hash_mismatch' });
    expect(put).not.toHaveBeenCalled();
  });
  it('tolerates an over-long ref: stores the rest, 200 with skippedRefs, and drops nothing valid', async () => {
    const put = vi.fn();
    const markRelationsStale = vi.fn(async () => 1);
    mocks.ports.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
      env: {}, db, tenantId, projectId, store: { markRelationsStale }, extracted: { get: vi.fn(async () => undefined), put },
    }));
    const long = 'src:r::' + 'x'.repeat(600); // a deep-path ref a producer emitted over the 512 bound
    const entry = {
      sourceRef: 'src:r::a.md', sourceHash: 'h1',
      nodes: [
        { ref: 'src:r::a.md', kind: 'file', label: 'a.md', pack: 'docs', importance: 0, origin: 'extracted' },
        { ref: long, kind: 'symbol', label: 'over-long', pack: 'docs', importance: 0, origin: 'extracted' },
      ],
      edges: [],
      keys: [{ ref: long, key: 'k' }],
    };
    const res = await routes().request('/42/knowledge/extracted/h1', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify([entry]) }, {});
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; hash: string; skippedRefs: number };
    expect(body).toMatchObject({ ok: true, hash: 'h1' });
    expect(body.skippedRefs).toBeGreaterThanOrEqual(1);
    // The stored object dropped the over-long node and key but kept the valid node.
    const stored = put.mock.calls[0]![1] as Array<{ nodes: Array<{ ref: string }>; keys: Array<{ ref: string }> }>;
    expect(stored[0]!.nodes.map((n) => n.ref)).toEqual(['src:r::a.md']);
    expect(stored[0]!.keys).toEqual([]);
  });

  it('answers a model relation on a source with no sourceHash with 400', async () => {
    const { sourceHash: _omit, ...unhashed } = relation(1);
    const res = await routes().request('/42/knowledge/write', post({ relations: [unhashed] }), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'missing_source_hash' });
    expect(mocks.upsertRelations).not.toHaveBeenCalled();
  });

  it('reports the facts a host key skipped because a person authored them', async () => {
    mocks.ports.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
      env: {}, db, tenantId, projectId,
      store: { upsertRelations: mocks.upsertRelations, factAuthor: vi.fn(async () => 'u7') },
      extracted: { setSource: vi.fn(), snapshotReview: vi.fn() },
    }));
    const res = await hostRoutes().request('/42/knowledge/write', post({ facts: [{ key: 'mine', content: 'c', fileAnchors: [] }] }), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, factsWritten: 0, factsSkipped: ['mine'] });
    expect(mocks.upsertFact).not.toHaveBeenCalled();
  });

  it('passes maxNodes through to the graph use case, which caps it', async () => {
    const res = await routes().request('/42/knowledge-graph?root=r&maxNodes=99999&focus=src%3Ar%3A%3Aa.md', {}, {});
    expect(res.status).toBe(200);
    expect(mocks.graph.mock.calls[0]![1]).toEqual({ rootId: 'r', focus: ['src:r::a.md'], maxNodes: 99999 });
  });

  it('answers an unknown root with 404', async () => {
    mocks.graph.mockResolvedValue(null);
    const res = await routes().request('/42/knowledge-graph?root=nope', {}, {});
    expect(res.status).toBe(404);
  });

  it('serves a root’s facts with their authors, and the viewer the delete rule sees', async () => {
    mocks.facts.mockResolvedValue([{ key: 'k1', content: 'c', source: 'knowledge', importance: 0.5, origin: 'human', fileAnchors: [], createdBy: 'u1' }]);
    const res = await routes().request('/42/knowledge/facts?root=r', {}, {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      facts: [{ key: 'k1', content: 'c', source: 'knowledge', importance: 0.5, origin: 'human', fileAnchors: [], createdBy: 'u1' }],
      viewer: { userId: 'u1', canAdmin: false },
    });
    expect(mocks.facts.mock.calls[0]![1]).toBe('r');
  });

  it('reports a superadmin viewer as an admin', async () => {
    mocks.facts.mockResolvedValue([]);
    mocks.superadmin.mockResolvedValueOnce(true);
    const res = await routes().request('/42/knowledge/facts?root=r', {}, {});
    expect(((await res.json()) as { viewer: unknown }).viewer).toEqual({ userId: 'u1', canAdmin: true });
  });

  it('answers facts of an unknown root with 404, and a missing root with 400', async () => {
    mocks.facts.mockResolvedValue(null);
    expect((await routes().request('/42/knowledge/facts?root=nope', {}, {})).status).toBe(404);
    expect((await routes().request('/42/knowledge/facts', {}, {})).status).toBe(400);
  });

  it('serves facts to a host key with no person and no admin', async () => {
    mocks.facts.mockResolvedValue([]);
    const res = await hostRoutes().request('/42/knowledge/facts?root=r', {}, {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { viewer: unknown }).viewer).toEqual({ userId: null, canAdmin: false });
    expect(mocks.superadmin).not.toHaveBeenCalled();
  });

  it('serves every knowledge route behind the host door', async () => {
    expect((await hostRoutes().request('/42/knowledge/scopes', {}, {})).status).toBe(200);
    expect((await hostRoutes().request('/42/knowledge-graph?root=r', {}, {})).status).toBe(200);
    expect((await hostRoutes().request('/42/knowledge/write', post({ relations: [relation(1)] }), {})).status).toBe(200);
  });

  describe('writer provenance', () => {
    const fact = (origin?: string) => ({ key: 'k', content: 'c', fileAnchors: [], ...(origin ? { origin } : {}) });

    it('records a person’s fact as human, authored by them', async () => {
      const res = await routes().request('/42/knowledge/write', post({ facts: [fact()] }), {});
      expect(res.status).toBe(200);
      expect((mocks.upsertFact.mock.calls[0] as unknown[])[7]).toMatchObject({ factOrigin: 'human', createdBy: 'u1' });
    });

    it('lets a person’s review write the model’s judgement, with no author', async () => {
      const res = await routes().request('/42/knowledge/write', post({ facts: [fact('model')] }), {});
      expect(res.status).toBe(200);
      expect((mocks.upsertFact.mock.calls[0] as unknown[])[7]).toMatchObject({ factOrigin: 'model', createdBy: null });
    });

    it("refuses a person claiming 'agent' with 400", async () => {
      const res = await routes().request('/42/knowledge/write', post({ facts: [fact('agent')] }), {});
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'origin_mismatch' });
      expect(mocks.upsertFact).not.toHaveBeenCalled();
    });

    it("refuses a host key claiming 'human' with 400, for a fact or a relation", async () => {
      const f = await hostRoutes().request('/42/knowledge/write', post({ facts: [fact('human')] }), {});
      expect(f.status).toBe(400);
      expect(await f.json()).toMatchObject({ code: 'origin_mismatch' });
      const r = await hostRoutes().request('/42/knowledge/write', post({ relations: [{ ...relation(1), origin: 'human' }] }), {});
      expect(r.status).toBe(400);
      expect(mocks.upsertFact).not.toHaveBeenCalled();
      expect(mocks.upsertRelations).not.toHaveBeenCalled();
    });

    it('records a host key’s fact as agent (or model), never authored', async () => {
      expect((await hostRoutes().request('/42/knowledge/write', post({ facts: [fact()] }), {})).status).toBe(200);
      expect((mocks.upsertFact.mock.calls[0] as unknown[])[7]).toMatchObject({ factOrigin: 'agent', createdBy: null });
      expect((await hostRoutes().request('/42/knowledge/write', post({ facts: [fact('model')] }), {})).status).toBe(200);
      expect((mocks.upsertFact.mock.calls[1] as unknown[])[7]).toMatchObject({ factOrigin: 'model', createdBy: null });
    });
  });

  describe('graph cache (§4.8): a hit, then a miss after a write', () => {
    it('serves the second GET from the cache and rebuilds after a POST write bumps the version', async () => {
      const real = await vi.importActual<typeof import('../../application/knowledge/getKnowledgeGraph')>('../../application/knowledge/getKnowledgeGraph');
      mocks.graph.mockImplementation(real.getKnowledgeGraph);
      mocks.version.n = 0;
      const facts = vi.fn(async () => []);
      const store = {
        scope: vi.fn(async () => ({ rootId: 'cache-root', title: 'Cache', packs: ['docs'], lastDigest: 'dg-cache' })),
        scopes: vi.fn(async () => []), facts, relations: vi.fn(async () => []),
        upsertRelations: mocks.upsertRelations, factAuthor: vi.fn(async () => undefined),
      };
      mocks.ports.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
        env: {}, db, tenantId, projectId, store,
        extracted: { setSource: vi.fn(), snapshotReview: vi.fn(), rootExtracted: vi.fn(async () => []) },
        graph: {
          cacheEnv: undefined, tenantId, projectId, store,
          extracted: { rootExtracted: vi.fn(async () => []) },
          analysis: { latest: vi.fn(async () => null) },
          repo: { linked: async () => null },
          version: async () => `cache-v${mocks.version.n}`,
        },
        index: {},
      }));
      const get = () => routes().request('/4242/knowledge-graph?root=cache-root', {}, {});

      expect((await get()).status).toBe(200);
      expect((await get()).status).toBe(200);
      expect(facts).toHaveBeenCalledTimes(1); // second read is a cache hit

      const w = await routes().request('/4242/knowledge/write', post({ relations: [relation(1)] }), {});
      expect(w.status).toBe(200);
      expect(mocks.bump).toHaveBeenCalledTimes(1);

      expect((await get()).status).toBe(200);
      expect(facts).toHaveBeenCalledTimes(2); // new version token = miss
    });
  });

  describe('model-claim privacy (§5.2)', () => {
    it('clamps a model claim to 3 lines before it reaches the fact upsert', async () => {
      const content = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
      const res = await routes().request('/42/knowledge/write', post({ facts: [{ key: 'claim:big', content, fileAnchors: [], origin: 'model' }] }), {});
      expect(res.status).toBe(200);
      expect((mocks.upsertFact.mock.calls[0] as unknown[])[5]).toBe('l1\nl2\nl3');
    });
  });
});

describe('POST /:projectId/knowledge/judge — clientResult (PRD 42 Part D)', () => {
  const items = [{ ref: 'src:a', text: 'Alpha asserts X.', sourceHash: 'h1' }];
  const provenance = { engine: 'webllm', model: 'Qwen-0.5B' };

  it('hands a valid clientResult to the use case, with the usage db', async () => {
    mocks.judge.mockResolvedValue({ extract: [], invalid: 0 });
    const clientResult = { json: { extract: [{ ref: 'src:a', claims: [], entities: [] }] }, provenance };
    const res = await appWithErrors().request('/42/knowledge/judge', post({ kind: 'extract', items, clientResult }), {});
    expect(res.status).toBe(200);
    expect(mocks.judge).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, projectId: 42, db }),
      { kind: 'extract', items },
      { value: clientResult.json, provenance },
    );
  });

  it('answers 400 invalid_client_result when the envelope does not match the request kind', async () => {
    const res = await appWithErrors().request('/42/knowledge/judge', post({ kind: 'extract', items, clientResult: { json: { compare: [] }, provenance } }), {});
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_client_result', reason: 'json_invalid' });
    expect(mocks.judge).not.toHaveBeenCalled();
  });

  it('is unchanged without a clientResult: no client argument', async () => {
    mocks.judge.mockResolvedValue({ extract: [], invalid: 0 });
    await appWithErrors().request('/42/knowledge/judge', post({ kind: 'extract', items }), {});
    expect(mocks.judge).toHaveBeenCalledWith(expect.anything(), { kind: 'extract', items }, undefined);
  });
});

describe('POST /:projectId/knowledge/extracted/bulk', () => {
  it('returns the entries for known hashes and null for unknown ones, one miss not failing the batch', async () => {
    const entries = [{ sourceRef: 'src:r::a.md', sourceHash: 'h1', nodes: [], edges: [], keys: [] }];
    const get = vi.fn(async (hash: string) => (hash === 'h1' ? entries : undefined));
    mocks.ports.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
      env: {}, db, tenantId, projectId,
      store: {},
      extracted: { get, setSource: vi.fn(), snapshotReview: vi.fn() },
      graph: { repo: { linked: async () => null } },
      index: {},
    }));
    const res = await routes().request('/42/knowledge/extracted/bulk', post({ hashes: ['h1', 'h2'] }), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ extracted: [{ hash: 'h1', entries }, { hash: 'h2', entries: null }] });
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('tolerates a ports mock without extracted.get, answering null entries', async () => {
    // The default beforeEach mock only gives extracted: { setSource, snapshotReview } —
    // one unknown hash must not fail the batch.
    const res = await routes().request('/42/knowledge/extracted/bulk', post({ hashes: ['h1'] }), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ extracted: [{ hash: 'h1', entries: null }] });
  });

  it('answers 400 for an invalid hash', async () => {
    const res = await appWithErrors().request('/42/knowledge/extracted/bulk', post({ hashes: ['bad hash!'] }), {});
    expect(res.status).toBe(400);
  });

  it('answers 400 for an empty or over-500 batch', async () => {
    expect((await appWithErrors().request('/42/knowledge/extracted/bulk', post({ hashes: [] }), {})).status).toBe(400);
    expect((await appWithErrors().request('/42/knowledge/extracted/bulk', post({ hashes: Array.from({ length: 501 }, (_, i) => `h${i}`) }), {})).status).toBe(400);
  });

  it('answers a body declaring more than 4× the extracted bound with 413, before parsing', async () => {
    // The 4× bound is a generous DoS guard: 500 hashes of ≤160 chars can never reach it from a
    // schema-valid body, so the refusal path is the DECLARED content-length — a real oversized
    // upload is refused before it is ever read.
    const res = await routes().request('/42/knowledge/extracted/bulk', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(4 * 1024 * 1024 + 1) },
      body: JSON.stringify({ hashes: ['h1'] }),
    }, {});
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'payload_too_large' });
  });

  it('works behind the host door', async () => {
    mocks.ports.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
      env: {}, db, tenantId, projectId,
      store: {},
      extracted: { get: vi.fn(async () => [{ sourceRef: 'src:r::a.md', sourceHash: 'h1', nodes: [], edges: [], keys: [] }]), setSource: vi.fn(), snapshotReview: vi.fn() },
      graph: { repo: { linked: async () => null } },
      index: {},
    }));
    const res = await hostRoutes().request('/42/knowledge/extracted/bulk', post({ hashes: ['h1'] }), {});
    expect(res.status).toBe(200);
    expect(((await res.json()) as { extracted: unknown[] }).extracted).toHaveLength(1);
  });

  it('does not bump the knowledge version on a read', async () => {
    mocks.version.n = 0;
    mocks.ports.mockImplementation((_e: unknown, _d: unknown, tenantId: number, projectId: number) => ({
      env: {}, db, tenantId, projectId,
      store: {},
      extracted: { get: vi.fn(async () => []), setSource: vi.fn(), snapshotReview: vi.fn() },
      graph: { repo: { linked: async () => null } },
      index: {},
    }));
    const res = await routes().request('/42/knowledge/extracted/bulk', post({ hashes: ['h1'] }), {});
    expect(res.status).toBe(200);
    expect(mocks.bump).not.toHaveBeenCalled();
  });
});

describe('GET /knowledge/judge/estimate (the confirm chip’s ≈ cost)', () => {
  it('refuses a project outside the caller’s tenant before estimating', async () => {
    mocks.owned.mockResolvedValue(false);
    const res = await routes().request('/42/knowledge/judge/estimate', {}, {});
    expect(res.status).toBe(404);
    expect(mocks.judgeCost).not.toHaveBeenCalled();
  });

  it('answers the use case’s estimate for the caller’s tenant and project, on both doors', async () => {
    mocks.judgeCost.mockResolvedValue({ perCallUsd: 0.0021, model: 'anthropic/claude-haiku-5-5', local: false });
    for (const app of [routes(), hostRoutes()]) {
      const res = await app.request('/42/knowledge/judge/estimate', {}, {});
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ perCallUsd: 0.0021, model: 'anthropic/claude-haiku-5-5', local: false });
    }
    expect(mocks.judgeCost).toHaveBeenCalledWith(expect.anything(), TENANT);
  });
});
