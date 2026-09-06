import { describe, expect, it, vi } from 'vitest';

const ideComplete = vi.fn();
const tenantComplete = vi.fn();

vi.mock('./LlmProxyService', async (importActual) => {
  const actual = await importActual<typeof import('./LlmProxyService')>();
  return {
    ...actual,
    ideProxy: () => ({ complete: ideComplete }),
  };
});
vi.mock('./tenantProxy', () => ({
  completeForTenant: (...args: unknown[]) => tenantComplete(...args),
}));

import { completeJson, jsonSchemaFormat, type JsonDispatch } from './completeJson';

function proxyResult(status: number, content: string | null, model = 'test/model') {
  const body = content === null ? {} : { choices: [{ message: { role: 'assistant', content } }] };
  return {
    response: new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
    resolvedModel: model,
    resolvedVendor: 'openrouter',
    retries: 0,
    failovers: [],
  };
}

const request = { system: 'sys', user: 'usr', maxTokens: 100, useCase: 'test_case' };
const env = {} as never;

describe('completeJson — dispatch kinds', () => {
  it('ide: routes through ideProxy(env).complete with the built body', async () => {
    ideComplete.mockResolvedValueOnce(proxyResult(200, '{"a":1}'));
    const out = await completeJson({ kind: 'ide', env }, { ...request, schema: jsonSchemaFormat('t', { type: 'object' }), temperature: 0.3 });
    expect(out).toMatchObject({ ok: true, value: { a: 1 }, model: 'test/model' });
    const body = ideComplete.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body.messages).toEqual([{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }]);
    expect(body.temperature).toBe(0.3);
    expect(body.max_tokens).toBe(100);
    expect(body.useCase).toBe('test_case');
    expect(body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 't', strict: true, schema: { type: 'object' } } });
  });

  it('tenant: routes through completeForTenant with tenantId and opts', async () => {
    tenantComplete.mockResolvedValueOnce(proxyResult(200, '{"b":2}'));
    const dispatch: JsonDispatch = { kind: 'tenant', env, tenantId: 7, opts: { meterUseCase: 'x' } };
    const out = await completeJson(dispatch, request);
    expect(out).toMatchObject({ ok: true, value: { b: 2 } });
    expect(tenantComplete.mock.calls[0]?.[1]).toBe(7);
    expect(tenantComplete.mock.calls[0]?.[3]).toEqual({ meterUseCase: 'x' });
    // Default temperature is 0: structured extraction wants the mode.
    expect((tenantComplete.mock.calls[0]?.[2] as { temperature: number }).temperature).toBe(0);
  });

  it('proxy: calls the supplied proxy and forwards the abort signal', async () => {
    const complete = vi.fn().mockResolvedValueOnce(proxyResult(200, '```json\n{"c":3}\n```'));
    const signal = new AbortController().signal;
    const out = await completeJson({ kind: 'proxy', proxy: { complete } }, { ...request, signal, model: 'pin/me' });
    expect(out).toMatchObject({ ok: true, value: { c: 3 } });
    expect(complete.mock.calls[0]?.[3]).toBe(signal);
    expect((complete.mock.calls[0]?.[0] as { model: string }).model).toBe('pin/me');
  });

  it('text: an injected (system, user) => string, parsed through the same reader; model is null', async () => {
    const llm = vi.fn().mockResolvedValueOnce('Sure! Here it is:\n{"d": 4}\nHope that helps.');
    const out = await completeJson({ kind: 'text', llm }, request);
    expect(out).toEqual({ ok: true, value: { d: 4 }, model: null, result: null });
    expect(llm).toHaveBeenCalledWith('sys', 'usr');
  });

  it('omits the system message when system is empty (a bare multimodal turn)', async () => {
    ideComplete.mockResolvedValueOnce(proxyResult(200, '{}'));
    await completeJson({ kind: 'ide', env }, { ...request, system: '', user: [{ type: 'text', text: 'hi' }] });
    const body = ideComplete.mock.calls.at(-1)?.[0] as { messages: unknown[] };
    expect(body.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
  });
});

describe('completeJson — failure reasons', () => {
  it('gateway: a >= 400 status never reaches the parser, and carries the status', async () => {
    ideComplete.mockResolvedValueOnce(proxyResult(503, '{"a":1}'));
    const out = await completeJson({ kind: 'ide', env }, request);
    expect(out).toMatchObject({ ok: false, reason: 'gateway', status: 503 });
  });

  it('gateway: a dispatcher that throws is a gateway failure, never a throw', async () => {
    ideComplete.mockRejectedValueOnce(new Error('network down'));
    const out = await completeJson({ kind: 'ide', env }, request);
    expect(out).toEqual({ ok: false, reason: 'gateway', detail: 'network down' });
    const llm = vi.fn().mockRejectedValueOnce(new Error('no model'));
    expect(await completeJson({ kind: 'text', llm }, request)).toEqual({ ok: false, reason: 'gateway', detail: 'no model' });
  });

  it('empty: a 2xx with no assistant text', async () => {
    ideComplete.mockResolvedValueOnce(proxyResult(200, null));
    const out = await completeJson({ kind: 'ide', env }, request);
    expect(out).toMatchObject({ ok: false, reason: 'empty' });
    expect(await completeJson({ kind: 'text', llm: async () => '   ' }, request)).toMatchObject({ ok: false, reason: 'empty' });
  });

  it('unparseable: text with no JSON in it, with the raw content kept for prose fallbacks', async () => {
    ideComplete.mockResolvedValueOnce(proxyResult(200, 'I cannot do that.'));
    const out = await completeJson({ kind: 'ide', env }, request);
    expect(out).toMatchObject({ ok: false, reason: 'unparseable', content: 'I cannot do that.' });
  });

  it('invalid: JSON the validator refused', async () => {
    ideComplete.mockResolvedValueOnce(proxyResult(200, '{"score": "high"}'));
    const out = await completeJson({ kind: 'ide', env }, request, (value) => {
      const score = (value as { score?: unknown }).score;
      return typeof score === 'number' ? { score } : null;
    });
    expect(out).toMatchObject({ ok: false, reason: 'invalid', content: '{"score": "high"}' });
  });

  it('ok: the validator shapes the value', async () => {
    ideComplete.mockResolvedValueOnce(proxyResult(200, '{"score": 3}'));
    const out = await completeJson({ kind: 'ide', env }, request, (value) => {
      const score = (value as { score?: unknown }).score;
      return typeof score === 'number' ? { score } : null;
    });
    expect(out).toMatchObject({ ok: true, value: { score: 3 } });
    expect(out.ok && out.result?.resolvedModel).toBe('test/model');
  });
});
