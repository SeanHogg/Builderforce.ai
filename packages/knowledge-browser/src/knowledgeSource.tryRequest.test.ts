import { describe, expect, it, vi } from 'vitest';
import type { KnowledgeClient } from '@builderforce/knowledge-client';
import { createKnowledgeSource } from './knowledgeSource';

describe('browser knowledge source — the API sandbox', () => {
  // A browser tab has no safe server-side proxy for a person's own localhost: the source must NOT
  // offer Send, so the drawer shows "Send is available in the editor" instead of a dead button.
  it('offers no tryRequest', () => {
    const client = { scopes: vi.fn(), graph: vi.fn(), search: vi.fn(), store: {}, judgement: {}, deleteFact: vi.fn() } as unknown as KnowledgeClient;
    const source = createKnowledgeSource({ projectId: 7, client, directorySources: async () => [], onDegraded: vi.fn() });
    expect(source.tryRequest).toBeUndefined();
  });
});
