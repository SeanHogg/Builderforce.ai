import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CronPollerService } from "./cron-poller.js";
import { isOfflineMode } from "./env-file.js";
import { WorkflowPollerService } from "./workflow-poller.js";

const OFFLINE_KEYS = ["BUILDERFORCE_OFFLINE", "BUILDERFORCE_AIRGAP"] as const;

describe("isOfflineMode", () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of OFFLINE_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of OFFLINE_KEYS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  });

  it("defaults to online (offline mode off)", () => {
    expect(isOfflineMode()).toBe(false);
  });

  it("treats common truthy values as offline", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", "enabled"]) {
      expect(isOfflineMode({ BUILDERFORCE_OFFLINE: value } as NodeJS.ProcessEnv)).toBe(true);
    }
  });

  it("treats falsy / unknown values as online", () => {
    for (const value of ["0", "false", "no", "off", ""]) {
      expect(isOfflineMode({ BUILDERFORCE_OFFLINE: value } as NodeJS.ProcessEnv)).toBe(false);
    }
  });

  it("honors the BUILDERFORCE_AIRGAP alias", () => {
    expect(isOfflineMode({ BUILDERFORCE_AIRGAP: "1" } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("control-plane pollers in offline mode", () => {
  const savedOffline = process.env.BUILDERFORCE_OFFLINE;
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

  beforeEach(() => {
    process.env.BUILDERFORCE_OFFLINE = "1";
    fetchSpy.mockResolvedValue(new Response("{}"));
    // Return a harmless timer handle without actually scheduling anything.
    setIntervalSpy.mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);
  });

  afterEach(() => {
    fetchSpy.mockClear();
    setIntervalSpy.mockClear();
    if (savedOffline === undefined) {
      delete process.env.BUILDERFORCE_OFFLINE;
    } else {
      process.env.BUILDERFORCE_OFFLINE = savedOffline;
    }
  });

  afterAll(() => {
    fetchSpy.mockRestore();
    setIntervalSpy.mockRestore();
  });

  it("cron poller start() schedules no outbound fetch or interval", async () => {
    const poller = new CronPollerService({
      baseUrl: "https://api.builderforce.ai",
      agentNodeId: "node-1",
      apiKey: "secret",
    });
    await poller.start();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("workflow poller start() schedules no outbound fetch or interval", () => {
    const poller = new WorkflowPollerService({
      baseUrl: "https://api.builderforce.ai",
      agentNodeId: "node-1",
      apiKey: "secret",
      getContext: () => ({}) as never,
    });
    poller.start();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});
