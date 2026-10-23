import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RERANK_MAX_CANDIDATES,
  RERANK_MODEL,
  __resetRerankerWarningForTests,
  parseRerankResponse,
  rerankCandidates,
  workersAiReranker,
  type Reranker,
} from './reranker';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  __resetRerankerWarningForTests();
});

describe('parseRerankResponse', () => {
  it('aligns Workers AI {id, score} rows with the input order', () => {
    const raw = { success: true, result: { response: [{ id: 2, score: 0.9 }, { id: 0, score: 0.1 }] } };
    expect(parseRerankResponse(raw, 3)).toEqual([0.1, 0, 0.9]);
  });

  it('treats a 200 with no scores as a failure', () => {
    expect(() => parseRerankResponse({ result: { response: [] } }, 2)).toThrow();
  });
});

describe('workersAiReranker', () => {
  it('is null without the account pair', () => {
    expect(workersAiReranker({ CLOUDFLARE_AI_API_TOKEN: 't' })).toBeNull();
  });

  it('posts query + contexts to the bge reranker on the account endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ result: { response: [{ id: 0, score: 0.2 }, { id: 1, score: 0.8 }] } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const reranker = workersAiReranker({ CLOUDFLARE_AI_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'acct' })!;
    expect(await reranker.rerank('q', ['a', 'b'])).toEqual([0.2, 0.8]);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/acct/ai/run/${RERANK_MODEL}`);
    expect(JSON.parse(String(init.body))).toEqual({ query: 'q', contexts: [{ text: 'a' }, { text: 'b' }], top_k: 2 });
  });
});

describe('rerankCandidates', () => {
  const fixed = (scores: number[]): Reranker => ({ rerank: async () => scores });

  it('returns the reranker scores', async () => {
    expect(await rerankCandidates({}, 'q', ['a', 'b'], { reranker: fixed([0.3, 0.7]) })).toEqual([0.3, 0.7]);
  });

  it('logs and falls back (null) when Workers AI is not configured', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await rerankCandidates({}, 'q', ['a', 'b'])).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs and falls back (null) when the call fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failing: Reranker = { rerank: async () => { throw new Error('502'); } };
    expect(await rerankCandidates({}, 'q', ['a'], { reranker: failing })).toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it('sends at most the candidate cap and scores the rest 0', async () => {
    const seen: number[] = [];
    const reranker: Reranker = { rerank: async (_q, docs) => { seen.push(docs.length); return docs.map(() => 0.5); } };
    const out = await rerankCandidates({}, 'q', Array.from({ length: RERANK_MAX_CANDIDATES + 4 }, (_, i) => `d${i}`), { reranker });
    expect(seen).toEqual([RERANK_MAX_CANDIDATES]);
    expect(out!.slice(-4)).toEqual([0, 0, 0, 0]);
  });

  it('does nothing for an empty query', async () => {
    expect(await rerankCandidates({}, '  ', ['a'], { reranker: fixed([1]) })).toBeNull();
  });
});
