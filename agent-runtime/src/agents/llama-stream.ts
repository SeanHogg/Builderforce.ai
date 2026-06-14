import { randomUUID } from "node:crypto";
import type { StreamFn } from "../builderforce/agent-loop/index.js";
import type {
  AssistantMessage,
  StopReason,
  TextContent,
  ToolCall,
  Tool,
  Usage,
} from "../builderforce/model/types.js";
import { createAssistantMessageEventStream } from "../builderforce/agent-loop/index.js";

export interface LlamaStreamOptions {
  modelPath: string;
  contextSize?: number;
  gpuLayers?: number | "auto";
  temperature?: number;
  topP?: number;
}

// ── Lazy node-llama-cpp import ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LlamaCppModule = any;

async function loadLlamaCpp(): Promise<LlamaCppModule> {
  try {
    return await import("node-llama-cpp");
  } catch {
    throw new Error(
      "[llama-stream] node-llama-cpp is not installed. " +
        "Install it with: pnpm add node-llama-cpp@3.15.1\n" +
        "It is listed as a peerDependency of builderForceAgents.",
    );
  }
}

// ── Tool schema conversion ──────────────────────────────────────────────────

function convertToolsToGrammarJson(tools: Tool[]): Record<string, unknown>[] {
  return tools
    .filter((t) => typeof t.name === "string" && t.name)
    .map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: typeof t.description === "string" ? t.description : "",
        parameters: (t.parameters ?? {}) as Record<string, unknown>,
      },
    }));
}

// ── Message conversion ──────────────────────────────────────────────────────

type InputContentPart =
  | { type: "text"; text: string }
  | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return (content as InputContentPart[])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

interface LlamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function convertToLlamaMessages(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): LlamaMessage[] {
  const result: LlamaMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    const text = extractTextContent(msg.content);
    if (msg.role === "user") {
      result.push({ role: "user", content: text });
    } else if (msg.role === "assistant") {
      result.push({ role: "assistant", content: text });
    } else if (msg.role === "tool" || msg.role === "toolResult") {
      // Fold tool results into a user message so llama.cpp can process them
      result.push({ role: "user", content: `[Tool result]: ${text}` });
    }
  }

  return result;
}

// ── Session cache — reuse across calls ─────────────────────────────────────

interface LlamaSessionCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: any;
  modelPath: string;
  contextSize: number;
  gpuLayers: number | "auto";
}

let _sessionCache: LlamaSessionCache | null = null;

