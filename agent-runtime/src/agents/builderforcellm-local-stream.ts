/**
 * BuilderForceAgentsLLM local brain — dual ONNX preprocessor + cortex execution engine.
 *
 * Anatomy:
 *
 *   **Amygdala** (Qwen3-0.6B-ONNX)
 *     — fast intent routing / triage (<200 ms)
 *     — decides HANDLE or DELEGATE
 *     — runs tool loop (read_file, list_files, grep_files, run_code)
 *
 *   **Hippocampus** (SmolLM2-1.7B)
 *     — memory consolidation & synthesis
 *     — prompt compression for the cortex
 *     — plan pass in the DELEGATE multi-step chain
 *
 *   **Cortex** (user's registered LLM)
 *     — complex reasoning, multi-file implementations
 *     — called on DELEGATE via callExecutionLlm()
 *
 * Request flow:
 *   1. RAG — relevant workspace files injected into context
 *   2. Amygdala — reasons with .builderforce memory + RAG, runs tools, decides
 *      HANDLE or DELEGATE
 *   3. If HANDLE → amygdala response returned directly
 *   4. If DELEGATE → hippocampus distils a plan → cortex implements
 *      → code-execution feedback → optional fix pass
 *
 * Graceful degradation:
 *   - If amygdala can't load → cortex handles everything
 *   - If hippocampus can't load → amygdala does the plan pass (smaller context)
 */

import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type { StreamFn } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, StopReason, TextContent, Usage } from "../builderforce/model/types.js";
import { createAssistantMessageEventStream } from "@mariozechner/pi-ai";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";
import { retrieveRelevantContext } from "./builderforcellm-rag.js";
import { checkLocalBrainRequirements } from "./builderforcellm-syscheck.js";
import {
  TOOL_USAGE_HINT,
  executeToolCall,
  extractCodeBlocks,
  formatToolResults,
  parseToolCalls,
  type ToolResult,
} from "./builderforcellm-tools.js";
import { loadMambaState, mambaStateToContextLine } from "./mamba-state-engine.js";
import {
  AMYGDALA_DEFAULT_DTYPE,
  AMYGDALA_DEFAULT_MODEL_ID,
  TRANSFORMERS_DEFAULT_CACHE_DIR,
  HIPPOCAMPUS_DEFAULT_MODEL_ID,
  HIPPOCAMPUS_DEFAULT_DTYPE,
  convertToTransformersMessages,
  getOrCreatePipeline,
  loadBuilderForceAgentsMemory,
} from "./transformers-stream.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const log = createSubsystemLogger("brain");
const MAX_TOOL_ROUNDS = 3;
const LOCAL_BRAIN_WORKER_URL = new URL("./builderforcellm-local-worker.js", import.meta.url);
const AMYGDALA_ROUTING_TIMEOUT_MS = 8_000;
const COMPLEX_QUERY_LENGTH = 500;
const COMPLEX_CONVERSATION_MESSAGES = 10;
const COMPLEX_RAG_CONTEXT_LENGTH = 2_500;
const COMPLEX_TOTAL_CONTEXT_LENGTH = 9_000;

const COMPLEX_REQUEST_PATTERNS = [
  /\brefactor\b/i,
  /\barchitecture\b/i,
  /\bdebug(?:ging)?\b/i,
  /\binvestigat(?:e|ion)\b/i,
  /\bperformance\b/i,
  /\boptimi[sz]e\b/i,
  /\bcodebase\b/i,
  /\bmulti(?:-|\s)?file\b/i,
  /\bmultiple files\b/i,
  /\bacross\b/i,
  /\bgateway\b/i,
  /\bworker\b/i,
  /\bthread\b/i,
];

type LocalBrainPendingRequest = {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};

export type LocalBrainRoutingDecision = {
  mode: "simple" | "complex";
  reasons: string[];
};

let localBrainWorker: Worker | null = null;
const localBrainWorkerPending = new Map<string, LocalBrainPendingRequest>();

// ── Brain system prompt ───────────────────────────────────────────────────────

