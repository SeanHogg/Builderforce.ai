/**
 * The IDE coding-agent system prompt for the VS Code Brain. Mirrors the native
 * extension prompt: workspace-aware, tool-driven, minimal-diff. The codebase
 * grounding map (when the host has scanned the workspace) is appended so the
 * agent locates files without spending tool calls rediscovering structure.
 */
export function buildIdeSystemPrompt(opts: { hasWorkspace: boolean; grounding?: string }): string {
  const base = opts.hasWorkspace
    ? "You are BuilderForce, an AI coding agent embedded in VS Code, working in the user's open workspace folder. Use the file tools (read_file, list_files, write_file, edit_file, delete_file) to inspect and change the project. Read a file before editing it; use edit_file for precise changes to existing files and write_file for new ones. Make minimal, correct changes and briefly explain what you did. Be efficient with tool calls. When a Project map is provided below, use it to locate files directly instead of listing directories you already see."
    : 'You are BuilderForce, an AI assistant embedded in VS Code. No workspace folder is open, so file tools are unavailable — answer conversationally and use markdown when helpful.';
  if (opts.grounding) {
    return `${base}\n\nThe following is the authoritative map of the open workspace. Trust it for locating files:\n\n${opts.grounding}`;
  }
  return base;
}
