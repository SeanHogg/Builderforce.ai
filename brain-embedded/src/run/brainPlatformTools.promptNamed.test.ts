/**
 * The tools a VSIX code turn's SYSTEM PROMPT names, measured on the prompt the run builds (`runPreamble.ts`: the host persona, then
 * the chat-mode directive, the turn-optimisation directive and the ship contract). Before, every one of them was required on a capped
 * turn, which held a VSIX code turn at 37 advertised tools (22 role tools + ~15 named). Now the tools only the system prompt names
 * compete on relevance on a code or verify turn; what the TURN names, the vocabulary the prompt names, `ask_user` and `hand_off` stay
 * required, and a planning or chat turn keeps `alwaysAdvertised` exactly.
 */
import { describe, expect, it } from 'vitest';
import { toolNamesMentionedIn } from '@builderforce/agent-stall';
import { roleCappedSelection, selectToolsForTurn } from '@builderforce/agent-run';
import type { ToolSchema } from '@builderforce/agent-tools';
import { brainPlatformTools, promptOnlyNamed } from './brainPlatformTools';
import { chatModeDirective } from '../chatMode';
import { turnOptimizationDirective } from '../turnOptimization';
import { selfReviewShipDirective } from '../selfReviewShip';
import { ticketToolVocabulary } from '../ticketToolVocabulary';
import { LOCAL_WORKSPACE_TOOLS, localToolsIn, memoryToolsIn } from '../localWorkspaceTools';
import { skillToolsIn } from '../skillLibraryTools';
import { relevantTools } from '../selectTools';
import type { BrainToolSpec } from '../streamChatCompletion';
import type { BrainRunContext } from '../runStore/brainRunContext';

/** The IDE persona (`clients/vscode/src/idePersona.ts`) names only the unprefixed workspace tools, never a `builtin_*` one. */
const PERSONA = "You are BuilderForce, an AI coding agent embedded in VS Code. Use read_file, edit_file and run_command; commit with git_commit and push with git_push.";
const CHAT_ID = 85;

/** A VSIX-shaped catalog: the workspace vocabulary, memory, skills, the board tools the directives name, and the platform's long tail. */
const BOARD = [
  'builtin_tasks_create', 'builtin_tasks_update', 'builtin_tasks_assignees', 'builtin_tasks_get', 'builtin_chats_link_ticket',
  'builtin_chats_list_tickets', 'builtin_chats_list_agents', 'builtin_chats_runs', 'builtin_chats_dispatch_agent', 'builtin_cloud_agents_list_mine',
  'builtin_cloud_agents_persona_brief', 'builtin_executions_post_message', 'builtin_tickets_from_delta', 'builtin_reviews_record',
  'builtin_kanban_participants', 'builtin_kanban_assess_resource', 'builtin_kanban_accountability', 'builtin_kanban_materialize_work_items',
  'builtin_kanban_coordinate', 'builtin_attachments_read',
];
const CATALOG_NAMES = [
  ...LOCAL_WORKSPACE_TOOLS, 'recall_facts', 'remember_fact', 'builtin_skills_read', 'output_filter', ...BOARD,
  ...Array.from({ length: 400 }, (_, i) => `builtin_platform_${i}`),
];
const schema = (name: string): ToolSchema => ({ type: 'function', function: { name, description: name.replace(/_/g, ' '), parameters: { type: 'object', properties: {} } } });
const CATALOG = [...CATALOG_NAMES, 'ask_user', 'hand_off'].map(schema);

/** The system prompt `runPreamble.ts` builds for a VSIX work-mode run bound to a server chat, ticket tools as the catalog has them. */
function vsixSystemPrompt(catalog: readonly string[]): string {
  const ticketTools = ticketToolVocabulary(catalog);
  const mode = chatModeDirective('work', CHAT_ID, { canEditHere: true, canDelegate: true, canFanOut: true, ticketTools });
  return `${PERSONA}\n\n${mode}\n\n${turnOptimizationDirective()}\n\n${selfReviewShipDirective(CHAT_ID)}`;
}

