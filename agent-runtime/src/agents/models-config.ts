import fs from "node:fs/promises";
import path from "node:path";
import { type BuilderForceAgentsConfig, loadConfig } from "../config/config.js";
import { isRecord } from "../utils.js";
import { resolveBuilderForceAgentsAgentDir } from "./agent-paths.js";
import {
  discoverOllamaModels,
  normalizeProviders,
  type ProviderConfig,
  resolveImplicitBedrockProvider,
  resolveImplicitCopilotProvider,
  resolveImplicitProviders,
} from "./models-config.providers.js";

type ModelsConfig = NonNullable<BuilderForceAgentsConfig["models"]>;

const DEFAULT_MODE: NonNullable<ModelsConfig["mode"]> = "merge";

function mergeProviderModels(implicit: ProviderConfig, explicit: ProviderConfig): ProviderConfig {
  const implicitModels = Array.isArray(implicit.models) ? implicit.models : [];
  const explicitModels = Array.isArray(explicit.models) ? explicit.models : [];
  if (implicitModels.length === 0) {
    return { ...implicit, ...explicit };
  }

  const getId = (model: unknown): string => {
    if (!model || typeof model !== "object") {
      return "";
    }
    const id = (model as { id?: unknown }).id;
    return typeof id === "string" ? id.trim() : "";
  };
  const seen = new Set(explicitModels.map(getId).filter(Boolean));

  const mergedModels = [
    ...explicitModels,
    ...implicitModels.filter((model) => {
      const id = getId(model);
      if (!id) {
        return false;
      }
      if (seen.has(id)) {
        return false;
      }
      seen.add(id);
      return true;
    }),
  ];

  return {
    ...implicit,
    ...explicit,
    models: mergedModels,
  };
}

function mergeProviders(params: {
  implicit?: Record<string, ProviderConfig> | null;
  explicit?: Record<string, ProviderConfig> | null;
}): Record<string, ProviderConfig> {
  const out: Record<string, ProviderConfig> = params.implicit ? { ...params.implicit } : {};
  for (const [key, explicit] of Object.entries(params.explicit ?? {})) {
    const providerKey = key.trim();
    if (!providerKey) {
      continue;
    }
    const implicit = out[providerKey];
    out[providerKey] = implicit ? mergeProviderModels(implicit, explicit) : explicit;
  }
  return out;
}

async function readJson(pathname: string): Promise<unknown> {
  try {
    const raw = await fs.readFile(pathname, "utf8");
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export async function ensureBuilderForceAgentsModelsJson(
  config?: BuilderForceAgentsConfig,
  agentDirOverride?: string,
): Promise<{ agentDir: string; wrote: boolean }> {
  const cfg = config ?? loadConfig();
  const agentDir = agentDirOverride?.trim() ? agentDirOverride.trim() : resolveBuilderForceAgentsAgentDir();

  const explicitProviders = cfg.models?.providers ?? {};
  const implicitProviders = await resolveImplicitProviders({ agentDir, explicitProviders });
  let mergedProviders: Record<string, ProviderConfig> = mergeProviders({
    implicit: implicitProviders,
    explicit: explicitProviders,
  });
  const implicitBedrock = await resolveImplicitBedrockProvider({ agentDir, config: cfg });
  if (implicitBedrock) {
    const existing = mergedProviders["amazon-bedrock"];
    mergedProviders["amazon-bedrock"] = existing
      ? mergeProviderModels(implicitBedrock, existing)
      : implicitBedrock;
  }
  const implicitCopilot = await resolveImplicitCopilotProvider({ agentDir });
  if (implicitCopilot && !mergedProviders["github-copilot"]) {
    mergedProviders["github-copilot"] = implicitCopilot;
  }

  if (Object.keys(mergedProviders).length === 0) {
    return { agentDir, wrote: false };
  }

  // Remove the problematic model ('googleai/gemini-2.5-flash-lite' or its normalized form)
  // from the merged providers before normalization.
  const filteredProviders: Record<string, ProviderConfig> = {};
  for (const [key, provider] of Object.entries(mergedProviders)) {
    if (provider.models) {
      provider.models = provider.models.filter(
        (model) =>
          !(
            model.id === "googleai/gemini-2.5-flash-lite" || // Exact match
            model.id.toLowerCase() === "gemini-2.5-flash-lite" || // Normalized common ID
            model.id.toLowerCase() === "google/gemini-2.5-flash-lite" // Normalized with provider
          )
      );
    }
    filteredProviders[key] = provider;
  }
  mergedProviders = filteredProviders;

  const mode = cfg.models?.mode ?? DEFAULT_MODE;
  const targetPath = path.join(agentDir, "models.json");

  let finalProviders = mergedProviders;
  let existingRaw = "";
  if (mode === "merge") {
    const existing = await readJson(targetPath);
    if (isRecord(existing) && isRecord(existing.providers)) {
      const existingProviders = existing.providers as Record<
        string,
        NonNullable<ModelsConfig["providers"]>[string]
      >;
      finalProviders = { ...existingProviders, ...mergedProviders };
    }
  }

  const normalizedProviders = normalizeProviders({
    providers: finalProviders,
    agentDir,
  });
  const next = `${JSON.stringify({ providers: normalizedProviders }, null, 2)}\n`;
  try {
    existingRaw = await fs.readFile(targetPath, "utf8");
  } catch {
    existingRaw = "";
  }

  if (existingRaw === next) {
    return { agentDir, wrote: false };
  }

  await fs.mkdir(agentDir, { recursive: true, mode: 0o700 });
  await fs.writeFile(targetPath, next, { mode: 0o600 });

  // Background Ollama discovery: if ollama has empty models, discover and patch
  // models.json when done so TUI startup is not blocked.
  const ollamaProvider = mergedProviders?.ollama; // Use original mergedProviders for discovery
  if (
    ollamaProvider &&
    Array.isArray(ollamaProvider.models) &&
    ollamaProvider.models.length === 0
  ) {
    const baseUrl = ollamaProvider.baseUrl;
    const runBackgroundDiscovery = async () => {
      try {
        const models = await discoverOllamaModels(baseUrl);
        if (models.length === 0) {
          return;
        }
        const existing = await readJson(targetPath);
        if (!isRecord(existing) || !isRecord(existing.providers)) {
          return;
        }
        const providers = existing.providers as Record<string, ProviderConfig>;
        const ollama = providers.ollama;
        if (!ollama) {
          return;
        }
        // Filter problematic models from discovery results as well
        const filteredModels = models.filter(
          (model) =>
            !(
              model.id === "googleai/gemini-2.5-flash-lite" || // Exact match
              model.id.toLowerCase() === "gemini-2.5-flash-lite" || // Normalized common ID
              model.id.toLowerCase() === "google/gemini-2.5-flash-lite" // Normalized with provider
            )
        );
        providers.ollama = { ...ollama, models: filteredModels };
        const normalized = normalizeProviders({ providers, agentDir });
        await fs.writeFile(targetPath, `${JSON.stringify({ providers: normalized }, null, 2)}\n`, {
          mode: 0o600,
        });
        const { invalidateModelCatalogCache } = await import("./model-catalog.js");
        invalidateModelCatalogCache();
      } catch {
        // ignore; discovery failures are already logged in discoverOllamaModels
      }
    };
    void runBackgroundDiscovery();
  }

  return { agentDir, wrote: true };
}
