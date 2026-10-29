import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { srcRef, type DirectorySource, type KnowledgeGraph, type KNode, type ReviewPlan } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeClient } from '@builderforce/knowledge-client';
import type { KnowledgeReviewEvent, ReviewControl } from '@builderforce/knowledge-graph-view';
import { createKnowledgeSource, type DirectoryProvider } from './knowledgeSource';
import { LIVE_DEBOUNCE_MS } from './liveWatch';

const ROOT = 'web:vfs:7';

// The review itself runs in a worker against IndexedDB; these tests are about what the SOURCE
// does around it (the estimate, which directory Live watches), so the two are stubs.
vi.mock('./reviewWorkerClient', () => ({
  runReview: vi.fn(async (job: { mode: string }) => (job.mode === 'plan'
    ? { rootId: 'web:vfs:7', files: 2, byPack: { docs: 2 }, unchanged: 0, changed: ['a.md'], removed: [], skipped: [], estimatedModelCalls: 4 } satisfies ReviewPlan
    : { rootId: 'web:vfs:7', unjudged: 0, aborted: false })),
}));
vi.mock('./manifestStore', () => ({ openManifest: vi.fn(async () => ({})) }));

function graph(): KnowledgeGraph {
  const nodes = ['a.md', 'b.md'].map((path) => ({ ref: srcRef(ROOT, path), kind: 'file', label: path, pack: 'docs', importance: 0.5, origin: 'extracted' }) as KNode);
  return {
    scope: { rootId: ROOT, packs: ['docs'], digest: 'd' }, nodes, edges: [], findings: [],
    stats: { sources: 2, nodes: 2, edges: 0, stale: 0, truncated: false },
  } as KnowledgeGraph;
}

/** A directory whose watcher the test can fire. */
function watchable() {
  const stop = vi.fn();
  let fire: (paths: string[]) => void = () => undefined;
  const dir: DirectorySource = {
    rootId: ROOT,
    title: 'workspace',
    async *list() { /* unused */ },
    read: async () => { throw new Error('unused'); },
    watch: (cb) => { fire = cb; return stop; },
  };
  return { dir, stop, fire: (paths: string[]) => fire(paths) };
}

const client = {
  scopes: vi.fn(async () => []),
  graph: vi.fn(async () => graph()),
  search: vi.fn(async () => []),
  store: {},
  judgement: {},
} as unknown as KnowledgeClient;

const provider = (extra: Partial<DirectoryProvider> = {}): DirectoryProvider => ({ id: 'workspace', kind: 'workspace', open: vi.fn(async () => null), ...extra });

async function drain(iterable: AsyncIterable<KnowledgeReviewEvent>): Promise<KnowledgeReviewEvent[]> {
  const out: KnowledgeReviewEvent[] = [];
  for await (const e of iterable) out.push(e);
  return out;
}

