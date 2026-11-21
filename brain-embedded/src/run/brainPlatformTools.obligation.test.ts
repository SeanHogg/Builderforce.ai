/**
 * VS Code chat #157440: the work-linking directive told 527 capped code turns to file tickets, and the role cap had dropped
 * the ticket tools (they were "only named by the system prompt"). The directive now DECLARES its obligation tools as data
 * (`chatWorkObligationTools`), the preamble records them (`promptTools.obligation`), and every role cap keeps them — while
 * the rest of the board family (assignees, the kanban scoping tools) still competes on relevance.
 */
import { describe, expect, it } from 'vitest';
import { toolNamesMentionedIn } from '@builderforce/agent-stall';
import { selectPlatformCatalog, type PolicyContext } from '@builderforce/agent-run';
import type { ToolSchema } from '@builderforce/agent-tools';
import { brainPlatformTools, promptOnlyNamed, unnamedVocabulary } from './brainPlatformTools';
import { chatModeDirective } from '../chatMode';
import { chatWorkObligationTools } from '../chatWorkLinking';
import { ticketToolVocabulary } from '../ticketToolVocabulary';
import { LOCAL_WORKSPACE_TOOLS, canChangeCodeHere, localToolsIn } from '../localWorkspaceTools';
import type { BrainRunContext, PromptToolNames } from '../runStore/brainRunContext';

const CHAT_ID = 157440;
const BOARD = [
  'builtin_tasks_create', 'builtin_tasks_update', 'builtin_tasks_assignees', 'builtin_chats_link_ticket', 'builtin_chats_list_tickets',
  'builtin_tickets_from_delta', 'builtin_kanban_participants', 'builtin_kanban_assess_resource', 'builtin_kanban_accountability',
  'builtin_kanban_materialize_work_items', 'builtin_kanban_coordinate', 'builtin_chats_dispatch_agent', 'builtin_chats_runs',
];
const PLATFORM = [...BOARD, ...Array.from({ length: 400 }, (_, i) => `builtin_platform_${i}`)];
const VSIX = [...LOCAL_WORKSPACE_TOOLS, ...PLATFORM];
const VSIX_LOCAL = [...VSIX, 'ticket-create', 'ticket-move'];

const schema = (name: string): ToolSchema => ({ type: 'function', function: { name, description: name.replace(/_/g, ' '), parameters: { type: 'object', properties: {} } } });

/** The run the preamble resolves for a work-mode chat: obligations recorded as it records them. */
function runFor(phase: string, catalog: readonly string[]): BrainRunContext {
  const ticketTools = ticketToolVocabulary(catalog);
  const systemPrompt = chatModeDirective('work', CHAT_ID, { canEditHere: canChangeCodeHere(catalog), ticketTools });
  const obligation = chatWorkObligationTools(CHAT_ID, ticketTools).filter((n) => catalog.includes(n));
  const promptTools: PromptToolNames = { system: toolNamesMentionedIn(systemPrompt), turn: [], contract: [], obligation };
  const alwaysAdvertised = [...new Set([...promptTools.system, ...obligation]), ...localToolsIn(catalog), 'ask_user'];
  return {
    c: {}, req: {}, policy: { phase }, canAskUser: true, allTools: [...catalog, 'ask_user', 'hand_off'].map(schema), catalogToolNames: [...catalog],
    alwaysAdvertised, promptTools, usedTools: new Set<string>(), systemPrompt, requestQuery: 'fix the null check in the parser',
  } as unknown as BrainRunContext;
}

function advertised(run: BrainRunContext): string[] {
  const ctx = { ports: { platform: brainPlatformTools(run).tools }, state: {} } as unknown as PolicyContext;
  return (selectPlatformCatalog(ctx, []) ?? []).map((t) => t.function.name);
}

describe('chatWorkObligationTools — the directive declares its obligations as data', () => {
  it('server vocabulary on a linked chat: create, update, from_delta, list linked — never the link tool or the board family', () => {
    expect(chatWorkObligationTools(42)).toEqual([
      'builtin_tasks_create', 'builtin_tasks_update', 'builtin_tickets_from_delta', 'builtin_chats_list_tickets',
    ]);
  });

  it('an unbound local chat has no chat to list or link', () => {
    expect(chatWorkObligationTools(null)).toEqual(['builtin_tasks_create', 'builtin_tasks_update', 'builtin_tickets_from_delta']);
  });

  it('the editor vocabulary files with ticket-create and never the link tool', () => {
    const local = chatWorkObligationTools(7, ticketToolVocabulary(['ticket-create']));
    expect(local).toEqual(['ticket-create', 'ticket-move', 'builtin_tasks_update', 'builtin_tickets_from_delta', 'builtin_chats_list_tickets']);
    expect(local).not.toContain('builtin_chats_link_ticket');
    expect(local).not.toContain('builtin_tasks_create');
  });

  it('every obligation is a tool the directive itself names', () => {
    for (const vocabulary of [ticketToolVocabulary(), ticketToolVocabulary(['ticket-create'])]) {
      const directive = chatModeDirective('work', 42, { canEditHere: true, ticketTools: vocabulary });
      for (const name of chatWorkObligationTools(42, vocabulary)) expect(directive).toContain(name);
    }
  });
});

describe('regression: chat #157440 — a capped code turn keeps the obligation tools', () => {
  it('a VSIX code turn advertises the ticket obligations, not the kanban scoping tools', () => {
    const run = runFor('code', VSIX);
    const names = advertised(run);
    for (const name of ['builtin_tasks_create', 'builtin_tasks_update', 'builtin_tickets_from_delta', 'builtin_chats_list_tickets']) {
      expect(names).toContain(name);
    }
    for (const name of ['builtin_kanban_participants', 'builtin_kanban_assess_resource', 'builtin_kanban_coordinate', 'builtin_tasks_assignees', 'builtin_chats_link_ticket']) {
      expect(names).not.toContain(name);
    }
    expect(promptOnlyNamed(run).has('builtin_tasks_create')).toBe(false);
    expect(promptOnlyNamed(run).has('builtin_kanban_participants')).toBe(true);
  });

  it('a verify turn keeps them too', () => {
    expect(advertised(runFor('verify', VSIX))).toEqual(expect.arrayContaining(['builtin_tasks_create', 'builtin_tickets_from_delta']));
  });

  it('the editor vocabulary keeps ticket-create and ticket-move on a capped turn', () => {
    const run = runFor('code', VSIX_LOCAL);
    expect(unnamedVocabulary(run).has('ticket-create')).toBe(false);
    expect(advertised(run)).toEqual(expect.arrayContaining(['ticket-create', 'ticket-move', 'builtin_tickets_from_delta']));
  });
});
