import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { PluginRegistry } from "../plugins/registry.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createRegistry } from "./server.e2e-registry-helpers.js";
import { connectGatewayClient } from "./test-helpers.e2e.js";
import {
  connectOk,
  installGatewayTestHooks,
  rpcReq,
  startServerWithClient,
} from "./test-helpers.js";

const loadConfigHelpers = async () => await import("../config/config.js");

installGatewayTestHooks({ scope: "suite" });

const registryState = vi.hoisted(() => ({
  registry: {
    plugins: [],
    tools: [],
    channels: [],
    providers: [],
    gatewayHandlers: {},
    httpHandlers: [],
    httpRoutes: [],
    cliRegistrars: [],
    services: [],
    diagnostics: [],
  } as unknown as PluginRegistry,
}));

vi.mock("./server-plugins.js", async () => {
  const { setActivePluginRegistry } = await import("../plugins/runtime.js");
  return {
    loadGatewayPlugins: (params: { baseMethods: string[] }) => {
      setActivePluginRegistry(registryState.registry);
      return {
        pluginRegistry: registryState.registry,
        gatewayMethods: params.baseMethods ?? [],
      };
    },
  };
});

const createStubChannelPlugin = (params: {
  id: ChannelPlugin["id"];
  label: string;
}): ChannelPlugin => ({
  id: params.id,
  meta: {
    id: params.id,
    label: params.label,
    selectionLabel: params.label,
    docsPath: `/channels/${params.id}`,
    blurb: "test stub.",
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => ["default"],
    resolveAccount: () => ({}),
    isConfigured: async () => false,
  },
  status: {
    buildChannelSummary: async () => ({ configured: false }),
  },
});

const defaultRegistry = createRegistry([
  {
    pluginId: "telegram",
    source: "test",
    plugin: createStubChannelPlugin({ id: "telegram", label: "Telegram" }),
  },
]);

let server: Awaited<ReturnType<typeof startServerWithClient>>["server"];
let ws: Awaited<ReturnType<typeof startServerWithClient>>["ws"];
let port: Awaited<ReturnType<typeof startServerWithClient>>["port"];
let gatewayToken: string;

beforeAll(async () => {
  setRegistry(defaultRegistry);
  const started = await startServerWithClient();
  server = started.server;
  ws = started.ws;
  port = started.port;
  gatewayToken = process.env.BUILDERFORCE_AGENTS_GATEWAY_TOKEN ?? "";
  const { connectReq } = await import("./test-helpers.server.js");
  const res = await connectReq(ws);
  if (!res.ok) {
    throw new Error(`connect failed: ${JSON.stringify(res.error)}`);
  }
  expect((res.payload as { type?: unknown } | undefined)?.type).toBe("hello-ok");
});

afterAll(async () => {
  ws.close();
  await server.close();
});

function setRegistry(registry: PluginRegistry) {
  registryState.registry = registry;
  setActivePluginRegistry(registry);
}

describe("channels.configure downlink (portal → on-prem host)", () => {
  test("rejects invalid params", async () => {
    setRegistry(defaultRegistry);
    const res = await rpcReq(ws, "channels.configure", { channel: "telegram", extra: 1 });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toContain("invalid channels.configure params");
  });

  test("rejects unknown channel", async () => {
    setRegistry(defaultRegistry);
    const res = await rpcReq(ws, "channels.configure", {
      channel: "not-a-channel",
      config: { enabled: true },
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe("invalid channels.configure channel");
  });

  test("round-trip: portal configureChannel → host applies and acknowledges", async () => {
    setRegistry(defaultRegistry);
    const { readConfigFileSnapshot } = await loadConfigHelpers();

    // Simulated on-prem host; the portal is a GatewayClient connected to it.
    const client = await connectGatewayClient({
      url: `ws://127.0.0.1:${port}`,
      token: gatewayToken,
      clientDisplayName: "portal",
    });

    try {
      // Portal pushes a channel configuration down to the host.
      const result = await client.configureChannel({
        channel: "telegram",
        config: { botToken: "123:abc", enabled: true },
      });
      expect(result.ok).toBe(true);
      expect(result.channel).toBe("telegram");
      expect(result.accountId).toBe("default");
      expect(result.applied).toEqual({ botToken: "123:abc", enabled: true });

      // Host persisted the pushed configuration.
      const snap = await readConfigFileSnapshot();
      expect(snap.valid).toBe(true);
      expect(snap.config?.channels?.telegram?.botToken).toBe("123:abc");
      expect(snap.config?.channels?.telegram?.enabled).toBe(true);
    } finally {
      client.stop();
    }
  });
});
