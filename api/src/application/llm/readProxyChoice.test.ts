import { describe, expect, it } from 'vitest';
import { readProxyChoice } from './LlmProxyService';

// ---------------------------------------------------------------------------
// readProxyChoice — THE single unwrap of a ProxyResult's HTTP Response body.
//
// Regression for the bug that emptied EVERY BrainService agent reply: consumers
// read `result.response.choices` directly, but `result.response` is an HTTP Response
// (a JSON body), so `.choices` is `undefined` and the reply is always blank regardless
// of what the model returned. These tests pin that the helper actually parses the body,
// exposes tool calls + finish_reason, and never throws on a bad body.
// ---------------------------------------------------------------------------

const jsonResponse = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

describe('readProxyChoice', () => {
  it('parses assistant content out of the Response BODY (not off the Response object)', async () => {
    const result = { response: jsonResponse({ choices: [{ message: { role: 'assistant', content: '  hello team  ' }, finish_reason: 'stop' }] }) };
    const choice = await readProxyChoice(result);
    expect(choice.content).toBe('hello team'); // trimmed
    expect(choice.finishReason).toBe('stop');
    expect(choice.toolCalls).toEqual([]);
  });

  it('exposes tool calls and leaves content empty for a tool-only turn', async () => {
    const result = { response: jsonResponse({ choices: [{ message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'tasks_create', arguments: '{"title":"x"}' } }] }, finish_reason: 'tool_calls' }] }) };
    const choice = await readProxyChoice(result);
    expect(choice.content).toBe('');
    expect(choice.toolCalls).toHaveLength(1);
    expect(choice.toolCalls[0]!.function.name).toBe('tasks_create');
    expect(choice.finishReason).toBe('tool_calls');
  });

  it('surfaces finish_reason=length (the "spent the budget, emitted no text" case)', async () => {
    const result = { response: jsonResponse({ choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'length' }] }) };
    const choice = await readProxyChoice(result);
    expect(choice.content).toBe('');
    expect(choice.finishReason).toBe('length');
  });

  it('returns empty fields (never throws) on a non-JSON body', async () => {
    const result = { response: new Response('<html>gateway error</html>', { status: 502 }) };
    const choice = await readProxyChoice(result);
    expect(choice.content).toBe('');
    expect(choice.message).toBeUndefined();
    expect(choice.body).toBeNull();
  });

  it('CLONES the response — the original body is still readable afterwards (metering re-reads it)', async () => {
    const payload = { choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { total_tokens: 5 } };
    const result = { response: jsonResponse(payload) };
    await readProxyChoice(result);
    // The original Response body was NOT consumed by the helper's clone().
    const reread = await result.response.json();
    expect((reread as { usage: { total_tokens: number } }).usage.total_tokens).toBe(5);
  });

  it('exposes the full parsed body for callers needing usage/other fields', async () => {
    const result = { response: jsonResponse({ choices: [{ message: { content: 'hi' } }], usage: { total_tokens: 9 } }) };
    const choice = await readProxyChoice(result);
    expect((choice.body as { usage?: { total_tokens?: number } })?.usage?.total_tokens).toBe(9);
  });
});
