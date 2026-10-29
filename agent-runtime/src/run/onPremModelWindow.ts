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
import { logWarn } from "../logger.js";

/** The host's config, or nothing (said, not silent) when it cannot be read — no window is then known. */
function readConfig(): BuilderForceAgentsConfig | undefined {
  try {
    return loadConfig();
  } catch (err) {
    logWarn(`[on-prem] models config unreadable, no model window known: ${String(err)}`);
    return undefined;
  }
}

/** `ModelTransport.window` over the host's config. The config is read ONCE, here — at startup, not per lookup. */
export function configuredModelWindow(cfg: BuilderForceAgentsConfig | undefined = readConfig()): (model: string) => number | undefined {
  return (model) => {
    const info = resolveContextWindowInfo({ cfg, provider: DEFAULT_PROVIDER, modelId: model, defaultTokens: 0 });
    return info.source === "default" ? undefined : info.tokens;
  };
}
