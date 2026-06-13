import path from "node:path";
import { ensureAuthProfileStore } from "../agents/auth-profiles.js";
import { downloadBuilderForceAgentsLlmModel } from "../agents/transformers-stream.js";
import type { BuilderForceAgentsConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import { promptAuthChoiceGrouped } from "./auth-choice-prompt.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { applyPrimaryModel } from "./model-picker.js";

/** Provider ID written into the config for the local-brain entry. */
export const BUILDERFORCE_AGENTSLLM_LOCAL_PROVIDER_ID = "builderforcellm-local";
/** @deprecated Use BUILDERFORCE_AGENTSLLM_LOCAL_PROVIDER_ID */
export const TRANSFORMERS_PROVIDER_ID = BUILDERFORCE_AGENTSLLM_LOCAL_PROVIDER_ID;

// ── Anatomical model defaults ────────────────────────────────────────────────
// Amygdala  = SmolLM2 (fast routing / triage, <200 ms)
// Hippocampus = Qwen3-0.6B-ONNX (plan pass; built for Transformers.js + ONNX)
// Cortex    = user's registered LLM (the actual agent model)
export const AMYGDALA_MODEL_ID = "HuggingFaceTB/SmolLM2-1.7B-Instruct";
export const AMYGDALA_DTYPE = "q4";
export const HIPPOCAMPUS_MODEL_ID = "onnx-community/Qwen3-0.6B-ONNX";
export const HIPPOCAMPUS_DTYPE = "q4f16";

/** @deprecated Use AMYGDALA_MODEL_ID */
export const TRANSFORMERS_DEFAULT_MODEL_ID = AMYGDALA_MODEL_ID;
/** @deprecated Use AMYGDALA_DTYPE */
export const TRANSFORMERS_DEFAULT_DTYPE = AMYGDALA_DTYPE;

const _DTYPE_OPTIONS = ["q4", "q5", "q8", "fp16", "fp32"] as const;

export function defaultCacheDir(): string {
  return path.join(resolveStateDir(), "models");
}

function toModelKey(modelId: string): string {
  return `${TRANSFORMERS_PROVIDER_ID}/${modelId}`;
}

export function applyTransformersProviderConfig(
  cfg: BuilderForceAgentsConfig,
  amygdalaModelId: string,
  amygdalaDtype: string,
  hippocampusModelId: string,
  hippocampusDtype: string,
  cacheDir: string,
): BuilderForceAgentsConfig {
  return {
    ...cfg,
    models: {
      ...cfg.models,
      mode: cfg.models?.mode ?? "merge",
      providers: {
        ...cfg.models?.providers,
        [TRANSFORMERS_PROVIDER_ID]: {
          // baseUrl is repurposed as the model cache directory for this provider.
          baseUrl: cacheDir,
          api: "transformers",
          // pi-ai ModelRegistry requires apiKey for custom providers; use a
          // sentinel value since local inference needs no remote auth.
          apiKey: "local",
          models: [
            {
              id: amygdalaModelId,
              name: `amygdala (${amygdalaModelId})`,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 8192,
              maxTokens: 2048,
              headers: { "x-transformers-dtype": amygdalaDtype, "x-brain-role": "amygdala" },
            },
            {
              id: hippocampusModelId,
              name: `hippocampus (${hippocampusModelId})`,
              reasoning: false,
              input: ["text"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 40960,
              maxTokens: 4096,
              headers: { "x-transformers-dtype": hippocampusDtype, "x-brain-role": "hippocampus" },
            },
          ],
        },
      },
    },
    localBrain: {
      ...cfg.localBrain,
      enabled: true,
      models: {
        amygdala: { modelId: amygdalaModelId, dtype: amygdalaDtype },
        hippocampus: { modelId: hippocampusModelId, dtype: hippocampusDtype },
      },
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractPrimaryModel(cfg: BuilderForceAgentsConfig): string | undefined {
  const model = cfg.agents?.defaults?.model;
  if (typeof model === "string") {
    return model;
  }
  if (model && typeof model === "object") {
    return model.primary;
  }
  return undefined;
}

function setModelWithFallback(
  cfg: BuilderForceAgentsConfig,
  primary: string,
  fallback: string,
): BuilderForceAgentsConfig {
  const defaults = cfg.agents?.defaults;
  const existingModel = defaults?.model;

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...defaults,
        model: {
          ...(typeof existingModel === "object" ? existingModel : undefined),
          primary,
          fallbacks: [fallback],
        },
      },
    },
  };
}

// ── Download & wire (step 3 only) ─────────────────────────────────────────────
// Exported so the onboarding wizard can call it directly when the user has
// already chosen their LLM provider and opted into the local brain.

import type { WizardPrompter } from "../wizard/prompts.js";

export async function downloadAndWireLocalBrain(opts: {
  config: BuilderForceAgentsConfig;
  prompter: WizardPrompter;
}): Promise<{ config: BuilderForceAgentsConfig }> {
  let nextConfig = opts.config;
  const configuredModelKey = extractPrimaryModel(nextConfig);

  const amygdalaModelId = nextConfig.localBrain?.models?.amygdala?.modelId ?? AMYGDALA_MODEL_ID;
  const amygdalaDtype = nextConfig.localBrain?.models?.amygdala?.dtype ?? AMYGDALA_DTYPE;
  const hippocampusModelId =
    nextConfig.localBrain?.models?.hippocampus?.modelId ?? HIPPOCAMPUS_MODEL_ID;
  const hippocampusDtype = nextConfig.localBrain?.models?.hippocampus?.dtype ?? HIPPOCAMPUS_DTYPE;
  const cacheDir = defaultCacheDir();

  // Register both models in the provider config.
  nextConfig = applyTransformersProviderConfig(
    nextConfig,
    amygdalaModelId,
    amygdalaDtype,
    hippocampusModelId,
    hippocampusDtype,
    cacheDir,
  );

  // ── Download amygdala (SmolLM2 — fast router) ──────────────────────────
  let lastFile = "";
  const amygdalaSpinner = opts.prompter.progress(
    `Downloading amygdala (${amygdalaModelId}, ${amygdalaDtype})… (~0.9 GB)`,
  );
  try {
    await downloadBuilderForceAgentsLlmModel({
      modelId: amygdalaModelId,
      dtype: amygdalaDtype,
      cacheDir,
      onProgress: (file, pct) => {
        if (file !== lastFile) {
          lastFile = file;
        }
        amygdalaSpinner.update(`Amygdala: ${path.basename(file)} — ${pct}%`);
      },
    });
    amygdalaSpinner.stop("Amygdala (fast router) downloaded and ready.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    amygdalaSpinner.stop(
      `Amygdala download failed: ${msg}\nThe cortex (registered LLM) will be used without a local brain.\nRe-run "builderforce configure" to try again.`,
    );
    return { config: nextConfig };
  }

  // ── Download hippocampus (Qwen3-0.6B-ONNX — plan / memory) ─────────
  lastFile = "";
  const hippoSpinner = opts.prompter.progress(
    `Downloading hippocampus (${hippocampusModelId}, ${hippocampusDtype})… (~2.3 GB)`,
  );
  try {
    await downloadBuilderForceAgentsLlmModel({
      modelId: hippocampusModelId,
      dtype: hippocampusDtype,
      cacheDir,
      onProgress: (file, pct) => {
        if (file !== lastFile) {
          lastFile = file;
        }
        hippoSpinner.update(`Hippocampus: ${path.basename(file)} — ${pct}%`);
      },
    });
    hippoSpinner.stop("Hippocampus (memory model) downloaded and ready.");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hippoSpinner.stop(
      `Hippocampus download failed: ${msg}\nAmygdala will run solo; hippocampus features disabled.\nRe-run "builderforce configure" to try again.`,
    );
    // Don't bail — amygdala is still functional.
  }

  const localModelKey = toModelKey(amygdalaModelId);
  if (configuredModelKey && configuredModelKey !== localModelKey) {
    nextConfig = setModelWithFallback(nextConfig, localModelKey, configuredModelKey);
  } else {
    nextConfig = applyPrimaryModel(nextConfig, localModelKey);
  }

  return { config: nextConfig };
}

// ── Main handler ──────────────────────────────────────────────────────────────
// Used when the user picks "builderforcellm-local" as their *primary* auth choice
// (standalone flow — not from the onboarding wizard).

export async function applyAuthChoiceTransformers(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "builderforcellm-local") {
    return null;
  }

  // ── Step 1: Select the main LLM provider ───────────────────────────────────
  await params.prompter.note(
    "First, pick your main LLM provider.\nThis handles coding tasks, complex reasoning, and everything the local brain defers.",
    "Configure LLM",
  );

  const llmChoice = await promptAuthChoiceGrouped({
    prompter: params.prompter,
    store: await ensureAuthProfileStore(params.agentDir, { allowKeychainPrompt: false }),
    includeSkip: false,
  });

  const { applyAuthChoice } = await import("./auth-choice.apply.js");
  const llmResult = await applyAuthChoice({
    authChoice: llmChoice,
    config: params.config,
    prompter: params.prompter,
    runtime: params.runtime,
    setDefaultModel: true,
  });

  let nextConfig = llmResult.config;

  // ── Step 2: Smarter brain toggle ───────────────────────────────────────────
  const enableLocalBrain = await params.prompter.confirm({
    message: "Enable local brain? (handles simple tasks, defers complex ones)",
    initialValue: true,
  });

  if (!enableLocalBrain) {
    return { config: nextConfig };
  }

  // ── Step 3: Download & wire ────────────────────────────────────────────────
  const result = await downloadAndWireLocalBrain({
    config: nextConfig,
    prompter: params.prompter,
  });

  return { config: result.config };
}
