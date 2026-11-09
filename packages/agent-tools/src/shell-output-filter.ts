/**
 * `output_filter`: read a RETAINED command output (`run_command` / `command_status` return its
 * `outputId`) through grep / head / tail — without running the command again. A model that
 * wanted `pnpm type-check | grep error` used to re-run a 100-second type-check just to grep it.
 *
 * Pure: the text comes from the shell's retention (`ShellCapability.output`); this only filters.
 */

import { defineTool, type ToolDefinition, type ToolResult } from "./tool.js";

export interface ShellOutputFilter {
  /** A regular expression (a plain string is matched literally when it is not a valid one). */
  grep?: string;
  head?: number;
  tail?: number;
  ignoreCase?: boolean;
}

/** With no head/tail, the most lines handed back (first half + last half). */
const DEFAULT_WINDOW = 200;
/** A single line longer than this (minified output) is cut. */
const MAX_LINE_CHARS = 2_000;

function lineCount(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : undefined;
}

function matcher(grep: string, ignoreCase: boolean): (line: string) => boolean {
  try {
    const re = new RegExp(grep, ignoreCase ? "i" : "");
    return (line) => re.test(line);
  } catch {
    const needle = ignoreCase ? grep.toLowerCase() : grep;
    return (line) => (ignoreCase ? line.toLowerCase() : line).includes(needle);
  }
}

export interface FilteredOutput {
  totalLines: number;
  matchedLines: number;
  output: string;
  /** True when lines that matched were left out (outside head/tail, or the default window). */
  truncated: boolean;
}

/** Filter `text`: grep first (each kept line prefixed with its 1-based line number), then head / tail. */
export function filterShellOutput(text: string, filter: ShellOutputFilter): FilteredOutput {
  const all = text.split("\n");
  const numbered = all.map((line, i) => ({ n: i + 1, line }));
  const test = filter.grep ? matcher(filter.grep, filter.ignoreCase === true) : undefined;
  const matched = test ? numbered.filter((l) => test(l.line)) : numbered;
  let head = lineCount(filter.head);
  let tail = lineCount(filter.tail);
  if (head === undefined && tail === undefined && matched.length > DEFAULT_WINDOW) {
    head = DEFAULT_WINDOW / 2;
    tail = DEFAULT_WINDOW / 2;
  }
  let kept = matched;
  if (head !== undefined || tail !== undefined) {
    const first = matched.slice(0, head ?? 0);
    const last = tail ? matched.slice(Math.max(first.length, matched.length - tail)) : [];
    kept = [...first, ...last];
  }
  const cut = (line: string): string => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line);
  const output = kept.map((l) => (test ? `${l.n}: ${cut(l.line)}` : cut(l.line))).join("\n");
  return { totalLines: all.length, matchedLines: matched.length, output, truncated: kept.length < matched.length };
}

export const outputFilterTool: ToolDefinition = defineTool({
  name: "output_filter",
  description:
    "Filter the FULL output of a command you already ran — by the outputId run_command / command_status returned — with grep / head / tail. Nothing is re-run. Use this instead of running a command again to grep, head or tail its output.",
  parameters: {
    type: "object",
    properties: {
      outputId: { type: "string", description: "The outputId a run_command or command_status result returned." },
      grep: { type: "string", description: "Optional: keep only lines matching this regular expression (each kept line is prefixed with its line number)." },
      head: { type: "number", description: "Optional: keep the first N (matching) lines." },
      tail: { type: "number", description: "Optional: keep the last N (matching) lines." },
      ignoreCase: { type: "boolean", description: "Optional: case-insensitive grep." },
    },
    required: ["outputId"],
  },
  requires: ["shell.outputs"],
  async execute(args, ctx): Promise<ToolResult> {
    const outputId = typeof args.outputId === "string" ? args.outputId.trim() : "";
    if (!outputId) return { data: { ok: false, error: "outputId is required" } };
    const read = ctx.caps.shell?.output;
    if (!read) return { data: { ok: false, error: "retained command outputs are not available on this surface" } };
    const text = await read.call(ctx.caps.shell, outputId);
    if (text === undefined) {
      return { data: { ok: false, outputId, error: `no retained output "${outputId}" in this run (only the last commands are kept) — run the command again` } };
    }
    const filter: ShellOutputFilter = {
      ...(typeof args.grep === "string" && args.grep ? { grep: args.grep } : {}),
      ...(lineCount(args.head) !== undefined ? { head: lineCount(args.head) } : {}),
      ...(lineCount(args.tail) !== undefined ? { tail: lineCount(args.tail) } : {}),
      ...(args.ignoreCase === true ? { ignoreCase: true } : {}),
    };
    const r = filterShellOutput(text, filter);
    return { data: { ok: true, outputId, ...r, ...(filter.grep ? { matches: r.matchedLines } : {}) } };
  },
});
