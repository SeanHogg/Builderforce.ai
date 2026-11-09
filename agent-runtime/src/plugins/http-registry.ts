import type { IncomingMessage, ServerResponse } from "node:http";
import { normalizePluginHttpPath } from "./http-path.js";
import type { PluginHttpRouteRegistration, PluginRegistry } from "./registry.js";
import { requireActivePluginRegistry } from "./runtime.js";

/**
 * Per-route auth classification for a plugin HTTP route.
 *
 * - "gateway" (the default): the gateway authenticates the request (shared
 *   gateway token / shared secret) before the plugin handler runs. A plugin
 *   that omits `auth` cannot accidentally expose an unauthenticated route.
 * - "public": the gateway runs the handler without any gateway auth. Use ONLY
 *   when the handler authenticates the request itself (e.g. a webhook that
 *   validates a provider signature); name that check in a comment at the
 *   registration site.
 */
export type PluginHttpRouteAuth = "gateway" | "public";

export type PluginHttpRouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<void> | void;

export function registerPluginHttpRoute(params: {
  path?: string | null;
  fallbackPath?: string | null;
  handler: PluginHttpRouteHandler;
  pluginId?: string;
  source?: string;
  accountId?: string;
  auth?: PluginHttpRouteAuth;
  log?: (message: string) => void;
  registry?: PluginRegistry;
}): () => void {
  const registry = params.registry ?? requireActivePluginRegistry();
  const routes = registry.httpRoutes ?? [];
  registry.httpRoutes = routes;

  const normalizedPath = normalizePluginHttpPath(params.path, params.fallbackPath);
  const suffix = params.accountId ? ` for account "${params.accountId}"` : "";
  if (!normalizedPath) {
    params.log?.(`plugin: webhook path missing${suffix}`);
    return () => {};
  }

  if (routes.some((entry) => entry.path === normalizedPath)) {
    const pluginHint = params.pluginId ? ` (${params.pluginId})` : "";
    params.log?.(`plugin: webhook path ${normalizedPath} already registered${suffix}${pluginHint}`);
    return () => {};
  }

  const entry: PluginHttpRouteRegistration = {
    path: normalizedPath,
    handler: params.handler,
    pluginId: params.pluginId,
    source: params.source,
    // Default "gateway": a route without an explicit auth declaration requires
    // gateway auth, so a plugin author cannot forget auth by omitting it.
    auth: params.auth ?? "gateway",
  };
  routes.push(entry);

  return () => {
    const index = routes.indexOf(entry);
    if (index >= 0) {
      routes.splice(index, 1);
    }
  };
}
