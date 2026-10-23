import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_FIRST_POLICY, PlatformAccessDenied } from "@builderforce/local-first";

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, fallback?: unknown) => fallback,
    }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {},
  commands: { executeCommand: vi.fn() },
  l10n: { t: (s: string) => s },
}));

import { platformPolicy } from "./platformPolicy";
import { assertPlatformSocketAllowed, platformPolicyFrame, platformSocketUrl } from "./platformCallGate";

beforeEach(() => {
  platformPolicy().set({ ...LOCAL_FIRST_POLICY });
});

describe("platformCallGate", () => {
  it("decides a platform socket with the shared request gate: Local only refuses a content socket whatever is granted", () => {
    // Unresolved (no sign-in read yet) is Local only — the same answer the web and Rovr give.
    const content = "wss://api.builderforce.ai/api/meetings/rooms/room/ws";
    expect(() => assertPlatformSocketAllowed(content)).toThrow(PlatformAccessDenied);
    platformPolicy().set({ gatewayInference: true, connectedFeatures: true });
    expect(() => assertPlatformSocketAllowed(content)).toThrow(PlatformAccessDenied);
    // A socket that only says "something changed" carries no content and goes.
    expect(() => assertPlatformSocketAllowed("wss://api.builderforce.ai/api/notifications/ws")).not.toThrow();
  });

  it("does not gate a non-platform socket", () => {
    expect(() => assertPlatformSocketAllowed("ws://127.0.0.1:9/socket")).not.toThrow();
  });

  it("publishes the host snapshot, not a second policy", () => {
    platformPolicy().set({ synchronize: true });
    const frame = platformPolicyFrame("https://corp.example/gateway", "https://web.corp.example");
    expect(frame.type).toBe("platform.policy");
    expect(frame.baseUrl).toBe("https://corp.example/gateway");
    expect(frame.webUrl).toBe("https://web.corp.example");
    expect(frame.platformPolicy).toEqual(platformPolicy().snapshot());
    expect(frame.platformPolicy.synchronize).toBe(true);
    expect(frame.platformPolicy.connectedFeatures).toBe(false);
    expect(frame.inferenceMode).toBe("local-only");
  });

  it("reads a websocket URL off a host message and ignores an https URL", () => {
    expect(platformSocketUrl({ wsUrl: "wss://api.builderforce.ai/ws" })).toBe("wss://api.builderforce.ai/ws");
    expect(platformSocketUrl({ url: "https://api.builderforce.ai/api" })).toBeNull();
    expect(platformSocketUrl({})).toBeNull();
  });

  it("the shared host bridge publishes the snapshot and refuses a denied platform socket", () => {
    const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "webviewHostBridge.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("watchPlatformPolicy(");
    expect(code).toContain("assertPlatformSocketAllowed(");
    expect(code).toContain("platformPolicyFrame(");
  });
});
