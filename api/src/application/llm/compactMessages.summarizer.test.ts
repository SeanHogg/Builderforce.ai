import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

const { complete, resolveSpecialist, captureSpecialistSample } = vi.hoisted(() => ({
  complete: vi.fn(),
  resolveSpecialist: vi.fn(),
  captureSpecialistSample: vi.fn(async () => undefined),
}));

vi.mock('./LlmProxyService', () => ({
  ideProxy: () => ({ complete }),
  readProxyChoice: async (r: { content: string }) => ({ content: r.content }),
}));
vi.mock('./specialists/resolveSpecialist', () => ({ resolveSpecialist }));
vi.mock('./specialists/evalCaseStore', () => ({ captureSpecialistSample }));

import { buildGatewaySummarizer, compactionSummaryRequest } from './gatewaySummarizer';

const env = {} as Env;
const ok = (content: string) => ({ response: { status: 200 }, content });

beforeEach(() => vi.clearAllMocks());

describe('buildGatewaySummarizer — the compaction summary model (cost lever E2)', () => {
  it('with no specialist admitted, asks the free pool exactly as before and keeps the input as an eval case', async () => {
    resolveSpecialist.mockResolvedValue(null);
    complete.mockResolvedValue(ok('- memory'));
    const summary = await buildGatewaySummarizer(env)('transcript', { tenantId: 7 });
    expect(summary).toBe('- memory');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).not.toHaveProperty('model');
    expect(complete.mock.calls[0]![0]).toMatchObject({ max_tokens: 700, temperature: 0 });
    expect(resolveSpecialist).toHaveBeenCalledWith(env, 7, 'compaction_summary');
    expect(captureSpecialistSample).toHaveBeenCalledWith(env, { jobId: 'compaction_summary', tenantId: 7, request: compactionSummaryRequest('transcript') });
  });

  it('asks an admitted specialist first, strictly pinned, and does not capture its answer', async () => {
    resolveSpecialist.mockResolvedValue({ jobId: 'compaction_summary', model: '@cf/meta/llama-3.1-8b-instruct-fp8', ratio: 0.95 });
    complete.mockResolvedValue(ok('- specialist memory'));
    const summary = await buildGatewaySummarizer(env)('transcript', { tenantId: '7' });
    expect(summary).toBe('- specialist memory');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).toMatchObject({ model: '@cf/meta/llama-3.1-8b-instruct-fp8', modelStrict: true });
    expect(captureSpecialistSample).not.toHaveBeenCalled();
  });

  it('falls back to the free pool when the specialist fails — the lever can only save', async () => {
    resolveSpecialist.mockResolvedValue({ jobId: 'compaction_summary', model: '@cf/x', ratio: 0.95 });
    complete.mockResolvedValueOnce({ response: { status: 503 }, content: '' }).mockResolvedValueOnce(ok('- pool memory'));
    expect(await buildGatewaySummarizer(env)('transcript')).toBe('- pool memory');
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]![0]).not.toHaveProperty('model');
  });

  it('returns null when the gateway throws, so compaction degrades to elision', async () => {
    resolveSpecialist.mockResolvedValue(null);
    complete.mockRejectedValue(new Error('down'));
    expect(await buildGatewaySummarizer(env)('transcript')).toBeNull();
    expect(captureSpecialistSample).not.toHaveBeenCalled();
  });
});
