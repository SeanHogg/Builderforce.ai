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
    'List repo files (recursively) on the ticket branch so you can discover the existing codebase before editing. Optionally pass `path` to scope to a subdirectory. To FIND A FILE BY NAME, pass `glob` — e.g. `ROADMAP.md` (matches that filename at any depth, case-insensitive) or `src/**/*.test.ts`. Use `glob` instead of concluding a file is missing: a large repo\'s unfiltered listing is summarized to directories, but a `glob` always returns the matching files in full.',
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Optional repo-relative subdirectory to scope to, e.g. "src/components".' },
      glob: { type: "string", description: 'Optional filename/glob filter, e.g. "ROADMAP.md", "*.md", or "src/**/*.ts". Case-insensitive; a name with no "/" matches the basename at any depth.' },
    },
  },
  requires: ["repo.read"],
  async execute(args, ctx): Promise<ToolResult> {
    const sub = typeof args.path === "string" ? args.path : undefined;
    const glob = typeof args.glob === "string" && args.glob.trim() ? args.glob.trim() : undefined;
    const r = (await ctx.caps.repoRead!.listFiles(sub, glob)) as RepoListResult;
    if (glob && r.ok && (r.paths?.length ?? 0) === 0) {
      return {
        data: {
          ...r,
          note: `No file matches glob "${glob}". Try a broader pattern (e.g. "*${glob.replace(/[*?/]/g, "")}*"), or list_files without a glob to see the tree. 0 matches means no such file exists — do not claim one is missing without trying a broader glob first.`,
        } as unknown as Record<string, unknown>,
      };
    }
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const searchCodeTool: ToolDefinition = defineTool({
  name: "search_code",
  description:
    'Search the repo for a string/symbol in one call — use this FIRST to find where something is referenced instead of reading files one by one. Returns matching file paths with line fragments. Pass `query` as an EXACT substring/regex (a symbol, import path, or config key), NOT a natural-language phrase — a multi-word phrase rarely appears verbatim on one line and will match nothing. On a large monorepo, scope the search with `path` (a subdirectory) to search just that subtree. 0 results with `truncated:false` means the term does not appear (so "remove all references to X" then means there is nothing to remove — say so, do not invent a change); 0 results with `truncated:true` means the search was cut short before scanning everything — narrow it with `path` or a more specific `query` and try again, do NOT conclude the term is absent. Then read_file the matches you intend to edit.',
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Exact text or symbol to find, e.g. a model id, function name, import path, or config key. NOT a natural-language phrase." },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict the search to, e.g. "packages/brain-ui". Use this to avoid truncation on a big repo.' },
    },
    required: ["query"],
  },
  requires: ["repo.search"],
  async execute(args, ctx): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : undefined;
    const r = (await ctx.caps.repoRead!.searchCode(query, scope)) as RepoSearchResult;
    if (r.ok && r.total === 0) {
      // A truncated 0-result is NOT a "not found" — the search hit its scan budget
      // before covering the whole tree. Saying "the term is not referenced" here is
      // the false negative that sent the agent reading files blind; be honest instead.
      const note = r.truncated
        ? `Search was truncated before scanning the whole${scope ? " subtree" : " repo"} — this is NOT proof the term is absent. Re-run scoped to a subdirectory via \`path\`${scope ? " (a narrower one)" : ""}, or use a more specific \`query\`.`
        : `No matches${scope ? ` under "${scope}"` : ""} — the term is not referenced${scope ? " there (try without `path` to search the whole repo)" : ""}. If the task was to remove/replace it, there is nothing to change; say so instead of inventing an edit.`;
      return { data: { ...r, note } };
    }
    return { data: r as unknown as Record<string, unknown> };
  },
});

/** Default line window for `read_file` — a large file returns a bounded slice the
 *  model pages through with `offset`/`limit`, instead of dumping (or failing) on it. */
export const READ_DEFAULT_LINE_LIMIT = 2000;

/**
 * Window file content to a 1-based line range, reporting whether more remains. This
 * is the SINGLE place large-file pagination lives, so every surface (cloud, on-prem,
 * VS Code) behaves identically: `read_file` returns the requested slice plus a
 * `truncated` flag + a "read the next chunk" note when the file is longer than the
 * window. A provider only has to return the file's content (or its own truncated
 * chunk); the windowing math is here, once.
 */
export function windowFileContent(
  content: string,
  opts?: { offset?: number; limit?: number },
): { content: string; truncated: boolean; totalLines: number; offset: number; returnedLines: number } {
  const lines = content.split("\n");
  const totalLines = lines.length;
  const start = opts?.offset && opts.offset > 1 ? Math.min(Math.floor(opts.offset), totalLines + 1) : 1;
  const limit = opts?.limit && opts.limit > 0 ? Math.floor(opts.limit) : READ_DEFAULT_LINE_LIMIT;
  const slice = lines.slice(start - 1, start - 1 + limit);
  const end = start - 1 + slice.length; // last line number included
  return { content: slice.join("\n"), truncated: end < totalLines, totalLines, offset: start, returnedLines: slice.length };
}

export const readFileTool: ToolDefinition = defineTool({
  name: "read_file",
  description:
    "Read a repo file on the ticket branch. Returns up to " +
    READ_DEFAULT_LINE_LIMIT +
    " lines at a time: a large file comes back as a paginated line window (never a hard failure), and the result's `truncated`/`totalLines` tell you when more remains — read the next chunk by calling again with `offset`. Always read a file before editing it so you preserve existing code and only change what is needed.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative path, e.g. "src/feature.ts".' },
      offset: { type: "number", description: "1-based line to start reading from (for paging through a large file). Default 1." },
      limit: { type: "number", description: `Max lines to return. Default ${READ_DEFAULT_LINE_LIMIT}. Read the next window with offset = previous offset + returned lines.` },
    },
    required: ["path"],
  },
  requires: ["repo.read"],
  async execute(args, ctx): Promise<ToolResult> {
    const path = typeof args.path === "string" ? args.path : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const offset = typeof args.offset === "number" && args.offset > 0 ? Math.floor(args.offset) : undefined;
    const limit = typeof args.limit === "number" && args.limit > 0 ? Math.floor(args.limit) : undefined;
    const r = (await ctx.caps.repoRead!.readFile(path)) as RepoReadResult;
    if (!r.ok) return { data: r as unknown as Record<string, unknown> };
    const win = windowFileContent(r.content ?? "", { offset, limit });
    const data: RepoReadResult = {
      ok: true,
      path: r.path ?? path,
      content: win.content,
      truncated: win.truncated || r.truncated === true,
      totalLines: win.totalLines,
      offset: win.offset,
    };
    if (win.truncated) {
      const lastLine = win.offset + win.returnedLines - 1;
      data.note = `Showing lines ${win.offset}–${lastLine} of ${win.totalLines}. To continue, call read_file again with offset ${lastLine + 1}.`;
    }
    return { data: data as unknown as Record<string, unknown> };
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
