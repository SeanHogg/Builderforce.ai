import type { BuilderForceAgentsConfig } from "../config/config.js";
import { applyAgentDefaultPrimaryModel } from "./model-default.js";

export const GOOGLE_GEMINI_DEFAULT_MODEL = "google/gemini-3-pro-preview";

export function applyGoogleGeminiModelDefault(cfg: BuilderForceAgentsConfig): {
  next: BuilderForceAgentsConfig;
  changed: boolean;
} {
  return applyAgentDefaultPrimaryModel({ cfg, model: GOOGLE_GEMINI_DEFAULT_MODEL });
}
