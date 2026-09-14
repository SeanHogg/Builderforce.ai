#!/usr/bin/env node
/**
 * xAI tool-call smoke test — stage 1 of the "Grok won't call tools" isolation ladder.
 *
 * Talks to https://api.x.ai/v1/responses DIRECTLY, with no gateway code at all, and runs
 * the documented function-calling loop: Grok → function_call → our fake executor →
 * function_call_output → Grok → … → final answer. For every step it prints the RAW
 * output item types, so the one binary question is answered from the wire:
 *
 *   Did xAI return a structured `function_call`?
 *     yes → the model and account are fine; look at stage 2
 *           (src/application/llm/vendors/xaiOAuth.live.test.ts — the same request
 *           through our adapter) and the "Per model:" raw-response line of a real chat.
 *     no  → the tools, the request parameters, the prompt, or the model itself.
 *
 * Usage:
 *   XAI_API_KEY=xai-… node scripts/xai-tool-call-smoke.mjs [--model grok-4.6] [--tools 2] [--stream] [--oauth]
 *
 *   --tools N  advertise N tools: search_code + read_file, padded with unrelated fillers
 *              (run 2, 5, then 67 to see whether catalog size degrades selection)
 *   --stream   stream the response and report which SSE event carried each call
 *   --oauth    read the SuperGrok OAuth access token from XAI_OAUTH_TOKEN instead of an API key
 *
 * Exit code 0 when Grok made at least one structured call and then answered; 1 otherwise.
 */

const ENDPOINT = 'https://api.x.ai/v1/responses';
const MAX_STEPS = 6;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

const model = arg('model', 'grok-4.6');
const toolCount = Number(arg('tools', 2));
const streamed = arg('stream', false) === true;
const key = arg('oauth', false) === true ? process.env.XAI_OAUTH_TOKEN : process.env.XAI_API_KEY;
if (!key) {
  console.error(`Set ${arg('oauth', false) === true ? 'XAI_OAUTH_TOKEN' : 'XAI_API_KEY'} first.`);
  process.exit(2);
}

const CORE_TOOLS = [
  {
    type: 'function',
    name: 'search_code',
    description: 'Search the repository for source code matching a query.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text or code to search for' } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'read_file',
    description: 'Read a file from the repository.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Repository-relative path' } },
      required: ['path'],
      additionalProperties: false,
    },
  },
];
const tools = [
  ...CORE_TOOLS,
  ...Array.from({ length: Math.max(0, toolCount - CORE_TOOLS.length) }, (_, i) => ({
    type: 'function',
    name: `workspace_util_${i}`,
    description: `Unrelated workspace utility #${i}: manages billing, calendars and notifications. Never needed to read or search code.`,
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  })),
];

/** The fake executor: a fixed repository with one component in it. */
function execute(name, args) {
  if (name === 'search_code') {
    return { ok: true, matches: [{ path: 'src/room/RoomRoster.tsx', line: 12, text: 'export function RoomRoster({ people }: Props) {' }] };
  }
  if (name === 'read_file') {
    return { ok: true, path: args.path, content: 'export function RoomRoster({ people }: Props) {\n  return <aside>{people.map(renderPerson)}</aside>;\n}\n' };
  }
  return { ok: false, error: `Unknown tool: ${name}` };
}

/** One Responses request; returns the terminal response object and, when streamed, the event log. */
async function send(input) {
  const body = {
    model,
    instructions: 'You are a coding agent. Use the tools to inspect the repository, then answer.',
    input,
    tools,
    tool_choice: 'auto',
    store: false,
    include: ['reasoning.encrypted_content'],
    ...(streamed ? { stream: true } : {}),
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 800)}`);
  if (!streamed) return { response: await res.json(), events: [] };

  const events = [];
  let terminal = null;
  let pending = '';
  const decoder = new TextDecoder();
  for await (const bytes of res.body) {
    pending += decoder.decode(bytes, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      const event = JSON.parse(data);
      const itemType = event.item?.type;
      events.push(itemType ? `${event.type}(${itemType}${event.item?.arguments ? ', args' : ''})` : event.type);
      if (event.type === 'response.completed' || event.type === 'response.incomplete') terminal = event.response;
      if (event.type === 'response.failed' || event.type === 'error') throw new Error(`stream failed: ${data.slice(0, 800)}`);
    }
  }
  if (!terminal) throw new Error('stream ended without response.completed');
  return { response: terminal, events };
}

/** Distinct event types in order, with repeat counts — the delta spam collapsed. */
function summarizeEvents(events) {
  const out = [];
  for (const e of events) {
    const last = out.at(-1);
    if (last && last.e === e) last.n += 1;
    else out.push({ e, n: 1 });
  }
  return out.map(({ e, n }) => (n > 1 ? `${e} ×${n}` : e)).join('\n      ');
}

const input = [{ role: 'user', content: [{ type: 'input_text', text: 'Find the RoomRoster component in the repository and tell me what it renders.' }] }];
let structuredCalls = 0;
let answered = false;

console.log(`xAI smoke: model=${model} tools=${tools.length} stream=${streamed}\n`);
for (let step = 1; step <= MAX_STEPS; step += 1) {
  const { response, events } = await send(input);
  const output = Array.isArray(response.output) ? response.output : [];
  const calls = output.filter((item) => item.type === 'function_call');
  const text = output.filter((item) => item.type === 'message')
    .flatMap((item) => item.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text).join('');
  console.log(`step ${step}: output items = [${output.map((item) => item.type).join(', ')}]`);
  if (streamed) console.log(`   events:\n      ${summarizeEvents(events)}`);
  structuredCalls += calls.length;

  if (calls.length === 0) {
    console.log(`   STRUCTURED function_call: NO\n   text: ${JSON.stringify(text.slice(0, 400))}`);
    answered = text.trim().length > 0;
    break;
  }
  // store:false — the conversation is replayed in full: the reasoning and calls exactly
  // as returned, then one function_call_output per call.
  input.push(...output.filter((item) => item.type === 'reasoning' || item.type === 'function_call'));
  for (const call of calls) {
    let parsed = {};
    try { parsed = JSON.parse(call.arguments || '{}'); } catch { /* reported below */ }
    console.log(`   STRUCTURED function_call: ${call.name}(${call.arguments}) call_id=${call.call_id}`);
    input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(execute(call.name, parsed)) });
  }
}

console.log(`\nresult: ${structuredCalls} structured call(s) · ${answered ? 'final answer given' : 'no final answer'}`);
process.exit(structuredCalls > 0 && answered ? 0 : 1);
