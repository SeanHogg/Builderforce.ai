import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import { buildAllowedModelSet, resolveConfiguredModelRef } from "../../agents/model-selection.js";
import { loadConfig } from "../../config/config.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateModelsListParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

export const modelsHandlers: GatewayRequestHandlers = {
  "models.list": async ({ params, respond, context }) => {
    if (!validateModelsListParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid models.list params: ${formatValidationErrors(validateModelsListParams.errors)}`,
        ),
      );
      return;
    }
    try {
      const models = await context.loadGatewayModelCatalog();
      const cfg = loadConfig();
      const resolvedDefault = resolveConfiguredModelRef({
        cfg,
        defaultProvider: DEFAULT_PROVIDER,
        defaultModel: DEFAULT_MODEL,
      });
      const allowed = buildAllowedModelSet({
        cfg,
        catalog: models,
        defaultProvider: resolvedDefault.provider,
        defaultModel: resolvedDefault.model,
      });
      const visibleModels = allowed.allowAny ? [...models] : [...allowed.allowedCatalog];
      const hasBuilderForceAgentsllm = visibleModels.some(
        (entry) => entry.provider === "builderforcellm" && entry.id === "auto",
      );
      if (!hasBuilderForceAgentsllm) {
        visibleModels.push({
          provider: "builderforcellm",
          id: "auto",
          name: "BuilderForceAgentsLLM Auto (free pool)",
          contextWindow: 262_144,
          reasoning: false,
          input: ["text"],
        });
      }
      respond(true, { models: visibleModels }, undefined);
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
