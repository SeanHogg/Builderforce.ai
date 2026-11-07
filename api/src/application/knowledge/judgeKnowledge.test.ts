/**
 * judgeKnowledge — PRD 42 Part D: a client-supplied judgement is validated by the SAME
 * validators the server's own model output goes through, makes no model call, and an
 * absent clientResult keeps the routed-call path.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  completeJson: vi.fn(),
  recordClientResultUsage: vi.fn(async () => {}),
}));
vi.mock('../llm/completeJson', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llm/completeJson')>()),
  completeJson: mocks.completeJson,
}));
vi.mock('../llm/clientResultUsage', () => ({ recordClientResultUsage: mocks.recordClientResultUsage }));

import { clientJudgementSpec, judgeKnowledge } from './judgeKnowledge';
import { CLIENT_JSON_MAX_CHARS, parseClientResult } from '../llm/clientResult';

const provenance = { engine: 'webllm' as const, model: 'Qwen-0.5B' };
const deps = { env: {} as never, tenantId: 7, projectId: 3, userId: 'u1', db: {} as never };
const items = [{ ref: 'a', text: 'Alpha asserts X.', sourceHash: 'h1' }, { ref: 'b', text: 'Beta asserts Y.', sourceHash: 'h2' }];
const claim = { subject: 'Alpha', predicate: 'asserts', object: 'X', quote: 'Alpha asserts X.' };

beforeEach(() => {
  mocks.completeJson.mockReset();
  mocks.recordClientResultUsage.mockClear();
});

describe('clientJudgementSpec', () => {
  it('requires the envelope array for the request kind', () => {
    expect(parseClientResult({ json: { extract: [] }, provenance }, clientJudgementSpec('extract')).ok).toBe(true);
    expect(parseClientResult({ json: { compare: [] }, provenance }, clientJudgementSpec('extract')).ok).toBe(false);
    expect(parseClientResult({ json: { compare: [] }, provenance }, clientJudgementSpec('compare')).ok).toBe(true);
    expect(parseClientResult({ json: [], provenance }, clientJudgementSpec('extract')).ok).toBe(false);
  });

  it('enforces the serialized-size cap on the parsed value, not just Content-Length', () => {
    const big = { extract: ['x'.repeat(CLIENT_JSON_MAX_CHARS + 1)] };
    expect(parseClientResult({ json: big, provenance }, clientJudgementSpec('extract')).ok).toBe(false);
  });
});

describe('judgeKnowledge with a clientResult', () => {
  it('makes no model call, keeps only validated claims, counts bad entries invalid, and records usage', async () => {
    const value = { extract: [
      { ref: 'a', claims: [claim, { subject: 'only-a-subject' }], entities: [{ name: 'Alpha', type: 'system' }] },
      { ref: 'b', claims: [claim], entities: [] },
    ] };
    const out = await judgeKnowledge(deps, { kind: 'extract', items } as never, { value, provenance });
    expect(mocks.completeJson).not.toHaveBeenCalled();
    expect(out.extract).toHaveLength(2);
    expect(out.extract![0]!.claims).toHaveLength(1);
    expect(out.extract![1]!.claims).toHaveLength(1);
    expect(out.invalid).toBeGreaterThanOrEqual(1);
    expect(mocks.recordClientResultUsage).toHaveBeenCalledWith(deps.db, deps.env, expect.objectContaining({ tenantId: 7, projectId: 3, useCase: 'knowledge_judge', provenance }));
  });

  it('counts an item the device did not answer as invalid, never as judged-with-claims', async () => {
    const out = await judgeKnowledge(deps, { kind: 'extract', items } as never, { value: { extract: [{ ref: 'a', claims: [claim], entities: [] }] }, provenance });
    expect(out.extract![0]!.claims).toHaveLength(1);
    expect(out.extract![1]!.claims).toHaveLength(0);
    expect(out.invalid).toBe(1);
  });

  it('validates a compare reply with the shared enum check', async () => {
    const two = items;
    const good = await judgeKnowledge(deps, { kind: 'compare', items: two } as never, { value: { compare: [{ a: 'a', b: 'b', relation: 'contradicts', confidence: 0.9 }] }, provenance });
    expect(good.compare).toEqual([{ a: 'a', b: 'b', relation: 'contradicts', confidence: 0.9 }]);
    const bad = await judgeKnowledge(deps, { kind: 'compare', items: two } as never, { value: { compare: [{ a: 'a', b: 'b', relation: 'maybe', confidence: 0.9 }] }, provenance });
    expect(bad.compare).toEqual([]);
    expect(bad.invalid).toBeGreaterThanOrEqual(1);
    expect(mocks.completeJson).not.toHaveBeenCalled();
  });
});

describe('judgeKnowledge without a clientResult', () => {
  it('still asks the routed model, one call per item, and records no client usage', async () => {
    mocks.completeJson.mockResolvedValue({ ok: true, value: { extract: [{ ref: 'a', claims: [], entities: [] }] } });
    await judgeKnowledge(deps, { kind: 'extract', items: [items[0]!] } as never);
    expect(mocks.completeJson).toHaveBeenCalledTimes(1);
    expect(mocks.recordClientResultUsage).not.toHaveBeenCalled();
  });
});
