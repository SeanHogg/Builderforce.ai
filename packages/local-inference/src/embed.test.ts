import { describe, expect, it, vi } from 'vitest';
import { ollamaEmbedFingerprint, ollamaEmbedder, ollamaResidentEmbedModel } from './embed';
import { residentModelTracker } from './logprobs';
import type { FetchLike } from './probe';

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });
const endpoint = { baseUrl: 'http://127.0.0.1:11434/v1' };

/** A fake Ollama: `resident` is what `/api/ps` holds; embeddings are `dims` wide. */
function fakeOllama(resident: Array<{ name: string; digest?: string; caps: string[] }>, dims = 4) {
  return vi.fn<FetchLike>(async (url, init) => {
    if (url.endsWith('/api/ps')) return json({ models: resident.map((m) => ({ name: m.name, model: m.name, digest: m.digest })) });
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string; input?: string[] };
    if (url.endsWith('/api/show')) return json({ capabilities: resident.find((m) => m.name === body.model)?.caps ?? [] });
    if (url.endsWith('/api/embed')) {
      if (!resident.some((m) => m.name === body.model)) return json({ error: 'model not loaded' }, 404);
      return json({ embeddings: (body.input ?? []).map((_, i) => Array.from({ length: dims }, (_, j) => i + j)) });
    }
    return json({}, 404);
  });
}

describe('ollama embedder — warm only', () => {
  it('reads warm only when an EMBEDDING model is resident — a resident chat model is not one', async () => {
    const chat = fakeOllama([{ name: 'qwen3:8b', caps: ['completion', 'tools'] }]);
    expect(await ollamaResidentEmbedModel(chat, endpoint)).toBeUndefined();
    const both = fakeOllama([{ name: 'qwen3:8b', caps: ['completion'] }, { name: 'nomic-embed-text', digest: '0123456789abcdef', caps: ['embedding'] }]);
    expect(await ollamaResidentEmbedModel(both, endpoint)).toEqual({ model: 'nomic-embed-text', digest: '0123456789abcdef' });
    expect(both.mock.calls.some(([url]) => url.endsWith('/api/embed'))).toBe(false);
  });

  it('nothing resident or the runtime down ⇒ undefined, never a throw', async () => {
    expect(await ollamaResidentEmbedModel(fakeOllama([]), endpoint)).toBeUndefined();
    const down = vi.fn<FetchLike>(async () => { throw new TypeError('fetch failed'); });
    expect(await ollamaResidentEmbedModel(down, endpoint)).toBeUndefined();
  });

  it('the tracker reads cold until the background reading lands', async () => {
    const fetchImpl = fakeOllama([{ name: 'nomic-embed-text', caps: ['embedding'] }]);
    const read = residentModelTracker(() => ollamaResidentEmbedModel(fetchImpl, endpoint));
    expect(read()).toBeUndefined();
    await vi.waitFor(() => expect(read()).toEqual({ model: 'nomic-embed-text' }));
  });
});

describe('ollama embedder — fingerprint', () => {
  it('names engine, model, digest and width', async () => {
    const fetchImpl = fakeOllama([{ name: 'nomic-embed-text', digest: '0123456789abcdef', caps: ['embedding'] }], 6);
    const port = await ollamaEmbedder(fetchImpl, endpoint, { model: 'nomic-embed-text', digest: '0123456789abcdef' });
    expect(port?.dims).toBe(6);
    expect(port?.fingerprint).toBe('ollama:nomic-embed-text@0123456789ab:6');
    const vectors = await port!.embed(['a', 'b']);
    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(ollamaEmbedFingerprint({ model: 'm' }, 3)).toBe('ollama:m:3');
  });

  it('a re-pull under the same name is another fingerprint', () => {
    expect(ollamaEmbedFingerprint({ model: 'm', digest: 'aaaaaaaaaaaaaaaa' }, 3)).not.toBe(ollamaEmbedFingerprint({ model: 'm', digest: 'bbbbbbbbbbbbbbbb' }, 3));
  });

  it('a model that unloaded since it was read as resident ⇒ no embedder', async () => {
    expect(await ollamaEmbedder(fakeOllama([]), endpoint, { model: 'nomic-embed-text' })).toBeUndefined();
  });
});
