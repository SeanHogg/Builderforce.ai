import { describe, expect, it, vi } from 'vitest';
import { answer, callTool, runOn, script, stepsLabelled, toolSpec } from '../test/engineKit';
import type { BrainStreamFn } from '../runStore/runTypes';
import { TOOL_ROUTER_INVOKE } from '../toolRouter';
import { modelToolNames } from './modelToolNames';
import { brainModelTransport } from './modelTransport';

const create = { name: 'builtin_tasks_create', wireName: 'platform__tasks_create' };
const list = { name: 'builtin_tasks_list', wireName: 'platform__tasks_list' };
const review = { name: 'builtin_reviews_record', wireName: 'platform__reviews_record' };

describe('MCP names at the Brain model boundary', () => {
  it('maps a forced menu, prompt and tool history without editing user text', async () => {
    const tools = [toolSpec(create.name), toolSpec('read_file')];
    const stream = vi.fn<BrainStreamFn>(async (_options, handlers) => {
      handlers?.onToolCallDelta?.(0, { name: create.wireName, argsFragment: '{' });
      return callTool(create.wireName)();
    });
    const wrapped = modelToolNames({ tools, stream, wireToolNames: [create, { name: 'read_file', wireName: create.name }] });
    const onToolCallDelta = vi.fn();
    const result = await wrapped.stream({ tools, tool_choice: 'required', messages: [
      { role: 'system', content: `Call ${create.name}; ${create.name}_bulk is a different tool.` },
      { role: 'user', content: `Please use ${create.name}` },
      { role: 'assistant', content: '', tool_calls: [{ id: 'history', type: 'function', function: { name: create.name, arguments: '{}' } }] },
      { role: 'tool', content: '{}', tool_call_id: 'history' },
    ] }, { onToolCallDelta });

    const [wire] = stream.mock.calls[0]!;
    expect(wire.tool_choice).toBe('required');
    expect(wire.tools?.map((tool) => tool.function.name)).toEqual([create.wireName, 'read_file']);
    expect(wire.messages[0]?.content).toBe(`Call ${create.wireName}; ${create.name}_bulk is a different tool.`);
    expect(wire.messages[1]?.content).toBe(`Please use ${create.name}`);
    expect(wire.messages[2]?.tool_calls?.[0]?.function.name).toBe(create.wireName);
    expect(wire.messages[3]?.tool_call_id).toBe('history');
    expect(result.toolCalls[0]?.name).toBe(create.name);
    expect(onToolCallDelta).toHaveBeenCalledWith(0, { name: create.name, argsFragment: '{' });
  });

  it('keeps the original stream for ambiguous or unregistered aliases', () => {
    const stream: BrainStreamFn = async () => answer('done')();
    expect(modelToolNames({ stream, tools: [toolSpec(list.name), toolSpec(create.name)], wireToolNames: [
      create, { name: list.name, wireName: create.wireName }, { name: review.name, wireName: review.wireName },
    ] }).stream).toBe(stream);
  });

  it('rewrites the generated forced-run tail while leaving the person\'s message verbatim', async () => {
    const tools = [toolSpec(create.name)];
    const stream = vi.fn<BrainStreamFn>(async () => answer('done')());
    const names = modelToolNames({ tools, stream, wireToolNames: [create] });
    const model = brainModelTransport({
      stream: names.stream, mapTailSection: names.mapPrompt,
      turn: { open: () => ({ handlers: {}, maxTokens: undefined, toolChoice: 'required',
        tail: [`Call ${create.name} now.`], completed: () => undefined, failed: (error) => error }) },
    });
    await model.complete({ messages: [{ role: 'user', content: `What does ${create.name} do?` }], tools });
    const [wire] = stream.mock.calls[0]!;
    expect(wire.tool_choice).toBe('required');
    expect(wire.tools?.map((tool) => tool.function.name)).toEqual([create.wireName]);
    expect(wire.messages.map((message) => message.content)).toEqual([
      `What does ${create.name} do?`, `<run-state>\nCall ${create.wireName} now.\n</run-state>`,
    ]);
  });

  it('stamps the same chat and checks approval for canonical and legacy creates', async () => {
    const runTool = vi.fn(async (_name: string, _args: unknown) => ({ id: 12, chatLink: { linked: true } }));
    const needsConfirm = vi.fn(() => false);
    const run = await runOn(9461, () => ({
      entryPoint: 'rovr', userTurn: 'Create two tickets', serverChatId: 71,
      tools: [toolSpec(create.name)], wireToolNames: [create], runTool, needsConfirm,
      stream: script([
        callTool(create.wireName, { title: 'first', chatId: 123 }),
        callTool(create.name, { title: 'second' }),
        callTool(TOOL_ROUTER_INVOKE, { name: create.wireName, args: { title: 'through the router' } }),
        answer('Created all three.'),
      ]),
    }));
    expect(run.asked[0]?.tools?.some((tool) => tool.function.name === create.wireName)).toBe(true);
    expect(needsConfirm.mock.calls).toHaveLength(3);
    expect(runTool.mock.calls.map(([name, args]) => [name, args])).toEqual([
      [create.name, { title: 'first', chatId: 71 }], [create.name, { title: 'second', chatId: 71 }],
      [create.name, { title: 'through the router', chatId: 71 }],
    ]);
    expect(run.cell.ticketRecorded).toBe(true);
  });

  it('runs the independent-review gate before a canonical review can dispatch', async () => {
    const runTool = vi.fn(async () => ({}));
    const run = await runOn(9462, () => ({
      userTurn: 'Record a complete review', tools: [toolSpec(review.name)], wireToolNames: [review], runTool,
      git: { outgoing: async () => ({ files: [], diffHash: 'hash', baseBranch: true, diff: 'fixture' }) },
      stream: script([callTool(review.wireName, { taskId: 1, verdict: 'complete' }), answer('The review was refused.')]),
    }));
    expect(runTool).not.toHaveBeenCalled();
    expect(stepsLabelled(run.trace, review.name).some((event) => JSON.stringify(event.result).includes('review'))).toBe(true);
  });

  it('deduplicates equivalent old and canonical read calls in the run', async () => {
    const runTool = vi.fn(async (_name: string, _args: unknown) => ({ rows: [1] }));
    await runOn(9463, () => ({
      entryPoint: 'rovr', userTurn: 'List tasks', tools: [toolSpec(list.name)], wireToolNames: [list], runTool,
      stream: script([callTool(list.wireName), callTool(list.name), answer('Listed.')]),
    }));
    expect(runTool).toHaveBeenCalledTimes(1);
    expect(runTool.mock.calls[0]?.slice(0, 2)).toEqual([list.name, {}]);
  });
});
