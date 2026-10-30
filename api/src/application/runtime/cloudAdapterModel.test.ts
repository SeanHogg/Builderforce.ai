/**
 * cloudModelPort — the cloud's ModelTransport (PRD 35 WS3). Fakes only at the gateway / metering edge.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelTransportError } from '@builderforce/agent-run';

const h = vi.hoisted(() => ({
  record: vi.fn(async (..._a: unknown[]) => ({ ok: true, content: 'hi', toolCalls: [{ id: 'c1', function: { name: 'read_file', arguments: '{"path":"a"}' } }], resolvedModel: 'm-served' }) as Record<string, unknown>),
}));
vi.mock('./cloudAgent/cloudLlmTurn', () => ({ recordCloudLlmTurn: h.record }));
vi.mock('../llm/vendors/registry', () => ({ catalogEntry: (m: string) => (m === 'known' ? { contextWindow: 131_072 } : null) }));

import { cloudModelPort } from './cloudAdapterModel';

function build(over: { status?: number; contained?: string | null; capTokens?: number } = {}) {
  const complete = vi.fn(async (..._a: unknown[]) => ({ response: { status: over.status ?? 200 }, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheReadTokens: 3 } }));
  const cost = {
    beforeTurn: vi.fn(async () => over.contained ?? null),
    recordTurn: vi.fn(async () => undefined),
    turnFields: vi.fn((caller: number | undefined) => (over.capTokens ?? caller) != null ? { max_tokens: over.capTokens ?? caller } : {}),
  };
  const port = cloudModelPort({
    env: {} as never, db: {} as never, proxy: { complete } as never,
    run: { tenantId: 1, projectId: 2, taskId: 3, executionId: 4, meterExecutionId: 4 },
    routing: { effectivePlan: 'free', premiumOverride: false } as never,
    runRole: 'code', pickedModel: 'seed', genParams: { maxTokens: 4000 }, cost: cost as never,
    declaredLimits: undefined, footprint: () => ({ files: 0, repositories: 0 }), progress: () => '', fallbackSurface: null, startStep: 5,
  });
  return { port, complete, cost };
}
const request = { messages: [{ role: 'system' as const, content: 'S' }, { role: 'user' as const, content: 'U' }], model: 'm-1', role: 'code', tools: [{ type: 'function' as const, function: { name: 'read_file', description: '', parameters: { type: 'object' as const } } }] };

beforeEach(() => vi.clearAllMocks());

describe('cloudModelPort', () => {
  it('sends one request through the plan proxy and returns the served model, calls and usage', async () => {
    const { port, complete } = build();
    const out = await port.complete(request);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ model: 'm-1', role: 'code', tool_choice: 'auto', useCase: 'task_execution', prompt_cache_key: 'cloud:4', max_tokens: 4000 });
    expect(out).toEqual({ content: 'hi', toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"a"}' }], model: 'm-served', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3 } });
    expect(port.servedModel()).toBe('m-served');
    expect(port.currentStep()).toBe(6);
  });

  it('the operator-configured cap outranks the role\'s; a tool-less synthesis keeps the agent\'s own bound', async () => {
    const { port, complete, cost } = build();
    cost.turnFields.mockReturnValue({});
    await port.complete({ ...request, tools: undefined, maxTokens: 1000 });
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ max_tokens: 1000 });
    expect(complete.mock.calls[0]?.[0]).not.toHaveProperty('tool_choice');
  });

  it('a contained run buys no further turn — and the failure is never routable', async () => {
    const { port, complete } = build({ contained: 'Run contained: token limit reached' });
    const thrown = (await port.complete(request).catch((e: unknown) => e)) as ModelTransportError;
    expect(thrown).toBeInstanceOf(ModelTransportError);
    expect(thrown.routable).toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it('a gateway failure is routable with its status, and is metered only if it ends the run', async () => {
    const { port } = build({ status: 429 });
    const thrown = (await port.complete(request).catch((e: unknown) => e)) as ModelTransportError;
    expect(thrown).toMatchObject({ status: 429, routable: true });
    expect(h.record).not.toHaveBeenCalled();
    h.record.mockResolvedValueOnce({ ok: false, error: 'rate limited upstream' });
    expect(await port.flushFailure()).toBe('rate limited upstream');
    expect(h.record).toHaveBeenCalledTimes(1);
    expect(await port.flushFailure()).toBeUndefined();
  });

  it('a failed attempt the policy re-asked is dropped: only the retry is metered', async () => {
    const { port, complete } = build({ status: 503 });
    await port.complete(request).catch(() => undefined);
    complete.mockResolvedValueOnce({ response: { status: 200 }, usage: undefined } as never);
    await port.complete(request);
    expect(await port.flushFailure()).toBeUndefined();
    expect(h.record).toHaveBeenCalledTimes(1);
  });

  it('sizes the context window from the vendor catalog', () => {
    const { port } = build();
    expect(port.window?.('known')).toBe(131_072);
    expect(port.window?.('unknown')).toBeUndefined();
  });
});
