import { upsertAuthProfileWithLock } from "../agents/auth-profiles.js";
import { resolveOllamaApiBase } from "../agents/models-config.providers.js";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { upsertSharedEnvVar } from "../infra/env-file.js";
import { normalizeBaseUrl as stripTrailingSlashes } from "../utils/normalize-base-url.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyPrimaryModel } from "./model-picker.js";

const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";
const OLLAMA_ENABLE_KEY = "ollama-local";
const VLLM_DEFAULT_BASE_URL = "http://127.0.0.1:8000/v1";
const VLLM_DEFAULT_API_KEY = "local";
const DISCOVERY_TIMEOUT_MS = 5000;
const MANUAL_MODEL_VALUE = "__manual";

type LocalBackend = "ollama" | "vllm";

type DiscoveredModel = {
  id: string;
  hint?: string;
};

type OllamaTagsResponse = {
  models?: Array<{
    name?: string;
    details?: {
      family?: string;
      parameter_size?: string;
    };
  }>;
};

type OpenAiModelsResponse = {
  data?: Array<{
    id?: string;
    owned_by?: string;
  }>;
};

function normalizeBaseUrl(value: string): string {
  return stripTrailingSlashes(value.trim());
}

function toModelKey(provider: string, modelId: string): string {
  return `${provider}/${modelId}`;
}

function parseOllamaFamilyHint(family?: string, parameterSize?: string): string | undefined {
  const parts = [family?.trim(), parameterSize?.trim()].filter(Boolean) as string[];
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(" · ");
}

async function discoverOllamaModels(baseUrl: string): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch(`${resolveOllamaApiBase(baseUrl)}/api/tags`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as OllamaTagsResponse;
    const dedupe = new Set<string>();
    const models: DiscoveredModel[] = [];
    for (const item of data.models ?? []) {
      const id = typeof item.name === "string" ? item.name.trim() : "";
      if (!id || dedupe.has(id)) {
        continue;
      }
      dedupe.add(id);
      models.push({
        id,
        hint: parseOllamaFamilyHint(item.details?.family, item.details?.parameter_size),
      });
    }
    return models;
  } catch {
    return [];
  }
}

async function discoverOpenAiCompatibleModels(
  baseUrl: string,
  apiKey?: string,
): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return [];
    }
    const data = (await response.json()) as OpenAiModelsResponse;
    const dedupe = new Set<string>();
    const models: DiscoveredModel[] = [];
    for (const item of data.data ?? []) {
      const id = typeof item.id === "string" ? item.id.trim() : "";
      if (!id || dedupe.has(id)) {
        continue;
      }
      dedupe.add(id);
      const ownedBy = typeof item.owned_by === "string" ? item.owned_by.trim() : "";
      models.push({
        id,
        hint: ownedBy || undefined,
      });
    }
    return models;
  } catch {
    return [];
  }
}

async function promptModelSelection(params: {
  models: DiscoveredModel[];
  defaultModel: string;
  message: string;
  placeholder: string;
  prompter: ApplyAuthChoiceParams["prompter"];
}): Promise<string> {
  if (params.models.length === 0) {
    const manual = await params.prompter.text({
      message: params.message,
      initialValue: params.defaultModel,
      placeholder: params.placeholder,
      validate: (value) => (value?.trim() ? undefined : "Required"),
    });
    return String(manual ?? "").trim();
  }

  const manualOptionLabel = "Enter model manually";
  const selected = await params.prompter.select({
    message: params.message,
    options: [
      ...params.models.map((model) => ({
        value: model.id,
        label: model.id,
        hint: model.hint,
      })),
      { value: MANUAL_MODEL_VALUE, label: manualOptionLabel },
    ],
    initialValue: params.models[0]?.id,
  });

  if (selected !== MANUAL_MODEL_VALUE) {
    return String(selected).trim();
  }

  const manual = await params.prompter.text({
    message: params.message,
    initialValue: params.defaultModel,
    placeholder: params.placeholder,
    validate: (value) => (value?.trim() ? undefined : "Required"),
  });
  return String(manual ?? "").trim();
}

