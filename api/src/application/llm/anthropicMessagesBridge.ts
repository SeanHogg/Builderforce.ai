/**
 * Anthropic Messages ⇄ OpenAI Chat Completions translation.
 *
 * The Claude Agent SDK (BuilderForce-V2) speaks the Anthropic Messages API to
 * whatever `ANTHROPIC_BASE_URL` points at — it does NOT require a real Anthropic
 * key (the Ollama pattern `ANTHROPIC_BASE_URL=…:11434 / ANTHROPIC_AUTH_TOKEN=ollama`
 * proves this). So our gateway can BE that endpoint, backed by our own
 * multi-vendor model pool: translate the inbound Messages request into our
 * OpenAI-compatible proxy request, then translate the response back to Messages
 * shape (non-streaming JSON and streaming SSE). The tenant Anthropic key is then
 * optional (only used to pass through to api.anthropic.com).
 *
 * Pure functions + a pure streaming reducer so the (subtle) shape mapping is
 * unit-testable without a live model.
 */

// ---------------------------------------------------------------------------
// Request: Anthropic Messages → OpenAI Chat Completions
// ---------------------------------------------------------------------------

interface AnthropicContentBlock {
  type?: string;
  text?: unknown;
  // tool_use
  id?: unknown;
  name?: unknown;
  input?: unknown;
  // tool_result
  tool_use_id?: unknown;
  content?: unknown;
  is_error?: unknown;
}

interface AnthropicMessage {
  role?: string;
  content?: string | AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  model?: unknown;
  max_tokens?: unknown;
  stream?: unknown;
  system?: unknown;
  messages?: AnthropicMessage[];
  tools?: Array<{ name?: unknown; description?: unknown; input_schema?: unknown }>;
  tool_choice?: { type?: string; name?: string };
  temperature?: unknown;
  top_p?: unknown;
}

function systemToText(system: unknown): string {
  if (typeof system === 'string') return system;
  if (Array.isArray(system)) {
    return system
      .map((b) => (b && typeof b === 'object' && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : ''))
      .filter(Boolean)
      .join('\n\n');
  }
  return '';
}

