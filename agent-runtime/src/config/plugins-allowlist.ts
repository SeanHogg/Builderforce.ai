import type { BuilderForceAgentsConfig } from "./config.js";

export function ensurePluginAllowlisted(cfg: BuilderForceAgentsConfig, pluginId: string): BuilderForceAgentsConfig {
  const allow = cfg.plugins?.allow;
  if (!Array.isArray(allow) || allow.includes(pluginId)) {
    return cfg;
  }
  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      allow: [...allow, pluginId],
    },
  };
}
