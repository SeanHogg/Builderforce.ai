/**
 * Common hallucinated tool names → the catalog name this surface actually runs.
 *
 * Models trained on Cursor / Claude Code / Codex often emit `list_dir`, `bash`,
 * `search_replace`, etc. instead of our catalog (`list_files`, `run_command`,
 * `edit_file`). Correcting at the execute seam — once, here — means every
 * registry consumer (VS Code, cloud Worker, on-prem Node) remaps identically
 * rather than returning `unknown tool` for an obvious synonym.
 *
 * Only obvious, arg-compatible synonyms belong here. Do not invent tools the
 * catalog does not have.
 */

/** Lowercase hallucinated name → catalog name. */
export const TOOL_NAME_ALIASES: Readonly<Record<string, string>> = {
  list_dir: 'list_files',
  listdir: 'list_files',
  list_directory: 'list_files',
  list_directories: 'list_files',
  ls_dir: 'list_files',
  // Shell / terminal
  bash: 'run_command',
  shell: 'run_command',
  run_terminal_cmd: 'run_command',
  execute_command: 'run_command',
  run_shell_command: 'run_command',
  // Search
  grep: 'search_code',
  codebase_search: 'search_code',
  search_files: 'search_code',
  find_files: 'list_files',
  glob_file_search: 'list_files',
  // Edit / write
  str_replace: 'edit_file',
  search_replace: 'edit_file',
  apply_patch: 'edit_file',
  write_to_file: 'write_file',
  create_file: 'write_file',
  delete: 'delete_file',
};

/**
 * Resolve a model-emitted tool name to the catalog name, or return it unchanged.
 * Case-insensitive on the alias key; the catalog name is returned as registered.
 */
export function resolveToolAlias(name: string): string {
  const key = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[key] ?? name;
}
