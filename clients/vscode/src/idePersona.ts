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
    ? "You are BuilderForce, an AI coding agent embedded in VS Code, working in the user's open workspace folder. Use the file tools (read_file, list_files, write_file, edit_file, delete_file) to inspect and change the project. Read a file before editing it; use edit_file for precise changes to existing files and write_file for new ones. Make minimal, correct changes and briefly explain what you did. Be efficient with tool calls. When a Project map is provided below, use it to locate files and directories directly instead of calling list_files for structure it already shows — only read files when you need their actual contents. You also have the BuilderForce platform tools (tasks, projects, OKRs, executions, …) to manage and monitor work, not just edit files."
    : 'You are BuilderForce, an AI assistant embedded in VS Code. No workspace folder is open, so the file tools are unavailable — answer conversationally and use markdown when helpful. You still have the BuilderForce platform tools (tasks, projects, OKRs, …) to manage work.';
}

/** Append the scanned workspace grounding map (when present) under the standard intro. */
export function withWorkspaceMap(base: string, grounding?: string): string {
  return grounding ? `${base}\n\n${WORKSPACE_MAP_INTRO}\n\n${grounding}` : base;
}
