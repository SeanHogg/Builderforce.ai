import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filesManifestKey, type DirectorySource, type ScopeRecord } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeClient } from '@builderforce/knowledge-client';
import type { KnowledgeReviewEvent, ReviewControl } from '@builderforce/knowledge-graph-view';
import { createKnowledgeSource, type DirectoryProvider } from './knowledgeSource';

const env = vi.hoisted(() => ({ idb: undefined as unknown }));

// Storage: the real IndexedDB-backed knowledge over fake-indexeddb, or (idb undefined) the real in-memory fallback.
vi.mock('./browserKnowledge', async (original) => {
  const actual = await original<typeof import('./browserKnowledge')>();
  return { ...actual, openBrowserKnowledge: (report: never) => actual.openBrowserKnowledge(report, env.idb ? { idb: env.idb as IDBFactory } : {}) };
});
// The review's compute runs in-thread; this stands for it: it writes the LOCAL store the way a review does.
vi.mock('./reviewWorkerClient', () => ({
  runReview: vi.fn(async (job: { mode: string }, ports: import('./reviewJob').ReviewPorts) => {
    if (job.mode === 'plan') return { rootId: 'r', files: 1, byPack: { docs: 1 }, unchanged: 0, changed: ['a.md'], removed: [], skipped: [], estimatedModelCalls: 0 };
    const scope = { rootId: 'r', title: 'r', packs: ['docs'], lastDigest: 'dg1', lastReviewedAt: '2026-11-08T00:00:00Z' } as ScopeRecord;
    await ports.store.write({ scope, facts: [], relations: [] });
    // A whole extraction (nodes, edges, keys): the pack encoder counts them.
    await ports.store.putExtracted!('h1', [{ sourceRef: 'src:r::a.md', sourceHash: 'h1', nodes: [], edges: [], keys: [] }]);
    await ports.manifest.set(filesManifestKey('r'), [{ id: 'a.md', hash: 'h1' }]);
    return { rootId: 'r', unjudged: 0, aborted: false };
  }),
}));

const dir: DirectorySource = { rootId: 'r', title: 'r', async *list() { /* unused */ }, read: async () => { throw new Error('unused'); } };
const provider: DirectoryProvider = { id: 'upload', kind: 'upload', open: async () => dir };
const ctl: ReviewControl = { confirm: async () => true, signal: new AbortController().signal };

function fakeClient() {
  return {
    scopes: vi.fn(async () => []),
    graph: vi.fn(async () => null),
    facts: vi.fn(async () => ({ facts: [] })),
    search: vi.fn(async () => []),
    judgement: {},
    sync: vi.fn(async () => ({ applied: true, generation: 1, digest: 'd' })),
    syncManifest: vi.fn(async () => ({ generation: 0, digest: '', buckets: [] })),
    syncGeneration: vi.fn(async () => ({ generation: 0, digest: '' })),
    syncLeaves: vi.fn(async () => ({ generation: 0, leaves: [] })),
    syncHave: vi.fn(async () => []),
    writeRows: vi.fn(async (_rootId: string, _rows: unknown) => undefined),
    putExtracted: vi.fn(),
    store: { write: vi.fn(), putExtracted: vi.fn(), getExtracted: vi.fn(async () => undefined), preloadExtracted: vi.fn(), relations: vi.fn(async () => []) },
  };
}

async function review(source: ReturnType<typeof createKnowledgeSource>): Promise<KnowledgeReviewEvent[]> {
  await source.targets!();
  const out: KnowledgeReviewEvent[] = [];
  for await (const e of source.review!({ target: 'upload' }, ctl)) out.push(e);
  return out;
}

beforeEach(() => { env.idb = new IDBFactory(); });

describe('browser knowledge source: ONE upload path (the pack)', () => {
  it('reviews into the local store; only the pump talks to the server, with a pack', async () => {
    const client = fakeClient();
    const source = createKnowledgeSource({ projectId: 7, client: client as unknown as KnowledgeClient, directorySources: async () => [provider], onDegraded: vi.fn() });
    const events = await review(source);
    expect(events.at(-1)).toMatchObject({ type: 'done', rootId: 'r' });
    expect(client.sync).toHaveBeenCalled();
    expect(client.putExtracted).not.toHaveBeenCalled();
    expect(client.store.putExtracted).not.toHaveBeenCalled();
    expect(client.store.write).not.toHaveBeenCalled();
    await source.dispose();
  });

  it('remembers a fact through the pump endpoint (writeRows), not the replicated store', async () => {
    const client = fakeClient();
    const source = createKnowledgeSource({ projectId: 7, client: client as unknown as KnowledgeClient, directorySources: async () => [provider], onDegraded: vi.fn() });
    await source.rememberFact!({ content: 'We chose X.', ref: 'src:r::a.md', rootId: 'r' } as never);
    expect(client.writeRows).toHaveBeenCalledTimes(1);
    expect(client.writeRows.mock.calls[0]![0]).toBe('r');
    expect(client.store.write).not.toHaveBeenCalled();
    await source.dispose();
  });

  it('reviews a root adopted from a server-reviewed manifest (no local rows) through to done', async () => {
    // A root reviewed against the server before the local store existed: manifest entries (version 1 record), no rows.
    env.idb = new IDBFactory();
    const { openBrowserKnowledge } = await vi.importActual<typeof import('./browserKnowledge')>('./browserKnowledge');
    const seeded = await openBrowserKnowledge(vi.fn(), { idb: env.idb as IDBFactory });
    await seeded.manifest.set(filesManifestKey('r'), [{ id: 'a.md', hash: 'h1' }]);
    seeded.close();
    const adopted = createKnowledgeSource({ projectId: 7, client: fakeClient() as unknown as KnowledgeClient, directorySources: async () => [provider], onDegraded: vi.fn() });
    expect((await review(adopted)).at(-1)).toMatchObject({ type: 'done' });
    await adopted.dispose();
  });

  it('falls back to memory when IndexedDB is unavailable: reported, never thrown', async () => {
    env.idb = undefined;
    const onDegraded = vi.fn();
    const source = createKnowledgeSource({ projectId: 7, client: fakeClient() as unknown as KnowledgeClient, directorySources: async () => [provider], onDegraded });
    const events = await review(source);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    expect(onDegraded).toHaveBeenCalledWith('knowledge storage', expect.anything());
    await source.dispose();
  });
});
