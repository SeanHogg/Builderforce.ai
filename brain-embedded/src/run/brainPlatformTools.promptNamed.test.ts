/**
 * The tools a code turn's SYSTEM PROMPT names, measured on the prompt the run builds (`runPreamble.ts`: the host persona, then the
 * chat-mode directive, the turn-optimisation directive, the ship contract and - in the Studio - the preview review contract). Before,
 * every one of them was required on a capped turn, which held a VSIX code turn at 37+ advertised tools (22 role tools + the named board
 * tools). Now, on an EDITOR surface, the tools only the standing system prompt names compete on relevance on a code or verify turn; what
 * the turn names, what the Studio's review contract names, the vocabulary the prompt names, `ask_user` and `hand_off` stay required. A
 * surface without the file tools (the web Brain) and a planning or chat turn keep every prompt-named tool required.
 */
import { describe, expect, it } from 'vitest';
import { toolNamesMentionedIn } from '@builderforce/agent-stall';
import { selectPlatformCatalog, type PolicyContext } from '@builderforce/agent-run';
import type { ToolSchema } from '@builderforce/agent-tools';
import { brainPlatformTools, promptOnlyNamed } from './brainPlatformTools';
import { chatModeDirective } from '../chatMode';
import { turnOptimizationDirective } from '../turnOptimization';
import { selfReviewShipDirective } from '../selfReviewShip';
import { previewReviewDirective } from '../previewReview';
import { ticketToolVocabulary } from '../ticketToolVocabulary';
import { LOCAL_WORKSPACE_TOOLS, STUDIO_WORKSPACE_TOOLS, canChangeCodeHere, canReviewInPreview, localToolsIn, memoryToolsIn, studioToolsIn } from '../localWorkspaceTools';
import { skillToolsIn } from '../skillLibraryTools';
import type { BrainRunContext, PromptToolNames } from '../runStore/brainRunContext';

/** The IDE persona (`clients/vscode/src/idePersona.ts`) names only the unprefixed workspace tools, never a `builtin_*` one. */
const PERSONA = 'You are BuilderForce, an AI coding agent. Use read_file, edit_file and run_command; commit with git_commit and push with git_push.';
const CHAT_ID = 85;

/** The board tools the directives name, the memory and skill tools, and the platform's long tail. */
const BOARD = [
  'builtin_tasks_create', 'builtin_tasks_update', 'builtin_tasks_assignees', 'builtin_tasks_get', 'builtin_chats_link_ticket',
  'builtin_chats_list_tickets', 'builtin_chats_list_agents', 'builtin_chats_runs', 'builtin_chats_dispatch_agent', 'builtin_cloud_agents_list_mine',
  'builtin_cloud_agents_persona_brief', 'builtin_executions_post_message', 'builtin_tickets_from_delta', 'builtin_reviews_record',
  'builtin_kanban_participants', 'builtin_kanban_assess_resource', 'builtin_kanban_accountability', 'builtin_kanban_materialize_work_items',
  'builtin_kanban_coordinate', 'builtin_attachments_read',
];
const PLATFORM = ['recall_facts', 'remember_fact', 'builtin_skills_read', 'output_filter', ...BOARD, ...Array.from({ length: 400 }, (_, i) => `builtin_platform_${i}`)];
const VSIX = [...LOCAL_WORKSPACE_TOOLS, ...PLATFORM];
const STUDIO = [...STUDIO_WORKSPACE_TOOLS, ...PLATFORM];
const WEB = PLATFORM;

const schema = (name: string): ToolSchema => ({ type: 'function', function: { name, description: name.replace(/_/g, ' '), parameters: { type: 'object', properties: {} } } });

/** The system prompt `runPreamble.ts` builds for a work-mode run bound to a server chat, and its preview review contract where it has one. */
function promptFor(catalog: readonly string[]): { systemPrompt: string; previewReview: string | null } {
  const ticketTools = ticketToolVocabulary(catalog);
  const mode = chatModeDirective('work', CHAT_ID, { canEditHere: canChangeCodeHere(catalog), canDelegate: catalog.includes('spawn_agent'), canFanOut: catalog.includes('spawn_agents'), ticketTools });
  const ship = catalog.includes('git_commit') && catalog.includes('git_push') ? `\n\n${selfReviewShipDirective(CHAT_ID)}` : '';
  const previewReview = canReviewInPreview(catalog) ? previewReviewDirective(CHAT_ID, ticketTools) : null;
  return { systemPrompt: `${PERSONA}\n\n${mode}\n\n${turnOptimizationDirective()}${ship}${previewReview ? `\n\n${previewReview}` : ''}`, previewReview };
}

