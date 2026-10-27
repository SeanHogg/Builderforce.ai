import type { AgentMessage } from "../../../builderforce/model/agent-types.js";
import type { Api, AssistantMessage, Model } from "../../../builderforce/model/types.js";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import type { SessionSystemPromptReport } from "../../../config/sessions/types.js";
import type { MessagingToolSend } from "../../embedded-messaging.js";
import type { AuthStorage, ModelRegistry } from "../../model-discovery.js";
import type { OnPremLocalBackings } from "../../on-prem-local-backings.js";
import type { NormalizedUsage } from "../../usage.js";
import type { RunEmbeddedAgentParams } from "./params.js";

type EmbeddedRunAttemptBase = Omit<
  RunEmbeddedAgentParams,
  "provider" | "model" | "authProfileId" | "authProfileIdSource" | "thinkLevel" | "lane" | "enqueue"
>;

export type EmbeddedRunAttemptParams = EmbeddedRunAttemptBase & {
  provider: string;
  modelId: string;
  model: Model<Api>;
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  thinkLevel: ThinkLevel;
};

export type EmbeddedRunAttemptResult = {
  aborted: boolean;
  timedOut: boolean;
  /** True if the timeout occurred while compaction was in progress or pending. */
  timedOutDuringCompaction: boolean;
  promptError: unknown;
  sessionIdUsed: string;
  systemPromptReport?: SessionSystemPromptReport;
  messagesSnapshot: AgentMessage[];
  assistantTexts: string[];
  toolMetas: Array<{ toolName: string; meta?: string }>;
  lastAssistant: AssistantMessage | undefined;
  lastToolError?: {
    toolName: string;
    meta?: string;
    error?: string;
    mutatingAction?: boolean;
    actionFingerprint?: string;
  };
  didSendViaMessagingTool: boolean;
  messagingToolSentTexts: string[];
  messagingToolSentMediaUrls: string[];
  messagingToolSentTargets: MessagingToolSend[];
  successfulCronAdds?: number;
  cloudCodeAssistFormatError: boolean;
  attemptUsage?: NormalizedUsage;
  compactionCount?: number;
  /** The local backings this attempt built its tools with — handed to overflow compaction
   *  so the compaction session sees the SAME tool list (absent when tools were disabled). */
  localBackings?: OnPremLocalBackings;
  /** Client tool call detected (OpenResponses hosted tools). */
  clientToolCall?: { name: string; params: Record<string, unknown> };
};
