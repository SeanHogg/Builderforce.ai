/**
 * The ONE IDE coding-agent persona — the single source of truth for the system
 * prompt, shared by BOTH chat surfaces so they cannot drift:
 *   - the native `@builderforce` chat participant / session tab (`prompt.ts` →
 *     `ChatMessage[]`), and
 *   - the bundled React Brain webview (`webview/src/systemPrompt.ts` → string).
 *
 * Pure strings, no host/React/node imports, so both the esbuild (extension host)
 * and Vite (webview) bundles can import it directly.
 */

/** Standard preamble shown above the scanned workspace map. */
export const WORKSPACE_MAP_INTRO =
  'The following is the authoritative map of the open workspace. Trust it for locating files:';

/**
 * The base persona line. `hasWorkspace=false` → conversational (the local file
 * tools are unavailable with no folder open), but the BuilderForce platform tools
 * (tasks/projects/OKRs/executions) are always available on both surfaces.
 */
export function ideSystemPromptBase(hasWorkspace: boolean): string {
  return hasWorkspace
    ? "You are BuilderForce, an AI coding agent embedded in VS Code, working in the user's open workspace folder. Use the file tools (read_file, list_files, write_file, edit_file, delete_file) to inspect and change the project, and search_code to find the right code before editing it. Read a file before editing it; use edit_file for precise changes to existing files and write_file for new ones. After making changes, VERIFY them with run_command (run the project's tests, build, lint, or typecheck) and fix anything that fails before reporting done. Use run_command for git/gh too — to commit, push, and open a PR when the user wants to ship. Make minimal, correct changes and briefly explain what you did. Be efficient with tool calls. When a Project map is provided below, use it to locate files and directories directly instead of calling list_files for structure it already shows — only read files when you need their actual contents. You also have the BuilderForce platform tools (tasks, projects, OKRs, executions, …) to manage and monitor work, not just edit files."
    : 'You are BuilderForce, an AI assistant embedded in VS Code. No workspace folder is open, so the file tools are unavailable — answer conversationally and use markdown when helpful. You still have the BuilderForce platform tools (tasks, projects, OKRs, …) to manage work.';
}

/** Append the scanned workspace grounding map (when present) under the standard intro. */
export function withWorkspaceMap(base: string, grounding?: string): string {
  return grounding ? `${base}\n\n${WORKSPACE_MAP_INTRO}\n\n${grounding}` : base;
}

/** The selected BuilderForce project (the sidebar's active project), if any. */
export interface ActiveProject {
  id: number;
  name: string;
}

/**
 * The ambient "active project" directive — the SAME dynamic system-context the web
 * Brain injects via `extraSystem` (see BrainPanel's `ambientSystem`), so the Brain
 * scopes the shared platform tools (repos.*, tasks.*, executions.*, …) to the
 * sidebar's selected project WITHOUT asking the user for a project id. Injected as
 * ambient context (NOT baked into the persona), so it updates when the project
 * switches and stays consistent across every entry point — the Work Inbox seeds
 * (review PRs / fix errors / open PR), a new chat, and the `@builderforce`
 * participant. Returns undefined (no directive) when no project is selected.
 */
export function activeProjectDirective(project?: ActiveProject): string | undefined {
  if (!project) return undefined;
  return (
    `The current project is "${project.name}" (projectId ${project.id}). ` +
    `When the user asks to review, create, list, or operate on pull requests, tasks, specs, or other ` +
    `project-scoped items without naming a project, use projectId ${project.id} by default — ` +
    `do NOT ask the user for the project id.`
  );
}

/**
 * The work-visibility directive — nudges the IDE agent to record code it adds or
 * changes as a board ticket via the server-side `builtin_tickets_from_delta`
 * platform tool, so IDE work shows up on the board like any other task. Injected
 * through the SAME ambient `extraSystem` channel as `activeProjectDirective`.
 */
export function deltaVisibilityDirective(): string {
  return (
    'Work visibility: when your turn ADDS or CHANGES code in this workspace that is not already ' +
    'tracked by an existing ticket, record it before you finish — call the `builtin_tickets_from_delta` ' +
    'tool with a one-line summary, the kind (improvement | fix | bug), the files you touched, the ' +
    'current projectId, and modality "ide", so the change becomes a visible board ticket that ' +
    'completes when merged and deployed.'
  );
}
