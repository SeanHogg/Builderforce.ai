/**
 * PRD 38 §5.2: the SERVER marks staleness when a host uploads extracted output, and
 * extracted node labels are reduced to one line before they are stored.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Extracted } from '@seanhogg/builderforce-memory/knowledge';

const bump = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('./knowledgeVersion', () => ({ bumpKnowledgeVersion: bump, knowledgeVersion: vi.fn() }));

import { putExtracted } from './knowledgePerception';
import { MAX_QUOTE_LINES, clampLabel, clampQuoteLines } from './knowledgePrivacy';

const entry = (path: string, hash: string, label = 'a.md'): Extracted => ({
  sourceRef: `src:r::${path}`, sourceHash: hash,
  nodes: [{ ref: `src:r::${path}`, kind: 'file', label, pack: 'docs', importance: 0, origin: 'extracted' }],
  edges: [], keys: [],
});

describe('putExtracted', () => {
  it('marks each source’s relations stale against its new hash, then bumps once', async () => {
    const put = vi.fn(async () => undefined);
    const markRelationsStale = vi.fn(async () => 1);
    await putExtracted(
      { env: {} as never, tenantId: 1, projectId: 2, extracted: { put } as never, store: { markRelationsStale } },
      'h',
      [entry('a.md', 'h-a'), entry('b.md', 'h-b')],
    );
    expect(markRelationsStale).toHaveBeenCalledWith('src:r::a.md', 'h-a');
    expect(markRelationsStale).toHaveBeenCalledWith('src:r::b.md', 'h-b');
    expect(bump).toHaveBeenCalledTimes(1);
  });

  it('stores node labels as one line', async () => {
    const put = vi.fn(async () => undefined);
    await putExtracted(
      { env: {} as never, tenantId: 1, projectId: 2, extracted: { put } as never, store: { markRelationsStale: vi.fn(async () => 0) } },
      'h',
      [entry('a.md', 'h-a', 'first line\nsecond line\nthird')],
    );
    const stored = (put.mock.calls[0] as unknown as [string, Extracted[]])[1];
    expect(stored[0]!.nodes[0]!.label).toBe('first line');
  });
});

describe('knowledgePrivacy', () => {
  it('keeps at most MAX_QUOTE_LINES lines of a claim', () => {
    expect(MAX_QUOTE_LINES).toBe(3);
    expect(clampQuoteLines('1\n2\n3\n4\n5')).toBe('1\n2\n3');
    expect(clampQuoteLines('1\n2')).toBe('1\n2');
  });
  it('reduces a label to its first non-blank line', () => {
    expect(clampLabel('\n  title  \nbody')).toBe('title');
  });
});
