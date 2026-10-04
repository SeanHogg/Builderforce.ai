import { describe, it, expect } from 'vitest';
import {
  isCodeChangeTool,
  isLocalWorkspaceTool,
  isUnscopedMutationTool,
  isRepoPublishTool,
  canChangeCodeHere,
  canShipHere,
  localToolsIn,
  memoryToolsIn,
  isProjectMemoryTool,
  canReviewInPreview,
  studioToolsIn,
  CODE_CHANGE_TOOLS,
  LOCAL_WORKSPACE_TOOLS,
  PROJECT_MEMORY_TOOLS,
  STUDIO_WORKSPACE_TOOLS,
  PREVIEW_REVIEW_TOOL,
} from './localWorkspaceTools';

describe('the project memory toolset', () => {
  it('pins the recall/remember pair out of a catalog, and nothing else', () => {
    expect(memoryToolsIn(['read_file', 'recall_facts', 'builtin_tasks_list', 'remember_fact'])).toEqual(['recall_facts', 'remember_fact']);
  });

  it('keeps memory tools OUT of the workspace set — they read no file and need no folder', () => {
    for (const name of PROJECT_MEMORY_TOOLS) {
      expect(isProjectMemoryTool(name)).toBe(true);
      expect(isLocalWorkspaceTool(name)).toBe(false);
    }
  });
});

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

  it('keeps every writer inside the toolset its surface pins', () => {
    // A writer that is in no pinned set would be dropped by the selector while the
    // backstop still counts it — the drift this pins shut. The IDE's writers are local
    // tools; the Studio's are its workspace vocabulary.
    for (const name of CODE_CHANGE_TOOLS) {
      expect(isLocalWorkspaceTool(name) || STUDIO_WORKSPACE_TOOLS.has(name)).toBe(true);
    }
  });

  /**
   * Chat #129: the Studio changed a site twice and nothing counted it as a code change,
   * so no ticket was opened for it and nothing ever reviewed it.
   */
  it('counts the Studio workspace writers as code changes, and its reads as not', () => {
    expect(isCodeChangeTool('canvas_write_build_file')).toBe(true);
    expect(isCodeChangeTool('canvas_edit_build_file')).toBe(true);
    expect(isCodeChangeTool('canvas_restore_build_file')).toBe(true);
    expect(isCodeChangeTool('canvas_read_build_file')).toBe(false);
    expect(isCodeChangeTool(PREVIEW_REVIEW_TOOL)).toBe(false);
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
   * Only a session that can LAND its change is told it is that change's reviewer (and
   * re-prompted for leaving it unshipped) — commit without push lands nothing.
   */
  it('answers whether THIS run can ship its own change: commit AND push', () => {
    expect(canShipHere(['edit_file', 'git_commit', 'git_push'])).toBe(true);
    expect(canShipHere(['edit_file', 'git_commit'])).toBe(false);
    expect(canShipHere(['builtin_tasks_create', 'builtin_chats_dispatch_agent'])).toBe(false);
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

  it('names the tools whose blast radius is unknown: the shell and the tree-rewriting git verbs', () => {
    // A codemod, a formatter, a checkout — the honest answer to "what did that touch?"
    // is "anything", so per-target invalidation cannot apply to it. A base-branch merge,
    // an undo or a redo rewrites the working tree the same way and names no file.
    expect(isUnscopedMutationTool('run_command')).toBe(true);
    expect(isUnscopedMutationTool('git_sync_latest')).toBe(true);
    expect(isUnscopedMutationTool('git_undo')).toBe(true);
    expect(isUnscopedMutationTool('git_redo')).toBe(true);
    // Publishing moves work OUT of the tree without changing a byte a read would see.
    expect(isUnscopedMutationTool('git_commit')).toBe(false);
    expect(isUnscopedMutationTool('git_push')).toBe(false);
    expect(isUnscopedMutationTool('edit_file')).toBe(false);
    expect(LOCAL_WORKSPACE_TOOLS.has('run_command')).toBe(true);
  });
});

describe('isRepoPublishTool', () => {
  it('names the tools that move platform-visible repository state', () => {
    for (const t of ['git_commit', 'git_push', 'open_pull_request', 'git_cleanup_merged']) {
      expect(isRepoPublishTool(t), t).toBe(true);
    }
  });

  it('excludes the tools that only OBSERVE the repository', () => {
    for (const t of ['git_status', 'git_diff', 'git_history', 'read_file', 'search_code']) {
      expect(isRepoPublishTool(t), t).toBe(false);
    }
  });
});

describe('the Studio workspace toolset', () => {
  const STUDIO = ['builtin_tasks_create', 'canvas_read_build_file', 'canvas_edit_build_file', PREVIEW_REVIEW_TOOL, 'canvas_add_object'];

  it('knows the Studio by its preview review tool', () => {
    expect(canReviewInPreview(STUDIO)).toBe(true);
    expect(canReviewInPreview(['read_file', 'edit_file', 'git_commit', 'git_push'])).toBe(false);
    expect(canReviewInPreview(['builtin_tasks_create'])).toBe(false);
  });

  it('pins the build vocabulary in the Studio and nothing outside it', () => {
    expect(studioToolsIn(STUDIO)).toEqual(['canvas_read_build_file', 'canvas_edit_build_file', PREVIEW_REVIEW_TOOL]);
  });

  /**
   * The creation canvas shares the `canvas_*` build tools but has no preview review
   * here, so its selection stays relevance-driven — eight pinned slots on every canvas
   * turn would crowd out the tools the board actually needs.
   */
  it('pins nothing where the review tool is absent, even with build tools advertised', () => {
    expect(studioToolsIn(['canvas_read_build_file', 'canvas_edit_build_file', 'canvas_add_object'])).toEqual([]);
  });
});
