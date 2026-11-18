import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_LABEL, isToolsUnsupported, MAX_TOOL_ROUNDS, runWithTools, SUPERSEDED_IMAGE, toolResultMessages,
  type BrowserToolHost, type ModelTurn, type ModelTurnCall,
} from './toolLoop';
import { runOnce, type BrowserRuntimeTransport } from './runner';
import { toolCallsOf } from './transport';

const host = (result: unknown = { ok: true }): BrowserToolHost & { execute: ReturnType<typeof vi.fn> } => ({
  schemas: () => [{ type: 'function', function: { name: 'runtime_preview_status', description: 'd', parameters: {} } }],
  execute: vi.fn(async () => result),
});

describe('runWithTools', () => {
  it('runs the tools the model calls and returns its prose answer', async () => {
    const turns: ModelTurnCall[] = [];
    const replies: ModelTurn[] = [
      { toolCalls: [{ id: 'c1', name: 'runtime_preview_status', arguments: '{"projectId":7}' }] },
      { content: 'It is live in the browser.' },
    ];
    const h = host({ ok: true, target: 'browser' });
    const out = await runWithTools(async (call) => { turns.push(structuredClone(call)); return replies.shift()!; }, h, 'm', 'Is it up?');
    expect(out).toBe('It is live in the browser.');
    expect(h.execute).toHaveBeenCalledWith('runtime_preview_status', { projectId: 7 });
    expect(turns[1]!.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"ok":true,"target":"browser"}' });
  });

  it('hands a tool error back to the model instead of failing the run', async () => {
    const h: BrowserToolHost = { schemas: () => [], execute: async () => { throw new Error('boom'); } };
    const replies: ModelTurn[] = [{ toolCalls: [{ id: 'c1', name: 'x', arguments: 'not json' }] }, { content: 'done' }];
    let seen: unknown;
    await runWithTools(async (call) => { seen = call.messages.at(-1); return replies.shift()!; }, h, 'm', 'p');
    expect(seen).toMatchObject({ role: 'tool', content: '{"ok":false,"error":"boom"}' });
  });

  it('stops a runaway loop and asks for an answer without tools', async () => {
    const turn = vi.fn(async (call: ModelTurnCall): Promise<ModelTurn> => (call.tools
      ? { toolCalls: [{ id: 'c', name: 'runtime_preview_status', arguments: '{}' }] }
      : { content: 'final' }));
    expect(await runWithTools(turn, host(), 'm', 'p')).toBe('final');
    expect(turn).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 1);
  });

  it('returns a screenshot as an image part labelled untrusted, not base64 in the tool text', () => {
    const [tool, image] = toolResultMessages({ id: 'c1', name: 'runtime_preview_screenshot', arguments: '{}' }, { ok: true, imageDataUrl: 'data:image/jpeg;base64,AA' });
    expect(String(tool!.content)).not.toContain('base64');
    expect(image).toMatchObject({ role: 'user', content: [{ type: 'text', text: IMAGE_LABEL('runtime_preview_screenshot') }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AA' } }] });
    expect(IMAGE_LABEL('x')).toMatch(/UNTRUSTED PAGE CONTENT/);
  });

  it('keeps only the newest screenshot in the conversation', async () => {
    const shot = { ok: true, imageDataUrl: 'data:image/jpeg;base64,AA' };
    const replies: ModelTurn[] = [
      { toolCalls: [{ id: 'a', name: 'runtime_preview_screenshot', arguments: '{}' }] },
      { toolCalls: [{ id: 'b', name: 'runtime_preview_screenshot', arguments: '{}' }] },
      { content: 'done' },
    ];
    let last: ModelTurnCall | undefined;
    await runWithTools(async (call) => { last = call; return replies.shift()!; }, host(shot), 'm', 'p');
    const images = last!.messages.filter((m) => Array.isArray(m.content));
    expect(images).toHaveLength(1);
    expect(last!.messages.filter((m) => m.content === SUPERSEDED_IMAGE)).toHaveLength(1);
  });

  it('recognises a model or gateway that does not take tools', () => {
    expect(isToolsUnsupported(new Error('This model does not support tool calling'))).toBe(true);
    expect(isToolsUnsupported(new Error('tools are not supported for this provider'))).toBe(true);
    expect(isToolsUnsupported(new Error('rate limited'))).toBe(false);
  });
});

describe('the browser runner with tools', () => {
  it('runs a reasoning dispatch as a tool loop when the transport speaks tool calls', async () => {
    const transport: BrowserRuntimeTransport = {
      claim: async () => ({ dispatchId: 'd1', model: 'm', role: 'qa', input: 'check the preview', taskId: 1 }),
      callModel: vi.fn(async () => 'prose only'),
      callModelTurn: vi.fn(async (): Promise<ModelTurn> => ({ content: 'checked' })),
      report: vi.fn(async () => undefined),
      openPullRequest: async () => null,
    };
    expect(await runOnce(transport, { tools: host() })).toBe('completed');
    expect(transport.callModel).not.toHaveBeenCalled();
    expect(transport.report).toHaveBeenCalledWith('d1', { status: 'completed', output: 'checked' });
  });

  it('falls back to a prose completion when the model turns tools down', async () => {
    const transport: BrowserRuntimeTransport = {
      claim: async () => ({ dispatchId: 'd2', model: 'm', role: 'qa', input: 'check', taskId: 1 }),
      callModel: vi.fn(async () => 'prose answer'),
      callModelTurn: vi.fn(async (): Promise<ModelTurn> => { throw new Error('This model does not support tool calling'); }),
      report: vi.fn(async () => undefined),
      openPullRequest: async () => null,
    };
    expect(await runOnce(transport, { tools: host() })).toBe('completed');
    expect(transport.report).toHaveBeenCalledWith('d2', { status: 'completed', output: 'prose answer' });
  });

  it('reads tool calls out of a chat completion', () => {
    expect(toolCallsOf({ choices: [{ message: { tool_calls: [{ id: 'a', function: { name: 'runtime_preview_url', arguments: '{}' } }, { function: {} }] } }] }))
      .toEqual([{ id: 'a', name: 'runtime_preview_url', arguments: '{}' }]);
  });
});
