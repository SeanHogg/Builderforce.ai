/**
 * What a tool result costs the MODEL transcript on the Brain — the Brain's adapter over
 * THE shared policy, `@builderforce/tool-output-policy` (PRD C7).
 *
 * The full result always survives in the trace (timeline + triage copy); only the copy
 * the model re-reads every turn is bounded. The rules — `read_file` paged at a LINE
 * boundary with its continuation offset rewritten (the fix for chat #99, where a 6,000-
 * char slice deleted the paging fields and the model re-read one file six times), the
 * generic head slice with an item-count marker, and, with the C7 lever on, log
 * summaries and JSON projection — live in that package, shared with agent-runtime, the
 * cloud loop and the container. What stays here is the Brain's own convention for the
 * loop-guard advisory: folded into the result's `note` (`withAdvisory`).
 *
 * Pure: no I/O, no clock.
 */

import { isCostLeverOn } from '@builderforce/cost-levers';
import {
  DEFAULT_TOOL_OUTPUT_CHARS,
  READ_FILE_RESULT_CHARS as SHARED_READ_FILE_RESULT_CHARS,
  READ_FILE_TOOL as SHARED_READ_FILE_TOOL,
  isReadFileResult,
  shapeToolResult,
  sliceReadFile,
  type ShapedToolResult,
} from '@builderforce/tool-output-policy';
import { withAdvisory } from '@builderforce/run-guards';

/** Per-result cap (chars of JSON) for every tool that is not a file read. */
export const MAX_TOOL_RESULT_CHARS = DEFAULT_TOOL_OUTPUT_CHARS;

/** Per-result cap for `read_file` — paged by line, so a big file arrives in windows. */
export const READ_FILE_RESULT_CHARS = SHARED_READ_FILE_RESULT_CHARS;

/** The tool whose results are paged by line rather than sliced by char. A truncated
 *  result from it is a WINDOW (the model is told the offset that continues it), not a
 *  loss — which is how the diagnostics tell the two apart. */
export const READ_FILE_TOOL = SHARED_READ_FILE_TOOL;

export type TrimmedToolResult = ShapedToolResult;

export interface TrimOptions {
  /**
   * A loop-guard advisory to attach to the result (the re-read warning). Attached AFTER
   * trimming so the trim can never delete it, and folded into the same `note` field the
   * tools' own guidance uses so the model meets one convention.
   */
  advisory?: string | null;
  /**
   * The C7 lever decision (log summaries + JSON projection). Defaults to the lever's
   * manifest/rollout answer for an on-device host (no tenant: on only when fully on).
   */
  summarize?: boolean;
  /**
   * The serving model's context window (tokens), when the run knows it
   * (`RunWindowFit.contextWindow`). Sizes the cap through the shared `windowedCap`: a
   * bigger `read_file` page on a large window, a smaller result on a tiny one. Unknown =
   * today's fixed caps.
   */
  contextWindowTokens?: number;
}

/**
 * Trim a tool result to what the model transcript can afford. `bytes` is always the
 * ORIGINAL size — the diagnostics report it. For `read_file`, `served` is the window the
 * model was handed before the advisory — what read coverage records.
 */
export function trimToolResult(tool: string, out: unknown, opts: TrimOptions = {}): TrimmedToolResult {
  return shapeToolResult(tool, out, {
    advisory: opts.advisory,
    attachAdvisory: withAdvisory,
    summarize: opts.summarize ?? isCostLeverOn(undefined, 'c7_tool_output_policy', null),
    ...(opts.contextWindowTokens !== undefined ? { contextWindowTokens: opts.contextWindowTokens } : {}),
  });
}

/**
 * What a COVERED read replays: lines `start`–`end` of the covering read's full result —
 * the window the model asked for, not the covering read's from its first line (PRD 35
 * E1: a request for offset 251 was re-served lines 1–250). Anything that is not a line
 * window passes through unchanged.
 */
export function requestedReadWindow(out: unknown, start: number, end: number): unknown {
  return isReadFileResult(out) ? sliceReadFile(out, start, end) : out;
}
