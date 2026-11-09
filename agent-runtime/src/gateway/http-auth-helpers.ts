import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuthRateLimiter } from "./auth-rate-limit.js";
import { authorizeGatewayConnect, type GatewayAuthResult, type ResolvedGatewayAuth } from "./auth.js";
import { sendGatewayAuthFailure } from "./http-common.js";
import { getBearerToken } from "./http-utils.js";

/**
 * Non-replying variant: returns the auth decision without writing a response,
 * so a caller can skip a rejected entry and keep scanning (fall-through).
 *
 * `rateLimiter` is consulted ONLY when the request actually presented a bearer
 * token — a request with no token must never record a rate-limit failure,
 * otherwise unauthenticated static/Control UI loads would lock out the IP's
 * shared-secret scope.
 */
export async function authorizeGatewayBearerRequest(params: {
  req: IncomingMessage;
  auth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  rateLimiter?: AuthRateLimiter;
}): Promise<GatewayAuthResult> {
  const token = getBearerToken(params.req);
  return authorizeGatewayConnect({
    auth: params.auth,
    connectAuth: token ? { token, password: token } : null,
    req: params.req,
    trustedProxies: params.trustedProxies,
    rateLimiter: token ? params.rateLimiter : undefined,
  });
}

export async function authorizeGatewayBearerRequestOrReply(params: {
  req: IncomingMessage;
  res: ServerResponse;
  auth: ResolvedGatewayAuth;
  trustedProxies?: string[];
  rateLimiter?: AuthRateLimiter;
}): Promise<boolean> {
  const authResult = await authorizeGatewayBearerRequest(params);
  if (!authResult.ok) {
    sendGatewayAuthFailure(params.res, authResult);
    return false;
  }
  return true;
}
