import { defineTool, type ToolDefinition, type ToolResult } from "@builderforce/agent-tools";
import { Type } from "@sinclair/typebox";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { BuilderForceAgentsConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { textToSpeech } from "../../tts/tts.js";
import type { GatewayMessageChannel } from "../../utils/message-channel.js";
import type { AgentToolResult, AnyAgentTool } from "./common.js";
import { nativeToolResult, readStringParam } from "./common.js";

const TtsToolSchema = Type.Object({
  text: Type.String({ description: "Text to convert to speech." }),
  channel: Type.Optional(
    Type.String({ description: "Optional channel id to pick output format (e.g. telegram)." }),
  ),
});

export interface TtsDeps {
  config?: BuilderForceAgentsConfig;
  agentChannel?: GatewayMessageChannel;
}

/** Shared implementation — pi wrapper + native ToolDefinition both delegate here (DRY). */
export async function runTts(
  opts: TtsDeps | undefined,
  args: Record<string, unknown>,
): Promise<AgentToolResult<unknown>> {
  const params = args;
  const text = readStringParam(params, "text", { required: true });
  const channel = readStringParam(params, "channel");
  const cfg = opts?.config ?? loadConfig();
  const result = await textToSpeech({
    text,
    cfg,
    channel: channel ?? opts?.agentChannel,
  });

  if (result.success && result.audioPath) {
    const lines: string[] = [];
    // Tag Telegram Opus output as a voice bubble instead of a file attachment.
    if (result.voiceCompatible) {
      lines.push("[[audio_as_voice]]");
    }
    lines.push(`MEDIA:${result.audioPath}`);
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: { audioPath: result.audioPath, provider: result.provider },
    };
  }

  return {
    content: [{ type: "text", text: result.error ?? "TTS conversion failed" }],
    details: { error: result.error },
  };
}

export function createTtsTool(opts?: TtsDeps): AnyAgentTool {
  return {
    label: "TTS",
    name: "tts",
    description: `Convert text to speech. Audio is delivered automatically from the tool result — reply with ${SILENT_REPLY_TOKEN} after a successful call to avoid duplicate messages.`,
    parameters: TtsToolSchema,
    execute: async (_toolCallId, args) => runTts(opts, args as Record<string, unknown>),
  };
}

/** Native shared {@link ToolDefinition} (cap `media`) — reuses the TypeBox schema and
 *  the shared `runTts` body; media is surfaced via {@link ToolResult.content}. */
export function buildTtsToolDef(opts?: TtsDeps): ToolDefinition {
  return defineTool({
    name: "tts",
    description:
      "Convert text to speech. The generated audio is returned as a media content block for the host to deliver.",
    parameters: TtsToolSchema as unknown as ToolDefinition["schema"]["function"]["parameters"],
    requires: ["media"],
    async execute(args): Promise<ToolResult> {
      return nativeToolResult(() => runTts(opts, args));
    },
  });
}
