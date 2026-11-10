/**
 * The Brain's required set per turn role (`brainPlatformTools.ts`). Chat #61651 (VSIX 2026.10.153): every code turn advertised 54–57
 * tools because `alwaysAdvertised` - what the prompt names PLUS the host's whole workspace, memory and skill vocabulary - was handed to
 * the code-turn cap as required. A capped turn now requires only what the prompt or the turn block names, `ask_user` and `hand_off`;
 * a planning or chat turn keeps `alwaysAdvertised` exactly.
 */
import { describe, expect, it } from 'vitest';
import { brainPlatformTools, unnamedVocabulary } from './brainPlatformTools';
import { LOCAL_WORKSPACE_TOOLS } from '../localWorkspaceTools';
import type { BrainRunContext } from '../runStore/brainRunContext';

const LOCAL = [...LOCAL_WORKSPACE_TOOLS];
const CATALOG = [...LOCAL, 'recall_facts', 'remember_fact', 'builtin_skills_read', 'builtin_tasks_update', 'builtin_chats_link_ticket', 'builtin_platform_1'];
const SYSTEM_PROMPT = 'Use run_command for git. Record a review with builtin_reviews_record and update the ticket with builtin_tasks_update. Link with builtin_chats_link_ticket.';
/** What `runPreamble.ts` builds: the prompt-named tools, then the local, memory and skill vocabulary, then `ask_user`. */
const ALWAYS = ['builtin_reviews_record', 'builtin_tasks_update', 'builtin_chats_link_ticket', ...LOCAL, 'recall_facts', 'remember_fact', 'builtin_skills_read', 'ask_user'];

function runFor(phase: string, systemPrompt = SYSTEM_PROMPT): BrainRunContext {
  return {
    c: {},
    req: {},
    policy: { phase },
    canAskUser: true,
    allTools: [],
    catalogToolNames: CATALOG,
    alwaysAdvertised: ALWAYS,
    usedTools: new Set<string>(),
    systemPrompt,
    requestQuery: 'fix the parser',
  } as unknown as BrainRunContext;
}

const requiredFor = (run: BrainRunContext): string[] => [...brainPlatformTools(run).tools.selection.required];

describe("the Brain's required set per turn role", () => {
  it('a code turn requires what the prompt names and ask_user, never the unnamed vocabulary', () => {
    const required = requiredFor(runFor('code'));
    expect(required).toEqual(['builtin_reviews_record', 'builtin_tasks_update', 'builtin_chats_link_ticket', 'ask_user']);
    for (const vocab of ['git_undo', 'git_sync_latest', 'run_command', 'recall_facts', 'builtin_skills_read']) expect(required).not.toContain(vocab);
  });

  it('a vocabulary tool the prompt names stays required on a code or verify turn', () => {
    for (const phase of ['code', 'verify']) {
      const required = requiredFor(runFor(phase, `${SYSTEM_PROMPT} Load the procedure with builtin_skills_read first.`));
      expect(required).toContain('builtin_skills_read');
      expect(required).not.toContain('git_undo');
    }
  });

  it('a planning turn keeps alwaysAdvertised exactly, plus hand_off', () => {
    expect(requiredFor(runFor('plan'))).toEqual([...ALWAYS, 'hand_off']);
  });

  it('a chat turn keeps alwaysAdvertised exactly', () => {
    expect(requiredFor(runFor('chat'))).toEqual(ALWAYS);
  });

  it('the unnamed vocabulary is the workspace, memory and skill tools the prompt does not name', () => {
    const unnamed = unnamedVocabulary(runFor('code'));
    expect([...unnamed].sort()).toEqual([...LOCAL, 'recall_facts', 'remember_fact', 'builtin_skills_read'].sort());
  });
});