const AMYGDALA_SYSTEM_PROMPT = `\
You are the BuilderForceAgents amygdala — the fast-routing intelligence grounded in memory and context.

Your loaded memory above contains everything you know: your identity, the user's preferences, \
long-term learnings, and recent daily activity. Use it to inform every response.

${TOOL_USAGE_HINT}

Your role:
1. Reason about the request using your memory and any relevant context provided.
2. Call tools if you need more information before answering (read_file, list_files, grep_files, run_code).
3. Decide: can you answer this well directly, or does it need the cortex (a more capable model)?

HANDLE DIRECTLY — respond normally:
- Reasoning, planning, decisions, and explanations
- Memory recall, preferences, and context-based answers
- Simple or short code (a single function or small snippet)
- Anything you can answer completely and correctly

DELEGATE — output exactly "DELEGATE" on the first line, then your reasoning/plan:
- Complex multi-function or multi-file implementations
- Deep debugging requiring broad codebase understanding
- Large refactors or architectural changes

Be decisive. Default to handling directly unless the task clearly exceeds your capabilities.`;

// ── Pipeline helper ───────────────────────────────────────────────────────────

type PipeOutput = Array<{ generated_text: string | Array<{ role: string; content: string }> }>;

function extractPipeText(output: PipeOutput): string {
  const first = output[0]?.generated_text;
  if (typeof first === "string") {
    return first.trim();
  }
  if (Array.isArray(first)) {
    const last = first.findLast((m: { role: string; content: string }) => m.role === "assistant");
    return (last?.content ?? "").trim();
  }
  return "";
}

async function runPipeline(
  pipe: Awaited<ReturnType<typeof getOrCreatePipeline>>,
  messages: Array<{ role: string; content: string }>,
  maxNewTokens: number,
  temperature: number,
): Promise<string> {
  const output = (await (pipe as (input: unknown, params: unknown) => Promise<unknown>)(messages, {
    max_new_tokens: maxNewTokens,
    temperature,
    do_sample: temperature > 0,
    top_p: 0.95,
    repetition_penalty: 1.1,
    return_full_text: false,
  })) as PipeOutput;
  return extractPipeText(output);
}

// ── API-key resolution ────────────────────────────────────────────────────────

function resolveApiKey(configured: string): string | undefined {
  const t = configured.trim();
  if (!t) {
    return undefined;
  }
  // UPPER_SNAKE_CASE → env var name
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(t)) {
    return process.env[t]?.trim() || undefined;
  }
  return t;
}

// ── Provider IDs to skip (avoids recursion into local brain) ───────────────────
// builderforcellm (proxy) is NOT skipped — it is the cortex when user's primary.
const SKIP_PROVIDERS = new Set(["builderforcellm-local", "transformers"]);

// ── Non-streaming Ollama call ─────────────────────────────────────────────────

async function callOllama(opts: {
  baseUrl: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  const base = normalizeBaseUrl(opts.baseUrl.replace(/\/v1\/?$/i, "")) || "http://127.0.0.1:11434";
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: opts.modelId,
        messages: opts.messages,
        stream: false,
        options: { num_predict: opts.maxTokens, temperature: opts.temperature },
      }),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { message?: { content?: string } };
    return data.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Non-streaming OpenAI Chat Completions call ────────────────────────────────

async function callOpenAiCompletions(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  try {
    const res = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.modelId,
        messages: opts.messages,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: false,
      }),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Non-streaming OpenAI Responses API call ───────────────────────────────────
// The Responses API (POST /responses) uses `input` instead of `messages`
// and returns output via `output[].content[].text`.

