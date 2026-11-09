import type { IncomingMessage, ServerResponse } from "node:http";
import type { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PluginRegistry } from "../../plugins/registry.js";
import {
  authorizeGatewayConnect,
  type GatewayAuthResult,
  type ResolvedGatewayAuth,
} from "../auth.js";
import type { AuthRateLimiter } from "../auth-rate-limit.js";
import { sendGatewayAuthFailure } from "../http-common.js";
import { getBearerToken } from "../http-utils.js";

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

async function authorizePluginHttpEntry(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: PluginHttpAuthContext,
): Promise<boolean> {
  const token = getBearerToken(req);
  const authResult = await authorizeGatewayConnect({
    auth: ctx.auth,
    connectAuth: token ? { token, password: token } : null,
    req,
    trustedProxies: ctx.trustedProxies,
    rateLimiter: ctx.rateLimiter,
  });
  if (!authResult.ok) {
    sendGatewayAuthFailure(res, authResult);
    return false;
  }
  return true;
}

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
          if (!(await authorizePluginHttpEntry(req, res, ctx))) {
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

    let authFailure: GatewayAuthResult | null = null;
    for (const entry of handlers) {
      // Per-entry decision because handlers carry no path: a gateway-auth
      // failure on one entry is remembered and the scan continues, so a
      // public webhook later in the list can still answer. If nothing handled
      // the request, the remembered failure is sent (default-deny).
      if ((entry.auth ?? "gateway") !== "public") {
        const token = getBearerToken(req);
        const authResult = await authorizeGatewayConnect({
          auth: ctx.auth,
          connectAuth: token ? { token, password: token } : null,
          req,
          trustedProxies: ctx.trustedProxies,
          rateLimiter: ctx.rateLimiter,
        });
        if (!authResult.ok) {
          authFailure ??= authResult;
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
    // Nothing handled the request. If a gateway-auth entry rejected it,
    // default-deny answers with that failure rather than falling through to
    // the next non-plugin handler.
    if (authFailure) {
      sendGatewayAuthFailure(res, authFailure);
      return true;
    }
    return false;
  };
}
