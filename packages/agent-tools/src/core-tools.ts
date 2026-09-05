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
  LeaseClaimResult,
  LeaseListResult,
  LeaseMode,
  LeaseReleaseResult,
  MemoryForgetResult,
  MemoryRecallResult,
  MemoryRememberResult,
  MemoryScopeKind,
  PrdUpdateResult,
  WorkspaceNoteResult,
  WorkspaceReadResult,
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
    "Create or update a file, writing its complete contents. How the write lands depends on the surface: in an editor/on-prem workspace it edits the file in place; in a cloud/review run it is staged on the ticket branch as a reviewable pending change. Do NOT narrate a specific mechanism (e.g. \"opened a PR\") — just state what the file now contains. Use once per deliverable file. Provide the FULL file content.",
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
    // `deleted: true` is stated EXPLICITLY, not implied by the absence of the key. The
    // no-op branch above reports `deleted: false`, so a success that omitted the field
    // left the model distinguishing "removed it" from "there was nothing to remove" by
    // noticing a MISSING key — which it reliably does not do.
    return { data: r.ok ? { ok: true, deleted: true, branch: r.branch, commitUrl: r.commitUrl } : { ok: false, error: r.error } };
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
      scope: {
        type: "string",
        enum: ["tenant", "project", "ticket"],
        description:
          "How widely this fact should be visible. 'ticket' = only this ticket's runs; 'project' (default) = every run on this project; 'tenant' = the whole workspace. Prefer the NARROWEST scope that is still true — a project convention is 'project', not 'tenant'.",
      },
      ttl_days: {
        type: "number",
        description:
          "Forget automatically after this many days. Use it for anything time-bound (a release date, a temporary workaround, an in-flight migration). Omit only for facts that stay true indefinitely.",
      },
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
    // The model may only NARROW or name a scope — the surface resolves which concrete
    // project/ticket that means from the run, so a scope string can never aim a write
    // at another project.
    const scope = MEMORY_SCOPES.includes(args.scope as MemoryScopeKind) ? (args.scope as MemoryScopeKind) : undefined;
    const ttlDays =
      typeof args.ttl_days === "number" && Number.isFinite(args.ttl_days) && args.ttl_days > 0 ? args.ttl_days : undefined;
    const r = (await ctx.caps.memory!.remember(key, content, { tags, importance, scope, ttlDays })) as MemoryRememberResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

const MEMORY_SCOPES: readonly MemoryScopeKind[] = ["tenant", "project", "ticket"];

