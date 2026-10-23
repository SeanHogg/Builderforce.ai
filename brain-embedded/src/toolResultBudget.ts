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
  shapeToolResult,
  type ShapedToolResult,
} from '@builderforce/tool-output-policy';
import { withAdvisory } from './readCoverage';

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
}

/**
 * Trim a tool result to what the model transcript can afford. `bytes` is always the
 * ORIGINAL size — the diagnostics report it.
 */
export function trimToolResult(tool: string, out: unknown, opts: TrimOptions = {}): TrimmedToolResult {
  return shapeToolResult(tool, out, {
    advisory: opts.advisory,
    attachAdvisory: withAdvisory,
    summarize: opts.summarize ?? isCostLeverOn(undefined, 'c7_tool_output_policy', null),
  });
}
