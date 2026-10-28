import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeClient } from '@builderforce/knowledge-client';
import type { KnowledgeReviewEvent, ReviewControl } from '@builderforce/knowledge-graph-view';
import { createKnowledgeSource, type DirectoryProvider } from './knowledgeSource';

const client = {
  scopes: vi.fn(async () => [{ rootId: 'rovr:folder:contracts', title: 'contracts', packs: ['docs'], lastReviewedAt: '2026-10-01' }]),
  graph: vi.fn(async () => null),
  search: vi.fn(async () => [{ id: 'src:r::a.md', score: 0.9, tier: 'bm25' }]),
  store: {},
  judgement: {},
  deleteFact: vi.fn(),
} as unknown as KnowledgeClient;

const ctl: ReviewControl = { confirm: async () => true, signal: new AbortController().signal } as ReviewControl;

async function events(iterable: AsyncIterable<KnowledgeReviewEvent>): Promise<KnowledgeReviewEvent[]> {
  const out: KnowledgeReviewEvent[] = [];
  for await (const e of iterable) out.push(e);
  return out;
}

function provider(id: string, kind: DirectoryProvider['kind'], extra: Partial<DirectoryProvider> = {}): DirectoryProvider {
  return { id, kind, open: vi.fn(async () => null), ...extra };
}

describe('browser knowledge source', () => {
  it('lists scopes and targets, and maps search hits', async () => {
    const folder = provider('folder', 'folder');
    const upload = provider('upload', 'upload');
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [folder, upload], onDegraded: vi.fn() });
    expect(await source.scopes()).toEqual([{ rootId: 'rovr:folder:contracts', title: 'contracts', packs: ['docs'], lastReviewedAt: '2026-10-01' }]);
    expect(await source.targets!()).toEqual([{ id: 'folder', kind: 'folder' }, { id: 'upload', kind: 'upload' }]);
    expect(await source.search!('r', 'lease')).toEqual([{ ref: 'src:r::a.md', score: 0.9, tier: 'bm25' }]);
  });

  it('re-picks a folder it cannot re-read (no reopen), and a cancelled pick is a cancelled review', async () => {
    const folder = provider('folder', 'folder');
    const upload = provider('upload', 'upload');
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [upload, folder], onDegraded: vi.fn() });
    await source.targets!();
    expect(await events(source.review!({ rootId: 'rovr:folder:contracts' }, ctl))).toEqual([{ type: 'cancelled' }]);
    expect(folder.open).toHaveBeenCalledTimes(1);
    expect(upload.open).not.toHaveBeenCalled();
    await events(source.review!({ rootId: 'web:upload:contracts' }, ctl));
    expect(upload.open).toHaveBeenCalledTimes(1);
  });

  it('prefers the folder picker, then the upload, when the view asks the host to pick', async () => {
    const folder = provider('folder', 'folder');
    const upload = provider('upload', 'upload');
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [upload, folder], onDegraded: vi.fn() });
    await source.targets!();
    await events(source.review!({ pick: true }, ctl));
    expect(folder.open).toHaveBeenCalledTimes(1);
  });

  it('reports a provider listing that fails and carries on with no targets', async () => {
    const onDegraded = vi.fn();
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => { throw new Error('offline'); }, onDegraded });
    expect(await source.targets!()).toEqual([]);
    expect(onDegraded).toHaveBeenCalledWith('review targets', expect.any(Error));
  });
});
