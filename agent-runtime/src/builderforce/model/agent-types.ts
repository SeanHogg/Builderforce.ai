/**
 * Native agent-loop domain types — the `@mariozechner/pi-agent-core` type-surface
 * replacement (PI cutover stage 3, type sites).
 *
 * pi-agent-core contributes only TYPES to the on-prem runtime (the one runtime value,
 * the loop `Agent`, lives in `pi-coding-agent` and is replaced separately). These shapes
 * are kept structurally IDENTICAL to pi-agent-core 0.54 so a native `AgentTool` is
 * mutually assignable with pi's at the still-present loop boundary — the swap is a pure
 * import-path change and `tsc` verifies equivalence.
 *
 * NOTE: `StreamFn` is intentionally NOT here. Its return type is pi-ai's
 * `AssistantMessageEventStream` CLASS (private fields → nominal in TS), and the loop
 * (`pi-coding-agent`) consumes that exact class, so a native look-alike is not
 * assignable. `StreamFn` migrates together with the loop replacement.
 */

import type { Static, TSchema } from "@sinclair/typebox";
import type {
  AssistantMessageEvent,
  ImageContent,
  Message,
  TextContent,
  Tool,
  ToolResultMessage,
} from "./types.js";

/** Agent reasoning effort (faithful to pi-agent-core — note the extra `"off"` vs the
 *  pi-ai model-level `ThinkingLevel`). */
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

/** Message type for bash executions via the `!` command (faithful to pi-coding-agent). */
export interface BashExecutionMessage {
  role: "bashExecution";
  command: string;
  output: string;
  exitCode: number | undefined;
  cancelled: boolean;
  truncated: boolean;
  fullOutputPath?: string;
  timestamp: number;
  /** If true, this message is excluded from LLM context (`!!` prefix). */
  excludeFromContext?: boolean;
}

/** Extension-injected custom message via `sendMessage()` (faithful to pi-coding-agent). */
export interface CustomMessage<T = unknown> {
  role: "custom";
  customType: string;
  content: string | (TextContent | ImageContent)[];
  display: boolean;
  details?: T;
  timestamp: number;
}

export interface BranchSummaryMessage {
  role: "branchSummary";
  summary: string;
  fromId: string;
  timestamp: number;
}

export interface CompactionSummaryMessage {
  role: "compactionSummary";
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

/**
 * Extensible interface for custom app messages (declaration-merge target, faithful to
 * pi-agent-core). The on-prem coding-agent surfaces add the four below — kept here so
 * native `AgentMessage` is structurally identical to pi's wider union while the pi loop
 * is still present (interop) and after it is removed (self-contained).
 */
export interface CustomAgentMessages {
  bashExecution: BashExecutionMessage;
  custom: CustomMessage;
  branchSummary: BranchSummaryMessage;
  compactionSummary: CompactionSummaryMessage;
}

/** Union of LLM messages + any custom app messages. */
export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];

export interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
}

// biome-ignore lint/suspicious/noExplicitAny: matches pi-agent-core's default
export type AgentToolUpdateCallback<T = any> = (partialResult: AgentToolResult<T>) => void;

// biome-ignore lint/suspicious/noExplicitAny: matches pi-agent-core's default
export interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any>
  extends Tool<TParameters> {
  label: string;
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
  ) => Promise<AgentToolResult<TDetails>>;
}

export interface AgentContext {
  systemPrompt: string;
  messages: AgentMessage[];
  // biome-ignore lint/suspicious/noExplicitAny: matches pi-agent-core's default
  tools?: AgentTool<any>[];
}

/**
 * Events emitted by the Agent loop for UI updates (faithful to pi-agent-core).
 */
export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: AgentMessage[] }
  | { type: "turn_start" }
  | { type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }
  | { type: "message_start"; message: AgentMessage }
  | { type: "message_update"; message: AgentMessage; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: AgentMessage }
  // biome-ignore lint/suspicious/noExplicitAny: matches pi-agent-core's `args: any`
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      // biome-ignore lint/suspicious/noExplicitAny: matches pi-agent-core
      args: any;
      // biome-ignore lint/suspicious/noExplicitAny: matches pi-agent-core
      partialResult: any;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      // biome-ignore lint/suspicious/noExplicitAny: matches pi-agent-core
      result: any;
      isError: boolean;
    };
