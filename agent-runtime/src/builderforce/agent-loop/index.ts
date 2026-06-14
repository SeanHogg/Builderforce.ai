/**
 * Native agent loop — the pi-free on-prem runtime (PI cutover). Barrel for the
 * `@mariozechner/pi-coding-agent` + `pi-agent-core` + pi-ai-streaming replacements:
 * session persistence, settings, the streaming event protocol, the Agent turn loop,
 * the session wrapper, and compaction.
 */

export {
  CURRENT_SESSION_VERSION,
  SessionManager,
  buildSessionContext,
  loadEntriesFromFile,
  getLatestCompactionEntry,
  createCompactionSummaryMessage,
  createBranchSummaryMessage,
  createCustomMessage,
} from "./session-manager.js";
export type {
  SessionHeader,
  SessionEntry,
  FileEntry,
  SessionContext,
  SessionTreeNode,
  CompactionEntry,
  BranchSummaryEntry,
} from "./session-manager.js";
export { SettingsManager } from "./settings-manager.js";
export type { CompactionSettings } from "./settings-manager.js";
export {
  EventStream,
  AssistantMessageEventStream,
  createAssistantMessageEventStream,
} from "./event-stream.js";
export { createGatewayStreamFn, nativeStreamSimple } from "./stream.js";
export type { StreamFn } from "./stream.js";
export { Agent, agentLoop, defaultConvertToLlm } from "./agent-loop.js";
export type { AgentLoopConfig, AgentState, AgentOptions } from "./agent-loop.js";
export { AgentSession, createAgentSession } from "./agent-session.js";
export type { CreateAgentSessionOptions, PromptOptions } from "./agent-session.js";
export { estimateTokens, generateSummary, serializeConversation } from "./compaction.js";
export { toAgentTool, registryToAgentTools } from "./tool-adapter.js";
