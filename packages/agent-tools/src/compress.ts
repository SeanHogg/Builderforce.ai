/**
 * `compressLargeContext` — the ONE caller-side policy for LLMLingua-2 token compression
 * (PRD C8, cost lever `c8_token_compression`).
 *
 * Pure and runtime-agnostic: the compressor is injected (the Desktop semantic capability's
 * `compress`, when the health probe reports it), so this file imports nothing node-only
 * and the Worker can share it. What it decides:
 *   • small inputs are returned untouched — compression has a fixed cost and a model
 *     round-trip; it only pays on large context;
 *   • fenced code blocks are never sent — only the prose between them is compressed, and
 *     only prose runs that are themselves large;
 *   • any failure, or a result that is not shorter, falls back to the original text.
 *
 * Callers gate the call on `isCostLeverOn(env, "c8_token_compression", tenantId)` from
 * `@builderforce/cost-levers`; this helper does not read the lever itself.
 */

import type { CompressResult, RepoSemanticCapability, ShellResult, WebFetchResult } from "./capabilities.js";
import type { ToolContext } from "./tool.js";

export type CompressFn = (text: string, rate: number) => Promise<CompressResult>;

export interface CompressLargeContextOptions {
  /** Inputs (and prose runs) shorter than this, in characters, are left alone. */
  minChars?: number;
  /** Share of tokens to keep, 0..1. */
  rate?: number;
  /** The compressor — absent means "not available here": the text is returned as-is. */
  compress?: CompressFn;
}

export interface CompressLargeContextResult {
  text: string;
  /** True when at least one prose run was replaced by its compressed form. */
  compressed: boolean;
  /** Summed over the compressed runs only (untouched text is not counted). */
  originalTokens: number;
  keptTokens: number;
}

export const DEFAULT_COMPRESS_MIN_CHARS = 4000;
export const DEFAULT_COMPRESS_RATE = 0.5;

/** One run of the text: prose may be compressed, a fence is carried verbatim. */
export interface ContextSegment {
  kind: "prose" | "fence";
  text: string;
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

/** The fence run (e.g. "```") a line opens with, or null. */
function fenceRun(line: string): string | null {
  return FENCE_OPEN.exec(line)?.[1] ?? null;
}

/**
 * Split into prose and fenced-code runs covering every character in order — the same
 * rule the service applies (CommonMark: ≥3 backticks or tildes, ≤3 spaces of indent,
 * closed by the same char at least as long; an unclosed fence runs to the end).
 */
export function splitFences(text: string): ContextSegment[] {
  const out: ContextSegment[] = [];
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let buf = "";
  let fence: { ch: string; len: number } | null = null;
  const flush = (kind: ContextSegment["kind"]) => {
    if (buf) out.push({ kind, text: buf });
    buf = "";
  };
  for (const line of lines) {
    const bare = line.replace(/\r?\n$/, "");
    if (!fence) {
      const run = fenceRun(bare);
      if (run) {
        flush("prose");
        fence = { ch: run.charAt(0), len: run.length };
      }
      buf += line;
      continue;
    }
    buf += line;
    const run = fenceRun(bare);
    const open = fence;
    if (run && run.charAt(0) === open.ch && run.length >= open.len && [...bare.trim()].every((c) => c === open.ch)) {
      flush("fence");
      fence = null;
    }
  }
  flush(fence ? "fence" : "prose");
  return out;
}

export async function compressLargeContext(
  text: string,
  opts: CompressLargeContextOptions = {},
): Promise<CompressLargeContextResult> {
  const minChars = opts.minChars ?? DEFAULT_COMPRESS_MIN_CHARS;
  const rate = opts.rate ?? DEFAULT_COMPRESS_RATE;
  const unchanged: CompressLargeContextResult = { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  if (!opts.compress || text.length < minChars || !(rate > 0 && rate < 1)) return unchanged;

  let compressed = false;
  let originalTokens = 0;
  let keptTokens = 0;
  const parts: string[] = [];
  for (const seg of splitFences(text)) {
    if (seg.kind === "fence" || seg.text.trim().length < minChars) {
      parts.push(seg.text);
      continue;
    }
    let r: CompressResult;
    try {
      r = await opts.compress(seg.text, rate);
    } catch {
      r = { ok: false };
    }
    if (r.ok && typeof r.text === "string" && r.text.length < seg.text.length) {
      parts.push(r.text);
      compressed = true;
      originalTokens += r.originalTokens ?? 0;
      keptTokens += r.keptTokens ?? 0;
    } else {
      parts.push(seg.text);
    }
  }
  return compressed ? { text: parts.join(""), compressed, originalTokens, keptTokens } : unchanged;
}

/**
 * What {@link compressToolOutput} reads off a tool context: the host's C8 decision
 * ({@link ToolContext.compressLargeOutputs} — agent-tools has no env, so the host resolves
 * `isCostLeverOn(env, "c8_token_compression", tenantId)` once and passes the answer; absent
 * or false = no compression), the compressor, and the log sink.
 */
export interface CompressionToolContext extends Pick<ToolContext, "compressLargeOutputs" | "emit"> {
  readonly caps: { readonly semantic?: Pick<RepoSemanticCapability, "compress"> };
}

/**
 * C8 on ONE tool-output string: compressed when the host turned it on AND the surface
 * backs `compress` (the Desktop semantic service, when its health probe reports it), else
 * the text unchanged. Only for prose-heavy outputs — shell stdout and fetched pages —
 * never for `read_file` of code (an edit needs the exact bytes).
 */
export async function compressToolOutput(
  text: string,
  ctx: CompressionToolContext,
  tool: string,
): Promise<CompressLargeContextResult> {
  const semantic = ctx.caps.semantic;
  if (ctx.compressLargeOutputs !== true || !semantic?.compress) {
    return { text, compressed: false, originalTokens: 0, keptTokens: 0 };
  }
  const r = await compressLargeContext(text, { compress: (t, rate) => semantic.compress!(t, rate) });
  if (r.compressed) {
    ctx.emit?.({ level: "debug", message: `${tool}: output compressed (C8)`, detail: { originalTokens: r.originalTokens, keptTokens: r.keptTokens } });
  }
  return r;
}

/**
 * `run_command`: compress a SUCCESSFUL command's stdout. A failing command's output is
 * left verbatim — the error lines, stack and assertion diff are exactly what the model
 * must read, and the C7 tool-output policy already focuses them.
 */
export async function compressShellResult(r: ShellResult, ctx: CompressionToolContext): Promise<ShellResult & { compressed?: true }> {
  if (!r.ok || (r.exitCode !== undefined && r.exitCode !== 0) || typeof r.stdout !== "string") return r;
  const c = await compressToolOutput(r.stdout, ctx, "run_command");
  return c.compressed ? { ...r, stdout: c.text, compressed: true } : r;
}

/** `web_fetch`: compress the fetched page's readable text (code fences stay verbatim). */
export async function compressWebFetchResult(r: WebFetchResult, ctx: CompressionToolContext): Promise<WebFetchResult & { compressed?: true }> {
  if (!r.ok || typeof r.content !== "string") return r;
  const c = await compressToolOutput(r.content, ctx, "web_fetch");
  return c.compressed ? { ...r, content: c.text, compressed: true } : r;
}
