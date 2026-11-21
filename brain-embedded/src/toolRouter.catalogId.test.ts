/**
 * A model that names a tool by its catalog id (`tasks.archive_many`) through the router reaches the advertised tool
 * (`builtin_tasks_archive_many`): the run that called `builtin_tools_invoke` with `tasks.archive_many` got "Unknown tool".
 * The dispatch carries the RESOLVED name, so every guard downstream sees the catalog name.
 */
import { describe, expect, it } from 'vitest';
import { describeTool, handleRouterCall, TOOL_ROUTER_DESCRIBE, TOOL_ROUTER_INVOKE } from './toolRouter';
import type { BrainToolSpec } from './streamChatCompletion';

const spec = (name: string): BrainToolSpec => ({
  type: 'function',
  function: { name, description: `${name} tool`, parameters: { type: 'object', properties: {} } },
});

const catalog: BrainToolSpec[] = [spec('read_file'), spec('builtin_tasks_archive_many'), spec('builtin_tasks_list')];

describe('the tool router resolves a catalog id to the advertised tool', () => {
  it('invoke with a dotted catalog id dispatches the advertised name', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_INVOKE, { name: 'tasks.archive_many', args: { ids: [1, 2] } });
    expect(out).toEqual({ dispatch: { name: 'builtin_tasks_archive_many', args: { ids: [1, 2] } } });
  });

  it('invoke with the unprefixed underscore form dispatches the advertised name', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_INVOKE, { name: 'tasks_list' });
    expect(out).toEqual({ dispatch: { name: 'builtin_tasks_list', args: {} } });
  });

  it('describe with a dotted catalog id answers with the advertised name', () => {
    expect(describeTool(catalog, 'tasks.archive_many')?.function?.name).toBe('builtin_tasks_archive_many');
    const out = handleRouterCall(catalog, TOOL_ROUTER_DESCRIBE, { name: 'tasks.archive_many' });
    expect(out).toMatchObject({ result: { name: 'builtin_tasks_archive_many' } });
  });

  it('an unknown name still errors, with the same text', () => {
    const invoked = handleRouterCall(catalog, TOOL_ROUTER_INVOKE, { name: 'tasks.delete_everything' });
    expect(invoked).toEqual({ result: { error: 'Unknown tool "tasks.delete_everything". Use builtin_tools_find to look up the exact name.' } });
    const described = handleRouterCall(catalog, TOOL_ROUTER_DESCRIBE, { name: 'tasks.delete_everything' });
    expect(described).toEqual({ result: { error: 'Unknown tool "tasks.delete_everything". Use builtin_tools_find to look up the exact name.' } });
  });

  it('a router tool named by its catalog id is still refused', () => {
    const catalogWithRouter = [...catalog, spec(TOOL_ROUTER_INVOKE)];
    const out = handleRouterCall(catalogWithRouter, TOOL_ROUTER_INVOKE, { name: 'tools.invoke' });
    expect(out).toEqual({ result: { error: 'tools.invoke cannot be invoked through the router.' } });
  });
});
