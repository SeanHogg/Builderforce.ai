import { describe, it, expect } from 'vitest';
import {
  routerToolSpecs,
  isRouterTool,
  handleRouterCall,
  findTools,
  describeTool,
  TOOL_ROUTER_FIND,
  TOOL_ROUTER_DESCRIBE,
  TOOL_ROUTER_INVOKE,
} from './toolRouter';
import type { BrainToolSpec } from './streamChatCompletion';

/**
 * The router exists because per-turn selection is LOSSY and the model cannot tell.
 * In VS Code chat #85 the ticket tools fell below the cut, so `builtin_chats_list_tickets`
 * did not exist from where the model stood — it narrated the call instead, four turns
 * running, and finally reported "only file, search, and run_command tools are available".
 * With the router, that tool is always one lookup away.
 */
const spec = (name: string, description: string): BrainToolSpec => ({
  type: 'function',
  function: { name, description, parameters: { type: 'object', properties: { chatId: { type: 'number' } }, required: ['chatId'] } },
});

const catalog: BrainToolSpec[] = [
  spec('read_file', 'Read a file in the workspace'),
  spec('run_command', 'Run a shell command'),
  spec('builtin_chats_list_tickets', 'List the work items a Brain chat is tied to, with a health summary'),
  spec('builtin_tasks_list', 'List tasks on the board by status'),
  spec('builtin_incidents_list', 'List incidents'),
];

describe('routerToolSpecs', () => {
  it('is exactly three tools — the cost of never losing the catalog', () => {
    const specs = routerToolSpecs(317);
    expect(specs.map((s) => s.function?.name)).toEqual([TOOL_ROUTER_FIND, TOOL_ROUTER_DESCRIBE, TOOL_ROUTER_INVOKE]);
  });

  it('tells the model the catalog is BIGGER than its visible list', () => {
    // Without this the model has no reason to look: an absent tool reads as an
    // absent capability, which is exactly what chat #85 concluded.
    for (const s of routerToolSpecs(317)) {
      expect(s.function?.description).toContain('317 platform tools');
      expect(s.function?.description).toContain('only the most relevant ones are listed');
    }
  });

  it('tells the model NOT to write a call as text — the failure this replaces', () => {
    const find = routerToolSpecs(317)[0]!;
    expect(find.function?.description).toContain('never write a tool call as plain text');
  });
});

describe('findTools', () => {
  it('finds a tool that per-turn selection would have dropped', () => {
    const hits = findTools(catalog, 'tickets backlog status').map((m) => m.name);
    expect(hits).toContain('builtin_chats_list_tickets');
    expect(hits).toContain('builtin_tasks_list');
  });

  it('ranks a NAME match above a description-only match', () => {
    const hits = findTools(catalog, 'tickets').map((m) => m.name);
    expect(hits[0]).toBe('builtin_chats_list_tickets');
  });

  it('returns nothing for an empty query rather than the whole catalog', () => {
    expect(findTools(catalog, '')).toEqual([]);
    expect(findTools(catalog, '   ')).toEqual([]);
  });
});

describe('handleRouterCall', () => {
  it('answers find LOCALLY — no host dispatch, no network', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_FIND, { query: 'tickets' });
    expect('result' in out).toBe(true);
    if (!('result' in out)) throw new Error('unreachable');
    expect((out.result as { matches: Array<{ name: string }> }).matches[0]!.name).toBe('builtin_chats_list_tickets');
  });

  it('says how to proceed when nothing matches, instead of a bare empty list', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_FIND, { query: 'zzzznope' });
    if (!('result' in out)) throw new Error('unreachable');
    expect(String((out.result as { note: string }).note)).toContain('5 tools exist');
  });

  it('describe returns the real schema so the model can build arguments', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_DESCRIBE, { name: 'builtin_chats_list_tickets' });
    if (!('result' in out)) throw new Error('unreachable');
    expect((out.result as { parameters: { required: string[] } }).parameters.required).toEqual(['chatId']);
  });

  it('invoke UNWRAPS to a real dispatch, so every normal guard still applies', () => {
    // Returning a dispatch (rather than calling anything here) is what keeps the
    // confirm gate, dedupe, audit and auto-link on the routed path.
    const out = handleRouterCall(catalog, TOOL_ROUTER_INVOKE, { name: 'builtin_chats_list_tickets', args: { chatId: 85 } });
    expect(out).toEqual({ dispatch: { name: 'builtin_chats_list_tickets', args: { chatId: 85 } } });
  });

  it('defaults missing invoke args to an empty object rather than undefined', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_INVOKE, { name: 'read_file' });
    expect(out).toEqual({ dispatch: { name: 'read_file', args: {} } });
  });

  it('refuses an unknown name with the lookup that fixes it', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_INVOKE, { name: 'builtin_nope' });
    if (!('result' in out)) throw new Error('unreachable');
    expect(String((out.result as { error: string }).error)).toContain(TOOL_ROUTER_FIND);
  });

  it('refuses to route the router through itself', () => {
    const out = handleRouterCall(catalog, TOOL_ROUTER_INVOKE, { name: TOOL_ROUTER_INVOKE });
    if (!('result' in out)) throw new Error('unreachable');
    expect(String((out.result as { error: string }).error)).toContain('cannot be invoked through the router');
  });
});

describe('isRouterTool / describeTool', () => {
  it('recognises only the three router names', () => {
    expect(isRouterTool(TOOL_ROUTER_FIND)).toBe(true);
    expect(isRouterTool(TOOL_ROUTER_INVOKE)).toBe(true);
    expect(isRouterTool('builtin_chats_list_tickets')).toBe(false);
  });

  it('returns null for a name the catalog does not carry', () => {
    expect(describeTool(catalog, 'builtin_nope')).toBeNull();
  });
});
