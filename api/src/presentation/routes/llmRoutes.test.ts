import { describe, expect, it, vi } from 'vitest';
import type { ChatCompletionRequest, LlmProxyService, ProxyResult } from '../../application/llm/LlmProxyService';
import { completeChatRequest } from './llmRoutes';

function proxyResult(resolvedModel: string): ProxyResult {
  return {
    response: new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
    resolvedModel,
    retries: 0,
    failovers: [],
    usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  };
}

describe('completeChatRequest', () => {
  it('uses completeForUseCase when body.useCase is registered', async () => {
    const completeForUseCase = vi.fn(async () => proxyResult('qwen/qwen3-coder:free'));
    const complete = vi.fn(async () => proxyResult('meta-llama/llama-3.3-70b-instruct:free'));
    const service: Pick<LlmProxyService, 'completeForUseCase' | 'complete'> = {
      completeForUseCase,
      complete,
    };

    const body: ChatCompletionRequest = {
      useCase: 'ide.code_complete',
      messages: [{ role: 'user', content: 'finish this function' }],
      stream: false,
    };

    const result = await completeChatRequest(service as LlmProxyService, body);

    expect(completeForUseCase).toHaveBeenCalledOnce();
    expect(completeForUseCase).toHaveBeenCalledWith('ide.code_complete', body);
    expect(complete).not.toHaveBeenCalled();
    expect(result.resolvedModel).toBe('qwen/qwen3-coder:free');
  });

  it('falls back to complete when useCase is missing or unknown', async () => {
    const completeForUseCase = vi.fn(async () => proxyResult('qwen/qwen3-coder:free'));
    const complete = vi.fn(async () => proxyResult('meta-llama/llama-3.3-70b-instruct:free'));
    const service: Pick<LlmProxyService, 'completeForUseCase' | 'complete'> = {
      completeForUseCase,
      complete,
    };

    const body: ChatCompletionRequest = {
      useCase: 'not.a.real.usecase',
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    };

    const result = await completeChatRequest(service as LlmProxyService, body);

    expect(completeForUseCase).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledOnce();
    expect(result.resolvedModel).toBe('meta-llama/llama-3.3-70b-instruct:free');
  });
});
