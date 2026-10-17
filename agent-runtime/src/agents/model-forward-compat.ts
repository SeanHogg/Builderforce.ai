import {
  ANTHROPIC_RELEASES,
  anthropicModelId,
  olderAnthropicTemplateIds,
} from "@builderforce/model-catalog";
import type { Api, Model } from "../builderforce/model/types.js";
import { DEFAULT_CONTEXT_TOKENS } from "./defaults.js";
import { normalizeModelCompat } from "./model-compat.js";
import { normalizeProviderId } from "./model-selection.js";
import type { ModelRegistry } from "./model-discovery.js";

const OPENAI_CODEX_GPT_53_MODEL_ID = "gpt-5.3-codex";
const OPENAI_CODEX_TEMPLATE_MODEL_IDS = ["gpt-5.2-codex"] as const;

const ZAI_GLM5_MODEL_ID = "glm-5";
const ZAI_GLM5_TEMPLATE_MODEL_IDS = ["glm-4.7"] as const;

function cloneFirstTemplateModel(params: {
  normalizedProvider: string;
  trimmedModelId: string;
  templateIds: string[];
  modelRegistry: ModelRegistry;
  patch?: Partial<Model<Api>>;
}): Model<Api> | undefined {
  const { normalizedProvider, trimmedModelId, templateIds, modelRegistry } = params;
  for (const templateId of [...new Set(templateIds)].filter(Boolean)) {
    const template = modelRegistry.find(normalizedProvider, templateId) as Model<Api> | null;
    if (!template) {
      continue;
    }
    return normalizeModelCompat({
      ...template,
      id: trimmedModelId,
      name: trimmedModelId,
      ...params.patch,
    } as Model<Api>);
  }
  return undefined;
}

function resolveOpenAICodexGpt53FallbackModel(
  provider: string,
  modelId: string,
  modelRegistry: ModelRegistry,
): Model<Api> | undefined {
  const normalizedProvider = normalizeProviderId(provider);
  const trimmedModelId = modelId.trim();
  if (normalizedProvider !== "openai-codex") {
    return undefined;
  }
  if (trimmedModelId.toLowerCase() !== OPENAI_CODEX_GPT_53_MODEL_ID) {
    return undefined;
  }

  for (const templateId of OPENAI_CODEX_TEMPLATE_MODEL_IDS) {
    const template = modelRegistry.find(normalizedProvider, templateId) as Model<Api> | null;
    if (!template) {
      continue;
    }
    return normalizeModelCompat({
      ...template,
      id: trimmedModelId,
      name: trimmedModelId,
    } as Model<Api>);
  }

  return normalizeModelCompat({
    id: trimmedModelId,
    name: trimmedModelId,
    api: "openai-codex-responses",
    provider: normalizedProvider,
    baseUrl: "https://chatgpt.com/backend-api",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_TOKENS,
    maxTokens: DEFAULT_CONTEXT_TOKENS,
  } as Model<Api>);
}

/**
 * Providers that serve Claude under Anthropic's own ids. A Claude release this host has
 * no `models.json` row for yet borrows its metadata from the newest OLDER release of the
 * same family that it does have (`olderAnthropicTemplateIds` — derived from the one
 * release list in `@builderforce/model-catalog`), keeping the requested spelling and suffix
 * (`-thinking`, a date). So every new flagship works the day it ships, without a
 * per-release table here.
 */
const CLAUDE_FORWARD_COMPAT_PROVIDERS: ReadonlySet<string> = new Set(["anthropic", "google-antigravity"]);

function resolveClaudeForwardCompatModel(
  provider: string,
  modelId: string,
  modelRegistry: ModelRegistry,
): Model<Api> | undefined {
  const normalizedProvider = normalizeProviderId(provider);
  if (!CLAUDE_FORWARD_COMPAT_PROVIDERS.has(normalizedProvider)) {
    return undefined;
  }
  const templateIds = olderAnthropicTemplateIds(modelId);
  if (templateIds.length === 0) {
    return undefined;
  }
  return cloneFirstTemplateModel({
    normalizedProvider,
    trimmedModelId: modelId.trim(),
    templateIds,
    modelRegistry,
  });
}

