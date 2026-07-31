import { normalizeProviderId } from "../../agents/model-selection.js";
import type { BuilderForceAgentsConfig } from "../../config/config.js";

export type ModelPickerCatalogEntry = {
  provider: string;
  id: string;
  name?: string;
};

export function resolveProviderEndpointLabel(
  provider: string,
  cfg: BuilderForceAgentsConfig,
): { endpoint?: string; api?: string } {
  const normalized = normalizeProviderId(provider);
  const providers = (cfg.models?.providers ?? {}) as Record<
    string,
    { baseUrl?: string; api?: string } | undefined
  >;
  const entry = providers[normalized];
  const endpoint = entry?.baseUrl?.trim();
  const api = entry?.api?.trim();
  return {
    endpoint: endpoint || undefined,
    api: api || undefined,
  };
}
