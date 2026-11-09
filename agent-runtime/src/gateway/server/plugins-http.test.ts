import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedGatewayAuth } from "../auth.js";
import type { AuthRateLimiter } from "../auth-rate-limit.js";
import { makeMockHttpResponse } from "../test-http-response.js";
import { createTestRegistry } from "./__tests__/test-utils.js";
import { createGatewayPluginRequestHandler } from "./plugins-http.js";

const testAuth: ResolvedGatewayAuth = {
  mode: "token",
  token: "test-token",
  password: undefined,
  allowTailscale: false,
};

type HandlerLog = Parameters<typeof createGatewayPluginRequestHandler>[0]["log"];

function makeParams(
  registry?: ReturnType<typeof createTestRegistry>,
  log?: HandlerLog,
  rateLimiter?: AuthRateLimiter,
) {
  return {
    registry: registry ?? createTestRegistry(),
    log: log ?? ({ warn: vi.fn() } as unknown as HandlerLog),
    auth: testAuth,
    trustedProxies: [] as string[],
    ...(rateLimiter ? { rateLimiter } : {}),
  };
}

function makeRequest(url: string, authorization?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (authorization) {
    headers.authorization = authorization;
  }
  return { url, headers, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage;
}

function createMockRateLimiter() {
  const check = vi.fn(() => ({ allowed: true, remaining: 10, retryAfterMs: 0 }));
  const recordFailure = vi.fn();
  const limiter = {
    check,
    recordFailure,
    reset: vi.fn(),
    size: vi.fn(() => 0),
    prune: vi.fn(),
    dispose: vi.fn(),
  } satisfies AuthRateLimiter;
  return { limiter, check, recordFailure };
}

describe("createGatewayPluginRequestHandler", () => {
  it("returns false when no handlers are registered", async () => {
    const handler = createGatewayPluginRequestHandler(makeParams());
    const { res } = makeMockHttpResponse();
    const handled = await handler({} as IncomingMessage, res);
    expect(handled).toBe(false);
  });

  it("continues until a handler reports it handled the request", async () => {
    const first = vi.fn(async () => false);
    const second = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpHandlers: [
            { pluginId: "first", handler: first, source: "first" },
            { pluginId: "second", handler: second, source: "second" },
          ],
        }),
      ),
    );

    const { res } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/anything", "Bearer test-token"), res);
    expect(handled).toBe(true);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("handles registered http routes before generic handlers", async () => {
    const routeHandler = vi.fn(async (_req, res: ServerResponse) => {
      res.statusCode = 200;
    });
    const fallback = vi.fn(async () => true);
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpRoutes: [
            {
              pluginId: "route",
              path: "/demo",
              handler: routeHandler,
              source: "route",
            },
          ],
          httpHandlers: [{ pluginId: "fallback", handler: fallback, source: "fallback" }],
        }),
      ),
    );

    const { res } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/demo", "Bearer test-token"), res);
    expect(handled).toBe(true);
    expect(routeHandler).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("logs and responds with 500 when a handler throws", async () => {
    const log = { warn: vi.fn() } as unknown as HandlerLog;
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpHandlers: [
            {
              pluginId: "boom",
              handler: async () => {
                throw new Error("boom");
              },
              source: "boom",
            },
          ],
        }),
        log,
      ),
    );

    const { res, setHeader, end } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/boom", "Bearer test-token"), res);
    expect(handled).toBe(true);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
    expect(res.statusCode).toBe(500);
    expect(setHeader).toHaveBeenCalledWith("Content-Type", "text/plain; charset=utf-8");
    expect(end).toHaveBeenCalledWith("Internal Server Error");
  });

  it("regression: a plugin handler registered without \"auth\" rejects a request with no token", async () => {
    const routeHandler = vi.fn(async () => undefined);
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpRoutes: [
            {
              pluginId: "secure",
              path: "/secure",
              handler: routeHandler,
              source: "secure",
            },
          ],
        }),
      ),
    );

    const { res, end } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/secure"), res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(routeHandler).not.toHaveBeenCalled();
    expect(JSON.parse(String(end.mock.calls[0]?.[0]))).toMatchObject({
      error: { type: "unauthorized" },
    });
  });

  it("allows an authenticated request through to a gateway-auth route", async () => {
    const routeHandler = vi.fn(async (_req, res: ServerResponse) => {
      res.statusCode = 200;
      res.end("ok");
    });
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpRoutes: [
            {
              pluginId: "secure",
              path: "/secure",
              handler: routeHandler,
              source: "secure",
            },
          ],
        }),
      ),
    );

    const { res } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/secure", "Bearer test-token"), res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(routeHandler).toHaveBeenCalledTimes(1);
  });

  it("regression: a \"public\" webhook still answers", async () => {
    const webhook = vi.fn(async (_req, res: ServerResponse) => {
      res.statusCode = 200;
      res.end("webhook-ok");
      return true;
    });
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpHandlers: [{ pluginId: "hook", handler: webhook, auth: "public", source: "hook" }],
        }),
      ),
    );

    const { res } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/webhook"), res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("still answers a public webhook registered after a gateway-auth handler that fails auth", async () => {
    const secure = vi.fn(async () => false);
    const webhook = vi.fn(async (_req, res: ServerResponse) => {
      res.statusCode = 200;
      res.end("webhook-ok");
      return true;
    });
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpHandlers: [
            { pluginId: "secure", handler: secure, source: "secure" },
            { pluginId: "hook", handler: webhook, auth: "public", source: "hook" },
          ],
        }),
      ),
    );

    const { res } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/webhook"), res);
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(200);
    expect(secure).not.toHaveBeenCalled();
    expect(webhook).toHaveBeenCalledTimes(1);
  });

  it("regression: an unhandled request falls through (returns false) when a gateway handler rejects it", async () => {
    const secure = vi.fn(async () => false);
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpHandlers: [{ pluginId: "secure", handler: secure, source: "secure" }],
        }),
      ),
    );

    const { res, end } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/unmatched"), res);
    expect(handled).toBe(false);
    expect(secure).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it("regression: a request with no bearer records no rate-limit failure", async () => {
    const { limiter, recordFailure } = createMockRateLimiter();
    const handler = createGatewayPluginRequestHandler(
      makeParams(
        createTestRegistry({
          httpHandlers: [{ pluginId: "secure", handler: async () => false, source: "secure" }],
        }),
        undefined,
        limiter,
      ),
    );

    const { res } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/unmatched"), res);
    expect(handled).toBe(false);
    expect(recordFailure).not.toHaveBeenCalled();
  });

  it("regression: auth is resolved once per request across N gateway handlers", async () => {
    const handlers = Array.from({ length: 5 }, (_, i) => ({
      pluginId: `h${i}`,
      handler: vi.fn(async () => false),
      source: `h${i}`,
    }));
    const { limiter, check, recordFailure } = createMockRateLimiter();
    const handler = createGatewayPluginRequestHandler(
      makeParams(createTestRegistry({ httpHandlers: handlers }), undefined, limiter),
    );

    const { res } = makeMockHttpResponse();
    const handled = await handler(makeRequest("/unmatched", "Bearer test-token"), res);
    expect(handled).toBe(false);
    for (const entry of handlers) {
      expect(entry.handler).toHaveBeenCalledTimes(1);
    }
    // One auth resolution for the whole request, not one per entry.
    expect(check).toHaveBeenCalledTimes(1);
    // A bad-token request never records a failure.
    expect(recordFailure).not.toHaveBeenCalled();
  });
});
