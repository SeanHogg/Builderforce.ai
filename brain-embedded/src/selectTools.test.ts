import { describe, it, expect } from 'vitest';
import { selectToolsForTurn, DEFAULT_TOOL_LIMIT } from './selectTools';
import type { BrainToolSpec } from './streamChatCompletion';

const tool = (name: string, description = ''): BrainToolSpec => ({
  type: 'function',
  function: { name, description, parameters: {} },
});

/** A catalog the size of the real one (~300), so trimming actually engages. */
function bigCatalog(): BrainToolSpec[] {
  const domains = ['tasks', 'projects', 'okrs', 'specs', 'workflows', 'repos', 'agents', 'quality'];
  const verbs = ['list', 'get', 'create', 'update', 'delete', 'search', 'link', 'archive'];
  const out: BrainToolSpec[] = [];
  for (const d of domains) {
    for (const v of verbs) {
      for (let i = 0; i < 5; i++) out.push(tool(`builtin_${d}_${v}${i || ''}`, `${v} ${d}`));
    }
  }
  return out; // 320
}

describe('selectToolsForTurn', () => {
  it('leaves a small catalog completely untouched', () => {
    const tools = [tool('a'), tool('b')];
    const sel = selectToolsForTurn(tools, { query: 'anything' });
    expect(sel.trimmed).toBe(false);
    expect(sel.tools).toEqual(tools);
  });

  it('trims an oversized catalog to the limit', () => {
    const sel = selectToolsForTurn(bigCatalog(), { query: 'chart task status' });
    expect(sel.available).toBe(320);
    expect(sel.trimmed).toBe(true);
    expect(sel.tools.length).toBe(DEFAULT_TOOL_LIMIT);
  });

  it('puts the RELEVANT domain first — the whole point of selecting', () => {
    // The live failure: "Chart how this project's tasks are distributed across
    // statuses" with 308 tools advertised and zero calls made.
    const sel = selectToolsForTurn(bigCatalog(), { query: "Chart how this project's tasks are distributed across statuses" });
    const names = sel.tools.map((t) => t.function.name);
    expect(names.some((n) => n.startsWith('builtin_tasks_'))).toBe(true);
    // Task tools must be near the front, not buried past the cut.
    expect(names.findIndex((n) => n.startsWith('builtin_tasks_'))).toBeLessThan(10);
  });

  it('matches singular/plural ("task" finds builtin_tasks_*)', () => {
    const sel = selectToolsForTurn(bigCatalog(), { query: 'create a task' });
    expect(sel.tools.map((t) => t.function.name).slice(0, 12).some((n) => n.startsWith('builtin_tasks_'))).toBe(true);
  });

  it('never drops a tool the run already called', () => {
    const sel = selectToolsForTurn(bigCatalog(), {
      query: 'something totally unrelated to repos',
      pinned: ['builtin_repos_link', 'builtin_quality_search'],
    });
    const names = sel.tools.map((t) => t.function.name);
    expect(names).toContain('builtin_repos_link');
    expect(names).toContain('builtin_quality_search');
  });

  it('still returns a full, stable set for a vague query', () => {
    const sel = selectToolsForTurn(bigCatalog(), { query: 'help me' });
    expect(sel.tools.length).toBe(DEFAULT_TOOL_LIMIT);
    // Deterministic: the same query yields the same selection.
    expect(selectToolsForTurn(bigCatalog(), { query: 'help me' }).tools.map((t) => t.function.name))
      .toEqual(sel.tools.map((t) => t.function.name));
  });

  it('never emits duplicates even when a pinned tool also scores', () => {
    const sel = selectToolsForTurn(bigCatalog(), { query: 'tasks', pinned: ['builtin_tasks_list'] });
    const names = sel.tools.map((t) => t.function.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('handles an absent catalog', () => {
    expect(selectToolsForTurn(undefined, { query: 'x' })).toEqual({ tools: [], trimmed: false, available: 0 });
  });
});

/**
 * Regression, measured on VS Code chat #85 (317 tools, 64 advertised).
 *
 * The run loop pushes its OWN `role:'user'` turns — the stall-recovery nudge, the
 * tool-budget close-out — so a selector fed "the latest user message" re-rolled the
 * advertised set from text the LOOP wrote. After one recovery the query became
 * "…made zero tool calls… answer using its result…", which scores `key_results` /
 * `dashboards` / `incidents` and drops the ticket tools entirely. The model was then
 * telling the truth when it said "only file, search, and run_command tools are
 * available" — and had been narrating `builtin_chats_list_tickets` because the SYSTEM
 * PROMPT names it.
 */
describe('the advertised set is driven by the request, not by loop-injected text', () => {
  const catalog: BrainToolSpec[] = Array.from({ length: 200 }, (_, i) => ({
    type: 'function',
    function: { name: `builtin_pad_${i}_call_data_result`, description: 'padding that matches nudge words' },
  }));
  const ticketTool: BrainToolSpec = {
    type: 'function',
    function: { name: 'builtin_chats_list_tickets', description: 'List the work items a chat is tied to' },
  };
  // Deliberately LAST: catalog-order backfill must not be what saves it.
  const tools = [...catalog, ticketTool];
  const nudge = 'You said you would call a tool but did not actually call one — your last turn made zero tool calls. Make the call NOW in this turn, then answer using its result.';
  const request = 'review all tickets in the backlog and group them by their status';

  it('keeps the requested tool when the query is the real request', () => {
    const sel = selectToolsForTurn(tools, { query: request, limit: 20 });
    expect(sel.tools.map((t) => t.function!.name)).toContain('builtin_chats_list_tickets');
  });

  it('loses it when the query is the recovery nudge — the bug this pins', () => {
    const sel = selectToolsForTurn(tools, { query: nudge, limit: 20 });
    expect(sel.tools.map((t) => t.function!.name)).not.toContain('builtin_chats_list_tickets');
  });

  it('keeps it ANYWAY when the system prompt names it as required', () => {
    // The prompt-named backstop makes the selection safe even under a bad query:
    // never instruct a model to call a tool and then decline to advertise it.
    const sel = selectToolsForTurn(tools, { query: nudge, limit: 20, required: ['builtin_chats_list_tickets'] });
    expect(sel.tools.map((t) => t.function!.name)).toContain('builtin_chats_list_tickets');
  });

  it('required outranks relevance, so it survives even at limit 1', () => {
    const sel = selectToolsForTurn(tools, { query: nudge, limit: 1, required: ['builtin_chats_list_tickets'] });
    expect(sel.tools.map((t) => t.function!.name)).toEqual(['builtin_chats_list_tickets']);
  });
});
