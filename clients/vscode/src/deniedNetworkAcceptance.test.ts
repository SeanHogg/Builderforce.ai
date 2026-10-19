/**
 * G27 VSIX packaged network-denial acceptance (ticket #5861).
 *
 * Host shape, not the library stand-in. `bindPlatformPolicy` owns global
 * fetch, `attemptPlatformSyncPush` is the platform call, and `bootVsixHost`
 * is the snapshot directory a restart reads back. The boundary owns
 * `globalThis.fetch` inside `vi.hoisted` because `./platformPolicy` binds
 * `nativeFetch` when that module is first evaluated.
 *
 * Web and Rovr are not this file. Covering them means editing hosts this
 * slice does not own.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_FIRST_POLICY, PlatformAccessDenied } from "@builderforce/local-first";

const boundary = vi.hoisted(() => {
  const attempts: string[] = [];
  let online = false;
  const fetch = (input: string): Promise<Response> => {
    attempts.push(input);
    if (!online) return Promise.reject(new Error("platform_network_denied"));
    return Promise.resolve(new Response("{}", { status: 200 }));
  };
  const previous = globalThis.fetch;
  globalThis.fetch = fetch as typeof globalThis.fetch;
  return {
    fetch,
    previous,
    get attempts(): readonly string[] {
      return attempts;
    },
    isOnline: () => online,
    setOnline(next: boolean) {
      online = next;
    },
    reset() {
      attempts.length = 0;
      online = false;
    },
    restore() {
      globalThis.fetch = previous;
    },
  };
});

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }),
    onDidChangeConfiguration: () => ({ dispose() {} }),
  },
  window: {},
  commands: { executeCommand: vi.fn() },
  l10n: { t: (message: string) => message },
}));

import { bootVsixHost, VSIX_LOCAL_SNAPSHOT_FILE } from "./bootVsixHost";
import { assertPlatformSocketAllowed } from "./platformCallGate";
import { bindPlatformPolicy, platformPolicy, platformRequestAccount } from "./platformPolicy";
import {
  DENIED_NETWORK_ERROR,
  NON_PLATFORM_PROBE_URL,
  PLATFORM_SYNC_PUSH_URL,
  createGlobalStorageDirectory,
  createHostContext,
  attemptPlatformSyncPush,
  removeGlobalStorageDirectory,
} from "./deniedNetworkAcceptance";

const PLATFORM_SOCKET_URL = "wss://api.builderforce.ai/api/sync/v1/push";

describe("G27 VSIX packaged network denial", () => {
  let directory: string | undefined;
  let host: ReturnType<typeof createHostContext> | undefined;
  let previousSocket: typeof globalThis.WebSocket | undefined;
  const sockets: string[] = [];
  const boots: Array<{ stop(): void }> = [];

  beforeEach(() => {
    boundary.reset();
    platformPolicy().set({ ...LOCAL_FIRST_POLICY });
    previousSocket = globalThis.WebSocket;
    globalThis.WebSocket = function OpenedSocket(url: string) {
      sockets.push(String(url));
      throw new Error("socket_opened");
    } as unknown as typeof WebSocket;
  });

  afterEach(() => {
    for (const boot of boots.splice(0)) boot.stop();
    host?.dispose();
    host = undefined;
    boundary.reset();
    boundary.restore();
    platformPolicy().set({ ...LOCAL_FIRST_POLICY });
    if (previousSocket) globalThis.WebSocket = previousSocket;
    previousSocket = undefined;
    sockets.length = 0;
    if (directory) removeGlobalStorageDirectory(directory);
    directory = undefined;
  });

  it("keeps a denied host off the network, survives a restart from the snapshot directory, then replays the pending batch", async () => {
    expect(DENIED_NETWORK_ERROR).toBe("platform_network_denied");
    expect(boundary.isOnline()).toBe(false);
    expect(platformPolicy().allows("synchronize")).toBe(false);

    directory = createGlobalStorageDirectory();
    host = createHostContext();
    bindPlatformPolicy(host.context);
    const beforeProbe = platformRequestAccount();

    await expect(fetch(NON_PLATFORM_PROBE_URL)).rejects.toThrow(DENIED_NETWORK_ERROR);
    expect([...boundary.attempts]).toEqual([NON_PLATFORM_PROBE_URL]);

    await expect(fetch(PLATFORM_SYNC_PUSH_URL, { method: "POST" })).rejects.toMatchObject({
      name: "PlatformAccessDenied",
      code: "PLATFORM_ACCESS_DENIED",
      capability: "synchronize",
      message: "platform_synchronize_disabled",
    });
    await expect(attemptPlatformSyncPush()).rejects.toBeInstanceOf(PlatformAccessDenied);
    expect(() => assertPlatformSocketAllowed(PLATFORM_SOCKET_URL)).toThrow(PlatformAccessDenied);
    expect(sockets).toEqual([]);

    const afterDenied = platformRequestAccount();
    expect(afterDenied.attempted - beforeProbe.attempted).toBe(0);
    expect(afterDenied.blocked - beforeProbe.blocked).toBe(2);
    expect([...boundary.attempts]).toEqual([NON_PLATFORM_PROBE_URL]);

    const first = bootVsixHost({ network: "denied", directory });
    boots.push(first);
    await first.ready();
    const id = await first.writeDurable({ title: "Offline ticket" });
    expect(await first.readRecord(id)).toEqual({ id, title: "Offline ticket" });
    first.stop();

    const snapshotFile = path.join(directory, VSIX_LOCAL_SNAPSHOT_FILE);
    const onDisk = readFileSync(snapshotFile, "utf8");
    expect(onDisk).toContain(id);
    expect(onDisk).toContain("Offline ticket");
    expect([...boundary.attempts]).toEqual([NON_PLATFORM_PROBE_URL]);

    const restarted = bootVsixHost({ network: "denied", directory });
    boots.push(restarted);
    await restarted.ready();
    expect(restarted.store()).not.toBe(first.store());
    expect(await restarted.readRecord(id)).toEqual({ id, title: "Offline ticket" });
    const replay = await restarted.replayBatch();
    expect(replay.count).toBe(1);
    expect(replay.idempotencyKey).toBe(`event:${id}`);
    restarted.stop();

    const again = bootVsixHost({ network: "denied", directory });
    boots.push(again);
    await again.ready();
    expect(await again.replayBatch()).toEqual({ count: 0, idempotencyKey: replay.idempotencyKey });
    expect(await again.readRecord(id)).toEqual({ id, title: "Offline ticket" });
    again.stop();
    expect([...boundary.attempts]).toEqual([NON_PLATFORM_PROBE_URL]);
    expect(sockets).toEqual([]);

    boundary.setOnline(true);
    platformPolicy().set({ synchronize: true });
    expect(platformPolicy().allows("synchronize")).toBe(true);
    expect(platformPolicy().allows("gateway-inference")).toBe(false);
    expect(platformPolicy().allows("connected-feature")).toBe(false);
    expect(platformPolicy().allows("model-download")).toBe(false);
    expect(platformPolicy().allows("direct-provider")).toBe(false);
    expect(platformPolicy().allows("external-mcp")).toBe(false);
    expect(platformPolicy().allows("git-remote")).toBe(false);
    const granted = await attemptPlatformSyncPush();
    expect(granted.ok).toBe(true);
    expect([...boundary.attempts]).toEqual([NON_PLATFORM_PROBE_URL, PLATFORM_SYNC_PUSH_URL]);
    const afterGrant = platformRequestAccount();
    expect(afterGrant.attempted - afterDenied.attempted).toBe(1);
    expect(afterGrant.blocked - afterDenied.blocked).toBe(0);
  });
});
