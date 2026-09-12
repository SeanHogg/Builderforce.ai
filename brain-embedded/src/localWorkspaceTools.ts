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
  // Cleanup after a merge is the LAST step of shipping and the one most easily trimmed:
  // by the time the agent reaches it, the turn's text is about the change, not about
  // branches, so "cleanup" shares no stem with anything the user said. Unpinned, the
  // agent falls back to hand-rolled `run_command` git — which is exactly how
  // `git push origin --delete <branch>` → `remote ref does not exist` happened.
  'git_cleanup_merged',
  // Delegation to a sub-agent. It belongs here for the same reason and fails the same
  // way: a turn phrased "where does the auth middleware live?" shares no stem with
  // "delegate", so relevance drops the one tool that would answer it cheaply, and the
  // agent burns the turns delegation exists to save. Nothing is pinned that the host
  // did not advertise — the web Brain offers no `spawn_agent`, so this is inert there.
  'spawn_agent',
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
 * The three git tools that REWRITE the working tree belong here for the same reason: a
 * merge of the base branch, an undo or a redo can change any file in the checkout, and
 * name none of them. Consumers that invalidate per-target state (see `readCoverage`)
 * must treat these as invalidating everything, because the honest answer to "what did
 * that touch?" is "unknown". `git_commit` / `git_push` / `open_pull_request` are NOT
 * here: they move work out of the tree without changing a byte a read would see.
 */
export const UNSCOPED_MUTATION_TOOLS: ReadonlySet<string> = new Set([
  'run_command',
  'git_sync_latest',
  'git_undo',
  'git_redo',
  // Cleanup checks out the base branch and fast-forwards it, so every file in the
  // checkout can differ from what a read before it returned — the same reason the
  // three above are here.
  'git_cleanup_merged',
]);

/**
 * The PROJECT MEMORY tools an editor host offers beside the workspace tools — the
 * run's `memory_recall` / `memory_remember` twins against the shared project facts
 * store. Pinned for the same reason the workspace tools are: "recall what a prior run
 * learned before re-reading the codebase" shares no word stem with most requests, so
 * relevance alone drops exactly the tool that would have saved the re-read. Not part of
 * {@link LOCAL_WORKSPACE_TOOLS} because they touch no file and need no workspace (they
 * work in a chat with no folder open), so the read guards must not treat them as
 * workspace reads.
 */
export const PROJECT_MEMORY_TOOLS: ReadonlySet<string> = new Set(['recall_facts', 'remember_fact']);

export function isLocalWorkspaceTool(name: string): boolean {
  return LOCAL_WORKSPACE_TOOLS.has(name);
}

export function isProjectMemoryTool(name: string): boolean {
  return PROJECT_MEMORY_TOOLS.has(name);
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
 * Whether THIS run can PUBLISH its own change — commit AND push. The VS Code host
 * advertises both; the web Brain advertises neither. Read by the self-review ship
 * contract (`selfReviewShip.ts`): only a session that can land its change is told it is
 * that change's reviewer, and only such a session is re-prompted for leaving it unshipped.
 */
export function canShipHere(toolNames: readonly string[]): boolean {
  return toolNames.includes('git_commit') && toolNames.includes('git_push');
}

/**
 * The local workspace tools this run actually has, out of a catalog. Handed to the
 * per-turn selector as always-advertised, so the surface's own capability is never a
 * casualty of relevance trimming.
 */
export function localToolsIn(toolNames: readonly string[]): string[] {
  return toolNames.filter(isLocalWorkspaceTool);
}

/** The project memory tools this run actually has, out of a catalog — always advertised. */
export function memoryToolsIn(toolNames: readonly string[]): string[] {
  return toolNames.filter(isProjectMemoryTool);
}
