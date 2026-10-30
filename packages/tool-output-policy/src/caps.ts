/**
 * The budgets, as DATA. Every surface used to carry its own numbers — the Brain's 6,000
 * generic / 16,000 `read_file`, agent-runtime's 30%-of-window with a 400K hard cap and a
 * 2K floor, the local shell's 200K capture / 30K pending buffer, the container's 60K
 * capture and 20K `run_command` reply. They live here once; a surface picks the row it
 * needs instead of restating it.
 */

/** Per-result cap (chars) for a tool with no row in {@link TOOL_OUTPUT_CAPS}. */
export const DEFAULT_TOOL_OUTPUT_CHARS = 6_000;

/**
 * Per-tool caps (chars of the model-facing result). `read_file` is larger on purpose:
 * reading source is what a coding surface DOES, and it is paged by line with the offset
 * that continues it, so a big file costs several honest windows rather than one lossy
 * cut. Shell tools get room for a build/test summary plus the tail of the log.
 */
export const TOOL_OUTPUT_CAPS: Readonly<Record<string, number>> = {
  read_file: 16_000,
  run_command: 20_000,
  exec: 20_000,
  bash: 20_000,
  git_status: 20_000,
  git_diff: 20_000,
  git_history: 20_000,
  git_sync_latest: 20_000,
  git_undo: 20_000,
  git_redo: 20_000,
  // Up to four children's reports in one result, each capped by agent-tools'
  // `SUBAGENT_REPORT_CHARS`. A research child's report IS its deliverable: under the 6K
  // default a wait on four left the owner ~1.5K of each, and it re-spawned researchers
  // to recover what was cut (VS Code chat #6). Four full reports plus each one's header
  // and cut marker; `subagentReportBudget.test.ts` (brain-embedded) holds the two together.
  wait_agents: 34_000,
  // The Creation Canvas's reads. A board snapshot is the whole board as JSON and a real
  // board runs to tens of KB; under the 6K default the model was handed a sliver of it and
  // asked the user to re-select objects that were already there. A build file is paged
  // like `read_file` (see {@link PAGED_READ_TOOLS}).
  canvas_read_snapshot: 64_000,
  canvas_read_object: 32_000,
  canvas_read_build_file: 16_000,
};

/** The tool whose results are paged by line rather than sliced by char. */
export const READ_FILE_TOOL = 'read_file';

/**
 * Every tool whose result is a file read paged at a line boundary, with the tool that
 * finds a symbol in the same files without reading them: `read_file` (`search_code`) and the
 * Creation Canvas's `canvas_read_build_file` (`canvas_search_build_files`) — same
 * `{content, offset, totalLines, truncated}` shape, same `offset` continuation. A paged read
 * is never cut mid-line and always says where it stopped.
 */
export const PAGED_READ_TOOLS: Readonly<Record<string, PagedReadTool>> = {
  // `read_file`'s `offset` applies to each path of a `paths[]` read (agent-tools core-tools).
  [READ_FILE_TOOL]: { search: 'search_code', perPathOffset: true },
  // The canvas's `offset` is honoured for a SINGLE path only.
  canvas_read_build_file: { search: 'canvas_search_build_files', perPathOffset: false },
};

/** What a paged read tool tells the model about continuing and searching. */
export interface PagedReadTool {
  /** The tool that finds a symbol without reading the file. */
  search: string;
  /** Whether `offset` applies to each path of a multi-path read (else: one path at a time). */
  perPathOffset: boolean;
}

/** Whether a tool's result is a line-paged file read. */
export function isPagedReadTool(tool: string): boolean {
  return Object.prototype.hasOwnProperty.call(PAGED_READ_TOOLS, tool);
}

/** The search tool a paged read's note points at when paging cannot reach what is wanted. */
export function pagedReadSearchTool(tool: string): string {
  return PAGED_READ_TOOLS[tool]?.search ?? 'search_code';
}

/** Whether a paged read's `offset` applies to each path of a multi-path read. */
export function pagedReadOffsetsPerPath(tool: string): boolean {
  return PAGED_READ_TOOLS[tool]?.perPathOffset ?? true;
}

/** Tool names whose result is a shell/build/test log. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['run_command', 'exec', 'bash', 'shell', 'process']);

/** Even the largest window (~2M tokens) should not spend more than ~100K tokens on one result. */
export const HARD_MAX_TOOL_RESULT_CHARS = 400_000;

/** Max share of the context window one tool result may occupy (window-relative cap). */
export const TOOL_RESULT_WINDOW_SHARE = 0.3;

/** Rough chars-per-token used to turn a window share into a char budget. */
export const TOOL_RESULT_CHARS_PER_TOKEN = 4;

/** A cut never keeps less than this — the model must still see what the content was. */
export const MIN_KEEP_CHARS = 2_000;

/**
 * Capture buffers for a running process (how much of a live log is HELD, not what the
 * model is handed). The tail is kept: a build or test run prints its verdict last.
 */
export const SHELL_CAPTURE_CHARS = {
  /** agent-runtime's aggregated exec buffer. */
  local: 200_000,
  /** agent-runtime's pending (not-yet-polled) buffer. */
  localPending: 30_000,
  /** The cloud container's per-command buffer. */
  container: 60_000,
} as const;

/** The cap for one tool's result. `caps` overrides the table (tests, a surface's own row). */
export function toolOutputCap(tool: string, caps: Readonly<Record<string, number>> = TOOL_OUTPUT_CAPS): number {
  return caps[tool] ?? DEFAULT_TOOL_OUTPUT_CHARS;
}

/**
 * The window-relative cap: {@link TOOL_RESULT_WINDOW_SHARE} of the context window, in
 * chars, never above {@link HARD_MAX_TOOL_RESULT_CHARS}.
 */
export function windowToolResultCap(contextWindowTokens: number): number {
  const maxTokens = Math.floor(contextWindowTokens * TOOL_RESULT_WINDOW_SHARE);
  return Math.min(maxTokens * TOOL_RESULT_CHARS_PER_TOKEN, HARD_MAX_TOOL_RESULT_CHARS);
}

/** The most one `read_file` result may hold, however large the window (PRD 35 E4). */
export const READ_FILE_MAX_CHARS = 64_000;

/**
 * THE window-sized cap for one tool result (PRD 35 §6.10), from the table row and the
 * serving model's context window:
 *
 *   • `read_file` with a known window → the window share, clamped to
 *     [table row (16K), {@link READ_FILE_MAX_CHARS}] — a big window reads a big file in
 *     fewer windows, a tiny one still gets a whole-line page;
 *   • every other tool with a known window → the smaller of its row and the window share;
 *   • unknown window → the table row (today's behaviour).
 */
export function windowedCap(tool: string, tableCap: number, contextWindowTokens?: number): number {
  if (typeof contextWindowTokens !== 'number' || !Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) return tableCap;
  const share = windowToolResultCap(contextWindowTokens);
  if (isPagedReadTool(tool)) return Math.min(READ_FILE_MAX_CHARS, Math.max(tableCap, share));
  return Math.min(tableCap, share);
}

/** Whether a tool's output is a shell/build/test log. */
export function isShellTool(tool: string): boolean {
  return SHELL_TOOLS.has(tool);
}
