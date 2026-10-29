/**
 * The context window of a gateway model, from what this host already knows: the host's
 * own models config (`models.providers.<gateway>.models[].contextWindow`, capped by
 * `agents.defaults.contextTokens`) through the runtime's one resolver
 * (`resolveContextWindowInfo`). A model the config does not size has NO window — the agent
 * then uses its fixed caps — rather than a window this file made up.
 */

import { resolveContextWindowInfo } from "../agents/context-window-guard.js";
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { loadConfig, type BuilderForceAgentsConfig } from "../config/config.js";

/** `ModelTransport.window` over the host's config. The config is read once, when asked. */
export function configuredModelWindow(cfg?: BuilderForceAgentsConfig): (model: string) => number | undefined {
  let loaded = cfg;
  return (model) => {
    loaded ??= loadConfig();
    const info = resolveContextWindowInfo({ cfg: loaded, provider: DEFAULT_PROVIDER, modelId: model, defaultTokens: 0 });
    return info.source === "default" ? undefined : info.tokens;
  };
}