/** The run `runPreamble.ts` resolves for that prompt: `alwaysAdvertised` and `promptTools` as it records them. */
function runFor(phase: string, catalog: readonly string[], turnText = ''): BrainRunContext {
  const { systemPrompt, previewReview } = promptFor(catalog);
  const promptTools: PromptToolNames = { system: toolNamesMentionedIn(systemPrompt), turn: toolNamesMentionedIn(turnText), contract: previewReview ? toolNamesMentionedIn(previewReview) : [] };
  const alwaysAdvertised = [...new Set([...promptTools.system, ...promptTools.turn]), ...localToolsIn(catalog), ...studioToolsIn(catalog), ...memoryToolsIn(catalog), ...skillToolsIn(catalog), 'ask_user'];
  return {
    c: {}, req: {}, policy: { phase }, canAskUser: true, allTools: [...catalog, 'ask_user', 'hand_off'].map(schema), catalogToolNames: [...catalog],
    alwaysAdvertised, promptTools, usedTools: new Set<string>(), systemPrompt, requestQuery: 'fix the null check in the parser',
  } as unknown as BrainRunContext;
}

/** What the turn advertises, through the agent's own selection for a closed surface (`policy/tools/platform.ts`), before the router tools. */
function advertised(run: BrainRunContext): string[] {
  const ctx = { ports: { platform: brainPlatformTools(run).tools }, state: {} } as unknown as PolicyContext;
  return (selectPlatformCatalog(ctx, []) ?? []).map((t) => t.function.name);
}

describe('the tools a code turn system prompt names', () => {
  it('names the board and close-out tools (measured, VSIX)', () => {
    expect(toolNamesMentionedIn(promptFor(VSIX).systemPrompt).sort()).toEqual([
      'builtin_attachments_read', 'builtin_chats_dispatch_agent', 'builtin_chats_link_ticket', 'builtin_chats_list_agents',
      'builtin_chats_list_tickets', 'builtin_chats_runs', 'builtin_cloud_agents_list_mine', 'builtin_cloud_agents_persona_brief',
      'builtin_executions_post_message', 'builtin_kanban_accountability', 'builtin_kanban_assess_resource', 'builtin_kanban_coordinate',
      'builtin_kanban_materialize_work_items', 'builtin_kanban_participants', 'builtin_reviews_record', 'builtin_tasks_assignees',
      'builtin_tasks_create', 'builtin_tasks_update', 'builtin_tickets_from_delta',
    ].sort());
  });

  it('a VSIX code turn advertises at most 30 tools, none of them the prompt-only board tools, and keeps the coder its tools', () => {
    const run = runFor('code', VSIX);
    const after = advertised(run);
    expect(after.length).toBeLessThanOrEqual(30);
    expect(promptOnlyNamed(run).size).toBeGreaterThan(0);
    for (const demoted of promptOnlyNamed(run)) expect(after).not.toContain(demoted);
    for (const must of ['read_file', 'edit_file', 'write_file', 'search_code', 'run_command', 'git_commit', 'git_push', 'ask_user']) expect(after).toContain(must);
  });

  it('a board tool the TURN names stays required on a code turn', () => {
    const run = runFor('code', VSIX, 'Link the ticket with builtin_chats_link_ticket.');
    expect([...brainPlatformTools(run).tools.selection.required]).toContain('builtin_chats_link_ticket');
    expect(promptOnlyNamed(run)).not.toContain('builtin_chats_link_ticket');
  });

  it('a Studio code or verify turn keeps every tool its preview review contract names', () => {
    for (const phase of ['code', 'verify']) {
      const run = runFor(phase, STUDIO);
      const contract = run.promptTools.contract;
      expect(contract).toContain('builtin_reviews_record');
      const required = [...brainPlatformTools(run).tools.selection.required];
      for (const name of contract) expect(required).toContain(name);
    }
  });

  it('a web-shaped catalog (no file tools) keeps every prompt-named tool required on a code turn', () => {
    const run = runFor('code', WEB);
    expect(promptOnlyNamed(run).size).toBe(0);
    const required = [...brainPlatformTools(run).tools.selection.required];
    for (const name of run.promptTools.system) expect(required).toContain(name);
  });

  it('a planning or chat turn keeps every prompt-named tool required, exactly as before', () => {
    for (const phase of ['plan', 'chat']) {
      const run = runFor(phase, VSIX);
      const required = [...brainPlatformTools(run).tools.selection.required];
      expect(required).toEqual(phase === 'plan' ? [...run.alwaysAdvertised, 'hand_off'] : run.alwaysAdvertised);
    }
  });
});
