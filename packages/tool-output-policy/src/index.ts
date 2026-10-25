/**
 * @builderforce/tool-output-policy — THE tool-output budget (PRD C7). One policy for the
 * Brain (brain-embedded), agent-runtime and the cloud durable loop (via the agent-loop
 * codec).
 */

export {
  DEFAULT_TOOL_OUTPUT_CHARS,
  HARD_MAX_TOOL_RESULT_CHARS,
  MIN_KEEP_CHARS,
  READ_FILE_MAX_CHARS,
  READ_FILE_TOOL,
  SHELL_CAPTURE_CHARS,
  SHELL_TOOLS,
  TOOL_OUTPUT_CAPS,
  TOOL_RESULT_CHARS_PER_TOKEN,
  TOOL_RESULT_WINDOW_SHARE,
  isShellTool,
  toolOutputCap,
  windowToolResultCap,
  windowedCap,
} from './caps.js';
export { DEFAULT_TRUNCATION_SUFFIX, cutHead, cutHeadTail, keepTail } from './textCut.js';
export type { CutHeadOptions, CutHeadTailOptions } from './textCut.js';
export { DEFAULT_TAIL_LINES, detectRunner, stripAnsi, summarizeShellOutput } from './shellSummary.js';
export type { OutputRunner, ShellSummary, ShellSummaryOptions } from './shellSummary.js';
export { projectJson } from './jsonProjection.js';
export type { JsonProjection, ProjectionStep } from './jsonProjection.js';
export { READ_FILE_RESULT_CHARS, isReadFileResult, isReadFilesResult, sliceReadFile, windowReadFile, windowReadFiles } from './readFileWindow.js';
export type { AttachAdvisory, ReadFileResult, ReadFilesResult, ReadFileWindowed, ReadFileWindowOptions } from './readFileWindow.js';
export { fitToolText, isLogLike, shapeToolResult } from './policy.js';
export type { FitToolTextOptions, ShapeToolResultOptions, ShapedToolResult } from './policy.js';
export { modelToolResultPolicy } from './modelPolicy.js';
export type { ModelToolResultPolicyOptions, ToolResultPolicyFn } from './modelPolicy.js';