/** Flatten an Anthropic content value (string | blocks) to OpenAI text. */
function blocksToText(content: string | AnthropicContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

export function anthropicToOpenAiRequest(body: AnthropicMessagesRequest): Record<string, unknown> {
  const messages: Array<Record<string, unknown>> = [];

  const systemText = systemToText(body.system);
  if (systemText) messages.push({ role: 'system', content: systemText });

  for (const m of body.messages ?? []) {
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = m.content;

    if (typeof content === 'string') {
      messages.push({ role, content });
      continue;
    }
    if (!Array.isArray(content)) continue;

    // Assistant turns may carry tool_use blocks → OpenAI tool_calls.
    if (role === 'assistant') {
      const text = blocksToText(content);
      const toolCalls = content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({
          id: typeof b.id === 'string' ? b.id : '',
          type: 'function' as const,
          function: { name: typeof b.name === 'string' ? b.name : '', arguments: JSON.stringify(b.input ?? {}) },
        }));
      const msg: Record<string, unknown> = { role: 'assistant', content: text || null };
      if (toolCalls.length > 0) msg.tool_calls = toolCalls;
      messages.push(msg);
      continue;
    }

    // User turns may carry tool_result blocks → OpenAI role:'tool' messages.
    const toolResults = content.filter((b) => b.type === 'tool_result');
    const text = blocksToText(content);
    if (text) messages.push({ role: 'user', content: text });
    for (const tr of toolResults) {
      const trContent = typeof tr.content === 'string'
        ? tr.content
        : Array.isArray(tr.content)
          ? blocksToText(tr.content as AnthropicContentBlock[])
          : JSON.stringify(tr.content ?? '');
      messages.push({ role: 'tool', tool_call_id: typeof tr.tool_use_id === 'string' ? tr.tool_use_id : '', content: trContent });
    }
  }

  const out: Record<string, unknown> = {
    messages,
    stream: body.stream === true,
  };
  if (typeof body.model === 'string') out.model = body.model;
  if (typeof body.max_tokens === 'number') out.max_tokens = body.max_tokens;
  if (typeof body.temperature === 'number') out.temperature = body.temperature;
  if (typeof body.top_p === 'number') out.top_p = body.top_p;
  if (body.stream === true) out.stream_options = { include_usage: true };

  if (Array.isArray(body.tools) && body.tools.length > 0) {
    out.tools = body.tools.map((t) => ({
      type: 'function',
      function: {
        name: typeof t.name === 'string' ? t.name : '',
        description: typeof t.description === 'string' ? t.description : undefined,
        parameters: t.input_schema ?? { type: 'object', properties: {} },
      },
    }));
    if (body.tool_choice?.type === 'tool' && body.tool_choice.name) {
      out.tool_choice = { type: 'function', function: { name: body.tool_choice.name } };
    } else if (body.tool_choice?.type === 'any') {
      out.tool_choice = 'required';
    } else if (body.tool_choice?.type === 'auto') {
      out.tool_choice = 'auto';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Response (non-streaming): OpenAI completion → Anthropic Message
// ---------------------------------------------------------------------------

export function mapStopReason(finishReason: string | null | undefined): string {
  switch (finishReason) {
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    case 'stop': return 'end_turn';
    default: return 'end_turn';
  }
}

export function openAiToAnthropicMessage(openai: unknown, model: string, messageId: string): Record<string, unknown> {
  const o = (openai && typeof openai === 'object' ? openai : {}) as {
    choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = o.choices?.[0];
  const content: Array<Record<string, unknown>> = [];

  const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  if (text) content.push({ type: 'text', text });

  for (const tc of choice?.message?.tool_calls ?? []) {
    let input: unknown = {};
    try { input = tc.function?.arguments ? JSON.parse(tc.function.arguments) : {}; } catch { input = {}; }
    content.push({ type: 'tool_use', id: tc.id ?? '', name: tc.function?.name ?? '', input });
  }
  if (content.length === 0) content.push({ type: 'text', text: '' });

  return {
    id: messageId,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: mapStopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: o.usage?.prompt_tokens ?? 0,
      output_tokens: o.usage?.completion_tokens ?? 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Response (streaming): OpenAI SSE chunks → Anthropic SSE events
// ---------------------------------------------------------------------------

interface OpenAiStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Stateful, pure reducer translating the OpenAI streaming chunks into Anthropic
 * Messages SSE events. `feed` returns the SSE text to forward for one chunk;
 * `finish` closes the message. Tracks content-block indices so text and
 * tool_use blocks are emitted as a well-formed Anthropic sequence.
 */
export function createAnthropicStreamEncoder(opts: { messageId: string; model: string }) {
  let started = false;
  let nextIndex = 0;
  /** The currently-open content block, or null. */
  let current: { kind: 'text' } | { kind: 'tool'; openAiIndex: number } | null = null;
  /** anthropic block index for each OpenAI tool_call index. */
  const toolIndexMap = new Map<number, number>();
  let stopReason = 'end_turn';
  let outputTokens = 0;
  let inputTokens = 0;

  const startMessage = (): string =>
    sse('message_start', {
      type: 'message_start',
      message: {
        id: opts.messageId, type: 'message', role: 'assistant', model: opts.model,
        content: [], stop_reason: null, stop_sequence: null,
        usage: { input_tokens: inputTokens, output_tokens: 0 },
      },
    });

  const closeCurrent = (): string => {
    if (!current) return '';
    const idx = current.kind === 'text' ? textIndex! : toolIndexMap.get(current.openAiIndex)!;
    current = null;
    return sse('content_block_stop', { type: 'content_block_stop', index: idx });
  };

  let textIndex: number | undefined;

  return {
    feed(chunk: OpenAiStreamChunk): string {
      let out = '';
      if (!started) { started = true; out += startMessage(); }

      const choice = chunk.choices?.[0];
      const delta = choice?.delta;

      if (chunk.usage) {
        if (typeof chunk.usage.prompt_tokens === 'number') inputTokens = chunk.usage.prompt_tokens;
        if (typeof chunk.usage.completion_tokens === 'number') outputTokens = chunk.usage.completion_tokens;
      }

      if (typeof delta?.content === 'string' && delta.content.length > 0) {
        if (current?.kind !== 'text') {
          out += closeCurrent();
          textIndex = nextIndex++;
          current = { kind: 'text' };
          out += sse('content_block_start', { type: 'content_block_start', index: textIndex, content_block: { type: 'text', text: '' } });
        }
        out += sse('content_block_delta', { type: 'content_block_delta', index: textIndex, delta: { type: 'text_delta', text: delta.content } });
      }

      for (const tc of delta?.tool_calls ?? []) {
        const oi = typeof tc.index === 'number' ? tc.index : 0;
        if (!toolIndexMap.has(oi)) {
          out += closeCurrent();
          const idx = nextIndex++;
          toolIndexMap.set(oi, idx);
          current = { kind: 'tool', openAiIndex: oi };
          out += sse('content_block_start', {
            type: 'content_block_start', index: idx,
            content_block: { type: 'tool_use', id: tc.id ?? `toolu_${idx}`, name: tc.function?.name ?? '', input: {} },
          });
        } else if (current?.kind !== 'tool' || current.openAiIndex !== oi) {
          // resume a tool block that isn't current
          out += closeCurrent();
          current = { kind: 'tool', openAiIndex: oi };
        }
        const args = tc.function?.arguments;
        if (typeof args === 'string' && args.length > 0) {
          out += sse('content_block_delta', { type: 'content_block_delta', index: toolIndexMap.get(oi)!, delta: { type: 'input_json_delta', partial_json: args } });
        }
      }

      if (typeof choice?.finish_reason === 'string') stopReason = mapStopReason(choice.finish_reason);

      return out;
    },

    finish(): string {
      let out = '';
      if (!started) out += startMessage();
      out += closeCurrent();
      out += sse('message_delta', { type: 'message_delta', delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: outputTokens } });
      out += sse('message_stop', { type: 'message_stop' });
      return out;
    },
  };
}

/**
 * Pipe an OpenAI Chat-Completions SSE body through the encoder into an Anthropic
 * Messages SSE stream, capturing token usage for metering on completion. Workers-
 * compatible (Web Streams). The stream plumbing lives here so the route stays thin.
 */
export function pipeOpenAiSseToAnthropic(
  openaiStream: ReadableStream<Uint8Array>,
  encoder: ReturnType<typeof createAnthropicStreamEncoder>,
  onUsage: (u: { promptTokens: number; completionTokens: number; totalTokens: number }) => void,
): ReadableStream<Uint8Array> {
  const textEnc = new TextEncoder();
  const textDec = new TextDecoder();
  const reader = openaiStream.getReader();
  let buffer = '';
  let prompt = 0;
  let completion = 0;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await reader.read();
      if (done) {
        controller.enqueue(textEnc.encode(encoder.finish()));
        onUsage({ promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion });
        controller.close();
        return;
      }
      buffer += textDec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let chunk: unknown;
        try { chunk = JSON.parse(data); } catch { continue; }
        const u = (chunk as { usage?: { prompt_tokens?: number; completion_tokens?: number } }).usage;
        if (u) {
          if (typeof u.prompt_tokens === 'number') prompt = u.prompt_tokens;
          if (typeof u.completion_tokens === 'number') completion = u.completion_tokens;
        }
        const outSse = encoder.feed(chunk as Parameters<typeof encoder.feed>[0]);
        if (outSse) controller.enqueue(textEnc.encode(outSse));
      }
    },
    cancel() { void reader.cancel().catch(() => { /* already closed */ }); },
  });
}
