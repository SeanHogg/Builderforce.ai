import { VendorFatalError, VendorRetryableError, pickUsage, type AiModelTier, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModule, type VendorStreamResult } from './types';

const ENDPOINT = 'https://api.x.ai/v1/responses';

function bodyFor(params: VendorCallParams): Record<string, unknown> {
  const tools = params.tools?.map((raw) => {
    const tool = raw as { type?: string; function?: Record<string, unknown> };
    return tool.type === 'function' && tool.function ? { type: 'function', ...tool.function } : raw;
  });
  const instructions = params.messages.filter((m) => m['role'] === 'system' || m['role'] === 'developer').map((m) => String(m['content'] ?? '')).filter(Boolean).join('\n\n') || 'You are a helpful assistant.';
  const input = params.messages.filter((m) => m['role'] !== 'system' && m['role'] !== 'developer').flatMap((message) => {
    const role = String(message['role'] ?? 'user');
    if (role === 'tool') return [{ type: 'function_call_output', call_id: String(message['tool_call_id'] ?? ''), output: typeof message['content'] === 'string' ? message['content'] : JSON.stringify(message['content'] ?? '') }];
    const items: Array<Record<string, unknown>> = [];
    if (message['content'] !== undefined && message['content'] !== null && message['content'] !== '') items.push({ role, content: typeof message['content'] === 'string' ? [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: message['content'] }] : message['content'] });
    if (role === 'assistant' && Array.isArray(message['tool_calls'])) for (const raw of message['tool_calls']) {
      const call = raw as { id?: string; function?: { name?: string; arguments?: string } };
      items.push({ type: 'function_call', call_id: call.id ?? '', name: call.function?.name ?? '', arguments: call.function?.arguments ?? '{}' });
    }
    return items;
  });
  return { model: params.model, instructions, input, store: false, ...(tools ? { tools } : {}), ...(params.maxTokens ? { max_output_tokens: params.maxTokens } : {}) };
}

async function call(params: VendorCallParams): Promise<VendorCallResult> {
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${params.apiKey}` }, body: JSON.stringify(bodyFor(params)), signal: params.signal });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 1000);
    if (response.status === 400 || response.status === 422) throw new VendorFatalError('xai-oauth', response.status, message);
    throw new VendorRetryableError('xai-oauth', params.model, response.status, message);
  }
  const raw = await response.json() as { id?: string; output_text?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }>; name?: string; arguments?: string; call_id?: string }>; usage?: unknown };
  const content = raw.output_text ?? raw.output?.flatMap((item) => item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('') ?? '';
  const toolCalls = raw.output?.filter((item) => item.type === 'function_call').map((item, i) => ({ id: item.call_id ?? `call_${i}`, type: 'function', function: { name: item.name ?? '', arguments: item.arguments ?? '{}' } })) ?? [];
  const usage = pickUsage(raw.usage);
  const chatRaw = { id: raw.id ?? `chatcmpl_${crypto.randomUUID()}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }], usage };
  return { raw: chatRaw, content, usage };
}

export const xaiOAuthModule: VendorModule = {
  id: 'xai-oauth', autoRoute: false,
  catalog: [{ id: 'grok-4.3', label: 'Grok 4.3', brand: 'xAI SuperGrok', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 1000000 }],
  tierFor(): AiModelTier { return 'ULTRA'; },
  apiKeyFrom(env: VendorEnv): string | null { return env.XAI_OAUTH_TOKEN ?? null; },
  call,
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    const result = await call(params);
    const raw = result.raw as { id: string; choices: Array<{ message: { content: string; tool_calls?: unknown[] }; finish_reason: string }> };
    const choice = raw.choices[0];
    const chunk = { id: raw.id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: choice?.message.content ?? '', ...(choice?.message.tool_calls ? { tool_calls: choice.message.tool_calls } : {}) }, finish_reason: choice?.finish_reason ?? 'stop' }] };
    return { response: new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }) };
  },
};
