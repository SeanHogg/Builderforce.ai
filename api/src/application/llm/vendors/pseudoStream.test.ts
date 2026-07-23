import { describe, expect, it } from 'vitest';
import { pseudoStreamFromCall } from './pseudoStream';
import type { VendorCallParams, VendorCallResult } from './types';

const params = { model: 'grok-4.3', messages: [], apiKey: 'k' } as unknown as VendorCallParams;

function completion(over: Partial<{ tool_calls: unknown[]; usage: unknown; content: string }> = {}): VendorCallResult {
  const raw = {
    id: 'resp_1',
    object: 'chat.completion',
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: over.content ?? 'Reviewing the tasks.',
        ...(over.tool_calls ? { tool_calls: over.tool_calls } : {}),
      },
      finish_reason: over.tool_calls ? 'tool_calls' : 'stop',
    }],
    ...(over.usage !== undefined ? { usage: over.usage } : {}),
  };
  return {
    raw,
    content: over.content ?? 'Reviewing the tasks.',
    ...(over.usage !== undefined ? { usage: over.usage as VendorCallResult['usage'] } : {}),
  };
}

/** Parse the SSE body back into the JSON frames a client would see. */
async function frames(body: Response): Promise<Array<Record<string, unknown>>> {
  const text = await body.text();
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('data: '))
    .map((l) => l.slice(6))
    .filter((p) => p !== '[DONE]')
    .map((p) => JSON.parse(p) as Record<string, unknown>);
}

describe('pseudoStreamFromCall', () => {
  it('emits token usage in its own trailing chunk', async () => {
    const usage = { prompt_tokens: 41_233, completion_tokens: 620, total_tokens: 41_853 };
    const { response } = pseudoStreamFromCall(completion({ usage }), params);
    const parsed = await frames(response);

    const usageFrame = parsed.find((f) => f.usage);
    expect(usageFrame).toBeDefined();
    expect(usageFrame?.usage).toEqual(usage);
    // Usage rides a choices-less chunk, matching OpenAI's `include_usage` shape
    // (which is what the client's readUsage already expects).
    expect(usageFrame?.choices).toEqual([]);
  });

  it('stamps the resolved model on every chunk', async () => {
    const { response } = pseudoStreamFromCall(completion({ usage: { prompt_tokens: 10 } }), params);
    const parsed = await frames(response);

    expect(parsed.length).toBeGreaterThan(0);
    for (const f of parsed) expect(f.model).toBe('grok-4.3');
  });

  it('carries content and tool calls through on the first chunk', async () => {
    const tool_calls = [{ id: 'call_1', type: 'function', function: { name: 'builtin_tasks_update', arguments: '{"id":322}' } }];
    const { response } = pseudoStreamFromCall(completion({ tool_calls }), params);
    const parsed = await frames(response);

    const choices = parsed[0]?.choices as Array<{ delta: { content: string; tool_calls: unknown[] }; finish_reason: string }>;
    expect(choices[0]?.delta.content).toBe('Reviewing the tasks.');
    expect(choices[0]?.delta.tool_calls).toEqual(tool_calls);
    expect(choices[0]?.finish_reason).toBe('tool_calls');
  });

  it('omits the usage chunk entirely when the vendor reported none', async () => {
    const { response } = pseudoStreamFromCall(completion(), params);
    const parsed = await frames(response);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.usage).toBeUndefined();
  });

  it('terminates the stream with [DONE]', async () => {
    const { response } = pseudoStreamFromCall(completion(), params);
    expect(await response.text()).toContain('data: [DONE]');
  });
});