/** A Claude id `models list` synthesizes for a provider whose catalog lags, with the
 *  template keys whose availability it inherits. */
export interface ClaudeForwardCompatCandidate {
  id: string;
  templateKeys: readonly string[];
}

const ANTIGRAVITY_PROVIDER = "google-antigravity";
/** Antigravity serves Opus from 4.6 on, plain and `-thinking`, ahead of its catalog. */
const ANTIGRAVITY_SYNTHESIZED_SINCE: readonly [number, number] = [4, 6];
const ANTIGRAVITY_SUFFIXES = ["-thinking", ""] as const;

/**
 * The Opus ids `models list` synthesizes for Google Antigravity — every Opus release from
 * 4.6 on (the one release list, `@builderforce/model-catalog`), plain and `-thinking` — each with
 * the older same-suffix template keys {@link resolveClaudeForwardCompatModel} would clone.
 * Derived, so a new Opus is listed the day it is added there. Pure.
 */
export function antigravityForwardCompatCandidates(): ClaudeForwardCompatCandidate[] {
  const [sinceMajor, sinceMinor] = ANTIGRAVITY_SYNTHESIZED_SINCE;
  const releases = ANTHROPIC_RELEASES.opus.filter((v) => {
    const [major, minor] = v.split(".").map(Number);
    return major > sinceMajor || (major === sinceMajor && (minor ?? 0) >= sinceMinor);
  });
  return releases.flatMap((version) =>
    ANTIGRAVITY_SUFFIXES.map((suffix) => {
      const id = `${anthropicModelId("opus", version)}${suffix}`;
      const templates = olderAnthropicTemplateIds(id).filter((t) => (suffix ? t.endsWith(suffix) : true));
      return { id, templateKeys: templates.map((t) => `${ANTIGRAVITY_PROVIDER}/${t}`) };
    }),
  );
}

// Z.ai's GLM-5 may not be present in pi-ai's built-in model catalog yet.
// When a user configures zai/glm-5 without a models.json entry, clone glm-4.7 as a forward-compat fallback.
function resolveZaiGlm5ForwardCompatModel(
  provider: string,
  modelId: string,
  modelRegistry: ModelRegistry,
): Model<Api> | undefined {
  if (normalizeProviderId(provider) !== "zai") {
    return undefined;
  }
  const trimmed = modelId.trim();
  const lower = trimmed.toLowerCase();
  if (lower !== ZAI_GLM5_MODEL_ID && !lower.startsWith(`${ZAI_GLM5_MODEL_ID}-`)) {
    return undefined;
  }

  for (const templateId of ZAI_GLM5_TEMPLATE_MODEL_IDS) {
    const template = modelRegistry.find("zai", templateId) as Model<Api> | null;
    if (!template) {
      continue;
    }
    return normalizeModelCompat({
      ...template,
      id: trimmed,
      name: trimmed,
      reasoning: true,
    } as Model<Api>);
  }

  return normalizeModelCompat({
    id: trimmed,
    name: trimmed,
    api: "openai-completions",
    provider: "zai",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: DEFAULT_CONTEXT_TOKENS,
    maxTokens: DEFAULT_CONTEXT_TOKENS,
  } as Model<Api>);
}

export function resolveForwardCompatModel(
  provider: string,
  modelId: string,
  modelRegistry: ModelRegistry,
): Model<Api> | undefined {
  return (
    resolveOpenAICodexGpt53FallbackModel(provider, modelId, modelRegistry) ??
    resolveClaudeForwardCompatModel(provider, modelId, modelRegistry) ??
    resolveZaiGlm5ForwardCompatModel(provider, modelId, modelRegistry)
  );
}
