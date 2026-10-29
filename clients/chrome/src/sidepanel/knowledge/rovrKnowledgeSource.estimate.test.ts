import { describe, expect, it, vi } from 'vitest';

// The shared browser source is covered in its own package; here it is a stand-in so what is
// under test is what Rovr WIRES: the server's judge estimate as the confirm chip's price.
const mocks = vi.hoisted(() => ({ createKnowledgeSource: vi.fn(() => ({})) }));
vi.mock('@builderforce/knowledge-browser', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@builderforce/knowledge-browser')>()),
  createKnowledgeSource: mocks.createKnowledgeSource,
}));

import { createRovrKnowledgeSource } from './rovrKnowledgeSource';

describe('Rovr knowledge source: the confirm chip price', () => {
  it('asks the server for the per-call price over Rovr’s authenticated fetch, scoped to the project', async () => {
    const fetch = vi.fn(async (_path: string) => new Response(JSON.stringify({ perCallUsd: 0.003, model: 'm', local: false }), { status: 200, headers: { 'content-type': 'application/json' } }));
    createRovrKnowledgeSource({ projectId: 7, fetch: fetch as never, reportError: vi.fn() });
    const options = (mocks.createKnowledgeSource.mock.calls[0] as unknown as [{ callPriceUsd(): Promise<unknown> }])[0];
    expect(await options.callPriceUsd()).toBe(0.003);
    expect(fetch.mock.calls[0]![0]).toBe('/api/projects/7/knowledge/judge/estimate');
  });

  it('a local engine is the local note, not a price', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ perCallUsd: 0, model: 'ollama/x', local: true }), { status: 200, headers: { 'content-type': 'application/json' } }));
    createRovrKnowledgeSource({ projectId: 7, fetch: fetch as never, reportError: vi.fn() });
    const options = (mocks.createKnowledgeSource.mock.calls.at(-1) as unknown as [{ callPriceUsd(): Promise<unknown> }])[0];
    expect(await options.callPriceUsd()).toEqual({ local: true });
  });
});
