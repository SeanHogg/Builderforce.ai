/**
 * @builderforce/tool-output-policy — THE tool-output budget (PRD C7). One policy for the
 * Brain (brain-embedded), agent-runtime and the cloud durable loop (via the agent-loop
 * codec).
 */

export {
  DEFAULT_COMMAND_TIMEOUT_MS,
  MAX_BACKGROUND_JOBS,
  BACKGROUND_JOB_LIMIT_ERROR,
  createBackgroundJobRegistry,
  waitForBackgroundJob,
  backgroundWaitAbort,
  EDITOR_COMMAND_OUTPUT_CHARS,
  EDITOR_COMMAND_BUFFER_CHARS,
  BROWSER_COMMAND_OUTPUT_CHARS,
  NATIVE_FILE_READ_MAX_LINES,
  NATIVE_FILE_READ_MAX_BYTES,
  DEFAULT_TOOL_OUTPUT_CHARS,
  HARD_MAX_TOOL_RESULT_CHARS,
  INDEX_FORMATS,
  INDEX_RESULT_CHARS,
  INDEX_RESULT_TOOLS,
  LIST_MAX_FILES,
  LIST_RETURN_MAX,
  READ_MAX_BYTES,
  SEARCH_MAX_MATCHES,
  SNAPSHOT_FILE_MAX_BYTES,
  SHELL_BLEED_MAX_BYTES,
  PANEL_SEARCH_MAX_FILES,
  R2_AGENT_SEARCH_MAX_FILES,
  TASK_INDEX_FORMAT,
  MIN_KEEP_CHARS,
  PAGED_READ_TOOLS,
  READ_FILE_MAX_CHARS,
  READ_FILE_TOOL,
  SHELL_CAPTURE_CHARS,
  SHELL_TOOLS,
  TOOL_OUTPUT_CAPS,
  TOOL_RESULT_CHARS_PER_TOKEN,
  TOOL_RESULT_WINDOW_SHARE,
  isIndexResult,
  isPagedReadTool,
  pagedReadOffsetsPerPath,
  resultTableCap,
  pagedReadSearchTool,
  isShellTool,
  toolOutputCap,
  windowToolResultCap,
  windowedCap,
} from './caps.js';
export { DEFAULT_TRUNCATION_SUFFIX, cutHead, cutHeadTail, keepTail, truncateMiddle } from './textCut.js';
export type { CutHeadOptions, CutHeadTailOptions, TruncateMiddleOptions } from './textCut.js';
export { DEFAULT_TAIL_LINES, detectRunner, stripAnsi, summarizeShellOutput } from './shellSummary.js';
export type { OutputRunner, ShellSummary, ShellSummaryOptions } from './shellSummary.js';
export { projectJson } from './jsonProjection.js';
export type { JsonProjection, ProjectionStep } from './jsonProjection.js';
export { READ_FILE_RESULT_CHARS, isReadFileResult, isReadFilesResult, sliceReadFile, windowReadFile, windowReadFiles } from './readFileWindow.js';
export type { AttachAdvisory, ReadFileResult, ReadFilesResult, ReadFileWindowed, ReadFileWindowOptions } from './readFileWindow.js';
export {
  OUTLINE_FIRST_MIN_CHARS,
  OUTLINE_FIRST_MIN_LINES,
  OUTLINE_FIRST_PREFIX_LINES,
  outlineFirstContinuationNote,
  shouldOutlineFirst,
  type OutlineFirstInput,
} from './outlineFirst.js';
export { fitToolText, isLogLike, shapeToolResult, truncatedResultNote } from './policy.js';
export type { FitToolTextOptions, ShapeToolResultOptions, ShapedToolResult } from './policy.js';
export { modelToolResultPolicy } from './modelPolicy.js';
export {
  CLOUD_MENTION_BUDGET,
  LOCAL_MENTION_BUDGET,
  inlineMentions,
  mentionBudget,
} from './mentions.js';
export type { Mention, MentionBudget, MentionBudgetOptions, MentionTarget } from './mentions.js';
export type { ModelToolResultPolicyOptions, ToolResultPolicyFn } from './modelPolicy.js';
