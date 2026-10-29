import { describe, expect, it } from 'vitest';
import type { StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { createKnowledgeClient, MAX_WRITE_ROWS } from './client.js';
import { KnowledgeApiError } from './types.js';

interface Seen { path: string; method: string; body: unknown }

function fakeFetch(respond: (path: string, init?: RequestInit) => Response = () => json({ ok: true })) {
  const seen: Seen[] = [];
  const fetch = async (path: string, init?: RequestInit): Promise<Response> => {
    seen.push({ path, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return respond(path, init);
  };
  return { fetch, seen };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fact = (i: number): StoredFact => ({ key: `claim:${i}`, content: `c${i}`, source: 'knowledge-review', importance: 0.5, origin: 'model', fileAnchors: [] });
const relation = (i: number): StoredRelation => ({ from: `fact:claim:${i}`, to: 'src:r::a.md', kind: 'about', weight: 1, origin: 'model' });
const scope = { rootId: 'r', title: 'R', packs: ['docs'], lastDigest: 'd1' };

describe('createKnowledgeClient', () => {
  it('chunks a write into batches of at most 500 rows, scope on the last one only', async () => {
    const { fetch, seen } = fakeFetch();
    const client = createKnowledgeClient({ fetch, projectId: 12 });
    await client.store.write({
      scope,
      facts: Array.from({ length: 700 }, (_, i) => fact(i)),
      relations: Array.from({ length: 350 }, (_, i) => relation(i)),
    });
    expect(seen.map((s) => s.path)).toEqual(Array(3).fill('/api/projects/12/knowledge/write'));
    const sizes = seen.map((s) => {
      const b = s.body as { facts: unknown[]; relations: unknown[] };
      return b.facts.length + b.relations.length;
    });
    expect(sizes).toEqual([MAX_WRITE_ROWS, MAX_WRITE_ROWS, 50]);
    expect(seen.map((s) => 'scope' in (s.body as object))).toEqual([false, false, true]);
  });

  it('sends a scope-only write as one call', async () => {
    const { fetch, seen } = fakeFetch();
    await createKnowledgeClient({ fetch, projectId: 1 }).store.write({ scope, facts: [], relations: [] });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.body).toMatchObject({ scope, facts: [], relations: [] });
  });

  it('marks stale through the single writer', async () => {
    const { fetch, seen } = fakeFetch();
    await createKnowledgeClient({ fetch, projectId: 3 }).store.markStale({ rootId: 'r' }, 'src:r::a.md', 'h2');
    expect(seen[0]).toEqual({
      path: '/api/projects/3/knowledge/write', method: 'POST',
      body: { facts: [], relations: [], stale: [{ sourceRef: 'src:r::a.md', currentHash: 'h2' }] },
    });
  });

  it('maps extracted get/put to the hash routes, a 404 to undefined', async () => {
    const { fetch, seen } = fakeFetch((path, init) =>
      init?.method === 'PUT' ? json({ ok: true }) : path.endsWith('/h1') ? json({ extracted: [] }) : json({ error: 'not found' }, 404));
    const client = createKnowledgeClient({ fetch, projectId: 5 });
    await client.store.putExtracted!('h1', []);
    expect(await client.store.getExtracted!('h1')).toEqual([]);
    expect(await client.store.getExtracted!('h2')).toBeUndefined();
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'PUT /api/projects/5/knowledge/extracted/h1',
      'GET /api/projects/5/knowledge/extracted/h1',
      'GET /api/projects/5/knowledge/extracted/h2',
    ]);
  });

  it('maps a server error to KnowledgeApiError with its code', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'too many', code: 'too_many_rows' }, 413));
    const err = await createKnowledgeClient({ fetch, projectId: 1 }).putAnalysis('abc', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KnowledgeApiError);
    expect(err).toMatchObject({ status: 413, code: 'too_many_rows', message: 'too many' });
  });

  it('maps a network failure to KnowledgeApiError(0, network)', async () => {
    const client = createKnowledgeClient({ fetch: async () => { throw new Error('offline'); }, projectId: 1 });
    await expect(client.scopes()).rejects.toMatchObject({ status: 0, code: 'network' });
  });

  it('builds the graph query and returns null for an unknown root', async () => {
    const { fetch, seen } = fakeFetch(() => json({ error: 'unknown knowledge root' }, 404));
    const g = await createKnowledgeClient({ fetch, projectId: 9 }).graph('vscode:r:', { focus: ['src:a', 'src:b'], maxNodes: 60 });
    expect(g).toBeNull();
    expect(seen[0]!.path).toBe('/api/projects/9/knowledge-graph?root=vscode%3Ar%3A&focus=src%3Aa&focus=src%3Ab&maxNodes=60');
  });

  it('asks for the graph at a past review digest, and lists a scope’s previous digest', async () => {
    const { fetch, seen } = fakeFetch((path) => (path.endsWith('/knowledge/scopes')
      ? json({ scopes: [{ ...scope, lastDigest: 'd2', previousDigest: 'd1' }] })
      : json({ graph: { scope: { rootId: 'r', packs: ['docs'], digest: 'g1' }, nodes: [], edges: [], findings: [], stats: {} } })));
    const client = createKnowledgeClient({ fetch, projectId: 9 });
    const [listed] = await client.scopes();
    expect(listed?.previousDigest).toBe('d1');
    const g = await client.graph('r', { at: listed!.previousDigest! });
    expect(g?.scope.digest).toBe('g1');
    expect(seen[1]!.path).toBe('/api/projects/9/knowledge-graph?root=r&at=d1');
  });

  it('searches and deletes facts on their routes', async () => {
    const { fetch, seen } = fakeFetch((path) => (path.includes('/search') ? json({ hits: [{ id: 'x', score: 1, tier: 'exact' }] }) : json({ ok: true })));
    const client = createKnowledgeClient({ fetch, projectId: 2 });
    expect(await client.search('r', 'billing', 5)).toEqual([{ id: 'x', score: 1, tier: 'exact' }]);
    await client.deleteFact('claim:a b');
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET /api/projects/2/knowledge/search?root=r&q=billing&k=5',
      'DELETE /api/projects/2/facts/claim%3Aa%20b',
    ]);
  });

  it('puts every route under the basePath it is given (the agent-host door on-prem)', async () => {
    const { fetch, seen } = fakeFetch((path) => (path.includes('/knowledge/scopes') ? json({ scopes: [] }) : json({ ok: true })));
    const client = createKnowledgeClient({ fetch, projectId: 7, basePath: '/api/agent/projects/' });
    await client.scopes();
    await client.deleteFact('k');
    expect(seen.map((s) => s.path)).toEqual(['/api/agent/projects/7/knowledge/scopes', '/api/agent/projects/7/facts/k']);
  });

  it('defaults to the tenant door', async () => {
    const { fetch, seen } = fakeFetch(() => json({ scopes: [] }));
    await createKnowledgeClient({ fetch, projectId: 7 }).scopes();
    expect(seen[0]!.path).toBe('/api/projects/7/knowledge/scopes');
  });

  it('reads facts with their author from the facts route, and the viewer', async () => {
    const stored = [{ ...fact(1), origin: 'human', createdBy: 'u1' }, { ...fact(2), createdBy: null }, fact(3)];
    const { fetch, seen } = fakeFetch(() => json({ facts: stored, viewer: { userId: 'u1', canAdmin: false } }));
    const client = createKnowledgeClient({ fetch, projectId: 4 });
    const out = await client.facts('vscode:r:');
    expect(seen[0]!.path).toBe('/api/projects/4/knowledge/facts?root=vscode%3Ar%3A');
    expect(out?.viewer).toEqual({ userId: 'u1', canAdmin: false });
    expect(out?.facts.map((f) => [f.key, f.origin, f.createdBy])).toEqual([
      ['claim:1', 'human', 'u1'], ['claim:2', 'model', null], ['claim:3', 'model', null],
    ]);
    const viaStore = await client.store.facts({ rootId: 'vscode:r:' });
    expect(viaStore.map((f) => f.createdBy)).toEqual(['u1', null, null]);
    expect(seen.map((s) => s.path).every((p) => p.includes('/knowledge/facts?'))).toBe(true);
  });

  it('answers an unknown root with null facts, and an empty list through the store', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'unknown knowledge root' }, 404));
    const client = createKnowledgeClient({ fetch, projectId: 4 });
    expect(await client.facts('nope')).toBeNull();
    expect(await client.store.facts({ rootId: 'nope' })).toEqual([]);
  });

  it('reads the judge estimate from the project’s door, keeping a null price and a local flag', async () => {
    const { fetch, seen } = fakeFetch(() => json({ perCallUsd: null, model: 'ollama/llama3', local: true }));
    const out = await createKnowledgeClient({ fetch, projectId: 5, basePath: '/api/agent/projects' }).judgeEstimate();
    expect(seen).toEqual([{ path: '/api/agent/projects/5/knowledge/judge/estimate', method: 'GET', body: undefined }]);
    expect(out).toEqual({ perCallUsd: null, model: 'ollama/llama3', local: true });
  });

  it('normalises a malformed estimate to "unknown, not local" and maps an error status', async () => {
    const bad = await createKnowledgeClient({ ...fakeFetch(() => json({ perCallUsd: -1, local: 'yes' })), projectId: 1 }).judgeEstimate();
    expect(bad).toEqual({ perCallUsd: null, model: null, local: false });
    const failing = createKnowledgeClient({ ...fakeFetch(() => json({ error: 'nope', code: 'x' }, 500)), projectId: 1 });
    await expect(failing.judgeEstimate()).rejects.toBeInstanceOf(KnowledgeApiError);
  });
});
