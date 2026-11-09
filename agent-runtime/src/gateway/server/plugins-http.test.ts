import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedGatewayAuth } from "../auth.js";
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

function makeParams(registry?: ReturnType<typeof createTestRegistry>, log?: HandlerLog) {
  return {
    registry: registry ?? createTestRegistry(),
    log: log ?? ({ warn: vi.fn() } as unknown as HandlerLog),
    auth: testAuth,
    trustedProxies: [] as string[],
  };
}

function makeRequest(url: string, authorization?: string): IncomingMessage {
  const headers: Record<string, string> = {};
  if (authorization) headers.authorization = authorization;
  return { url, headers, socket: { remoteAddress: "127.0.0.1" } } as IncomingMessage;
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

  it("rejects a route registered without auth when the request carries no token", async () => {
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

  it("lets a public webhook handler answer without a token", async () => {
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

  it("sends the remembered 401 when no entry handles the request and auth failed", async () => {
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
    expect(handled).toBe(true);
    expect(res.statusCode).toBe(401);
    expect(secure).not.toHaveBeenCalled();
    expect(String(end.mock.calls[0]?.[0])).toContain("Unauthorized");
  });
});