function applyOllamaProviderConfig(cfg: BuilderForceAgentsConfig, baseUrl: string, modelId: string) {
  const normalizedBaseUrl = resolveOllamaApiBase(baseUrl);
  const next: BuilderForceAgentsConfig = {
    ...cfg,
    models: {
      ...cfg.models,
      mode: cfg.models?.mode ?? "merge",
      providers: {
        ...cfg.models?.providers,
        ollama: {
          baseUrl: normalizedBaseUrl,
          api: "ollama",
          apiKey: "OLLAMA_API_KEY",
          models: [
            {
              id: modelId,
              name: modelId,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
  };

  return applyPrimaryModel(next, toModelKey("ollama", modelId));
}

async function applyLocalOllamaSetup(params: ApplyAuthChoiceParams): Promise<BuilderForceAgentsConfig> {
  const baseUrlInput = await params.prompter.text({
    message: "Ollama base URL",
    initialValue: OLLAMA_DEFAULT_BASE_URL,
    placeholder: OLLAMA_DEFAULT_BASE_URL,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) {
        return "Required";
      }
      try {
        new URL(raw);
        return undefined;
      } catch {
        return "Please enter a valid URL";
      }
    },
  });
  const baseUrl = normalizeBaseUrl(String(baseUrlInput ?? ""));

  const discovery = params.prompter.progress("Discovering Ollama models...");
  const discoveredModels = await discoverOllamaModels(baseUrl);
  discovery.stop(
    discoveredModels.length > 0
      ? `Found ${discoveredModels.length} model${discoveredModels.length === 1 ? "" : "s"}.`
      : "No models discovered (you can enter one manually).",
  );

  const modelId = await promptModelSelection({
    models: discoveredModels,
    defaultModel: "llama3.3",
    message: "Default Ollama model",
    placeholder: "llama3.3 or qwen2.5-coder:32b",
    prompter: params.prompter,
  });

  upsertSharedEnvVar({ key: "OLLAMA_API_KEY", value: OLLAMA_ENABLE_KEY });
  process.env.OLLAMA_API_KEY = OLLAMA_ENABLE_KEY;

  const nextConfig = applyOllamaProviderConfig(params.config, baseUrl, modelId);
  await params.prompter.note(
    `Configured Ollama at ${resolveOllamaApiBase(baseUrl)} with default model ${toModelKey("ollama", modelId)}.`,
    "Local setup",
  );
  return nextConfig;
}

function applyVllmProviderConfig(
  cfg: BuilderForceAgentsConfig,
  baseUrl: string,
  apiKey: string,
  modelId: string,
) {
  const next: BuilderForceAgentsConfig = {
    ...cfg,
    models: {
      ...cfg.models,
      mode: cfg.models?.mode ?? "merge",
      providers: {
        ...cfg.models?.providers,
        vllm: {
          baseUrl: normalizeBaseUrl(baseUrl),
          api: "openai-completions",
          apiKey: "VLLM_API_KEY",
          models: [
            {
              id: modelId,
              name: modelId,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
  };

  process.env.VLLM_API_KEY = apiKey;
  return applyPrimaryModel(next, toModelKey("vllm", modelId));
}

async function applyLocalVllmSetup(params: ApplyAuthChoiceParams): Promise<BuilderForceAgentsConfig> {
  await params.prompter.note(
    "For llama.cpp, run an OpenAI-compatible server (e.g. llama-server) and use its /v1 URL here.",
    "llama.cpp",
  );

  const baseUrlInput = await params.prompter.text({
    message: "Local server base URL",
    initialValue: VLLM_DEFAULT_BASE_URL,
    placeholder: VLLM_DEFAULT_BASE_URL,
    validate: (value) => {
      const raw = String(value ?? "").trim();
      if (!raw) {
        return "Required";
      }
      try {
        new URL(raw);
        return undefined;
      } catch {
        return "Please enter a valid URL";
      }
    },
  });
  const baseUrl = normalizeBaseUrl(String(baseUrlInput ?? ""));

  const apiKeyInput = await params.prompter.text({
    message: "API key (blank uses 'local')",
    initialValue: VLLM_DEFAULT_API_KEY,
    placeholder: VLLM_DEFAULT_API_KEY,
  });
  const apiKey = String(apiKeyInput ?? "").trim() || VLLM_DEFAULT_API_KEY;

  const discovery = params.prompter.progress("Discovering models from /models...");
  const discoveredModels = await discoverOpenAiCompatibleModels(baseUrl, apiKey);
  discovery.stop(
    discoveredModels.length > 0
      ? `Found ${discoveredModels.length} model${discoveredModels.length === 1 ? "" : "s"}.`
      : "No models discovered (you can enter one manually).",
  );

  const modelId = await promptModelSelection({
    models: discoveredModels,
    defaultModel: "local-model",
    message: "Default model ID",
    placeholder: "meta-llama/Llama-3.1-8B-Instruct",
    prompter: params.prompter,
  });

  await upsertAuthProfileWithLock({
    profileId: "vllm:default",
    credential: { type: "api_key", provider: "vllm", key: apiKey },
    agentDir: params.agentDir,
  });

  const nextConfig = applyVllmProviderConfig(params.config, baseUrl, apiKey, modelId);
  await params.prompter.note(
    `Configured local OpenAI-compatible endpoint at ${baseUrl} with default model ${toModelKey("vllm", modelId)}.`,
    "Local setup",
  );
  return nextConfig;
}

async function promptLocalBackend(
  prompter: ApplyAuthChoiceParams["prompter"],
): Promise<LocalBackend> {
  return await prompter.select<LocalBackend>({
    message: "Local backend",
    options: [
      {
        value: "ollama",
        label: "Ollama (simplest)",
        hint: "Uses native Ollama API and discovers installed models",
      },
      {
        value: "vllm",
        label: "llama.cpp / vLLM / LiteLLM",
        hint: "Uses OpenAI-compatible /v1 endpoint",
      },
    ],
    initialValue: "ollama",
  });
}

export async function applyAuthChoiceLocal(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "local") {
    return null;
  }

  await params.prompter.note(
    [
      "Local model/cache paths are installation-specific and are not hardcoded.",
      "This setup discovers models from your running local backend.",
      "Optional path overrides can be configured later (e.g. OLLAMA_MODELS, memorySearch.local.*).",
    ].join("\n"),
    "Local setup",
  );

  const backend = await promptLocalBackend(params.prompter);
  const nextConfig =
    backend === "ollama" ? await applyLocalOllamaSetup(params) : await applyLocalVllmSetup(params);

  return { config: nextConfig };
}
