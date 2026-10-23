import { afterEach, describe, expect, it, vi } from 'vitest';
import { RERANKED_K, cutRecall } from './retrievalK';
import type { Reranker } from './reranker';

const rows = (scores: number[]) => scores.map((score, i) => ({ row: `r${i}`, score }));
const textOf = (row: string) => row;
const ON = 'on';
const OFF = 'off';

afterEach(() => vi.restoreAllMocks());

describe('cutRecall', () => {
  it('both levers off: the first `requested` rows, as before', async () => {
    const env = { COST_LEVER_C4_ADAPTIVE_CONTEXT: OFF, COST_LEVER_C6_RERANK: OFF };
    const out = await cutRecall({ env, tenantId: 1, query: 'q', ranked: rows([0.95, 0.9, 0.85, 0.2, 0.1, 0.05]), requested: 5, textOf });
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3', 'r4']);
  });

  it('C4: a clear head sends 3, a flat field sends the requested K', async () => {
    const env = { COST_LEVER_C4_ADAPTIVE_CONTEXT: ON, COST_LEVER_C6_RERANK: OFF };
    expect(await cutRecall({ env, tenantId: 1, query: 'q', ranked: rows([0.95, 0.9, 0.85, 0.2, 0.1, 0.05]), requested: 5, textOf })).toHaveLength(3);
    expect(await cutRecall({ env, tenantId: 1, query: 'q', ranked: rows([0.3, 0.3, 0.3, 0.3, 0.3, 0.3]), requested: 5, textOf })).toHaveLength(5);
  });

  it('C6: reorders by the cross-encoder and sends the top 3', async () => {
    const env = { COST_LEVER_C4_ADAPTIVE_CONTEXT: OFF, COST_LEVER_C6_RERANK: ON };
    const reranker: Reranker = { rerank: async () => [0.1, 0.2, 0.3, 0.9, 0.8, 0.05] };
    const out = await cutRecall({ env, tenantId: 1, query: 'q', ranked: rows([0.9, 0.8, 0.7, 0.6, 0.5, 0.4]), requested: 6, textOf, deps: { reranker } });
    expect(out).toEqual(['r3', 'r4', 'r2']);
    expect(out).toHaveLength(RERANKED_K);
  });

  it('C6 falls back to the fused order and the requested K when the reranker fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const env = { COST_LEVER_C4_ADAPTIVE_CONTEXT: OFF, COST_LEVER_C6_RERANK: ON };
    const reranker: Reranker = { rerank: async () => { throw new Error('down'); } };
    const out = await cutRecall({ env, tenantId: 1, query: 'q', ranked: rows([0.9, 0.8, 0.7, 0.6]), requested: 4, textOf, deps: { reranker } });
    expect(out).toEqual(['r0', 'r1', 'r2', 'r3']);
  });

  it('C6 is skipped with no query (nothing to score against)', async () => {
    const env = { COST_LEVER_C4_ADAPTIVE_CONTEXT: OFF, COST_LEVER_C6_RERANK: ON };
    const reranker: Reranker = { rerank: vi.fn(async () => [1, 0]) };
    const out = await cutRecall({ env, tenantId: 1, query: '', ranked: rows([0.5, 0.4]), requested: 2, textOf, deps: { reranker } });
    expect(out).toEqual(['r0', 'r1']);
    expect(reranker.rerank).not.toHaveBeenCalled();
  });
});
