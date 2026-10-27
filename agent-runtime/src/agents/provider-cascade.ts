/**
 * The non-streaming provider cascade — one completion through the CONFIGURED providers
 * (primary first, then fallbacks, then the rest), each over its own wire (Ollama native,
 * OpenAI Chat Completions, OpenAI Responses). A provider that fails or answers nothing
 * hands over to the next; the whole cascade answering nothing is `null`.
 *
 * Callers: the local brain's cortex (`builderforcellm-local-stream.ts`, which puts a
 * semantic cache in front) and `local_research` (`local-research/`), which narrows
 * the cascade to the providers served on THIS machine with `only`.
 */

import type { BuilderForceAgentsConfig } from "../config/config.js";
import { isLoopbackUrl } from "../gateway/net.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { normalizeBaseUrl } from "../utils/normalize-base-url.js";

const log = createSubsystemLogger("brain");

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

/**
 * The bearer an OpenAI-wire target is called with: its configured key, or — for a server
 * on THIS machine (loopback `baseUrl` only) — none, since llama.cpp / vLLM / LM Studio run
 * keyless by default. `null` = not callable (a remote OpenAI-wire provider with no key).
 * Ollama's native wire never takes a key. The ONE rule {@link cascadeTargets} filters by
 * and {@link runProviderCascade} calls with, so a caller that probes the targets
 * (`local_research`) never advertises one the cascade would skip.
 */
function openAiBearer(cfg: { apiKey?: unknown; baseUrl?: string }): string | null {
  const key = resolveApiKey(typeof cfg.apiKey === "string" ? cfg.apiKey : "");
  if (key) {
    return key;
  }
  return isLoopbackUrl(cfg.baseUrl) ? "" : null;
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

/** JSON headers, with a bearer only when there is a key (a keyless loopback server). */
function jsonHeaders(apiKey: string): Record<string, string> {
  return apiKey ? { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` } : { "Content-Type": "application/json" };
}

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
      headers: jsonHeaders(opts.apiKey),
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
      headers: jsonHeaders(opts.apiKey),
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

export interface ProviderCascadeOptions {
  config: BuilderForceAgentsConfig | undefined;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  signal?: AbortSignal;
  /** Narrow the cascade (e.g. to providers on this machine). Absent = every provider. */
  only?: (providerId: string, cfg: ProviderCascadeConfig) => boolean;
}

/** One configured provider as the cascade reads it. */
export type ProviderCascadeConfig = NonNullable<NonNullable<BuilderForceAgentsConfig["models"]>["providers"]>[string];

/** The wire apis the cascade can call; a provider on any other api is passed over. */
export const CASCADE_APIS: ReadonlySet<string> = new Set(["ollama", "openai-completions", "openai-responses"]);

/** One provider the cascade will try, with the model it will ask. */
export interface CascadeTarget {
  id: string;
  cfg: ProviderCascadeConfig & { baseUrl: string };
  modelId: string;
}

/**
 * The providers the cascade tries, in order: the default model's provider, then the
 * fallbacks', then every other configured provider — each with a base URL and a model,
 * narrowed by `only`. An OpenAI-wire provider the cascade could not authenticate
 * ({@link openAiBearer} null: remote and keyless) is not a target. Shared with callers that must know the targets before calling
 * (`local_research` probes them to decide whether to advertise the tool).
 */
export function cascadeTargets(
  config: BuilderForceAgentsConfig | undefined,
  only?: ProviderCascadeOptions["only"],
): CascadeTarget[] {
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

  const targets: CascadeTarget[] = [];
  for (const [id, cfg] of orderedEntries) {
    if (!cfg?.baseUrl || (only && !only(id, cfg))) {
      continue;
    }
    if ((cfg.api === "openai-completions" || cfg.api === "openai-responses") && openAiBearer(cfg) === null) {
      continue;
    }
    const parsed = parseModelKey(preferredKeys.find((k) => k.startsWith(`${id}/`)) ?? "");
    const modelId = parsed?.provider === id ? parsed.modelId : cfg.models?.[0]?.id;
    if (modelId) {
      targets.push({ id, cfg: cfg as CascadeTarget["cfg"], modelId });
    }
  }
  return targets;
}

export async function runProviderCascade(opts: ProviderCascadeOptions): Promise<string | null> {
  const { config, messages, maxTokens, temperature, signal } = opts;
  for (const { id, cfg, modelId } of cascadeTargets(config, opts.only)) {
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
      const apiKey = openAiBearer(cfg);
      if (apiKey === null) {
        continue;
      }
      const r = await callOpenAiCompletions({ baseUrl: cfg.baseUrl, apiKey, ...callArgs });
      if (r !== null) {
        log.info(`cortex: completed in ${Date.now() - t0}ms (${r.length} chars)`);
        return r;
      }
    } else if (cfg.api === "openai-responses") {
      const apiKey = openAiBearer(cfg);
      if (apiKey === null) {
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
