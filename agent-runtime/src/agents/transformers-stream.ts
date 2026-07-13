import fs from "node:fs/promises";
import path from "node:path";
import type { StreamFn } from "../builderforce/agent-loop/index.js";
import type { AssistantMessage, StopReason, TextContent, Usage } from "../builderforce/model/types.js";
import { createAssistantMessageEventStream } from "../builderforce/agent-loop/index.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveAgentRuntimeDir, resolveWorkspaceFilePath } from "./workspace.js";

// HuggingFaceTB/SmolLM2-1.7B-Instruct is the official HuggingFace ONNX build
// with pre-quantized q4 weights — optimised for Transformers.js / Node.js inference.
export const TRANSFORMERS_DEFAULT_MODEL_ID = "HuggingFaceTB/SmolLM2-1.7B-Instruct";
export const TRANSFORMERS_DEFAULT_DTYPE = "q4";
/** Default model cache: ~/.builderforce/models (global .builderforce only). */
export const TRANSFORMERS_DEFAULT_CACHE_DIR = path.join(resolveStateDir(), "models");

// ── Anatomical model defaults ────────────────────────────────────────────────
// Amygdala  = Qwen3-0.6B-ONNX (fastest local router / triage)
// Hippocampus = SmolLM2 (heavier planner / fallback local reasoner)
// Cortex    = user's registered LLM (the actual agent model)
export const AMYGDALA_DEFAULT_MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
export const AMYGDALA_DEFAULT_DTYPE = "q4f16";
export const HIPPOCAMPUS_DEFAULT_MODEL_ID = TRANSFORMERS_DEFAULT_MODEL_ID;
export const HIPPOCAMPUS_DEFAULT_DTYPE = TRANSFORMERS_DEFAULT_DTYPE;

// Long-term memory files in the runtime workspace directory.
// MEMORY.md contains personal/curated knowledge — omit in shared/group contexts.
const LONG_TERM_FILES_ALL = ["SOUL.md", "USER.md", "MEMORY.md", "AGENTS.md"] as const;
const LONG_TERM_FILES_SHARED = ["SOUL.md", "USER.md", "AGENTS.md"] as const;
// Character budget for brain context — leaves headroom for system prompt + conversation.
const BRAIN_CONTEXT_CHAR_BUDGET = 20000;

// ── .builderforce brain context loader ─────────────────────────────────────────

function dailyNoteFilenames(): string[] {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000);
  return [`${fmt(now)}.md`, `${fmt(yesterday)}.md`];
}

/**
 * Loads the full brain context from the agent runtime directory:
 *   - Long-term memory: SOUL.md, USER.md, MEMORY.md*, AGENTS.md
 *   - Short-term memory: workspace/.builderforce/memory/YYYY-MM-DD.md (today + yesterday)
 *
 * *MEMORY.md contains personal curated knowledge and is skipped when
 * `isSharedContext` is true (Discord, group chats, multi-user sessions)
 * to avoid leaking personal data to third parties.
 *
 * Missing files are silently skipped; this function never throws.
 */
export async function loadBuilderForceAgentsMemory(
  workspaceDir: string,
  opts?: { isSharedContext?: boolean },
): Promise<string> {
  const longTermFiles = opts?.isSharedContext ? LONG_TERM_FILES_SHARED : LONG_TERM_FILES_ALL;
  const sections: string[] = [];
  let remaining = BRAIN_CONTEXT_CHAR_BUDGET;
  const runtimeDir = resolveAgentRuntimeDir(workspaceDir);

  // Long-term memory
  for (const filename of longTermFiles) {
    if (remaining <= 0) {
      break;
    }
    try {
      const raw = (
        await fs.readFile(resolveWorkspaceFilePath(workspaceDir, filename), "utf-8")
      ).trim();
      if (!raw) {
        continue;
      }
      const entry = `### ${filename}\n${raw}`;
      if (entry.length <= remaining) {
        sections.push(entry);
        remaining -= entry.length;
      } else if (remaining > 200) {
        sections.push(`### ${filename}\n${raw.slice(0, remaining - 50)}…`);
        remaining = 0;
      }
    } catch {
      // File absent — skip silently.
    }
  }

  // Short-term memory: today's and yesterday's daily notes
  const memoryDir = path.join(runtimeDir, "memory");
  for (const filename of dailyNoteFilenames()) {
    if (remaining <= 0) {
      break;
    }
    try {
      const raw = (await fs.readFile(path.join(memoryDir, filename), "utf-8")).trim();
      if (!raw) {
        continue;
      }
      const label = filename.replace(".md", "");
      const entry = `### Daily note (${label})\n${raw}`;
      if (entry.length <= remaining) {
        sections.push(entry);
        remaining -= entry.length;
      } else if (remaining > 200) {
        sections.push(`### Daily note (${label})\n${raw.slice(0, remaining - 50)}…`);
        remaining = 0;
      }
    } catch {
      // File absent — skip silently.
    }
  }

  if (sections.length === 0) {
    return "";
  }
  return `## BuilderForceAgents Memory\n\n${sections.join("\n\n")}`;
}

