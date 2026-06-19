/**
 * The core agent toolset, defined ONCE here so EVERY engine — cloud Worker, cloud
 * Container, on-prem Node — runs the exact same definitions. Each tool reaches the
 * runtime only through the injected {@link ToolContext}/{@link CapabilityProvider},
 * and declares the {@link Capability} it needs; a surface offers a tool iff it backs
 * that capability. No definition is cloud- or node-specific.
 *
 * Surface-flavoured wording is safe here: `run_checks` ("no shell") is gated to
 * `static-check`-only surfaces, so a shell-capable on-prem agent never sees it; the
 * "ticket branch / pull request" framing of write/delete/finish applies on every
 * surface (cloud and on-prem both work a ticket branch and open a PR).
 */

import type {
  MemoryRecallResult,
  MemoryRememberResult,
  RepoDeleteResult,
  RepoEditResult,
  RepoListResult,
  RepoReadResult,
  RepoSearchResult,
  RepoWriteResult,
  StaticCheckResult,
  WebFetchResult,
  WebSearchResult,
} from "./capabilities.js";
import { ToolRegistry } from "./registry.js";
import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";

export const listFilesTool: ToolDefinition = defineTool({
  name: "list_files",
  description:
    'List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass a subdirectory to scope the listing.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
    },
  },
  requires: ["repo.read"],
  async execute(args, ctx): Promise<ToolResult> {
    const sub = typeof args.path === "string" ? args.path : undefined;
    const r = (await ctx.caps.repoRead!.listFiles(sub)) as RepoListResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const searchCodeTool: ToolDefinition = defineTool({
  name: "search_code",
  description:
    'Search the ENTIRE repo for a string/symbol in one call (indexed code search) — use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. 0 results means the term does not appear in the indexed codebase (so "remove all references to X" with 0 results means there is nothing to remove — say so, do not invent a change). Recently-pushed code may lag the index; confirm a specific file with read_file. Then read_file the matches you intend to edit.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Exact text or symbol to find, e.g. a model id, function name, import path, or config key." },
    },
    required: ["query"],
  },
  requires: ["repo.search"],
  async execute(args, ctx): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const r = (await ctx.caps.repoRead!.searchCode(query)) as RepoSearchResult;
    if (r.ok && r.total === 0) {
      return {
        data: {
          ...r,
          note: "No matches in the indexed codebase — the term is not referenced. If the task was to remove/replace it, there is nothing to change; say so instead of inventing an edit.",
        },
      };
    }
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const readFileTool: ToolDefinition = defineTool({
  name: "read_file",
  description:
    "Read the FULL current contents of a repo file on the ticket branch. Always read a file before editing it so you preserve existing code and only change what is needed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
    },
    required: ["path"],
  },
  requires: ["repo.read"],
  async execute(args, ctx): Promise<ToolResult> {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const r = (await ctx.caps.repoRead!.readFile(path)) as RepoReadResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const writeFileTool: ToolDefinition = defineTool({
  name: "write_file",
  description:
    "Create or update a file on the ticket branch as a reviewable pending change (a PR is opened/updated for the run). Use once per deliverable file. Provide the FULL file content.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      content: { type: "string", description: "Complete file content (no placeholders)." },
      summary: { type: "string", description: "One-line description of the change." },
    },
    required: ["path", "content"],
  },
  requires: ["repo.write"],
  async execute(args, ctx): Promise<ToolResult> {
    const path = typeof args.path === "string" ? args.path : "";
    const content = typeof args.content === "string" ? args.content : "";
    const summary = typeof args.summary === "string" ? args.summary : undefined;
    if (!path || !content) return { data: { ok: false, error: "path and content are both required" } };
    const r = (await ctx.caps.repoWrite!.writeFile(path, content, summary)) as RepoWriteResult;
    return { data: r.ok ? { ok: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  },
});

export const deleteFileTool: ToolDefinition = defineTool({
  name: "delete_file",
  description:
    'Remove a file from the ticket branch so it does NOT ship in the pull request. Use this to clean up dead code: a stub/placeholder, an unreferenced file, or a file a PRIOR pass on this branch created that should not be part of the final change. The "Files already on this branch" list in your context shows what a prior pass left — reconcile against it. Verify the file is genuinely unused (search_code for its exports) before deleting. Deleting a file not on the branch is a no-op (reported back), not an error.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path to remove, e.g. "src/utils/email.ts".' },
      reason: { type: "string", description: 'One-line why this file should not ship (e.g. "stub superseded by existing email infra").' },
    },
    required: ["path"],
  },
  requires: ["repo.delete"],
  async execute(args, ctx): Promise<ToolResult> {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const reason = typeof args.reason === "string" ? args.reason : undefined;
    const r = (await ctx.caps.repoWrite!.deleteFile(path, reason)) as RepoDeleteResult;
    if (r.ok && r.deleted === false) return { data: { ok: true, deleted: false, note: r.note } };
    return { data: r.ok ? { ok: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
  },
});

export const editFileTool: ToolDefinition = defineTool({
  name: "edit_file",
  description:
    "Make a surgical in-place edit to an existing file on the ticket branch: replace an exact snippet with new text, without rewriting the whole file. Read the file first so `old_string` matches EXACTLY (including indentation). `old_string` must be unique in the file unless you set `replace_all`. Prefer this over write_file for small changes to large files.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      old_string: { type: "string", description: "The exact text to replace (must match the file byte-for-byte)." },
      new_string: { type: "string", description: "The replacement text." },
      replace_all: { type: "boolean", description: "Replace every occurrence instead of requiring a unique match. Default false." },
    },
    required: ["path", "old_string", "new_string"],
  },
  requires: ["repo.edit"],
  async execute(args, ctx): Promise<ToolResult> {
    const path = typeof args.path === "string" ? args.path : "";
    const oldString = typeof args.old_string === "string" ? args.old_string : "";
    const newString = typeof args.new_string === "string" ? args.new_string : "";
    const replaceAll = args.replace_all === true;
    if (!path || !oldString) return { data: { ok: false, error: "path and old_string are required" } };
    const r = (await ctx.caps.repoWrite!.editFile(path, oldString, newString, replaceAll)) as RepoEditResult;
    return {
      data: r.ok
        ? { ok: true, branch: r.branch, commitUrl: r.commitUrl, replaced: r.replaced }
        : { ok: false, error: r.error },
    };
  },
});

