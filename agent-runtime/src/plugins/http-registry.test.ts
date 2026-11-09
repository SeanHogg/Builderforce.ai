import { describe, expect, it } from "vitest";
import {
  registerPluginHttpRoute,
  type PluginHttpRouteHandler,
} from "./http-registry.js";
import { createEmptyPluginRegistry } from "./registry.js";

const noop: PluginHttpRouteHandler = async () => undefined;

describe("registerPluginHttpRoute", () => {
  it("regression: a route registered without \"auth\" defaults to \"gateway\"", () => {
    const registry = createEmptyPluginRegistry();
    registerPluginHttpRoute({
      path: "/webhook",
      handler: noop,
      registry,
    });

    expect(registry.httpRoutes).toHaveLength(1);
    expect(registry.httpRoutes[0]?.path).toBe("/webhook");
    expect(registry.httpRoutes[0]?.auth).toBe("gateway");
  });

  it("regression: the LINE webhook route is registered as \"public\"", () => {
    // The LINE provider registers its webhook via registerPluginHttpRoute with
    // auth: "public" (src/line/monitor.ts) because the handler verifies LINE
    // signatures itself (validateLineSignature in src/line/webhook-node.ts).
    // Mirror that registration here so a regression to the default would fail.
    const registry = createEmptyPluginRegistry();
    registerPluginHttpRoute({
      path: "/line/webhook",
      pluginId: "line",
      handler: noop,
      auth: "public",
      registry,
    });

    expect(registry.httpRoutes).toHaveLength(1);
    expect(registry.httpRoutes[0]?.auth).toBe("public");
  });
});