// ── Dynamic import helper ────────────────────────────────────────────────────

// @huggingface/transformers is an optional peer dependency.
// Dynamically import to avoid crashing when it is not installed.
async function importTransformers() {
  try {
    return await import("@huggingface/transformers");
  } catch {
    throw new Error(
      "Package '@huggingface/transformers' is not installed. " +
        "Run `npm install @huggingface/transformers` (or pnpm/yarn equivalent) to use local Transformers.js inference.",
    );
  }
}

// ── Pipeline cache ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- pipeline return type is too complex for TS to represent
type TextGenerationPipeline = any;

// Known quantization dtypes accepted by @huggingface/transformers pipeline().
type PipelineDtype = "auto" | "int8" | "uint8" | "q4" | "q8" | "fp16" | "fp32" | "bnb4" | "q4f16";

const pipelineCache = new Map<string, TextGenerationPipeline>();

export async function getOrCreatePipeline(
  modelId: string,
  dtype: string,
  cacheDir: string,
): Promise<TextGenerationPipeline> {
  const resolvedCacheDir = path.resolve(cacheDir);
  const key = `${modelId}:${dtype}:${resolvedCacheDir}`;
  const cached = pipelineCache.get(key);

  const transformers = await importTransformers();
  transformers.env.cacheDir = resolvedCacheDir;
  transformers.env.allowRemoteModels = true;

  if (cached) {
    return cached;
  }

  // Suppress noisy upstream warning about missing Content-Length headers.
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("Unable to determine content-length")) {
      return;
    }
    origWarn.apply(console, args);
  };

  let pipe: TextGenerationPipeline;
  try {
    pipe = await transformers.pipeline("text-generation", modelId, {
      dtype: dtype as PipelineDtype,
    });
  } finally {
    console.warn = origWarn;
  }

  pipelineCache.set(key, pipe);
  return pipe;
}

/**
 * Pre-downloads and caches the BuilderForceAgentsLLM brain model.
 * Calls `onProgress(file, pct)` for each file as it downloads so callers can
 * show a live progress indicator.  Resolves when the full pipeline is ready.
 */
export async function downloadBuilderForceAgentsLlmModel(opts: {
  modelId: string;
  dtype: string;
  cacheDir: string;
  onProgress?: (file: string, percent: number) => void;
}): Promise<void> {
  const resolvedCacheDir = path.resolve(opts.cacheDir);
  const transformers = await importTransformers();
  transformers.env.cacheDir = resolvedCacheDir;
  transformers.env.allowRemoteModels = true;

  const key = `${opts.modelId}:${opts.dtype}:${resolvedCacheDir}`;

  const progressCallback = opts.onProgress
    ? (info: unknown) => {
        const ev = info as { file?: string; progress?: number; status?: string };
        if (ev.status === "progress" && typeof ev.file === "string") {
          opts.onProgress!(ev.file, Math.round(ev.progress ?? 0));
        }
      }
    : undefined;

  // Suppress noisy upstream warning about missing Content-Length headers
  // that would alarm users during normal model downloads.
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("Unable to determine content-length")) {
      return;
    }
    origWarn.apply(console, args);
  };

  try {
    const pipe = await transformers.pipeline("text-generation", opts.modelId, {
      dtype: opts.dtype as PipelineDtype,
      ...(progressCallback ? { progress_callback: progressCallback } : {}),
    });

    pipelineCache.set(key, pipe);
  } finally {
    console.warn = origWarn;
  }
}

