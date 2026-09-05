/**
 * The LOCAL WORKSPACE TOOLSET — the tools a surface has only because it is running
 * beside the user's files.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * The per-turn tool selector (`selectTools.ts`) trims a ~440-tool catalog to ~64 by
 * LEXICAL relevance against the turn's text, keeping (a) tools the system prompt
 * names and (b) tools this run has already called. Both of those are the right
 * instincts and both missed these tools:
 *
 *   - "tools the prompt names" is resolved by `toolNamesMentionedIn`, whose pattern
 *     matches only `builtin_*` / `mcp__*` identifiers. The IDE persona names
 *     `run_command`, `read_file`, `edit_file` and the rest in plain prose, so
 *     naming them pinned nothing at all.
 *   - "tools already called" cannot help a tool that has not been called YET.
 *
 * So on the turn where it mattered, `run_command` scored zero against "commit the
 * change and push to main" — no shared word stems — and was dropped from the 64.
 * The agent, whose own system prompt had just told it to "use run_command for git…
 * to commit, push, and open a PR", searched its tool list, could not find it, and
 * spent the rest of the run looking: 78 tool calls, 44 minutes, the same two files
 * read 14 and 13 times, and the commit never made. It reported, correctly, that the
 * tool it had been promised did not exist.
 *
 * These are not one domain among many that a query can be relevant to — they are
 * WHAT THIS SURFACE IS. Relevance must never decide whether the agent can touch the
 * workspace it is sitting in, so the run loop pins every one of them that the host
 * actually advertised. Nothing is pinned that the host did not offer: on the web
 * Brain this set matches no advertised tool and the selection is unchanged.
 *
 * Framework-free (plain Sets and predicates) so it is safe in every bundle.
 */

/**
 * Every local workspace tool, by the name the host advertises. The run loop pins the
 * intersection of this set with the run's own catalog — a host that adds a tool must
 * add it here to have it pinned, which is deliberate: this is a declaration of what
 * "working in the user's workspace" means, not a prefix match on whatever appears.
 */
export const LOCAL_WORKSPACE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_files',
  'search_code',
  'write_file',
  'edit_file',
  'delete_file',
  'run_command',
  // The git tools, read and publish alike. They belong here for exactly the reason the
  // file tools do: "commit the change and push to main" is not one domain among many a
  // query can be relevant to, it is the surface doing its job. The turn that produced
  // this set is the proof — `run_command` shared no stem with that request, missed the
  // relevance cut, and the agent spent the run unable to find the tool its own persona
  // had just told it to use. `git_status` before a commit, and `open_pull_request`
  // after one, are dropped by the same mechanism on a turn phrased "ship this".
  'git_status',
  'git_diff',
  'git_history',
  'git_sync_latest',
  'git_undo',
  'git_redo',
  'git_commit',
  'git_push',
  'open_pull_request',
]);

/**
 * Local workspace tools whose success means the agent CHANGED code on disk — the
 * surface-specific signal that a ticket must exist. Only the VS Code (IDE) surface
 * exposes these; the web Brain has no file tools, so a web run never trips the
 * ticket backstop. `run_command` is intentionally excluded: it usually runs tests /
 * build / lint, not a durable code change, so treating it as one would mint
 * spurious tickets.
 */
export const CODE_CHANGE_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'edit_file',
  'delete_file',
]);

/**
 * Local tools that can change ARBITRARY files — a shell command may run a codemod, a
 * formatter, `git checkout`, or nothing at all, and the call site cannot tell which.
 * Consumers that invalidate per-target state (see `readCoverage`) must treat these as
 * invalidating everything, because the honest answer to "what did that touch?" is
 * "unknown".
 */
export const UNSCOPED_MUTATION_TOOLS: ReadonlySet<string> = new Set(['run_command']);

export function isLocalWorkspaceTool(name: string): boolean {
  return LOCAL_WORKSPACE_TOOLS.has(name);
}

export function isCodeChangeTool(name: string): boolean {
  return CODE_CHANGE_TOOLS.has(name);
}

export function isUnscopedMutationTool(name: string): boolean {
  return UNSCOPED_MUTATION_TOOLS.has(name);
}

/**
 * Whether THIS run can change code itself — i.e. the host advertised the local
 * workspace writers. The IDE surface does; the web Brain does not.
 *
 * Read by the WORK-mode directive, so "do it yourself rather than dispatching a cloud
 * agent for it" is stated only where it is true, and by nothing else — the post-run
 * ticket backstop reads the same set through {@link isCodeChangeTool}, so the two
 * can never disagree about what "this session can change code" means.
 */
export function canChangeCodeHere(toolNames: readonly string[]): boolean {
  return toolNames.some(isCodeChangeTool);
}

/**
 * The local workspace tools this run actually has, out of a catalog. Handed to the
 * per-turn selector as always-advertised, so the surface's own capability is never a
 * casualty of relevance trimming.
 */
export function localToolsIn(toolNames: readonly string[]): string[] {
  return toolNames.filter(isLocalWorkspaceTool);
}