/** The run `runPreamble.ts` resolves for that prompt: `alwaysAdvertised` as it builds it. */
function runFor(phase: string, systemPrompt: string, catalog: readonly string[] = CATALOG_NAMES): BrainRunContext {
  const alwaysAdvertised = [...toolNamesMentionedIn(systemPrompt), ...localToolsIn(catalog), ...memoryToolsIn(catalog), ...skillToolsIn(catalog), 'ask_user'];
  return {
    c: {}, req: {}, policy: { phase }, canAskUser: true, allTools: CATALOG, catalogToolNames: [...catalog], alwaysAdvertised,
    usedTools: new Set<string>(), systemPrompt, requestQuery: 'fix the null check in the parser',
  } as unknown as BrainRunContext;
}

/** What the code turn advertises, as the agent's platform catalog selects it (`policy/tools/platform.ts`), before the 3 router tools. */
function advertised(run: BrainRunContext): string[] {
  const selection = brainPlatformTools(run).tools.selection;
  const capped = roleCappedSelection('code', CATALOG.map((t) => t.function.name), selection.roleKeep ?? [], selection.required);
  return selectToolsForTurn(CATALOG, { query: selection.query, limit: capped.limit, pinned: [], required: capped.required, rank: (t, q) => relevantTools(t as unknown as BrainToolSpec[], q) as unknown as ToolSchema[], capRequired: true, backfill: false }).tools.map((t) => t.function.name);
}

describe('the tools a VSIX code turn system prompt names', () => {
  it('names the board and close-out tools (measured)', () => {
    const named = toolNamesMentionedIn(vsixSystemPrompt(CATALOG_NAMES)).sort();
    expect(named).toEqual([
      'builtin_attachments_read', 'builtin_chats_dispatch_agent', 'builtin_chats_link_ticket', 'builtin_chats_list_agents',
      'builtin_chats_list_tickets', 'builtin_chats_runs', 'builtin_cloud_agents_list_mine', 'builtin_cloud_agents_persona_brief',
      'builtin_executions_post_message', 'builtin_kanban_accountability', 'builtin_kanban_assess_resource', 'builtin_kanban_coordinate',
      'builtin_kanban_materialize_work_items', 'builtin_kanban_participants', 'builtin_reviews_record', 'builtin_tasks_assignees',
      'builtin_tasks_create', 'builtin_tasks_update', 'builtin_tickets_from_delta',
    ].sort());
  });

  it('a code turn advertises at most 30 tools, none of them the prompt-only board tools, and keeps the coder its tools', () => {
    const run = runFor('code', vsixSystemPrompt(CATALOG_NAMES));
    const before = new Set([...run.alwaysAdvertised]);
    const after = advertised(run);
    expect(after.length).toBeLessThanOrEqual(30);
    for (const demoted of promptOnlyNamed(run)) expect(after).not.toContain(demoted);
    for (const must of ['read_file', 'edit_file', 'write_file', 'search_code', 'run_command', 'git_commit', 'git_push', 'ask_user']) expect(after).toContain(must);
    // Every tool the prompt names was required before; the ~19 board tools it names alone held the turn above 30.
    expect(before.size).toBeGreaterThan(after.length);
  });

  it('a board tool the TURN names stays required on a code turn', () => {
    const turn = '<turn_context>\nContext for this turn only:\n\nLink the ticket with builtin_chats_link_ticket.\n</turn_context>';
    const run = runFor('code', `${vsixSystemPrompt(CATALOG_NAMES)}\n\n${turn}`);
    expect([...brainPlatformTools(run).tools.selection.required]).toContain('builtin_chats_link_ticket');
    expect(promptOnlyNamed(run)).not.toContain('builtin_chats_link_ticket');
  });

  it('a planning or chat turn keeps every prompt-named tool required, exactly as before', () => {
    for (const phase of ['plan', 'chat']) {
      const run = runFor(phase, vsixSystemPrompt(CATALOG_NAMES));
      const required = [...brainPlatformTools(run).tools.selection.required];
      expect(required).toEqual(phase === 'plan' ? [...run.alwaysAdvertised, 'hand_off'] : run.alwaysAdvertised);
    }
  });
});