describe('browser knowledge source: Live', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('re-opens a root reviewed in an earlier session through its provider and overlays what changed', async () => {
    const { dir, fire } = watchable();
    const reopen = vi.fn(async (id: string) => (id === ROOT ? dir : null));
    const p = provider({ reopen });
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [p], onDegraded: vi.fn() });
    const seen: KnowledgeGraph[] = [];
    source.subscribeLive!(ROOT, (g) => seen.push(g));
    await vi.advanceTimersByTimeAsync(0);
    expect(reopen).toHaveBeenCalledWith(ROOT);
    expect(p.open).not.toHaveBeenCalled();

    fire(['a.md']);
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.nodes.find((n) => n.label === 'a.md')!.badges).toMatchObject({ changed: 1 });
    expect(seen[0]!.nodes.find((n) => n.label === 'b.md')!.badges).toBeUndefined();
  });

  it('debounces a burst of writes into one refresh', async () => {
    const { dir, fire } = watchable();
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [provider({ reopen: async () => dir })], onDegraded: vi.fn() });
    const cb = vi.fn();
    source.subscribeLive!(ROOT, cb);
    await vi.advanceTimersByTimeAsync(0);
    fire(['a.md']);
    await vi.advanceTimersByTimeAsync(100);
    fire(['b.md']);
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(client.graph).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('watches the directory a review opened this session, without re-opening it', async () => {
    const { dir, fire } = watchable();
    const reopen = vi.fn(async () => null);
    const p = provider({ open: async () => dir, reopen });
    const ctl: ReviewControl = { confirm: async () => true, signal: new AbortController().signal };
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [p], onDegraded: vi.fn() });
    await source.targets!();
    await drain(source.review!({ target: 'workspace' }, ctl));
    const cb = vi.fn();
    source.subscribeLive!(ROOT, cb);
    await vi.advanceTimersByTimeAsync(0);
    expect(reopen).not.toHaveBeenCalled();
    fire(['a.md']);
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when no provider can re-open the root (a picked folder has no Live)', async () => {
    const onDegraded = vi.fn();
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [provider()], onDegraded });
    const cb = vi.fn();
    const stop = source.subscribeLive!(ROOT, cb);
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(cb).not.toHaveBeenCalled();
    expect(onDegraded).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('stops the watcher on unsubscribe, and never starts one unsubscribed before the re-open lands', async () => {
    const live = watchable();
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [provider({ reopen: async () => live.dir })], onDegraded: vi.fn() });
    const stop = source.subscribeLive!(ROOT, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    stop();
    expect(live.stop).toHaveBeenCalledTimes(1);

    const early = watchable();
    const other = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [provider({ reopen: async () => early.dir })], onDegraded: vi.fn() });
    const cancel = other.subscribeLive!(ROOT, vi.fn());
    cancel();
    await vi.advanceTimersByTimeAsync(0);
    early.fire(['a.md']);
    await vi.advanceTimersByTimeAsync(LIVE_DEBOUNCE_MS + 1);
    expect(early.stop).not.toHaveBeenCalled();
    expect(client.graph).not.toHaveBeenCalled();
  });

  it('reports a re-open that throws and carries on without Live', async () => {
    const onDegraded = vi.fn();
    const source = createKnowledgeSource({
      projectId: 7,
      client,
      onDegraded,
      directorySources: async () => [provider({ reopen: async () => { throw new Error('gone'); } })],
    });
    source.subscribeLive!(ROOT, vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(onDegraded).toHaveBeenCalledWith('reopen root', expect.any(Error), { rootId: ROOT });
  });
});

describe('browser knowledge source: the confirm chip estimate', () => {
  const dir = (): DirectorySource => ({ rootId: ROOT, title: 'workspace', async *list() { /* unused */ }, read: async () => { throw new Error('unused'); } });

  async function planEvent(callPriceUsd?: () => number | undefined) {
    const confirmed: unknown[] = [];
    const ctl: ReviewControl = { confirm: async (_plan, estimate) => { confirmed.push(estimate); return false; }, signal: new AbortController().signal };
    const source = createKnowledgeSource({
      projectId: 7,
      client,
      onDegraded: vi.fn(),
      ...(callPriceUsd ? { callPriceUsd } : {}),
      directorySources: async () => [provider({ open: async () => dir() })],
    });
    await source.targets!();
    const events = await drain(source.review!({ target: 'workspace' }, ctl));
    return { plan: events.find((e) => e.type === 'plan') as Extract<KnowledgeReviewEvent, { type: 'plan' }>, confirmed };
  }

  it("prices the plan's model calls with the host's per-call price", async () => {
    const { plan, confirmed } = await planEvent(() => 0.02);
    expect(plan.estimate).toEqual({ modelCalls: 4, costUsd: 0.08 });
    expect(confirmed).toEqual([{ modelCalls: 4, costUsd: 0.08 }]);
  });

  it('carries only the calls when the host has no price', async () => {
    expect((await planEvent()).plan.estimate).toEqual({ modelCalls: 4 });
    expect((await planEvent(() => undefined)).plan.estimate).toEqual({ modelCalls: 4 });
  });
});
