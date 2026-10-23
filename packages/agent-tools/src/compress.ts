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

import type { CompressResult } from "./capabilities.js";

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
