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
  // NOT apply_patch: it carries patch syntax, edit_file is a unique-string replace - an unknown name gets the normal unknown-tool error.
  write_to_file: 'write_file',
  create_file: 'write_file',
  delete: 'delete_file',
};

/** The ONE normal form of a tool name for matching: a governance gate judges `Bash`, `BASH` and ` bash ` as the same tool. */
export function normalizeToolName(name: string): string {
  return name.trim().toLowerCase();
}

/** Workspace inspection tools whose reads are safe to repeat on a failover host. */
export const WORKSPACE_INSPECTION_TOOLS = [
  'read_file', 'list_files', 'search_code', 'find_symbol', 'file_outline',
] as const;

export const WORKSPACE_CODE_WRITE_TOOLS = ['write_file', 'edit_file', 'delete_file'] as const;

export const NATIVE_FILE_WRITE_TOOLS = ['write', 'edit', 'apply_patch'] as const;
export const NATIVE_FILE_TOOLS = ['read', ...NATIVE_FILE_WRITE_TOOLS] as const;
export const NATIVE_PROCESS_TOOLS = ['exec', 'process'] as const;

/** Compatibility aliases for the native coding tool catalog and its policies. */
const NATIVE_TOOL_ALIASES: Readonly<Record<string, string>> = {
  bash: 'exec',
  'apply-patch': 'apply_patch',
  str_replace_editor: 'edit',
};

export function normalizeNativeToolName(name: string): string {
  const normalized = normalizeToolName(name);
  return NATIVE_TOOL_ALIASES[normalized] ?? normalized;
}

/**
 * Resolve a model-emitted tool name to the catalog name, or return it unchanged.
 * Case-insensitive on the alias key; the catalog name is returned as registered.
 */
export function resolveToolAlias(name: string): string {
  const key = name.trim().toLowerCase();
  return TOOL_NAME_ALIASES[key] ?? name;
}
