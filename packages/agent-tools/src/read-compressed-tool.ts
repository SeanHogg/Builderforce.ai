/**
 * `read_compressed` — a long PROSE file (docs, notes, logs) read through LLMLingua-2 at
 * roughly half its tokens (cost lever C8, model-invoked). For understanding, never for
 * editing: code files are refused (an edit needs the exact bytes — `read_file`), and
 * fenced code inside a document is carried verbatim.
 *
 * Requires `repo.compress`, which a surface advertises only while its semantic backing
 * really has a compressor (the Desktop health probe reports it). The tool never quietly
 * returns the original as if it were compressed when the compressor is missing: that is
 * an error, because the surface should not have offered it.
 */

import { proseKindOf, compressProse, PROSE_EXTENSIONS } from "./proseCompress.js";
import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";

/** Below this a document is cheap enough to read as-is; it is returned uncompressed. */
const READ_COMPRESSED_MIN_CHARS = 1500;
const RATE_MIN = 0.2;
const RATE_MAX = 0.9;

export const readCompressedTool: ToolDefinition = defineTool({
  name: "read_compressed",
  description:
    `Read a long PROSE file — docs, design notes, READMEs, logs (${PROSE_EXTENSIONS.join(" ")}) — compressed to about half its tokens (LLMLingua-2; code fences, paths and numbers kept verbatim). Use it to UNDERSTAND a big document without paying for every token; never to edit (read_file gives the exact text). Code files are refused.`,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "Repo-relative path of the prose file, e.g. \"docs/design/billing.md\"." },
      rate: { type: "number", description: `Share of tokens to keep, ${RATE_MIN}–${RATE_MAX} (default 0.5).` },
    },
    required: ["path"],
  },
  requires: ["repo.read", "repo.compress"],
  async execute(args, ctx): Promise<ToolResult> {
    const path = typeof args.path === "string" ? args.path.trim() : "";
    if (!path) return { data: { ok: false, error: "path is required" } };
    const kind = proseKindOf(path);
    if (kind === "code") {
      return { data: { ok: false, path, error: `read_compressed only reads prose (${PROSE_EXTENSIONS.join(" ")}). Use read_file for code — an edit needs the exact text.` } };
    }
    const semantic = ctx.caps.semantic;
    if (!semantic?.compress) return { data: { ok: false, path, error: "Compression is not available on this surface right now — use read_file." } };
    const read = await ctx.caps.repoRead!.readFile(path);
    if (!read.ok || typeof read.content !== "string") return { data: read as unknown as Record<string, unknown> };
    const rate = typeof args.rate === "number" && Number.isFinite(args.rate) ? Math.min(RATE_MAX, Math.max(RATE_MIN, args.rate)) : undefined;
    const r = await compressProse(read.content, kind, {
      compress: (t, k) => semantic.compress!(t, k),
      minChars: READ_COMPRESSED_MIN_CHARS,
      ...(rate !== undefined ? { rate } : {}),
    });
    const data: Record<string, unknown> = { ok: true, path, content: r.text, compressed: r.compressed };
    if (r.compressed) {
      data.originalTokens = r.originalTokens;
      data.keptTokens = r.keptTokens;
      data.note = "Compressed for reading — do not quote it as the file's exact text; read_file before editing.";
    } else {
      data.note = read.content.length < READ_COMPRESSED_MIN_CHARS ? "Short enough to read as-is — returned uncompressed." : "Compression did not shorten this text — returned as-is.";
    }
    if (read.truncated) data.truncated = true;
    if (r.compressed) ctx.emit?.({ level: "debug", message: "read_compressed: compressed (C8)", detail: { originalTokens: r.originalTokens, keptTokens: r.keptTokens } });
    return { data };
  },
});