async function callOpenAiResponses(opts: {
  baseUrl: string;
  apiKey: string;
  modelId: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  type ResponsesOutput = {
    output?: Array<{
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    }>;
  };
  try {
    const res = await fetch(`${normalizeBaseUrl(opts.baseUrl)}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${opts.apiKey}` },
      body: JSON.stringify({
        model: opts.modelId,
        input: opts.messages,
        max_output_tokens: opts.maxTokens,
        temperature: opts.temperature,
        stream: false,
        store: false,
      }),
      signal: opts.signal ?? AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return null;
    }
    const data = (await res.json()) as ResponsesOutput;
    for (const block of data.output ?? []) {
      if (block.type === "message") {
        for (const part of block.content ?? []) {
          if (part.type === "output_text" && part.text) {
            return part.text.trim();
          }
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ── Execution LLM router ──────────────────────────────────────────────────────

function parseModelKey(key: string): { provider: string; modelId: string } | null {
  const idx = key.indexOf("/");
  if (idx <= 0 || idx >= key.length - 1) {
    return null;
  }
  return { provider: key.slice(0, idx).trim(), modelId: key.slice(idx + 1).trim() };
}

async function callExecutionLlm(opts: {
  config: BuilderForceAgentsConfig | undefined;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
}): Promise<string | null> {
  const { config, messages, maxTokens, temperature, signal } = opts;
  const providers = config?.models?.providers ?? {};

  // Build ordered list: primary first, then fallbacks, then remaining providers.
  const primary = config?.agents?.defaults?.model?.primary?.trim();
  const fallbacks = config?.agents?.defaults?.model?.fallbacks ?? [];
  const preferredKeys = [
    ...(primary ? [primary] : []),
    ...fallbacks.filter((f): f is string => typeof f === "string" && f.trim().length > 0),
  ];
  const seen = new Set<string>();
  const orderedEntries: Array<[string, (typeof providers)[string]]> = [];
  for (const key of preferredKeys) {
    const parsed = parseModelKey(key);
    if (!parsed || seen.has(parsed.provider)) {
      continue;
    }
    const cfg = providers[parsed.provider];
    if (cfg && !SKIP_PROVIDERS.has(parsed.provider.toLowerCase())) {
      seen.add(parsed.provider);
      orderedEntries.push([parsed.provider, cfg]);
    }
  }
  for (const [id, cfg] of Object.entries(providers)) {
    if (!seen.has(id) && !SKIP_PROVIDERS.has(id.toLowerCase())) {
      orderedEntries.push([id, cfg]);
    }
  }

  for (const [id, cfg] of orderedEntries) {
    if (!cfg?.baseUrl) {
      continue;
    }
    const parsed = parseModelKey(preferredKeys.find((k) => k.startsWith(`${id}/`)) ?? "");
    const modelId = parsed?.provider === id ? parsed.modelId : cfg.models?.[0]?.id;
    if (!modelId) {
      continue;
    }

    const callArgs = { modelId, messages, maxTokens, temperature, signal };
    log.info(
      `cortex: calling execution LLM provider=${id} model=${modelId} api=${cfg.api ?? "unknown"}`,
    );
    const t0 = Date.now();

    if (cfg.api === "ollama") {
      const r = await callOllama({ baseUrl: cfg.baseUrl, ...callArgs });
      if (r !== null) {
        log.info(`cortex: completed in ${Date.now() - t0}ms (${r.length} chars)`);
        return r;
      }
    } else if (cfg.api === "openai-completions") {
      const apiKey = resolveApiKey(cfg.apiKey ?? "");
      if (!apiKey) {
        continue;
      }
      const r = await callOpenAiCompletions({ baseUrl: cfg.baseUrl, apiKey, ...callArgs });
      if (r !== null) {
        log.info(`cortex: completed in ${Date.now() - t0}ms (${r.length} chars)`);
        return r;
      }
    } else if (cfg.api === "openai-responses") {
      const apiKey = resolveApiKey(cfg.apiKey ?? "");
      if (!apiKey) {
        continue;
      }
      const r = await callOpenAiResponses({ baseUrl: cfg.baseUrl, apiKey, ...callArgs });
      if (r !== null) {
        log.info(`cortex: completed in ${Date.now() - t0}ms (${r.length} chars)`);
        return r;
      }
    }
    log.info(`cortex: provider ${id} returned null — trying next provider`);
  }
  log.info("cortex: no execution LLM returned a result");
  return null;
}

// ── Multi-step chain: plan → code → execution feedback ───────────────────────

async function runMultiStepChain(opts: {
  amygdalaPipe: Awaited<ReturnType<typeof getOrCreatePipeline>>;
  /* oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- pipeline type from upstream */
  hippocampusPipe: Awaited<ReturnType<typeof getOrCreatePipeline>> | null;
  config: BuilderForceAgentsConfig | undefined;
  // Raw context messages (content: unknown) — converted internally as needed.
  rawMessages: Array<{ role: string; content: unknown }>;
  contextSystemPrompt: string | undefined;
  brainPlan: string;
  memoryBlock: string;
  ragContext: string;
  maxTokens: number;
  temperature: number;
  workspaceDir: string | undefined;
  /** Forwarded from factory opts — user must have explicitly opted in. */
  allowRunCode: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  const {
    amygdalaPipe,
    hippocampusPipe,
    brainPlan,
    memoryBlock,
    ragContext,
    maxTokens,
    temperature,
  } = opts;

  // Use hippocampus for the plan pass when available (128K ctx → better plans).
  // Fallback to amygdala if hippocampus couldn't be loaded.
  const planPipe = hippocampusPipe ?? amygdalaPipe;
  const planMaxTokens = hippocampusPipe ? 512 : 256;

  // ── Step 1: Plan pass — hippocampus distils a numbered implementation plan ─
  const planTier = hippocampusPipe ? "hippocampus" : "amygdala (fallback)";
  log.info(`${planTier}: starting plan pass...`);
  const planT0 = Date.now();
  const planContext = [memoryBlock, ragContext, brainPlan].filter(Boolean).join("\n\n");
  const planMessages = convertToTransformersMessages(opts.rawMessages, planContext || undefined);
  planMessages.push({
    role: "user",
    content: "Produce a concise numbered implementation plan for the task above. Be specific.",
  });
  const plan = await runPipeline(planPipe, planMessages, planMaxTokens, 0.4);
  log.info(`${planTier}: plan pass completed in ${Date.now() - planT0}ms`);

  // ── Step 2: Code pass — cortex (execution LLM) implements the plan ────────
  const codeSystemParts = [
    opts.contextSystemPrompt ?? "",
    ragContext,
    `[BuilderForceAgents implementation plan]\n${plan}`,
  ].filter(Boolean);

  const codeMessages = convertToTransformersMessages(
    opts.rawMessages,
    codeSystemParts.join("\n\n") || undefined,
  );

  log.info("cortex: starting code pass...");
  let codeResult = await callExecutionLlm({
    config: opts.config,
    messages: codeMessages,
    maxTokens,
    temperature,
    signal: opts.signal,
  });

  // ── Step 3: Code execution feedback ───────────────────────────────────────
  const wsDir = opts.workspaceDir;
  if (codeResult && wsDir) {
    const blocks = extractCodeBlocks(codeResult);
    if (blocks.length > 0) {
      const errorParts: ToolResult[] = [];
      for (const block of blocks.slice(0, 2)) {
        const result = await executeToolCall(
          { tool: "run_code", code: block.code, lang: block.lang },
          wsDir,
          { allowRunCode: opts.allowRunCode },
        );
        if (result.output.startsWith("Error:") || result.output.includes("SyntaxError")) {
          errorParts.push(result);
        }
      }
      if (errorParts.length > 0) {
        log.info(`cortex: code produced ${errorParts.length} error(s) — requesting fix pass`);
        const fixMessages: Array<{ role: string; content: string }> = [
          ...codeMessages,
          { role: "assistant", content: codeResult },
          {
            role: "user",
            content: `The code above produced errors:\n\n${formatToolResults(errorParts)}\n\nPlease fix it.`,
          },
        ];
        const fixed = await callExecutionLlm({
          config: opts.config,
          messages: fixMessages,
          maxTokens,
          temperature,
          signal: opts.signal,
        });
        if (fixed !== null) {
          codeResult = fixed;
        }
      }
    }
  }

  if (codeResult !== null) {
    log.info("multi-step chain complete — cortex produced final answer");
    return codeResult;
  }

  // Fallback: amygdala handles directly with memory context only.
  log.info("cortex returned null — amygdala handling directly as fallback");
  const directMessages = convertToTransformersMessages(
    opts.rawMessages,
    [memoryBlock, ragContext].filter(Boolean).join("\n\n") || undefined,
  );
  return runPipeline(amygdalaPipe, directMessages, maxTokens, temperature);
}

// ── Main StreamFn factory ─────────────────────────────────────────────────────

export type BuilderForceAgentsLlmLocalStreamOptions = {
  /** Full runtime config — used to find and call the cortex (execution LLM). */
  config?: BuilderForceAgentsConfig;
  /** Agent workspace dir (e.g. ~/.builderforce/workspace) — for memory + RAG. */
  workspaceDir?: string;
  /** Amygdala: HuggingFace model ID for the fast-routing brain. */
  modelId?: string;
  /** Amygdala: quantization dtype (q4, q5, q8, fp16, fp32). */
  dtype?: string;
  /** Hippocampus: HuggingFace model ID for memory/compression brain. */
  hippocampusModelId?: string;
  /** Hippocampus: quantization dtype. */
  hippocampusDtype?: string;
  /** Directory where the ONNX models are cached. */
  cacheDir?: string;
  /**
   * When true (Discord, Slack, group sessions), MEMORY.md is not loaded to
   * avoid leaking personal curated knowledge to third parties.
   */
  isSharedContext?: boolean;
  /**
   * Allow the amygdala to execute model-generated code via the `run_code` tool.
   *
   * **Security**: `run_code` spawns a Node.js child process inheriting the
   * same OS privileges as the BuilderForceAgents process.  It is limited to a 10-second
   * timeout and the workspace directory, but it is NOT containerised.
   *
   * Only set this to `true` when the user has explicitly chosen the
   * `builderforcellm-local` provider (i.e. they already opted into local inference
   * and understand that model-generated code will run on their machine).
   * Defaults to `false` — `run_code` calls are silently blocked.
   */
  allowRunCode?: boolean;
};

export type BuilderForceAgentsLlmLocalRunRequest = {
  config?: BuilderForceAgentsConfig;
  workspaceDir?: string;
  modelId: string;
  dtype: string;
  hippocampusModelId: string;
  hippocampusDtype: string;
  cacheDir: string;
  isSharedContext?: boolean;
  allowRunCode: boolean;
  contextSystemPrompt?: string;
  rawMessages: Array<{ role: string; content: unknown }>;
  maxTokens: number;
  temperature: number;
};

const localBrainEligibilityCache = new Map<
  string,
  { amygdalaEligible: boolean; hippocampusEligible: boolean }
>();

function getLocalBrainEligibilityKey(request: BuilderForceAgentsLlmLocalRunRequest): string {
  return [
    request.modelId,
    request.dtype,
    request.hippocampusModelId,
    request.hippocampusDtype,
    request.cacheDir,
  ].join("|");
}

function resolveAmygdalaRoutingTimeoutMs(): number {
  const raw = Number.parseInt(process.env.BUILDERFORCE_AGENTS_AMYGDALA_ROUTING_TIMEOUT_MS ?? "", 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return AMYGDALA_ROUTING_TIMEOUT_MS;
}

export function classifyLocalBrainRequest(params: {
  queryText: string;
  rawMessages: Array<{ role: string; content: unknown }>;
  ragContext: string;
  memoryBlock: string;
}): LocalBrainRoutingDecision {
  const reasons: string[] = [];
  const query = params.queryText.trim();
  const normalizedQuery = query.toLowerCase();

  if (query.length >= COMPLEX_QUERY_LENGTH) {
    reasons.push("long-user-prompt");
  }
  if (params.rawMessages.length >= COMPLEX_CONVERSATION_MESSAGES) {
    reasons.push("long-conversation");
  }
  if (params.ragContext.length >= COMPLEX_RAG_CONTEXT_LENGTH) {
    reasons.push("large-rag-context");
  }
  if (params.ragContext.length + params.memoryBlock.length >= COMPLEX_TOTAL_CONTEXT_LENGTH) {
    reasons.push("large-brain-context");
  }
  if (query.includes("\n\n") || query.includes("```")) {
    reasons.push("structured-multi-part-request");
  }
  if (COMPLEX_REQUEST_PATTERNS.some((pattern) => pattern.test(normalizedQuery))) {
    reasons.push("complex-intent");
  }

  return {
    mode: reasons.length > 0 ? "complex" : "simple",
    reasons,
  };
}

function getOrCreateLocalBrainWorker(): Worker {
  if (localBrainWorker) {
    return localBrainWorker;
  }
  const worker = new Worker(LOCAL_BRAIN_WORKER_URL);
  worker.on(
    "message",
    (message: { type?: string; id?: string; finalText?: string; error?: string }) => {
      const id = typeof message.id === "string" ? message.id : "";
      if (!id) {
        return;
      }
      const pending = localBrainWorkerPending.get(id);
      if (!pending) {
        return;
      }
      localBrainWorkerPending.delete(id);
      if (message.type === "result") {
        pending.resolve(message.finalText ?? "");
        return;
      }
      pending.reject(new Error(message.error || "Local brain worker failed"));
    },
  );
  worker.on("error", (error) => {
    for (const pending of localBrainWorkerPending.values()) {
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
    localBrainWorkerPending.clear();
    localBrainWorker = null;
  });
  worker.on("exit", (code) => {
    if (code !== 0) {
      for (const pending of localBrainWorkerPending.values()) {
        pending.reject(new Error(`Local brain worker exited with code ${code}`));
      }
      localBrainWorkerPending.clear();
    }
    localBrainWorker = null;
  });
  localBrainWorker = worker;
  return worker;
}

async function restartLocalBrainWorker(): Promise<void> {
  const worker = localBrainWorker;
  localBrainWorker = null;
  if (!worker) {
    return;
  }
  await worker.terminate().catch(() => undefined);
}

async function runBuilderForceAgentsLlmLocalRequestInWorker(
  request: BuilderForceAgentsLlmLocalRunRequest,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) {
    throw new Error("Request aborted");
  }

  const worker = getOrCreateLocalBrainWorker();
  const id = randomUUID();

  return await new Promise<string>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      settled = true;
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      if (settled) {
        return;
      }
      localBrainWorkerPending.delete(id);
      cleanup();
      reject(new Error("Request aborted"));
      void restartLocalBrainWorker();
    };

    localBrainWorkerPending.set(id, {
      resolve: (value) => {
        if (settled) {
          return;
        }
        cleanup();
        resolve(value);
      },
      reject: (error) => {
        if (settled) {
          return;
        }
        cleanup();
        reject(error);
      },
    });

    signal?.addEventListener("abort", onAbort, { once: true });

    try {
      worker.postMessage({ type: "run", id, request });
    } catch (error) {
      localBrainWorkerPending.delete(id);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function runDirectCortexRequest(params: {
  request: BuilderForceAgentsLlmLocalRunRequest;
  memoryBlock: string;
  ragContext: string;
  routingReason: string;
}): Promise<string> {
  log.info(`routing: using cortex directly (${params.routingReason})`);
  const externalSystemParts = [
    params.request.contextSystemPrompt,
    params.memoryBlock,
    params.ragContext,
    `[Routing note]\nAmygdala was bypassed/escalated: ${params.routingReason}. Use the configured cortex model to answer directly.`,
  ].filter(Boolean);

  const externalMessages = convertToTransformersMessages(
    params.request.rawMessages,
    externalSystemParts.join("\n\n---\n\n") || undefined,
  );

  const externalResult = await callExecutionLlm({
    config: params.request.config,
    messages: externalMessages,
    maxTokens: params.request.maxTokens,
    temperature: params.request.temperature,
  });

  return (
    externalResult ??
    "I'm unable to process this request: the local router was bypassed and no cortex (external LLM) returned a result."
  );
}

async function loadRoutingContext(request: BuilderForceAgentsLlmLocalRunRequest): Promise<{
  memoryBlock: string;
  ragContext: string;
  queryText: string;
}> {
  let memoryBlock = request.workspaceDir
    ? await loadBuilderForceAgentsMemory(request.workspaceDir, {
        isSharedContext: request.isSharedContext,
      })
    : "";
  if (memoryBlock) {
    log.info(`loaded .builderforce memory (${memoryBlock.length} chars)`);
  }

  // Inject Mamba state context line when a workforce agent is installed (v1 format — no WebGPU)
  if (request.workspaceDir) {
    const mambaState = await loadMambaState(request.workspaceDir);
    if (mambaState) {
      const contextLine = mambaStateToContextLine(mambaState);
      memoryBlock = memoryBlock ? `${contextLine}\n\n${memoryBlock}` : contextLine;
      log.debug(`injected mamba memory context: ${contextLine}`);
    }
  }

  const lastUserMsg = [...request.rawMessages].toReversed().find((m) => m.role === "user");
  const queryText =
    typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : ((lastUserMsg?.content as Array<{ text?: string }>)?.[0]?.text ?? "");

  const ragContext =
    request.workspaceDir && queryText
      ? await retrieveRelevantContext({ query: queryText, workspaceDir: request.workspaceDir })
      : "";
  if (ragContext) {
    log.info(`RAG context retrieved (${ragContext.length} chars)`);
  }

  return { memoryBlock, ragContext, queryText };
}

export async function runBuilderForceAgentsLlmLocalRequest(
  request: BuilderForceAgentsLlmLocalRunRequest,
): Promise<string> {
  const eligibilityKey = getLocalBrainEligibilityKey(request);
  let eligibility = localBrainEligibilityCache.get(eligibilityKey);
  if (!eligibility) {
    const check = await checkLocalBrainRequirements({
      cacheDir: request.cacheDir,
      modelId: request.modelId,
      hippocampusModelId: request.hippocampusModelId,
    });
    eligibility = {
      amygdalaEligible: check.eligible,
      hippocampusEligible: check.hippocampusEligible,
    };
    localBrainEligibilityCache.set(eligibilityKey, eligibility);
    if (!check.eligible) {
      log.info(`amygdala: ${check.reason ?? "system requirements not met"}`);
    }
    if (!check.hippocampusEligible) {
      log.info("hippocampus: insufficient RAM — plan pass will use amygdala");
    }
  }

  const { memoryBlock, ragContext, queryText } = await loadRoutingContext(request);

  const routingDecision = classifyLocalBrainRequest({
    queryText,
    rawMessages: request.rawMessages,
    ragContext,
    memoryBlock,
  });
  log.info(
    `routing: request classified as ${routingDecision.mode}${routingDecision.reasons.length > 0 ? ` (${routingDecision.reasons.join(", ")})` : ""}`,
  );

  if (!eligibility.amygdalaEligible) {
    log.info("amygdala not eligible → cortex handling entire request");
    return await runDirectCortexRequest({
      request,
      memoryBlock,
      ragContext,
      routingReason: "amygdala not eligible",
    });
  }

  const amygdalaSystem = [
    request.contextSystemPrompt,
    memoryBlock,
    ragContext,
    AMYGDALA_SYSTEM_PROMPT,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

  const amygdalaPipe = await getOrCreatePipeline(request.modelId, request.dtype, request.cacheDir);

  /* oxlint-disable-next-line typescript-eslint/no-redundant-type-constituents -- pipeline type from upstream */
  let hippocampusPipe: Awaited<ReturnType<typeof getOrCreatePipeline>> | null = null;
  if (eligibility.hippocampusEligible) {
    try {
      hippocampusPipe = await getOrCreatePipeline(
        request.hippocampusModelId,
        request.hippocampusDtype,
        request.cacheDir,
      );
    } catch {
      log.info("hippocampus: failed to load pipeline — plan pass will use amygdala");
      eligibility.hippocampusEligible = false;
    }
  }

  if (routingDecision.mode === "complex") {
    log.info(
      `routing: bypassing amygdala handle path → hippocampus/cortex (${routingDecision.reasons.join(", ")})`,
    );
    const finalText = await runMultiStepChain({
      amygdalaPipe,
      hippocampusPipe,
      config: request.config,
      rawMessages: request.rawMessages,
      contextSystemPrompt: request.contextSystemPrompt,
      brainPlan: queryText,
      memoryBlock,
      ragContext,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      workspaceDir: request.workspaceDir,
      allowRunCode: request.allowRunCode,
    });
    log.info(`response ready (${finalText.length} chars, routing=complex-bypass)`);
    return finalText;
  }

  log.info("amygdala: starting reasoning pass...");
  const amygdalaT0 = Date.now();
  let amygdalaMessages = convertToTransformersMessages(request.rawMessages, amygdalaSystem);
  let amygdalaText = await runPipeline(amygdalaPipe, amygdalaMessages, 256, 0.4);
  log.info(`amygdala: reasoning pass completed in ${Date.now() - amygdalaT0}ms`);

  let toolRounds = 0;
  while (toolRounds < MAX_TOOL_ROUNDS && request.workspaceDir) {
    const calls = parseToolCalls(amygdalaText);
    if (calls.length === 0) {
      break;
    }

    toolRounds++;
    log.info(
      `amygdala: tool round ${toolRounds}/${MAX_TOOL_ROUNDS} — ${calls.length} call(s): ${calls.map((c) => c.tool).join(", ")}`,
    );
    const results: ToolResult[] = [];
    for (const call of calls) {
      results.push(
        await executeToolCall(call, request.workspaceDir, {
          allowRunCode: request.allowRunCode,
        }),
      );
    }
    amygdalaMessages = [
      ...amygdalaMessages,
      { role: "assistant", content: amygdalaText },
      { role: "user", content: `Tool results:\n\n${formatToolResults(results)}` },
    ];
    amygdalaText = await runPipeline(amygdalaPipe, amygdalaMessages, 256, 0.4);
  }

  const isDelegating = amygdalaText.toUpperCase().trimStart().startsWith("DELEGATE");
  const brainPlan = amygdalaText.replace(/^DELEGATE[:\s]*/i, "").trim();

  log.info(
    `routing: amygdala decision=${isDelegating ? "DELEGATE → hippocampus/cortex" : "HANDLE (responding directly)"}`,
  );

  if (isDelegating) {
    log.info(
      `routing: entering multi-step chain hippocampus=${hippocampusPipe ? "loaded" : "unavailable (amygdala fallback)"} cortex=configured`,
    );
  }

  const finalText = isDelegating
    ? await runMultiStepChain({
        amygdalaPipe,
        hippocampusPipe,
        config: request.config,
        rawMessages: request.rawMessages,
        contextSystemPrompt: request.contextSystemPrompt,
        brainPlan,
        memoryBlock,
        ragContext,
        maxTokens: request.maxTokens,
        temperature: request.temperature,
        workspaceDir: request.workspaceDir,
        allowRunCode: request.allowRunCode,
      })
    : amygdalaText;
  log.info(`response ready (${finalText.length} chars, total=${Date.now() - amygdalaT0}ms)`);
  return finalText;
}

export function createBuilderForceAgentsLlmLocalStreamFn(
  opts: BuilderForceAgentsLlmLocalStreamOptions = {},
): StreamFn {
  const modelId = opts.modelId ?? AMYGDALA_DEFAULT_MODEL_ID;
  const dtype = opts.dtype ?? AMYGDALA_DEFAULT_DTYPE;
  const hippocampusModelId = opts.hippocampusModelId ?? HIPPOCAMPUS_DEFAULT_MODEL_ID;
  const hippocampusDtype = opts.hippocampusDtype ?? HIPPOCAMPUS_DEFAULT_DTYPE;
  const cacheDir = opts.cacheDir ?? TRANSFORMERS_DEFAULT_CACHE_DIR;

  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();

    const run = async () => {
      try {
        const maxTokens = typeof options?.maxTokens === "number" ? options.maxTokens : 512;
        const temperature = typeof options?.temperature === "number" ? options.temperature : 0.6;
        const request: BuilderForceAgentsLlmLocalRunRequest = {
          config: opts.config,
          workspaceDir: opts.workspaceDir,
          modelId,
          dtype,
          hippocampusModelId,
          hippocampusDtype,
          cacheDir,
          isSharedContext: opts.isSharedContext,
          allowRunCode: opts.allowRunCode ?? false,
          contextSystemPrompt: context.systemPrompt,
          rawMessages: context.messages ?? [],
          maxTokens,
          temperature,
        };
        const timeoutMs = resolveAmygdalaRoutingTimeoutMs();
        const timeoutController = new AbortController();
        let timedOut = false;
        const timeoutHandle = setTimeout(() => {
          timedOut = true;
          timeoutController.abort();
        }, timeoutMs);
        const abortListener = () => timeoutController.abort();
        options?.signal?.addEventListener("abort", abortListener, { once: true });

        let finalText: string;
        try {
          finalText = await runBuilderForceAgentsLlmLocalRequestInWorker(request, timeoutController.signal);
        } catch (err) {
          if (!timedOut) {
            throw err;
          }
          log.warn(`amygdala: routing exceeded ${timeoutMs}ms — escalating to cortex`);
          const { memoryBlock, ragContext } = await loadRoutingContext(request);
          finalText = await runDirectCortexRequest({
            request,
            memoryBlock,
            ragContext,
            routingReason: `amygdala timeout after ${timeoutMs}ms`,
          });
        } finally {
          clearTimeout(timeoutHandle);
          options?.signal?.removeEventListener("abort", abortListener);
        }

        const content: TextContent[] = finalText
          ? [{ type: "text" as const, text: finalText }]
          : [];

        const usage: Usage = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        };

        stream.push({
          type: "done",
          reason: "stop",
          message: {
            role: "assistant",
            content,
            stopReason: "stop" as StopReason,
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage,
            timestamp: Date.now(),
          } satisfies AssistantMessage,
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