async function getOrCreateSession(
  llamaCpp: LlamaCppModule,
  modelPath: string,
  contextSize: number,
  gpuLayers: number | "auto",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<{ model: any; context: any }> {
  if (
    _sessionCache &&
    _sessionCache.modelPath === modelPath &&
    _sessionCache.contextSize === contextSize &&
    _sessionCache.gpuLayers === gpuLayers
  ) {
    return { model: _sessionCache.model, context: _sessionCache.context };
  }

  const { getLlama } = llamaCpp;

  const llama = await getLlama();
  const model = await llama.loadModel({ modelPath, gpuLayers });
  const context = await model.createContext({ contextSize });

  _sessionCache = { model, context, modelPath, contextSize, gpuLayers };
  return { model, context };
}

// ── Main StreamFn factory ──────────────────────────────────────────────────

export function createLlamaStreamFn(modelPath: string, options?: LlamaStreamOptions): StreamFn {
  const resolvedContextSize = options?.contextSize ?? 4096;
  const resolvedGpuLayers = options?.gpuLayers ?? "auto";
  const resolvedTemperature = options?.temperature;
  const resolvedTopP = options?.topP;

  return (model, context, callOptions) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const llamaCpp = await loadLlamaCpp();
        const { LlamaChatSession } = llamaCpp;

        const { context: llamaContext } = await getOrCreateSession(
          llamaCpp,
          modelPath,
          resolvedContextSize,
          resolvedGpuLayers,
        );

        const llamaMessages = convertToLlamaMessages(context.messages ?? [], context.systemPrompt);

        const hasTools = Array.isArray(context.tools) && context.tools.length > 0;

        // Build the full conversation text to feed to llama.cpp
        // LlamaChatSession handles the chat-template formatting internally.
        const session = new LlamaChatSession({ contextSequence: llamaContext.getSequence() });

        // Inject prior messages into the session history
        for (const msg of llamaMessages) {
          if (msg.role !== "user") {
            continue; // LlamaChatSession starts from user turns; system/assistant injected via system prompt
          }
        }

        // Build the user prompt — last user message in the chain
        const lastUserMsg = [...llamaMessages].toReversed().find((m) => m.role === "user");
        const userPrompt = lastUserMsg?.content ?? "";

        // System prompt for the session
        const systemPrompt = llamaMessages.find((m) => m.role === "system")?.content;

        // Grammar for tool calling (JSON-constrained generation)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let grammar: any = undefined;
        if (hasTools && llamaCpp.LlamaJsonSchemaGrammar) {
          try {
            const toolSchemas = convertToolsToGrammarJson(context.tools!);
            const jsonSchema = {
              type: "object",
              properties: {
                tool_calls: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: {
                        type: "string",
                        enum: toolSchemas.map((t) => (t.function as { name: string }).name),
                      },
                      arguments: { type: "object" },
                    },
                    required: ["name", "arguments"],
                  },
                },
                content: { type: "string" },
              },
            };
            grammar = new llamaCpp.LlamaJsonSchemaGrammar(llamaCpp.getLlama(), jsonSchema);
          } catch {
            // Grammar construction failed — fall back to plain generation
            grammar = undefined;
          }
        }

        const temperature =
          resolvedTemperature ??
          (callOptions as { temperature?: number } | undefined)?.temperature ??
          0.7;
        const topP = resolvedTopP ?? 0.9;

        let accumulatedText = "";

        const completionOpts: Record<string, unknown> = {
          temperature,
          topP,
          onToken: (tokens: number[]) => {
            // node-llama-cpp streams tokens — decode and emit chunk
            try {
              const chunk = llamaContext.model.detokenize(tokens);
              accumulatedText += chunk;
            } catch {
              // detokenize may not be exposed on context.model in all versions
            }
          },
        };
        if (grammar) {
          completionOpts.grammar = grammar;
        }
        if (systemPrompt) {
          completionOpts.systemPrompt = systemPrompt;
        }

        const responseText: string = await session.prompt(userPrompt, completionOpts);

        // Try to parse tool calls from JSON response when grammar was used
        const toolCalls: ToolCall[] = [];
        let finalText = responseText;

        if (hasTools) {
          try {
            const parsed = JSON.parse(responseText) as {
              tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>;
              content?: string;
            };
            if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
              for (const tc of parsed.tool_calls) {
                if (typeof tc.name === "string" && tc.name) {
                  toolCalls.push({
                    type: "toolCall",
                    id: `llama_call_${randomUUID()}`,
                    name: tc.name,
                    arguments: tc.arguments ?? {},
                  });
                }
              }
              finalText = parsed.content ?? "";
            }
          } catch {
            // Not a JSON tool-call response — treat as plain text
          }
        }

        const content: (TextContent | ToolCall)[] = [];
        if (finalText.trim()) {
          content.push({ type: "text", text: finalText });
        }
        for (const tc of toolCalls) {
          content.push(tc);
        }

        const stopReason: Extract<StopReason, "stop" | "toolUse"> =
          toolCalls.length > 0 ? "toolUse" : "stop";

        const usage: Usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };

        const assistantMessage: AssistantMessage = {
          role: "assistant",
          content,
          stopReason,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage,
          timestamp: Date.now(),
        };

        stream.push({
          type: "done",
          reason: stopReason,
          message: assistantMessage,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        stream.push({
          type: "error",
          reason: "error",
          error: {
            role: "assistant" as const,
            content: [],
            stopReason: "error" as StopReason,
            errorMessage,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            timestamp: Date.now(),
          },
        });
      } finally {
        stream.end();
      }
    };

    queueMicrotask(() => void run());
    return stream;
  };
}
