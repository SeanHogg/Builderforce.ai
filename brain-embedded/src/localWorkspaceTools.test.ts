import { describe, it, expect } from 'vitest';
import {
  isCodeChangeTool,
  isLocalWorkspaceTool,
  isUnscopedMutationTool,
  canChangeCodeHere,
  localToolsIn,
  CODE_CHANGE_TOOLS,
  LOCAL_WORKSPACE_TOOLS,
} from './localWorkspaceTools';

describe('the local workspace toolset', () => {
  it('recognises the workspace file tools that change code', () => {
    expect(isCodeChangeTool('write_file')).toBe(true);
    expect(isCodeChangeTool('edit_file')).toBe(true);
    expect(isCodeChangeTool('delete_file')).toBe(true);
    // Reads and shell are NOT code changes (run_command commonly runs tests/build).
    expect(isCodeChangeTool('read_file')).toBe(false);
    expect(isCodeChangeTool('run_command')).toBe(false);
    expect(isCodeChangeTool('search_code')).toBe(false);
  });

  it('keeps the writers a strict subset of the local toolset', () => {
    // Two sets, one meaning. A writer that is not a local tool would be pinned by
    // neither the selector nor the backstop, which is the drift this pins shut.
    for (const name of CODE_CHANGE_TOOLS) expect(isLocalWorkspaceTool(name)).toBe(true);
  });

  /**
   * The WORK-mode directive tells a session to make a small change itself rather than
   * hire a cloud agent to make it — advice that is only true where the file tools
   * exist. Both sides read this one set, so the directive and the post-run backstop
   * cannot disagree about what "this session can change code" means.
   */
  it('answers whether THIS run can change code from its advertised tools', () => {
    expect(canChangeCodeHere(['read_file', 'search_code', 'edit_file'])).toBe(true);
    // The web Brain: platform tools only, so dispatching is its only route to a change.
    expect(canChangeCodeHere(['builtin_tasks_create', 'builtin_chats_dispatch_agent'])).toBe(false);
    expect(canChangeCodeHere([])).toBe(false);
  });

  /**
   * THE PIN. The per-turn selector trims ~440 tools to ~64 by lexical relevance, and
   * `run_command` shares no word stem with "commit the change and push to main" — so it
   * was dropped from the very turn that needed it, while the system prompt was telling
   * the model to use it. The agent could not find the tool it had been promised.
   */
  it('always advertises the local tools the host actually offered', () => {
    const catalog = ['builtin_tasks_create', 'read_file', 'run_command', 'builtin_chats_dispatch_agent', 'edit_file'];
    expect(localToolsIn(catalog)).toEqual(['read_file', 'run_command', 'edit_file']);
    // Nothing is pinned that the host did not offer: on the web Brain (no file tools)
    // the intersection is empty and the selection is exactly what it was.
    expect(localToolsIn(['builtin_tasks_create', 'builtin_specs_create'])).toEqual([]);
  });

  it('names run_command as the one tool whose blast radius is unknown', () => {
    // A codemod, a formatter, a checkout — the honest answer to "what did that touch?"
    // is "anything", so per-target invalidation cannot apply to it.
    expect(isUnscopedMutationTool('run_command')).toBe(true);
    expect(isUnscopedMutationTool('edit_file')).toBe(false);
    expect(LOCAL_WORKSPACE_TOOLS.has('run_command')).toBe(true);
  });
});
