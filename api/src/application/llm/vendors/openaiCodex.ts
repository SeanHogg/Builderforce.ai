import { VendorFatalError, VendorRetryableError, pickUsage, type AiModelTier, type VendorCallParams, type VendorCallResult, type VendorEnv, type VendorModule, type VendorStreamResult } from './types';

const ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses';
type PackedAuth = { accessToken: string; accountId: string };

function unpack(value: string): PackedAuth {
  const auth = JSON.parse(value) as PackedAuth;
  if (!auth.accessToken || !auth.accountId) throw new Error('Incomplete OpenAI Codex auth');
  return auth;
}

function requestBody(params: VendorCallParams): Record<string, unknown> {
  const tools = params.tools?.map((raw) => {
    const tool = raw as { type?: string; function?: { name?: string; description?: string; parameters?: unknown } };
    return tool.type === 'function' && tool.function ? { type: 'function', ...tool.function } : raw;
  });
  const instructions = params.messages
    .filter((message) => message['role'] === 'system' || message['role'] === 'developer')
    .map((message) => typeof message['content'] === 'string' ? message['content'] : JSON.stringify(message['content'] ?? ''))
    .filter(Boolean)
    .join('\n\n') || 'You are a helpful assistant.';
  const input = params.messages
    .filter((message) => message['role'] !== 'system' && message['role'] !== 'developer')
    .flatMap((message) => {
    const role = String(message['role'] ?? 'user');
    if (role === 'tool') {
      return [{ type: 'function_call_output', call_id: String(message['tool_call_id'] ?? ''), output: typeof message['content'] === 'string' ? message['content'] : JSON.stringify(message['content'] ?? '') }];
    }
    const items: Array<Record<string, unknown>> = [];
    if (message['content'] !== undefined && message['content'] !== null && message['content'] !== '') {
      const content = typeof message['content'] === 'string'
        ? [{ type: role === 'assistant' ? 'output_text' : 'input_text', text: message['content'] }]
        : message['content'];
      items.push({ role, content });
    }
    if (role === 'assistant' && Array.isArray(message['tool_calls'])) {
      for (const raw of message['tool_calls']) {
        const call = raw as { id?: string; function?: { name?: string; arguments?: string } };
        items.push({ type: 'function_call', call_id: call.id ?? '', name: call.function?.name ?? '', arguments: call.function?.arguments ?? '{}' });
      }
    }
    return items;
  });
  const rawChoice = params.toolChoice as { type?: string; function?: { name?: string } } | string | undefined;
  const toolChoice = rawChoice && typeof rawChoice === 'object' && rawChoice.type === 'function'
    ? { type: 'function', name: rawChoice.function?.name }
    : rawChoice;
  return { model: params.model, instructions, input, store: false, ...(tools ? { tools } : {}), ...(toolChoice ? { tool_choice: toolChoice } : {}), ...(params.maxTokens ? { max_output_tokens: params.maxTokens } : {}) };
}

async function callResponses(params: VendorCallParams): Promise<VendorCallResult> {
  const auth = unpack(params.apiKey);
  const response = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${auth.accessToken}`, 'ChatGPT-Account-Id': auth.accountId }, body: JSON.stringify(requestBody(params)), signal: params.signal });
  if (!response.ok) {
    const message = (await response.text()).slice(0, 500);
    if (response.status === 400 || response.status === 422) throw new VendorFatalError('openai-codex', response.status, message);
    throw new VendorRetryableError('openai-codex', params.model, response.status, message);
  }
  const raw = await response.json() as { id?: string; output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }>; name?: string; arguments?: string; call_id?: string }>; output_text?: string; usage?: unknown };
  const content = raw.output_text ?? raw.output?.flatMap((item) => item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('') ?? '';
  const toolCalls = raw.output?.filter((item) => item.type === 'function_call').map((item, index) => ({ id: item.call_id ?? `call_${index}`, type: 'function', function: { name: item.name ?? '', arguments: item.arguments ?? '{}' } })) ?? [];
  const usage = pickUsage(raw.usage);
  const chatRaw = { id: raw.id ?? `chatcmpl_${crypto.randomUUID()}`, object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls.length ? 'tool_calls' : 'stop' }], usage };
  return { raw: chatRaw, content, usage };
}

export const openAiCodexModule: VendorModule = {
  id: 'openai-codex', autoRoute: false,
  catalog: [{ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex', brand: 'OpenAI Codex', tier: 'ULTRA', capabilities: ['tools', 'structured_output', 'vision'], contextWindow: 400000 }],
  tierFor(): AiModelTier { return 'ULTRA'; },
  apiKeyFrom(env: VendorEnv): string | null { return env.OPENAI_CODEX_AUTH ?? null; },
  call: callResponses,
  async callStream(params: VendorCallParams): Promise<VendorStreamResult> {
    const result = await callResponses(params);
    const raw = result.raw as { id: string; choices: Array<{ message: { content: string; tool_calls?: unknown[] }; finish_reason: string }> };
    const choice = raw.choices[0];
    const chunk = { id: raw.id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: choice?.message.content ?? '', ...(choice?.message.tool_calls ? { tool_calls: choice.message.tool_calls } : {}) }, finish_reason: choice?.finish_reason ?? 'stop' }] };
    return { response: new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }) };
  },
};
