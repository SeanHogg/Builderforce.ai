/**
 * The knowledge routes (PRD 38 §4.8): tenancy is refused before any port exists, the
 * write and upload bounds answer 413/400, and `maxNodes` reaches the use case capped.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TenantRole } from '../../domain/shared/types';

const TENANT = 8;
const mocks = vi.hoisted(() => ({
  owned: vi.fn(),
  ports: vi.fn(),
  graph: vi.fn(),
  putAnalysis: vi.fn(async () => undefined),
  upsertRelations: vi.fn(async (rows: unknown[]) => rows.length),
  scopes: vi.fn(async () => []),
  facts: vi.fn(),
  superadmin: vi.fn(async () => false),
  upsertFact: vi.fn(async () => true),
  judgeCost: vi.fn(),
  version: { n: 0 },
  bump: vi.fn(async () => { mocks.version.n += 1; }),
}));

vi.mock('../middleware/authMiddleware', () => ({
  authMiddleware: async (c: any, next: any) => { c.set('tenantId', TENANT); c.set('userId', 'u1'); c.set('role', TenantRole.DEVELOPER); await next(); },
}));
vi.mock('../../application/project/projectOwnership', () => ({ projectInTenantCached: mocks.owned }));
vi.mock('../../application/knowledge/knowledgeComposition', () => ({ knowledgePortsFor: mocks.ports }));
vi.mock('../../application/knowledge/knowledgeVersion', () => ({ bumpKnowledgeVersion: mocks.bump, knowledgeVersion: vi.fn() }));
vi.mock('../../application/knowledge/knowledgePerception', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/knowledge/knowledgePerception')>()),
  putAnalysisSnapshot: mocks.putAnalysis,
}));
vi.mock('../../application/knowledge/listKnowledge', () => ({ listKnowledgeScopes: mocks.scopes, listKnowledgeFacts: mocks.facts }));
vi.mock('../../application/knowledge/judgeCostEstimate', () => ({ judgeCostFor: mocks.judgeCost }));
vi.mock('../../infrastructure/auth/superadminFlag', () => ({ resolveIsSuperadmin: mocks.superadmin }));
vi.mock('../../application/llm/projectFactsWrite', () => ({ upsertProjectFact: mocks.upsertFact, deleteProjectFact: vi.fn() }));
vi.mock('../../application/knowledge/getKnowledgeGraph', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../application/knowledge/getKnowledgeGraph')>()),
  getKnowledgeGraph: mocks.graph,
}));

import { createProjectKnowledgeRoutes } from './projectKnowledgeRoutes';
import type { FrontDoor } from '../middleware/frontDoor';

const db = {} as never;
const routes = () => createProjectKnowledgeRoutes(db);
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
  mocks.ports.mockImplementation((_env: unknown, _db: unknown, tenantId: number, projectId: number) => ({
    env: {}, db, tenantId, projectId,
    store: { upsertRelations: mocks.upsertRelations, scopes: vi.fn(async () => []), factAuthor: vi.fn(async () => undefined) },
    extracted: { setSource: vi.fn(), snapshotReview: vi.fn() },
    graph: { repo: { linked: async () => ({ rootId: 'cloud:r1:' }) } },
    index: {},
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
    expect(mocks.judgeCost).toHaveBeenCalledWith(expect.anything(), TENANT, 42);
  });
});
