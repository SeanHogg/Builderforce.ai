/**
 * Tools an earlier turn of the conversation called or named stay advertised on the next run. The failure: a reply named
 * `builtin_tasks_archive_many`, the follow-up's query did not rank it, it missed the cut, and the model narrated a tool it
 * was not offered (`narratedUnadvertised`).
 */
import { describe, expect, it } from 'vitest';
import { PINNED_OVERFLOW, selectToolsForTurn } from '@builderforce/agent-run';
import { brainPlatformTools, selectionPins } from '../run/brainPlatformTools';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { BrainRunContext } from './brainRunContext';
import { conversationPinnedTools, CONVERSATION_PIN_LIMIT, CONVERSATION_PIN_WINDOW } from './conversationPins';

const call = (name: string, args: unknown = {}) => ({ id: `c-${name}`, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });

const CATALOG = ['read_file', 'builtin_tasks_archive_many', 'builtin_tasks_list', 'builtin_kanban_signoff', 'builtin_tools_invoke'];

describe('conversationPinnedTools', () => {
  it('pins a tool an earlier assistant turn called, and one it named in prose', () => {
    const convo: ChatCompletionMessage[] = [
      { role: 'user', content: 'list my tasks' },
      { role: 'assistant', content: '', tool_calls: [call('builtin_tasks_list')] },
      { role: 'tool', content: '[]', tool_call_id: 'c-builtin_tasks_list' },
      { role: 'assistant', content: 'I can archive them with builtin_tasks_archive_many.' },
      { role: 'user', content: 'yes do it' },
    ];
    expect(conversationPinnedTools(convo, CATALOG)).toEqual(['builtin_tasks_archive_many', 'builtin_tasks_list']);
  });

  it('pins the target of a routed call, resolving a catalog id, never the router itself', () => {
    const convo: ChatCompletionMessage[] = [
      { role: 'user', content: 'sign it off' },
      { role: 'assistant', content: '', tool_calls: [call('builtin_tools_invoke', { name: 'kanban.signoff' })] },
      { role: 'user', content: 'again' },
    ];
    expect(conversationPinnedTools(convo, CATALOG)).toEqual(['builtin_kanban_signoff']);
  });

  it('pins a dotted catalog id named in prose, and only when it is a real tool', () => {
    const convo: ChatCompletionMessage[] = [
      { role: 'assistant', content: 'Edit index.ts, then run tasks.archive_many on the done column (e.g. the old ones).' },
      { role: 'user', content: 'ok' },
    ];
    expect(conversationPinnedTools(convo, CATALOG)).toEqual(['builtin_tasks_archive_many']);
  });

  it('reads nothing from the current request and ignores names outside the catalog', () => {
    const convo: ChatCompletionMessage[] = [
      { role: 'assistant', content: 'try builtin_not_in_catalog' },
      { role: 'user', content: 'use builtin_tasks_list now' },
    ];
    expect(conversationPinnedTools(convo, CATALOG)).toEqual([]);
  });

  it('reads only the last window of messages and keeps the newest names under the bound', () => {
    expect(CONVERSATION_PIN_LIMIT).toBeLessThan(PINNED_OVERFLOW);
    const many = Array.from({ length: CONVERSATION_PIN_LIMIT + 4 }, (_, i) => `builtin_tool_n${i}`);
    const convo: ChatCompletionMessage[] = [
      { role: 'assistant', content: 'old: builtin_tasks_list' },
      ...Array.from({ length: CONVERSATION_PIN_WINDOW }, () => ({ role: 'tool' as const, content: 'x', tool_call_id: 'x' })),
      ...many.map((n) => ({ role: 'assistant' as const, content: `use ${n}` })),
      { role: 'user', content: 'go' },
    ];
    const pins = conversationPinnedTools(convo, [...many, 'builtin_tasks_list']);
    expect(pins).toHaveLength(CONVERSATION_PIN_LIMIT);
    expect(pins[0]).toBe(many[many.length - 1]);
    expect(pins).not.toContain('builtin_tasks_list');
  });
});

describe('selectionPins', () => {
  const runOf = (phase: string, conversation: string[], used: string[]) => ({
    policy: { phase },
    catalogToolNames: ['read_file', 'edit_file', 'write_file', 'builtin_tasks_archive_many', 'builtin_tasks_list'],
    usedTools: new Set(used),
    conversationPinnedTools: conversation,
  }) as unknown as BrainRunContext;

  it('puts conversation pins first and only ever appends this run\'s calls, so the list grows at its end', () => {
    const run = runOf('chat', ['builtin_tasks_archive_many'], []);
    const step1 = selectionPins(run, [], []);
    run.usedTools.add('builtin_tasks_list');
    const step2 = selectionPins(run, [], []);
    run.usedTools.add('builtin_tasks_archive_many');
    const step3 = selectionPins(run, [], []);
    expect(step1).toEqual(['builtin_tasks_archive_many']);
    expect(step2).toEqual(['builtin_tasks_archive_many', 'builtin_tasks_list']);
    expect(step2.slice(0, step1.length)).toEqual(step1);
    expect(step3).toEqual(step2);
  });

  it('a capped (verify) turn drops a conversation pin its role cap excludes; an uncapped plan turn keeps it', () => {
    expect(selectionPins(runOf('verify', ['write_file', 'read_file'], []), [], [])).toEqual(['read_file']);
    expect(selectionPins(runOf('plan', ['write_file'], []), [], [])).toEqual(['write_file']);
  });

  it('a tool this run already called keeps its pin whatever the role', () => {
    expect(selectionPins(runOf('verify', ['write_file'], ['write_file']), [], [])).toEqual(['write_file']);
  });
});

describe("the Brain's selection keeps a tool the conversation used", () => {
  const spec = (name: string, description: string) => ({ type: 'function', function: { name, description, parameters: {} } });
  // An oversized catalog the query ranks without the archive tool.
  const catalog = [
    ...Array.from({ length: 80 }, (_, i) => spec(`builtin_parser_tool_${i}`, 'fix the parser')),
    spec('builtin_tasks_archive_many', 'Archive several tasks at once'),
  ];

  it('the next run advertises builtin_tasks_archive_many even though the query does not rank it', () => {
    const convo: ChatCompletionMessage[] = [
      { role: 'user', content: 'clean up the board' },
      { role: 'assistant', content: 'I will call builtin_tasks_archive_many on the done tasks.' },
      { role: 'user', content: 'fix the parser first' },
    ];
    const names = catalog.map((t) => t.function.name);
    const run = {
      c: {}, req: {}, policy: { phase: 'chat' }, canAskUser: false, allTools: [], catalogToolNames: names,
      alwaysAdvertised: [], promptTools: { system: [], turn: [], contract: [] }, usedTools: new Set<string>(),
      conversationPinnedTools: conversationPinnedTools(convo, names), systemPrompt: '', requestQuery: 'fix the parser first',
    } as unknown as BrainRunContext;
    const selection = brainPlatformTools(run).tools.selection;
    expect(selection.pinned).toContain('builtin_tasks_archive_many');

    const unpinned = selectToolsForTurn(catalog, { query: selection.query }).tools.map((t) => t.function?.name);
    expect(unpinned).not.toContain('builtin_tasks_archive_many');
    const pinned = selectToolsForTurn(catalog, { query: selection.query, pinned: selection.pinned }).tools.map((t) => t.function?.name);
    expect(pinned).toContain('builtin_tasks_archive_many');
  });
});
