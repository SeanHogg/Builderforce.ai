/**
 * PRD 38 §5.2: the SERVER marks staleness when a host uploads extracted output — for the
 * sources the upload ADDS to its hash's object, never for ones it already held — and
 * extracted node labels are reduced to one line before they are stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';

const bump = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: bump, knowledgeVersion: vi.fn() }));

import { putExtracted } from './knowledgePerception';

const entry = (path: string, hash: string, label = 'a.md'): Extracted => ({
  sourceRef: `src:r::${path}`, sourceHash: hash,
  nodes: [{ ref: `src:r::${path}`, kind: 'file', label, pack: 'docs', importance: 0, origin: 'extracted' }],
  edges: [], keys: [],
});

/** An object store holding `prior` at its hash; records what is put. */
function harness(prior: Extracted[] | undefined = undefined) {
  const put = vi.fn(async () => undefined);
  const get = vi.fn(async () => prior);
  const markRelationsStale = vi.fn(async () => 1);
  const deps = { env: {} as never, tenantId: 1, projectId: 2, extracted: { get, put } as never, store: { markRelationsStale } };
  return { deps, put, get, markRelationsStale };
}

beforeEach(() => vi.clearAllMocks());

describe('putExtracted', () => {
  it('marks each NEW source’s relations stale against the uploaded hash, then bumps once', async () => {
    const { deps, markRelationsStale } = harness(undefined);
    await putExtracted(deps, 'h', [entry('a.md', 'h'), entry('b.md', 'h')]);
    expect(markRelationsStale).toHaveBeenCalledTimes(2);
    expect(markRelationsStale).toHaveBeenCalledWith('src:r::a.md', 'h');
    expect(markRelationsStale).toHaveBeenCalledWith('src:r::b.md', 'h');
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('does not touch a source the object at that hash already held (an empty file joining another’s hash)', async () => {
    // X was uploaded at H earlier (an empty file); Y is a different, also-empty file: the object at H
    // is re-uploaded whole as [X@H, Y@H]. X is unchanged — its relations must not go stale.
    const { deps, put, markRelationsStale } = harness([entry('x.md', 'H')]);
    await putExtracted(deps, 'H', [entry('x.md', 'H'), entry('y.md', 'H')]);
    expect(markRelationsStale).toHaveBeenCalledTimes(1);
    expect(markRelationsStale).toHaveBeenCalledWith('src:r::y.md', 'H');
    expect(markRelationsStale).not.toHaveBeenCalledWith('src:r::x.md', expect.anything());
    // The object is still replaced whole.
    expect((put.mock.calls[0] as unknown as [string, Extracted[]])[1].map((e) => e.sourceRef)).toEqual(['src:r::x.md', 'src:r::y.md']);
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('marks nothing on a plain re-upload of the same object, but still bumps', async () => {
    const { deps, markRelationsStale } = harness([entry('x.md', 'H')]);
    await putExtracted(deps, 'H', [entry('x.md', 'H')]);
    expect(markRelationsStale).not.toHaveBeenCalled();
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('refuses an entry whose sourceHash is not the hash it was uploaded under (400), storing and marking nothing', async () => {
    const { deps, put, markRelationsStale } = harness(undefined);
    const err = await putExtracted(deps, 'h', [entry('a.md', 'h'), entry('b.md', 'h-b')]).catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'KnowledgeWriteError', status: 400, code: 'source_hash_mismatch' });
    expect(put).not.toHaveBeenCalled();
    expect(markRelationsStale).not.toHaveBeenCalled();
    expect(bump).not.toHaveBeenCalled();
  });

  it('marks nothing for a root-level output (~tag), which is not a source’s content, yet bumps', async () => {
    const { deps, markRelationsStale } = harness(undefined);
    await putExtracted(deps, '~deps:abc', [entry('a.md', '~deps:abc')]);
    expect(markRelationsStale).not.toHaveBeenCalled();
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('still bumps when marking fails part-way', async () => {
    const { deps, markRelationsStale } = harness(undefined);
    markRelationsStale.mockRejectedValueOnce(new Error('db down'));
    await expect(putExtracted(deps, 'h', [entry('a.md', 'h')])).rejects.toThrow('db down');
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('stores node labels as one bounded line', async () => {
    const { deps, put } = harness(undefined);
    await putExtracted(deps, 'h', [entry('a.md', 'h', `first line\nsecond line\n${'x'.repeat(400)}`)]);
    const label = (put.mock.calls[0] as unknown as [string, Extracted[]])[1][0]!.nodes[0]!.label;
    expect(label).not.toMatch(/\n/);
    expect(label.startsWith('first line second line')).toBe(true);
    expect(label.length).toBeLessThanOrEqual(120);
  });
});
