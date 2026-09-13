/**
 * The code-navigation tools — `find_symbol` and `file_outline` — defined once for every
 * surface that backs capability `repo.symbols` (a maintained definition index: the
 * VS Code workspace and the on-prem Node runtime). A surface without an index never
 * sees them, so neither tool can promise "one instant call" where it would really be a
 * tree walk.
 *
 * They exist to replace two expensive habits with two cheap ones:
 *   • "where is X defined?" answered by `search_code` (every line that MENTIONS X) plus
 *     reads to tell the definition from the calls → `find_symbol`: the definition's
 *     file and line, in one call.
 *   • paging a large file in 2,000-line windows to find one function → `file_outline`:
 *     every definition with its line number, then ONE `read_file` at that offset.
 */

import type { RepoReadResult, SymbolFindResult } from "./capabilities.js";
import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";
import { extractSymbols, formatSymbol, SYMBOL_KINDS, type SymbolKind } from "./symbols.js";

/** Default / ceiling for `find_symbol` matches. */
const FIND_DEFAULT_LIMIT = 20;
const FIND_MAX_LIMIT = 50;
/** Outline entries returned per call — sized to fit a tool result without truncation. */
export const OUTLINE_MAX_ENTRIES = 150;

function asKind(v: unknown): SymbolKind | undefined {
  return typeof v === "string" && (SYMBOL_KINDS as readonly string[]).includes(v) ? (v as SymbolKind) : undefined;
}

export const findSymbolTool: ToolDefinition = defineTool({
  name: "find_symbol",
  description:
    "Find where a function, class, method, type, constant, SQL table or Markdown heading is DEFINED, from the workspace's symbol index — one instant call instead of search_code plus reading files to tell the definition from its call sites. Pass `query` as the symbol name or part of it (case-insensitive; exact matches rank first). Each match is `path:line kind name`; then read_file with `offset` a few lines above that line and a small `limit`. Narrow with `path` (a subdirectory) or `kind`. For USAGES, string literals or config values (not definitions), use search_code instead.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Symbol name or a distinctive part of it, e.g. \"buildGitCommand\" or \"GitCommand\"." },
      path: { type: "string", description: 'Optional repo-relative subdirectory to restrict to, e.g. "api/src".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." },
      limit: { type: "number", description: `Max matches (default ${FIND_DEFAULT_LIMIT}, max ${FIND_MAX_LIMIT}).` },
    },
    required: ["query"],
  },
  requires: ["repo.symbols"],
  async execute(args, ctx): Promise<ToolResult> {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query is required" } };
    const scope = typeof args.path === "string" && args.path.trim() ? args.path.trim() : undefined;
    const kind = asKind(args.kind);
    const requested = typeof args.limit === "number" && Number.isFinite(args.limit) ? Math.floor(args.limit) : FIND_DEFAULT_LIMIT;
    const limit = Math.min(FIND_MAX_LIMIT, Math.max(1, requested));
    const r: SymbolFindResult = await ctx.caps.symbols!.find(query, { scope, kind, limit });
    if (!r.ok) return { data: r as unknown as Record<string, unknown> };
    // One line per match: a JSON object per match would spend most of the result budget
    // on repeated keys, and these are read by a model, not parsed.
    const data: Record<string, unknown> = {
      ok: true,
      query,
      total: r.total ?? 0,
      truncated: r.truncated === true,
      matches: (r.matches ?? []).map((m) => `${m.path}:${m.line} ${m.kind} ${m.name}${m.exported && m.kind !== "heading" ? " (export)" : ""}`),
      indexedFiles: r.indexedFiles,
    };
    if ((r.total ?? 0) === 0) {
      data.note = r.partialIndex
        ? `No definition named like "${query}" in the indexed files — but the index is PARTIAL (file cap reached), so this is not proof it does not exist. Try search_code${scope ? "" : " with a `path`"}.`
        : `No definition named like "${query}"${scope ? ` under "${scope}"` : ""}. It may be defined in a form the index does not recognise (a re-export, an object property, a generated file) — use search_code for the exact text.`;
    } else if (r.truncated) {
      data.note = `Showing ${r.matches?.length ?? 0} of ${r.total} matches — pass a longer \`query\`, a \`path\` or a \`kind\` to narrow.`;
    }
    return { data };
  },
});

export const fileOutlineTool: ToolDefinition = defineTool({
  name: "file_outline",
  description:
    "List what a file DEFINES — functions, classes, methods, types, constants, or a Markdown file's headings — each with its line number, without reading the file's contents. Call this BEFORE paging through a large file: find the symbol you need, then read_file with `offset` at its line and a small `limit`, instead of reading 2,000-line windows until you reach it. Pass `kind` to list only one kind of definition.",
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: 'Repo-relative file path, e.g. "api/src/service.ts".' },
      kind: { type: "string", enum: [...SYMBOL_KINDS], description: "Optional: only this kind of definition." },
    },
    required: ["path"],
  },
  requires: ["repo.read", "repo.symbols"],
  async execute(args, ctx): Promise<ToolResult> {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const kind = asKind(args.kind);
    const file = (await ctx.caps.repoRead!.readFile(path)) as RepoReadResult;
    if (!file.ok) return { data: file as unknown as Record<string, unknown> };
    const content = file.content ?? "";
    // Read fresh from disk, not from the index: the outline must describe the file as it
    // is NOW (the agent may have just edited it), and one file is cheap to parse.
    const all = extractSymbols(path, content).filter((s) => !kind || s.kind === kind);
    const shown = all.slice(0, OUTLINE_MAX_ENTRIES);
    const data: Record<string, unknown> = {
      ok: true,
      path: file.path ?? path,
      totalLines: content.split("\n").length,
      total: all.length,
      symbols: shown.map(formatSymbol),
    };
    if (all.length === 0) {
      data.note = kind
        ? `No ${kind} definitions found in ${path}.`
        : `No definitions recognised in ${path} (unsupported language, or a data/config file) — read_file it directly.`;
    } else if (all.length > shown.length) {
      const lastLine = shown.at(-1)?.line ?? 0;
      data.note = `Showing the first ${shown.length} of ${all.length} definitions (through line ${lastLine}). Pass \`kind\` to list one kind, or find_symbol for a specific name.`;
    }
    return { data };
  },
});

/** The code-navigation tools, spliced into `CORE_TOOLS` beside the file tools. */
export const SYMBOL_TOOLS: readonly ToolDefinition[] = [findSymbolTool, fileOutlineTool];