export const memoryRecallTool: ToolDefinition = defineTool({
  name: "memory_recall",
  description:
    "Recall durable facts from cross-run memory that are relevant to a query — decisions, fixes, project conventions, user preferences you (or another run) stored earlier. Call this FIRST when a task touches an area you may have worked before, instead of re-reading large files or history. Returns the most relevant stored entries (key + content); 0 results means nothing relevant is stored yet.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What you want to remember about, e.g. a subsystem, decision, or convention." },
      limit: { type: "number", description: "Max entries to return (default 5)." },
    },
    required: ["query"],
  },
  requires: ["memory"],
  async execute(args, ctx): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : undefined;
    const r = (await ctx.caps.memory!.recall(query, limit)) as MemoryRecallResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const memoryRememberTool: ToolDefinition = defineTool({
  name: "memory_remember",
  description:
    "Store ONE durable fact in cross-run memory so a future run can recall it instead of re-deriving it — a decision, a non-obvious fix, a project constraint, or a user preference. Keep content to one tight line. Use a stable, descriptive key (e.g. 'release-checklist', 'auth-flow'); reusing a key overwrites it. Do NOT store things the repo/git already records or facts that only matter to the current turn.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Stable, descriptive identifier for the fact, e.g. 'deploy-command'." },
      content: { type: "string", description: "The fact, as one concise line." },
      tags: { type: "array", items: { type: "string" }, description: "Optional tags for grouping/filtering." },
      importance: { type: "number", description: "0–1; higher surfaces earlier. Default 0.5." },
    },
    required: ["key", "content"],
  },
  requires: ["memory"],
  async execute(args, ctx): Promise<ToolResult> {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const tags = Array.isArray(args.tags) ? args.tags.filter((t): t is string => typeof t === "string") : undefined;
    const importance =
      typeof args.importance === "number" && Number.isFinite(args.importance) ? args.importance : undefined;
    const r = (await ctx.caps.memory!.remember(key, content, { tags, importance })) as MemoryRememberResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const webFetchTool: ToolDefinition = defineTool({
  name: "web_fetch",
  description:
    "Fetch a single URL and return its readable text content (HTML is reduced to text/markdown). Use to read documentation, an API spec, an issue, or any page you have an exact URL for. Returns the status and the (possibly truncated) content.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "The absolute http(s) URL to fetch." },
    },
    required: ["url"],
  },
  requires: ["web"],
  async execute(args, ctx): Promise<ToolResult> {
    const url = typeof args.url === "string" ? args.url : "";
    if (!url.trim()) return { data: { ok: false, error: "url is required" } };
    const r = (await ctx.caps.web!.fetch(url)) as WebFetchResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const webSearchTool: ToolDefinition = defineTool({
  name: "web_search",
  description:
    "Search the public web for a query and return ranked results (title, url, snippet). Use to discover sources/docs when you don't have an exact URL; then web_fetch the most relevant result.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
    },
    required: ["query"],
  },
  requires: ["web.search"],
  async execute(args, ctx): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const r = (await ctx.caps.web!.search(query)) as WebSearchResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

const runChecksTool: ToolDefinition = defineTool({
  name: "run_checks",
  description:
    "Statically validate the files you have written: it parses your committed JSON and YAML config files in-place and reports any syntax errors to fix BEFORE finishing. IMPORTANT: this serverless executor has NO shell, so it does NOT run the build, project-wide type-check, lint, or tests — those run in CI on the pull request your changes open (the source of truth). Call this after writing config files. Never claim the build/type-check/lint/tests passed — you cannot run those here; only the JSON/YAML syntax check is real.",
  parameters: { type: "object", properties: {} },
  requires: ["static-check"],
  async execute(_args, ctx): Promise<ToolResult> {
    const r = (await ctx.caps.staticCheck!.verify()) as StaticCheckResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const runCommandTool: ToolDefinition = defineTool({
  name: "run_command",
  description:
    'Run a shell command in the checked-out repository (real shell). Use it to install dependencies and run the build, type-check, lint, and tests. Returns combined stdout/stderr and the exit code. Verify your changes this way BEFORE calling finish.',
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: 'The shell command to run, e.g. "npm install" or "npm test".' },
    },
    required: ["command"],
  },
  requires: ["shell"],
  async execute(args, ctx): Promise<ToolResult> {
    const command = typeof args.command === "string" ? args.command : "";
    if (!command.trim()) return { data: { ok: false, error: "command is required" } };
    const r = await ctx.caps.shell!.run(command);
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const askHumanTool: ToolDefinition = defineTool({
  name: "ask_human",
  description:
    'Pause and ask a human for input when you are genuinely BLOCKED — a requirement is ambiguous, you cannot find an expected file/system after searching, a decision needs product/business judgement, or you would otherwise have to guess. The run pauses (no further token spend) and the question goes to the team\'s human-requests queue with a notification; when someone answers, you resume automatically with their answer and continue. Prefer this over guessing or finishing with a "could not proceed" summary — a blocked task that asks gets unblocked; one that gives up silently does not. Do NOT use it for things you can determine yourself with list_files/search_code/read_file.',
  parameters: {
    type: "object",
    properties: {
      question: { type: "string", description: "The specific question for the human. Be concrete and self-contained — they may not have the full task context." },
      context: { type: "string", description: "Optional: what you have tried / why you are blocked, so the human can answer well." },
    },
    required: ["question"],
  },
  requires: ["human"],
  async execute(args, ctx): Promise<ToolResult> {
    const question = typeof args.question === "string" ? args.question.trim() : "";
    const context = typeof args.context === "string" ? args.context : undefined;
    if (!question) return { data: { ok: false, error: "question is required to ask a human" } };
    const r = await ctx.caps.human!.ask(question, context);
    if (r.paused) {
      return {
        control: { kind: "ask_human", approvalId: r.approvalId, question },
        data: { ok: true, paused: true, note: r.note ?? "Question sent to a human. The run is paused until it is answered; you will resume with the answer." },
      };
    }
    return { data: { ok: true, paused: false, answer: r.answer ?? null, note: r.note } };
  },
});

// ---------------------------------------------------------------------------
// Git / version-control tools. Gated to `shell` (a real clone + Linux process),
// so they reach the Container and on-prem Node surfaces but NOT the shell-less
// durable Worker. Each is a thin, intent-named wrapper over a git command run
// through the shell capability — explicit tools the model can call reliably
// instead of hand-crafting git through run_command (the on-prem agent only ever
// had a read-only `git_history`; the mutating "get latest / undo / redo" verbs
// lived nowhere). The Container image runs its OWN loop, so it mirrors these via
// the SAME command strings (`buildGitCommand`) in its execTool — single source
// for the command text so the two execution backends can't drift.
// ---------------------------------------------------------------------------

/** A safe git ref/path token — blocks shell metacharacters so a model-supplied
 *  branch/path can't inject a second command. */
function safeGitArg(v: unknown): string | null {
  return typeof v === "string" && /^[\w./@-]+$/.test(v) ? v : null;
}

/** The git action verbs exposed as tools. */
export type GitAction = "status" | "diff" | "history" | "sync_latest" | "undo" | "redo";

/**
 * Build the shell command for a git action — the SINGLE source of the command
 * text, shared by the registry's `execute` (via `ctx.caps.shell.run`) and the
 * Container image's `execTool`. Pure + deterministic so both backends + the unit
 * tests agree byte-for-byte. `opts` are already-sanitised (see `safeGitArg`).
 *
 * `sync_latest` fetches the base branch and merges it into the working branch so
 * the agent never builds on stale code (the root cause of a branch that compiles
 * against old deps and whose PR would revert newer base work). On conflict it
 * aborts the merge and signals `MERGE_CONFLICT` rather than leaving a half-merged
 * tree. `undo`/`redo` are the classic reflog pair (`HEAD~1` / `HEAD@{1}`) and
 * refuse to run on a dirty tree so they can never silently discard uncommitted
 * work. Pushing the synced/rewound branch is the CALLER's job (surface-specific).
 */
export function buildGitCommand(action: GitAction, opts?: { path?: string; baseBranch?: string; limit?: number }): string {
  const path = safeGitArg(opts?.path);
  const pathArg = path ? ` -- "${path}"` : "";
  switch (action) {
    case "status":
      return "git status --short --branch";
    case "diff":
      return `git --no-pager diff${pathArg}`;
    case "history": {
      const limit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0 ? Math.min(Math.floor(opts!.limit as number), 200) : 30;
      return `git --no-pager log --oneline -n ${limit}${pathArg}`;
    }
    case "sync_latest": {
      const base = safeGitArg(opts?.baseBranch);
      const resolveBase = base
        ? `BASE="${base}"`
        : `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;
      return [
        "set -e",
        resolveBase,
        'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
        'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
        'git fetch origin "$BASE"',
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        'echo "Synced with origin/$BASE"',
      ].join("\n");
    }
    case "undo":
      // Drop the last commit, reflog-recoverable via redo. Guard a dirty tree so
      // uncommitted work is never silently lost.
      return '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }\ngit reset --hard HEAD~1\necho "Undid the last commit (use git_redo to reapply)"';
    case "redo":
      // Reapply the change undone by the most recent reset (the reflog redo).
      return '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }\ngit reset --hard "HEAD@{1}"\necho "Reapplied the last undone change"';
  }
}

/** Map a git ShellResult to a uniform tool result, decoding the sentinel exits
 *  `buildGitCommand` emits (MERGE_CONFLICT / DIRTY) into actionable messages. */
function gitToolResult(action: GitAction, r: { ok: boolean; stdout?: string; exitCode?: number; error?: string }): ToolResult {
  const out = (r.stdout ?? "").trim();
  if (r.exitCode === 3 || /MERGE_CONFLICT/.test(out)) {
    return { data: { ok: false, action, error: "merge conflict — the base branch has changes that conflict with your branch; the merge was aborted (working tree is clean). Resolve by editing the conflicting files, or ask a human.", output: out } };
  }
  if (r.exitCode === 4 || /\bDIRTY\b/.test(out)) {
    return { data: { ok: false, action, error: "you have uncommitted changes — commit or discard them before git_" + action + " (it refuses to discard uncommitted work)." } };
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 20_000), ...(r.error ? { error: r.error } : {}) } };
}

async function runGitTool(action: GitAction, opts: { path?: string; baseBranch?: string; limit?: number }, ctx: { caps: { shell?: { run(c: string): Promise<{ ok: boolean; stdout?: string; exitCode?: number; error?: string }> } } }): Promise<ToolResult> {
  const r = await ctx.caps.shell!.run(buildGitCommand(action, opts));
  return gitToolResult(action, r);
}

export const gitStatusTool: ToolDefinition = defineTool({
  name: "git_status",
  description: "Show the current branch and any uncommitted changes (git status). Use it to see what you have modified before committing, syncing, or finishing.",
  parameters: { type: "object", properties: {} },
  requires: ["shell"],
  execute: (_args, ctx) => runGitTool("status", {}, ctx),
});

export const gitDiffTool: ToolDefinition = defineTool({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional repo-relative file/dir to scope the diff to." } } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : undefined }, ctx),
});

export const gitHistoryTool: ToolDefinition = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repo-relative file/dir to scope history to." },
      limit: { type: "number", description: "Max commits to return (default 30, max 200)." },
    },
  },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("history", { path: typeof args.path === "string" ? args.path : undefined, limit: typeof args.limit === "number" ? args.limit : undefined }, ctx),
});

export const gitSyncLatestTool: ToolDefinition = defineTool({
  name: "git_sync_latest",
  description:
    "Fetch the latest base branch (e.g. main) and merge it into your working branch so you are NOT building on stale code. Run this FIRST, before editing — a branch created earlier can be far behind main, so its build fails against old dependencies and its pull request would revert newer work. On a merge conflict it safely aborts and tells you which to resolve.",
  parameters: { type: "object", properties: { baseBranch: { type: "string", description: "Base branch to sync from. Defaults to the remote's default branch (usually main)." } } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("sync_latest", { baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : undefined }, ctx),
});

export const gitUndoTool: ToolDefinition = defineTool({
  name: "git_undo",
  description: "Undo your most recent commit (keeps the change recoverable — use git_redo to reapply). Refuses if you have uncommitted changes, so it can never discard unsaved work. Use it to back out a change that was wrong.",
  parameters: { type: "object", properties: {} },
  requires: ["shell"],
  execute: (_args, ctx) => runGitTool("undo", {}, ctx),
});

export const gitRedoTool: ToolDefinition = defineTool({
  name: "git_redo",
  description: "Reapply the change you most recently undid with git_undo (reflog redo). Refuses if you have uncommitted changes.",
  parameters: { type: "object", properties: {} },
  requires: ["shell"],
  execute: (_args, ctx) => runGitTool("redo", {}, ctx),
});

export const finishTool: ToolDefinition = defineTool({
  name: "finish",
  description:
    'Call ONLY when the task is fully complete — every deliverable file written with real, working content (no stubs/placeholders) and every task/PRD requirement implemented. Your changes open a pull request for human review, so a partial scaffold is not "done". Provide a concise summary of what was delivered. Do NOT assert that a build/type-check/lint/test passed — you cannot run those here (CI on the PR verifies). If you are blocked rather than done, call ask_human instead of finishing with a "could not proceed" summary.',
  parameters: {
    type: "object",
    properties: { summary: { type: "string", description: "What was delivered." } },
    required: ["summary"],
  },
  // No capability: every surface can finish. The engine applies the honesty +
  // anti-stub finish gates around this control signal (loop policy, not a tool).
  async execute(args): Promise<ToolResult> {
    const summary = typeof args.summary === "string" ? args.summary.trim() : "";
    return { control: { kind: "finish", summary }, data: { ok: true } };
  },
});

/** All core tools, in canonical order. */
export const CORE_TOOLS: readonly ToolDefinition[] = [
  listFilesTool,
  searchCodeTool,
  readFileTool,
  writeFileTool,
  editFileTool,
  deleteFileTool,
  runChecksTool,
  runCommandTool,
  gitStatusTool,
  gitDiffTool,
  gitHistoryTool,
  gitSyncLatestTool,
  gitUndoTool,
  gitRedoTool,
  webFetchTool,
  webSearchTool,
  memoryRecallTool,
  memoryRememberTool,
  askHumanTool,
  finishTool,
];

/** A fresh registry seeded with the core tools — both engines build from this. */
export function buildCoreToolRegistry(): ToolRegistry {
  return new ToolRegistry(CORE_TOOLS);
}