export const memoryForgetTool: ToolDefinition = defineTool({
  name: "memory_forget",
  description:
    "Delete one stored fact from cross-run memory by its key. Use when a fact you (or an earlier run) stored has become WRONG — a decision was reversed, a workaround was removed, a convention changed. Correcting a fact is memory_remember with the same key; this is for facts that should no longer exist at all.",
  parameters: {
    type: "object",
    properties: { key: { type: "string", description: "The key of the fact to delete." } },
    required: ["key"],
  },
  requires: ["memory", "memory.forget"],
  async execute(args, ctx): Promise<ToolResult> {
    const key = typeof args.key === "string" ? args.key : "";
    if (!key.trim()) return { data: { ok: false, error: "key is required" } };
    const r = (await ctx.caps.memory!.forget!(key)) as MemoryForgetResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

// ── Multi-agent coordination ─────────────────────────────────────────────────────
// These four exist because a ticket stage can dispatch SEVERAL agents at once. The
// surface enforces write leases implicitly, so these tools are not load-bearing for
// safety — they let an agent reserve work BEFORE doing it and see what its peers are
// doing, which is what turns a refused write into a plan instead of a retry loop.

export const claimResourceTool: ToolDefinition = defineTool({
  name: "claim_resource",
  description:
    "Reserve a shared resource before you work on it, so a peer agent working the same ticket does not change it underneath you. Pass a file path ('src/app.ts'), a directory ('src/api/'), or 'repo' for the whole tree. Returns granted:false with the current holder when someone else has it — then work on something else, or leave a workspace_note explaining what you need. Writes to a path held by another agent are refused whether or not you claim first.",
  parameters: {
    type: "object",
    properties: {
      resource: { type: "string", description: "What to reserve: a repo-relative file path, a directory, or 'repo'." },
      mode: {
        type: "string",
        enum: ["exclusive", "shared"],
        description: "'exclusive' (default) to write it; 'shared' to signal you are reading it and block others' exclusive claims.",
      },
      reason: { type: "string", description: "One line on why you need it — shown to the peer agent that gets refused." },
    },
    required: ["resource"],
  },
  requires: ["coordinate"],
  async execute(args, ctx): Promise<ToolResult> {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const mode: LeaseMode | undefined = args.mode === "shared" || args.mode === "exclusive" ? args.mode : undefined;
    const reason = typeof args.reason === "string" ? args.reason : undefined;
    const r = (await ctx.caps.coordination!.claim(resource, { mode, reason })) as LeaseClaimResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const releaseResourceTool: ToolDefinition = defineTool({
  name: "release_resource",
  description:
    "Release a resource you claimed, so a peer agent can take it. Do this as soon as you are finished with it rather than holding it to the end of the run. Every lease this run holds is released automatically when the run ends, so this is an optimisation, not a requirement.",
  parameters: {
    type: "object",
    properties: { resource: { type: "string", description: "The resource string you claimed." } },
    required: ["resource"],
  },
  requires: ["coordinate"],
  async execute(args, ctx): Promise<ToolResult> {
    const resource = typeof args.resource === "string" ? args.resource : "";
    if (!resource.trim()) return { data: { ok: false, error: "resource is required" } };
    const r = (await ctx.caps.coordination!.release(resource)) as LeaseReleaseResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const workspaceNoteTool: ToolDefinition = defineTool({
  name: "workspace_note",
  description:
    "Publish a short note on the shared workspace for this ticket, readable by every agent working it (now or later in the ticket's lifecycle). Use it to declare intent ('I own the DB migration'), hand off a finding, or record a decision a peer must not contradict. Reusing a key overwrites that note. This is WORKING state for the current ticket — durable cross-ticket knowledge belongs in memory_remember.",
  parameters: {
    type: "object",
    properties: {
      key: { type: "string", description: "Short stable identifier, e.g. 'owns-migration' or 'api-contract'." },
      content: { type: "string", description: "The note, in one or two lines." },
    },
    required: ["key", "content"],
  },
  requires: ["coordinate"],
  async execute(args, ctx): Promise<ToolResult> {
    const key = typeof args.key === "string" ? args.key : "";
    const content = typeof args.content === "string" ? args.content : "";
    if (!key.trim() || !content.trim()) return { data: { ok: false, error: "key and content are required" } };
    const r = (await ctx.caps.coordination!.postNote(key, content)) as WorkspaceNoteResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

export const workspaceReadTool: ToolDefinition = defineTool({
  name: "workspace_read",
  description:
    "Read the shared workspace for this ticket — notes posted by peer agents plus the resources they currently hold. Call this EARLY when a ticket may be staffed by more than one agent, so you plan around what others already own instead of colliding with them.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Optional filter; omit to read everything." },
      limit: { type: "number", description: "Max notes to return (default 20)." },
    },
  },
  requires: ["coordinate"],
  async execute(args, ctx): Promise<ToolResult> {
    const query = typeof args.query === "string" && args.query.trim() ? args.query : undefined;
    const limit = typeof args.limit === "number" && Number.isFinite(args.limit) ? args.limit : undefined;
    const [notes, leases] = await Promise.all([
      ctx.caps.coordination!.readNotes(query, limit) as Promise<WorkspaceReadResult>,
      ctx.caps.coordination!.listClaims() as Promise<LeaseListResult>,
    ]);
    if (!notes.ok) return { data: notes as unknown as Record<string, unknown> };
    return { data: { ok: true, notes: notes.notes ?? [], heldResources: leases.ok ? (leases.leases ?? []) : [] } };
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
    "Search the public web for a query and return ranked results (title, url, snippet) plus `coverage` and `attribution`. Use to discover sources/docs when you don't have an exact URL; then web_fetch the most relevant result. `coverage: \"owned_index\"` means this workspace's own previously-crawled corpus answered directly; `\"web\"` or `\"encyclopedic\"` means a vendor answered and the found pages are being indexed for next time. When `coverage` is \"encyclopedic\" the index behind this workspace is narrower than a general web engine — report what you actually found and say what you could not find, rather than filling the gap from memory.",
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
    // `web.search` is in the surface's capability set, so the registry only reaches
    // here when a search backing is wired (see WebCapability — `search` is optional
    // precisely so a fetch-only surface can omit `web.search`).
    if (!ctx.caps.web?.search) return { data: { ok: false, error: "web search is not available on this surface" } };
    const r = (await ctx.caps.web.search(query)) as WebSearchResult;
    return { data: r as unknown as Record<string, unknown> };
  },
});

const runChecksTool: ToolDefinition = defineTool({
  name: "run_checks",
  description:
    "Statically validate the files you have written: it parses committed JSON/YAML and runs the platform's shell-free changed-source quality policies, returning structured path/line/rule diagnostics to fix BEFORE finishing. The same validation runs automatically at finish, so it cannot be skipped. IMPORTANT: this serverless executor has NO shell, so it does NOT run the full build, project-wide type-check, lint, or tests — those run in CI on the pull request (the source of truth). Never claim those checks passed.",
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
export function buildGitCommand(action: GitAction, opts?: { path?: string; baseBranch?: string; limit?: number; repo?: string }): string {
  const path = safeGitArg(opts?.path);
  const pathArg = path ? ` -- "${path}"` : "";
  // A workspace root is not always the repository root: a monorepo checkout, or simply
  // a folder holding several projects, has its `.git` one level down. `repo` scopes the
  // command into that subdirectory. `cd X && Y` is the one chaining form that behaves
  // identically under sh, cmd and PowerShell, so this stays portable across every
  // surface that runs these strings. Omitted ⇒ byte-for-byte the previous command, so
  // the Container image's execTool and its tests are unaffected.
  //
  // `repo` is held to a stricter rule than the other args: it becomes the target of a
  // `cd`, so a `..` segment would walk OUT of the workspace rather than merely widening
  // a diff. `safeGitArg` permits dots (a directory really can be named `Builderforce.ai`),
  // so traversal is rejected separately here — the one place it would actually escape.
  const repo = safeRepoArg(opts?.repo);
  const scoped = (cmd: string): string => (repo ? `cd "${repo}" && ${cmd}` : cmd);
  // The multi-line actions cannot take the `cd X && Y` prefix — it would scope only the
  // first line — so they get the `cd` as their own leading statement instead. These
  // scripts already require a POSIX shell (they use `$(…)` and `[ … ]`), so a bare `cd`
  // line is safe here in a way it would not be for the one-liners above. Without this,
  // `sync_latest`/`undo`/`redo` could ONLY ever run at the workspace root: in a folder
  // that CONTAINS checkouts rather than being one, they were unusable and said nothing
  // about why, while `git_status` — which does take `repo` — worked one call earlier.
  const scopedScript = (lines: string[]): string => repoScopedScript(lines.join("\n"), opts?.repo);
  switch (action) {
    case "status":
      return scoped("git status --short --branch");
    case "diff":
      return scoped(`git --no-pager diff${pathArg}`);
    case "history": {
      const limit = Number.isFinite(opts?.limit) && (opts!.limit as number) > 0 ? Math.min(Math.floor(opts!.limit as number), 200) : 30;
      return scoped(`git --no-pager log --oneline -n ${limit}${pathArg}`);
    }
    case "sync_latest": {
      const base = safeGitArg(opts?.baseBranch);
      const resolveBase = base ? `BASE="${base}"` : RESOLVE_BASE;
      return scopedScript([
        "set -e",
        resolveBase,
        'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
        'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
        'git fetch origin "$BASE"',
        'git merge --no-edit "origin/$BASE" || { git merge --abort; echo MERGE_CONFLICT; exit 3; }',
        'echo "Synced with origin/$BASE"',
      ]);
    }
    case "undo":
      // Drop the last commit, reflog-recoverable via redo. Guard a dirty tree so
      // uncommitted work is never silently lost.
      return scopedScript([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        "git reset --hard HEAD~1",
        'echo "Undid the last commit (use git_redo to reapply)"',
      ]);
    case "redo":
      // Reapply the change undone by the most recent reset (the reflog redo).
      return scopedScript([
        '[ -z "$(git status --porcelain)" ] || { echo DIRTY; exit 4; }',
        'git reset --hard "HEAD@{1}"',
        'echo "Reapplied the last undone change"',
      ]);
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

/** git's own wording when the working directory has no repository above it. */
const NOT_A_REPO = /not a git repository/i;

function isNotARepo(r: { stdout?: string; error?: string }): boolean {
  return NOT_A_REPO.test(`${r.stdout ?? ""} ${r.error ?? ""}`);
}

async function runGitTool(action: GitAction, opts: { path?: string; baseBranch?: string; limit?: number; repo?: string }, ctx: { caps: { shell?: { run(c: string): Promise<{ ok: boolean; stdout?: string; exitCode?: number; error?: string }> } } }): Promise<ToolResult> {
  const r = await ctx.caps.shell!.run(buildGitCommand(action, opts));
  // "fatal: not a git repository" is not the end of the road, and returning it raw is
  // what makes it look like one. It happens routinely when the OPEN FOLDER holds
  // several checkouts side by side (`/code/`, with `/code/app` and `/code/api` each a
  // repo): git is run at the root, finds no `.git`, and the agent — handed a bare
  // fatal with no next step — concludes the tool is unusable and gives up, or asks the
  // user a question it could have answered itself.
  //
  // So the failure carries its own remedy: the tools take a `repo` subdirectory, and
  // this says so, names the tool that finds it, and shows the exact retry. Discovery
  // is left to `list_files` rather than a shell one-liner because that tool already
  // works identically on every surface, whereas a directory-scan command would have to
  // be written three ways for sh, cmd and PowerShell.
  if (isNotARepo(r) && !opts.repo) {
    return {
      data: {
        ok: false,
        action,
        error:
          "not a git repository at the workspace root — this usually means the open folder CONTAINS the repositories rather than being one (several checkouts side by side). "
          + "Do not conclude git is unavailable: call `list_files` to see the top-level directories, then re-run this tool with `repo` set to the one holding the code you are working on "
          + `(e.g. { "repo": "my-project" }). If none of them is a checkout, say so plainly — file edits still work, only the git tools need a repository.`,
      },
    };
  }
  const result = gitToolResult(action, r);
  // Say WHERE it ran whenever that was not the obvious place, so a later command in
  // the same run does not have to rediscover the scope.
  if (opts.repo && (result.data as { ok?: boolean }).ok) {
    (result.data as Record<string, unknown>).repo = opts.repo;
  }
  return result;
}

/** The `repo` parameter, shared by every git tool — one description so the six
 *  cannot drift into describing the same argument differently. */
const REPO_PARAM = {
  type: "string",
  description: 'Optional subdirectory holding the repository, when the open folder CONTAINS checkouts rather than being one (e.g. "my-project"). Omit when the workspace root is itself the repo.',
} as const;

export const gitStatusTool: ToolDefinition = defineTool({
  name: "git_status",
  description: "Show the current branch and any uncommitted changes (git status). Use it to see what you have modified before committing, syncing, or finishing. If the open folder contains several checkouts rather than being one repo, pass `repo` to name the one you mean.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("status", { repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitDiffTool: ToolDefinition = defineTool({
  name: "git_diff",
  description: "Show the uncommitted diff of your working tree (optionally for one path). Use it to review exactly what you changed before finishing.",
  parameters: { type: "object", properties: { path: { type: "string", description: "Optional repo-relative file/dir to scope the diff to." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("diff", { path: typeof args.path === "string" ? args.path : undefined, repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitHistoryTool: ToolDefinition = defineTool({
  name: "git_history",
  description: "Show recent commit history (git log --oneline), optionally scoped to a path. Use it to understand how a file evolved before changing it.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Optional repo-relative file/dir to scope history to." },
      limit: { type: "number", description: "Max commits to return (default 30, max 200)." },
      repo: REPO_PARAM,
    },
  },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("history", { path: typeof args.path === "string" ? args.path : undefined, limit: typeof args.limit === "number" ? args.limit : undefined, repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitSyncLatestTool: ToolDefinition = defineTool({
  name: "git_sync_latest",
  description:
    "Fetch the latest base branch (e.g. main) and merge it into your working branch so you are NOT building on stale code. Run this FIRST, before editing — a branch created earlier can be far behind main, so its build fails against old dependencies and its pull request would revert newer work. On a merge conflict it safely aborts and tells you which to resolve.",
  parameters: { type: "object", properties: { baseBranch: { type: "string", description: "Base branch to sync from. Defaults to the remote's default branch (usually main)." }, repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("sync_latest", { baseBranch: typeof args.baseBranch === "string" ? args.baseBranch : undefined, repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitUndoTool: ToolDefinition = defineTool({
  name: "git_undo",
  description: "Undo your most recent commit (keeps the change recoverable — use git_redo to reapply). Refuses if you have uncommitted changes, so it can never discard unsaved work. Use it to back out a change that was wrong.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("undo", { repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

export const gitRedoTool: ToolDefinition = defineTool({
  name: "git_redo",
  description: "Reapply the change you most recently undid with git_undo (reflog redo). Refuses if you have uncommitted changes.",
  parameters: { type: "object", properties: { repo: REPO_PARAM } },
  requires: ["shell"],
  execute: (args, ctx) => runGitTool("redo", { repo: typeof args.repo === "string" ? args.repo : undefined }, ctx),
});

// ── Publishing: commit → push → pull request ─────────────────────────────────────
//
// The git tools above READ, sync and rewind; none of them could move work out of the
// working tree. On the cloud surfaces that is correct — a write there IS a commit and
// the engine opens the PR at finish — but on a LOCAL surface (the editor) an agent
// could edit a file and then had no verb for shipping it. Asked to "commit and push",
// it reported it had no git tool, hunted the catalog, found `run_command`, and shelled
// out `git add -A && git commit && git push` straight to `main`: everything the
// working tree happened to contain, unreviewed, on the base branch.
//
// So these three exist to make the SAFE path the reachable one. The default is a ticket
// branch, a pull request and a reviewer; pushing the base branch is a distinct, declared
// act that the surface's own approval gate prompts for (every tool here is mutating).
// They are gated on `git.write`, NOT `shell` — see that capability for why the cloud
// surfaces must not be handed a second route to publishing.

/** Resolve the base branch into `$BASE`, or fall back to `main`. Shared by every
 *  script below so "what is the base branch" has ONE answer per surface. */
const RESOLVE_BASE = `BASE="$(git remote show origin 2>/dev/null | sed -n 's/.*HEAD branch: //p')"; [ -n "$BASE" ] || BASE=main`;

/** Shell-quote a model-supplied string for a single-quoted POSIX argument. Commit
 *  messages and PR bodies are free text — they cannot go through `safeGitArg`, which
 *  rejects spaces — so they are QUOTED rather than validated. */
function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

/**
 * Build the commit script. Commits ONLY the named paths — never `git add -A`.
 *
 * That is the whole point of requiring `paths`. A working tree is shared with the
 * human using it: the run that prompted this tool had three modified files and the
 * agent had touched one, so `git add -A` would have swept a colleague's in-flight work
 * into the agent's commit. An agent that cannot say what it changed should not be
 * committing.
 *
 * Refuses to commit onto the base branch: `branch` names the ticket branch, created
 * from the current HEAD if it does not exist yet.
 */
function buildCommitCommand(opts: { message: string; paths: string[]; branch?: string; repo?: string }): string {
  const branch = safeGitArg(opts.branch);
  const paths = opts.paths.map((p) => shellQuote(p)).join(" ");
  return [
    "set -e",
    RESOLVE_BASE,
    'git config user.email >/dev/null 2>&1 || git config user.email "agent@builderforce.ai"',
    'git config user.name  >/dev/null 2>&1 || git config user.name  "Builderforce Agent"',
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    // A ticket branch was named: switch to it, creating it if new.
    ...(branch
      ? [`git rev-parse --verify --quiet "${branch}" >/dev/null && git checkout "${branch}" || git checkout -b "${branch}"`]
      : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }']),
    `git add -- ${paths}`,
    // Nothing staged is a fact, not a failure — say which rather than exiting 1 with
    // git's own "nothing to commit" that reads like a broken tool.
    'git diff --cached --quiet && { echo NOTHING_STAGED; exit 6; }',
    `git commit -m ${shellQuote(opts.message)}`,
    'echo "Committed on $(git rev-parse --abbrev-ref HEAD): $(git rev-parse --short HEAD)"',
  ].join("\n");
}

/** Build the push script. Refuses the base branch unless the caller DECLARED it. */
function buildPushCommand(opts: { allowBaseBranch?: boolean; repo?: string }): string {
  return [
    "set -e",
    RESOLVE_BASE,
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    ...(opts.allowBaseBranch ? [] : ['[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }']),
    // `-u` so a brand-new ticket branch gets its upstream on the first push.
    'git push -u origin "$CUR"',
    'echo "Pushed $CUR to origin"',
  ].join("\n");
}

/** Build the `gh pr create` script. The GitHub CLI is used rather than the REST API
 *  because this surface has a shell and the user's own gh auth, so no token has to be
 *  plumbed through the agent. */
function buildPullRequestCommand(opts: { title: string; body: string; base?: string; reviewers?: string[]; repo?: string }): string {
  const base = safeGitArg(opts.base);
  const reviewers = (opts.reviewers ?? []).map((r) => safeGitArg(r)).filter((r): r is string => !!r);
  return [
    "set -e",
    'command -v gh >/dev/null 2>&1 || { echo NO_GH_CLI; exit 7; }',
    ...(base ? [`BASE="${base}"`] : [RESOLVE_BASE]),
    'CUR="$(git rev-parse --abbrev-ref HEAD)"',
    '[ "$CUR" != "$BASE" ] || { echo ON_BASE_BRANCH; exit 5; }',
    // Push first when the branch has no upstream — `gh pr create` fails on an unpushed
    // head, and "open a PR" plainly means the branch has to exist on the remote.
    'git rev-parse --abbrev-ref "@{upstream}" >/dev/null 2>&1 || git push -u origin "$CUR"',
    `gh pr create --base "$BASE" --head "$CUR" --title ${shellQuote(opts.title)} --body ${shellQuote(opts.body)}`
      + reviewers.map((r) => ` --reviewer "${r}"`).join(""),
  ].join("\n");
}

/** Decode the sentinels the publish scripts emit into an instruction the agent can
 *  act on, rather than a raw non-zero exit it can only report. */
function publishToolResult(action: string, r: { ok: boolean; stdout?: string; exitCode?: number; error?: string }): ToolResult {
  const out = (r.stdout ?? "").trim();
  const fail = (error: string): ToolResult => ({ data: { ok: false, action, error, output: out } });
  if (r.exitCode === 5 || /\bON_BASE_BRANCH\b/.test(out)) {
    return fail(
      action === "push"
        ? "you are on the BASE branch (main/master) and `allowBaseBranch` was not set — pushing here bypasses review. Open a pull request instead (git_commit with a `branch`, then open_pull_request). If the human has explicitly asked you to push the base branch, re-call with allowBaseBranch:true; they will be prompted to approve it."
        : "you are on the BASE branch (main/master) — committing here bypasses review. Pass `branch` to git_commit to work on a ticket branch (it is created for you), then open_pull_request.",
    );
  }
  if (r.exitCode === 6 || /\bNOTHING_STAGED\b/.test(out)) {
    return fail("none of the named paths have uncommitted changes — nothing was committed. Run git_status to see what actually differs; do not report a commit that did not happen.");
  }
  if (r.exitCode === 7 || /\bNO_GH_CLI\b/.test(out)) {
    return fail("the GitHub CLI (`gh`) is not installed or not on PATH, so a pull request cannot be opened from here. The branch is committed and pushed; tell the human to open the PR, and give them the branch name.");
  }
  return { data: { ok: r.ok, action, output: out.slice(0, 20_000), ...(r.error ? { error: r.error } : {}) } };
}

/** Run a publish script through the shell capability, with the same not-a-repo remedy
 *  the read-only git tools give. */
async function runPublishTool(
  action: string,
  command: string,
  repo: string | undefined,
  ctx: { caps: { shell?: { run(c: string): Promise<{ ok: boolean; stdout?: string; exitCode?: number; error?: string }> } } },
): Promise<ToolResult> {
  const scoped = repoScopedScript(command, repo);
  const r = await ctx.caps.shell!.run(scoped);
  if (isNotARepo(r) && !repo) return notARepoResult(action);
  const result = publishToolResult(action, r);
  if (repo && (result.data as { ok?: boolean }).ok) (result.data as Record<string, unknown>).repo = repo;
  return result;
}

export const gitCommitTool: ToolDefinition = defineTool({
  name: "git_commit",
  description:
    "Commit the files you changed, on a TICKET BRANCH. You must list the exact `paths` to commit — the working tree is shared with the human using it, so committing everything would sweep up their unrelated in-flight work; run git_status/git_diff first if you are unsure what you touched. Pass `branch` to name the ticket branch (created for you if it does not exist); without it, a commit is refused while you are on the base branch, because that bypasses review. After committing, use open_pull_request — that is how work gets reviewed and shipped.",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", description: "Commit message. One line saying what changed and why." },
      paths: { type: "array", items: { type: "string" }, description: "Repo-relative paths to commit. Exactly the files YOU changed — never a catch-all." },
      branch: { type: "string", description: 'Ticket branch to commit on, created if new (e.g. "ticket/2394-mobile-board-height"). Required in effect when you are on the base branch.' },
      repo: REPO_PARAM,
    },
    required: ["message", "paths"],
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return Promise.resolve({ data: { ok: false, action: "commit", error: "message is required" } });
    const paths = Array.isArray(args.paths) ? args.paths.filter((p): p is string => typeof p === "string" && p.trim() !== "") : [];
    if (paths.length === 0) {
      return Promise.resolve({ data: { ok: false, action: "commit", error: "paths is required — list the exact files you changed. Run git_status to see them. Do not pass '.' or '-A': the working tree may hold changes that are not yours." } });
    }
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    return runPublishTool("commit", buildCommitCommand({ message, paths, branch: typeof args.branch === "string" ? args.branch : undefined, repo }), repo, ctx);
  },
});

export const gitPushTool: ToolDefinition = defineTool({
  name: "git_push",
  description:
    "Push the current branch to origin (setting its upstream on the first push). Pushing the BASE branch (main/master) is refused unless you pass allowBaseBranch — that path skips review, so only set it when the human has explicitly asked for it, and expect them to be prompted to approve it. The normal route is a ticket branch: git_commit with a `branch`, git_push, then open_pull_request.",
  parameters: {
    type: "object",
    properties: {
      allowBaseBranch: { type: "boolean", description: "Set ONLY when the human explicitly asked to push the base branch directly. Default false, which refuses and tells you to open a pull request." },
      repo: REPO_PARAM,
    },
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    return runPublishTool("push", buildPushCommand({ allowBaseBranch: args.allowBaseBranch === true, repo }), repo, ctx);
  },
});

export const openPullRequestTool: ToolDefinition = defineTool({
  name: "open_pull_request",
  description:
    "Open a pull request for the current ticket branch against the base branch, pushing it first if it has no upstream yet. This is how a change gets REVIEWED — prefer it over pushing the base branch, and say so when someone asks you to push directly. Pass `reviewers` to request review from specific people or teams. Returns the pull request URL; report that URL rather than claiming the work is shipped, because it is not until the PR is merged.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Pull request title — what this change does, in one line." },
      body: { type: "string", description: "Pull request description: what changed, why, and how a reviewer can verify it." },
      base: { type: "string", description: "Base branch to target. Defaults to the remote's default branch (usually main)." },
      reviewers: { type: "array", items: { type: "string" }, description: "GitHub usernames or org/team slugs to request review from." },
      repo: REPO_PARAM,
    },
    required: ["title", "body"],
  },
  requires: ["git.write"],
  execute: (args, ctx) => {
    const title = typeof args.title === "string" ? args.title.trim() : "";
    const body = typeof args.body === "string" ? args.body : "";
    if (!title) return Promise.resolve({ data: { ok: false, action: "pull_request", error: "title is required" } });
    const repo = typeof args.repo === "string" ? args.repo : undefined;
    const reviewers = Array.isArray(args.reviewers) ? args.reviewers.filter((r): r is string => typeof r === "string") : undefined;
    return runPublishTool(
      "pull_request",
      buildPullRequestCommand({ title, body, base: typeof args.base === "string" ? args.base : undefined, reviewers, repo }),
      repo,
      ctx,
    );
  },
});

// ── The ticket's PRD ─────────────────────────────────────────────────────────────
// Every run is handed its ticket's PRD as context and, until now, could only READ it:
// a decision made mid-run went nowhere, and a requirement the agent discovered was
// wrong stayed wrong for every later run on the ticket.
//
// ONE tool with a `mode`, not two tools, deliberately. The two writes are the same act
// on the same document — record what this run learned about the spec — differing only
// in WHERE the text lands, and that is a parameter, not an identity. Concretely: one
// name is one thing for the model to discover among ~25 advertised tools (`update_prd`
// is findable from the word "PRD"; `append_prd_note` vs `edit_prd_section` makes the
// model pick before it knows the document), one `requires` gate, and one op to
// implement on every surface — the container image and the Actions runner each dispatch
// by tool name, so a second name is a second handler that can be forgotten in one of
// them. The modes stay separate CAPABILITY verbs (append / editSection) because their
// risk differs; only the model-facing surface is unified.
export const updatePrdTool: ToolDefinition = defineTool({
  name: "update_prd",
  description:
    'Record a change on THIS TICKET\'S PRD — the shared spec you were given in your context and that every other agent on this ticket reads. Use mode "append" (the default, and the safe one) to add a dated, signed note: a decision you made, a constraint you discovered, an assumption you had to take, or work you deliberately left out of scope. Use mode "section" ONLY to correct a section that is actually WRONG — it replaces that section\'s whole body, so pass the full replacement text, not a fragment; name the section by its exact heading (e.g. "Acceptance criteria", "Implementation Notes"). If the heading does not exist the call fails and returns the headings that do — retry with one of those, or append instead. This is not a substitute for doing the work: keep it to what a later run genuinely needs to know.',
  parameters: {
    type: "object",
    properties: {
      mode: {
        type: "string",
        enum: ["append", "section"],
        description:
          '"append" adds a dated, attributed note at the end (nothing already written is lost). "section" REPLACES the named section\'s body — only for correcting something wrong.',
      },
      section: {
        type: "string",
        description:
          'Required when mode is "section": the exact heading to replace, without the leading "##" (e.g. "Acceptance criteria").',
      },
      content: {
        type: "string",
        description:
          'The markdown to record. For mode "append", the note. For mode "section", the section\'s COMPLETE new body.',
      },
    },
    required: ["mode", "content"],
  },
  requires: ["prd.write"],
  async execute(args, ctx): Promise<ToolResult> {
    const mode = args.mode === "section" ? "section" : "append";
    const content = typeof args.content === "string" ? args.content.trim() : "";
    if (!content) return { data: { ok: false, error: "content is required" } };
    if (mode === "section") {
      const heading = typeof args.section === "string" ? args.section.trim() : "";
      if (!heading) {
        return {
          data: {
            ok: false,
            error:
              'section is required when mode is "section" — pass the exact heading to replace, or use mode "append" to add a note instead.',
          },
        };
      }
      const edited = (await ctx.caps.prd!.editSection(heading, content)) as PrdUpdateResult;
      return { data: edited as unknown as Record<string, unknown> };
    }
    const appended = (await ctx.caps.prd!.append(content)) as PrdUpdateResult;
    return { data: appended as unknown as Record<string, unknown> };
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
  memoryForgetTool,
  claimResourceTool,
  releaseResourceTool,
  workspaceNoteTool,
  workspaceReadTool,
  askHumanTool,
  updatePrdTool,
  finishTool,
];

/** A fresh registry seeded with the core tools — both engines build from this. */
export function buildCoreToolRegistry(): ToolRegistry {
  return new ToolRegistry(CORE_TOOLS);
}
