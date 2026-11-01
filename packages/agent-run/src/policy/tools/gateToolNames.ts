/**
 * gateToolNames — which tool names a governance gate authored against ONE name also covers.
 *
 * Native / SDK tool names the model emits, plus the catalog names a gate is typically authored against (`write_file`,
 * `run_command`, …). The on-prem `policy-gate-seam.ts` table, extended with the SDK vocabulary its runner's allowlist covered:
 * `Task` / `sessions_spawn` are delegation (`spawn_agent(s)`), `Glob` / `Grep` / `grep` / `find` / `ls` are the read-only
 * exploration tools (`list_files` / `search_code`), and a write gate also covers `delete_file` (a delete is a write) and `apply_patch`.
 *
 * Two kinds of DATA, no branches in the code that reads them:
 *   - {@link TOOL_NAME_SYNONYMS}: a name stands for other names;
 *   - {@link ACTION_RULES}: a tool whose ARGUMENTS decide what it is (`nodes` with `action: "run"`, or `invoke` of a `system.*`
 *     command, runs a command on a node, so it evaluates as the exec family at dispatch). The whole tool is NOT withheld from
 *     the catalog for that (its other actions are not execution); only a call matching the rule evaluates as the family.
 */

export const TOOL_NAME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  write: ["write_file", "Write"],
  write_file: ["write", "Write"],
  Write: ["write", "write_file"],
  delete_file: ["write_file", "write", "Write"],
  // A patch is a write and an edit at once: a gate authored on either covers it.
  apply_patch: ["write_file", "write", "Write", "edit_file", "edit", "Edit"],
  edit: ["edit_file", "Edit"],
  edit_file: ["edit", "Edit"],
  Edit: ["edit", "edit_file"],
  exec: ["run_command", "Bash", "bash"],
  Bash: ["run_command", "exec", "bash"],
  bash: ["run_command", "exec", "Bash"],
  run_command: ["exec", "Bash", "bash"],
  read: ["read_file", "Read"],
  Read: ["read", "read_file"],
  read_file: ["read", "Read"],
  Task: ["spawn_agent", "spawn_agents", "sessions_spawn"],
  spawn_agent: ["Task", "spawn_agents", "sessions_spawn"],
  spawn_agents: ["Task", "spawn_agent", "sessions_spawn"],
  sessions_spawn: ["Task", "spawn_agent", "spawn_agents"],
  Glob: ["list_files", "find", "ls"],
  list_files: ["Glob", "find", "ls"],
  find: ["list_files", "Glob"],
  ls: ["list_files", "Glob"],
  Grep: ["search_code", "grep"],
  search_code: ["Grep", "grep"],
  grep: ["search_code", "Grep"],
};

/** A call of `tool` whose arguments match `when` evaluates as the tool `as`. A string compares equal (trimmed, lowercased); `startsWith` is a prefix. */
interface ActionRule {
  tool: string;
  when: Readonly<Record<string, string | { startsWith: string }>>;
  as: string;
}

export const ACTION_RULES: readonly ActionRule[] = [
  // `process` drives a running exec session: writing to it, submitting to it or killing it acts on a command (listing, polling and reading its log do not).
  ...["write", "send-keys", "submit", "paste", "kill"].map((action): ActionRule => ({ tool: "process", when: { action }, as: "exec" })),
  { tool: "nodes", when: { action: "run" }, as: "exec" },
  { tool: "nodes", when: { action: "invoke", invokeCommand: { startsWith: "system." } }, as: "exec" },
];

function ruleMatches(rule: ActionRule, args: Record<string, unknown> | undefined): boolean {
  return Object.entries(rule.when).every(([key, want]) => {
    const have = typeof args?.[key] === "string" ? (args[key] as string).trim().toLowerCase() : "";
    return typeof want === "string" ? have === want : have.startsWith(want.startsWith);
  });
}

/** The names a call of `toolName` (with `args`) is evaluated as: itself, its synonyms, and the family an action rule puts it in. */
export function candidateToolNames(toolName: string, args?: Record<string, unknown>): string[] {
  const families = ACTION_RULES.filter((r) => r.tool === toolName && ruleMatches(r, args)).map((r) => r.as);
  const names = [toolName, ...(TOOL_NAME_SYNONYMS[toolName] ?? []), ...families.flatMap((f) => [f, ...(TOOL_NAME_SYNONYMS[f] ?? [])])];
  return [...new Set(names.filter(Boolean))];
}
