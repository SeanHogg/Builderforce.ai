import { describe, expect, it } from 'vitest';
import { anthropicEventToOpenAiChunks, newAnthropicStreamState } from './anthropic';

// The Anthropic-SSE → OpenAI-SSE streaming translation ships without a live Anthropic
// endpoint, so the pure per-event mapper is verified here against Anthropic's documented
// event sequence. Downstream consumers expect standard `chat.completion.chunk` frames;
// these assertions pin that shape.

type Chunk = {
  object: string;
  choices: Array<{ index: number; delta: Record<string, unknown>; finish_reason: string | null }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
};

function run(events: Array<Record<string, unknown>>, model = 'claude-opus-4-8'): Chunk[] {
  const st = newAnthropicStreamState(model);
  return events.flatMap((e) => anthropicEventToOpenAiChunks(e, st)) as Chunk[];
}

describe('anthropicEventToOpenAiChunks — text stream', () => {
  const chunks = run([
    { type: 'message_start', message: { usage: { input_tokens: 42 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' world' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ]);

  it('emits standard chat.completion.chunk frames', () => {
    expect(chunks.every((c) => c.object === 'chat.completion.chunk')).toBe(true);
  });

  it('the FIRST content chunk carries role:assistant, later ones do not', () => {
    const contentChunks = chunks.filter((c) => typeof c.choices[0]?.delta.content === 'string');
    expect(contentChunks[0]!.choices[0]!.delta).toEqual({ role: 'assistant', content: 'Hello' });
    expect(contentChunks[1]!.choices[0]!.delta).toEqual({ content: ' world' });
  });

  it('concatenating content deltas reconstructs the full text', () => {
    const text = chunks.map((c) => c.choices[0]?.delta.content ?? '').join('');
    expect(text).toBe('Hello world');
  });

  it('emits a terminal finish_reason chunk then a usage-only chunk', () => {
    const finish = chunks.find((c) => c.choices[0]?.finish_reason === 'stop');
    expect(finish).toBeTruthy();
    const usage = chunks.find((c) => c.usage);
    expect(usage!.usage).toEqual({ prompt_tokens: 42, completion_tokens: 7, total_tokens: 49 });
    expect(usage!.choices).toEqual([]);
  });
});

describe('anthropicEventToOpenAiChunks — tool_use stream', () => {
  const chunks = run([
    { type: 'message_start', message: { usage: { input_tokens: 10 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_1', name: 'tasks_create' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"title":' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Ship"}' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]);

  it('opens the tool call with id + name (role on the first chunk), then streams argument fragments', () => {
    const first = chunks[0]!.choices[0]!.delta as { role?: string; tool_calls?: Array<Record<string, unknown>> };
    expect(first.role).toBe('assistant');
    expect(first.tool_calls![0]).toMatchObject({ index: 0, id: 'toolu_1', type: 'function', function: { name: 'tasks_create', arguments: '' } });
    // Argument fragments concatenate to the full JSON.
    const args = chunks
      .flatMap((c) => (c.choices[0]?.delta as { tool_calls?: Array<{ function?: { arguments?: string } }> })?.tool_calls ?? [])
      .map((t) => t.function?.arguments ?? '')
      .join('');
    expect(args).toBe('{"title":"Ship"}');
  });

  it('maps stop_reason tool_use → finish_reason tool_calls', () => {
    const finish = chunks.find((c) => c.choices[0]?.finish_reason);
    expect(finish!.choices[0]!.finish_reason).toBe('tool_calls');
  });
});
