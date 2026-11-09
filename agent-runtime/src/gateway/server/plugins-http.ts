import type { IncomingMessage, ServerResponse } from "node:http";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import type { ResolvedGatewayAuth } from "../auth.js";
import type { AuthRateLimiter } from "../auth-rate-limit.js";
import {
  authorizeGatewayBearerRequest,
  authorizeGatewayBearerRequestOrReply,
} from "../http-auth-helpers.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export type PluginHttpRequestHandler = (
  req: IncomingMessage,
  res: ServerResponse,
) => Promise<boolean>;

type PluginHttpAuthContext = {
  auth: ResolvedGatewayAuth;
  trustedProxies: string[];
  rateLimiter?: AuthRateLimiter;
};

export function createGatewayPluginRequestHandler(params: {
  registry: PluginRegistry;
  log: SubsystemLogger;
  auth: ResolvedGatewayAuth;
  trustedProxies: string[];
  rateLimiter?: AuthRateLimiter;
}): PluginHttpRequestHandler {
  const { registry, log } = params;
  const ctx: PluginHttpAuthContext = {
    auth: params.auth,
    trustedProxies: params.trustedProxies,
    rateLimiter: params.rateLimiter,
  };
  return async (req, res) => {
    const routes = registry.httpRoutes ?? [];
    const handlers = registry.httpHandlers ?? [];
    if (routes.length === 0 && handlers.length === 0) {
      return false;
    }

    if (routes.length > 0) {
      const url = new URL(req.url ?? "/", "http://localhost");
      const route = routes.find((entry) => entry.path === url.pathname);
      if (route) {
        // Default-deny: entries without an explicit auth declaration require
        // gateway auth before the handler runs.
        if ((route.auth ?? "gateway") !== "public") {
          if (
            !(await authorizeGatewayBearerRequestOrReply({
              req,
              res,
              auth: ctx.auth,
              trustedProxies: ctx.trustedProxies,
              rateLimiter: ctx.rateLimiter,
            }))
          ) {
            // The 401 is the answer for this path — the handler must not run.
            return true;
          }
        }
        try {
          await route.handler(req, res);
          return true;
        } catch (err) {
          log.warn(`plugin http route failed (${route.pluginId ?? "unknown"}): ${String(err)}`);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/plain; charset=utf-8");
            res.end("Internal Server Error");
          }
          return true;
        }
      }
    }

    // Resolve gateway auth AT MOST ONCE per request, lazily: only when a
    // gateway-auth entry is reached, and memoized across entries. A rejected
    // gateway entry is skipped (its handler never runs — that is the security
    // property); if nothing handles the request we return false so it falls
    // through to OpenAI/canvas/Control UI instead of a plugin-owned 401
    // swallowing unrelated paths.
    let gatewayAuth: Promise<boolean> | null = null;
    const ensureGatewayAuth = () => {
      gatewayAuth ??= authorizeGatewayBearerRequest({
        req,
        auth: ctx.auth,
        trustedProxies: ctx.trustedProxies,
        rateLimiter: ctx.rateLimiter,
      }).then((result) => result.ok);
      return gatewayAuth;
    };

    for (const entry of handlers) {
      if ((entry.auth ?? "gateway") !== "public") {
        if (!(await ensureGatewayAuth())) {
          // Gateway auth failed: skip this entry. Its handler never runs.
          continue;
        }
      }
      try {
        const handled = await entry.handler(req, res);
        if (handled) {
          return true;
        }
      } catch (err) {
        log.warn(`plugin http handler failed (${entry.pluginId}): ${String(err)}`);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Internal Server Error");
        }
        return true;
      }
    }
    return false;
  };
}