// ── Message conversion ───────────────────────────────────────────────────────

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

type ChatMessage = { role: string; content: string };

export function convertToTransformersMessages(
  messages: Array<{ role: string; content: unknown }>,
  system?: string,
): ChatMessage[] {
  const result: ChatMessage[] = [];

  if (system) {
    result.push({ role: "system", content: system });
  }

  for (const msg of messages) {
    const text = extractTextContent(msg.content);
    if (msg.role === "user") {
      result.push({ role: "user", content: text });
    } else if (msg.role === "assistant") {
      result.push({ role: "assistant", content: text });
    }
    // Tool result and tool call messages are not natively supported by
    // small Transformers.js models — they are folded into user/assistant turns.
  }

  return result;
}

// ── Main StreamFn factory ────────────────────────────────────────────────────

export type TransformersStreamOptions = {
  modelId?: string;
  dtype?: string;
  cacheDir?: string;
  /** Agent workspace directory (e.g. ~/.builderforce/workspace).
   *  When provided, SOUL.md / USER.md / MEMORY.md are loaded and prepended
   *  to the system prompt so the model is grounded in long-term memory. */
  workspaceDir?: string;
};

export function createTransformersStreamFn(opts: TransformersStreamOptions = {}): StreamFn {
  const modelId = opts.modelId ?? TRANSFORMERS_DEFAULT_MODEL_ID;
  const dtype = opts.dtype ?? TRANSFORMERS_DEFAULT_DTYPE;
  const cacheDir = opts.cacheDir ?? TRANSFORMERS_DEFAULT_CACHE_DIR;
  const workspaceDir = opts.workspaceDir;

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const pipe = await getOrCreatePipeline(modelId, dtype, cacheDir);

        // Load SOUL.md / USER.md / MEMORY.md from the .builderforce workspace and
        // prepend them to the system prompt so the model is grounded in the
        // agent's identity and long-term memory on every inference call.
        let effectiveSystem = context.systemPrompt ?? "";
        if (workspaceDir) {
          const memoryBlock = await loadBuilderForceAgentsMemory(workspaceDir);
          if (memoryBlock) {
            effectiveSystem = effectiveSystem
              ? `${memoryBlock}\n\n---\n\n${effectiveSystem}`
              : memoryBlock;
          }
        }

        const chatMessages = convertToTransformersMessages(
          context.messages ?? [],
          effectiveSystem || undefined,
        );

        const maxNewTokens = typeof options?.maxTokens === "number" ? options.maxTokens : 512;
        const temperature = typeof options?.temperature === "number" ? options.temperature : 0.6;

        // Transformers.js pipeline call with chat template support.
        // apply_chat_template is handled automatically when passing an array of
        // {role, content} messages to a text-generation pipeline.
        type PipeOutput = Array<{
          generated_text: string | Array<{ role: string; content: string }>;
        }>;
        const rawOutput = (await (pipe as (input: unknown, params: unknown) => Promise<unknown>)(
          chatMessages,
          {
            max_new_tokens: maxNewTokens,
            temperature,
            do_sample: temperature > 0,
            top_p: 0.95,
            repetition_penalty: 1.1,
            return_full_text: false,
          },
        )) as PipeOutput;

        // Extract generated text from the response.
        let generatedText = "";
        const first = rawOutput[0]?.generated_text;
        if (typeof first === "string") {
          generatedText = first.trim();
        } else if (Array.isArray(first)) {
          // When the pipeline returns a message array, grab the last assistant entry.
          const lastMsg = first.findLast(
            (m: { role: string; content: string }) => m.role === "assistant",
          );
          generatedText = (lastMsg?.content ?? "").trim();
        }

        const content: TextContent[] = generatedText
          ? [{ type: "text" as const, text: generatedText }]
          : [];

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
          stopReason: "stop" as StopReason,
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage,
          timestamp: Date.now(),
        };

        stream.push({
          type: "done",
          reason: "stop",
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
