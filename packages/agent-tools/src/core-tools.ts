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
  webFetchTool,
  webSearchTool,
  askHumanTool,
  finishTool,
];

/** A fresh registry seeded with the core tools — both engines build from this. */
export function buildCoreToolRegistry(): ToolRegistry {
  return new ToolRegistry(CORE_TOOLS);
}
