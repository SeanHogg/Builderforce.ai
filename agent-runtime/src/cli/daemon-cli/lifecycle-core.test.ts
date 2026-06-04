import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfig = vi.fn(() => ({
  gateway: {
    auth: {
      token: "config-token",
    },
  },
}));

const runtimeLogs: string[] = [];
const defaultRuntime = {
  log: (message: string) => runtimeLogs.push(message),
  error: vi.fn(),
  exit: (code: number) => {
    throw new Error(`__exit__:${code}`);
  },
};

const service = {
  label: "TestService",
  loadedText: "loaded",
  notLoadedText: "not loaded",
  install: vi.fn(),
  uninstall: vi.fn(),
  stop: vi.fn(),
  isLoaded: vi.fn(),
  readCommand: vi.fn(),
  readRuntime: vi.fn(),
  restart: vi.fn(),
};

const readRecentGatewayLogErrors = vi.fn(async (): Promise<string[]> => []);

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfig(),
}));

vi.mock("../../daemon/diagnostics.js", () => ({
  readRecentGatewayLogErrors: (...args: Parameters<typeof readRecentGatewayLogErrors>) =>
    readRecentGatewayLogErrors(...args),
}));

vi.mock("../../runtime.js", () => ({
  defaultRuntime,
}));

describe("runServiceRestart token drift", () => {
  beforeEach(() => {
    runtimeLogs.length = 0;
    loadConfig.mockClear();
    service.isLoaded.mockClear();
    service.readCommand.mockClear();
    service.restart.mockClear();
    service.isLoaded.mockResolvedValue(true);
    service.readCommand.mockResolvedValue({
      environment: { BUILDERFORCE_AGENTS_GATEWAY_TOKEN: "service-token" },
    });
    service.restart.mockResolvedValue(undefined);
    service.readRuntime.mockResolvedValue({ status: "running" });
    readRecentGatewayLogErrors.mockClear();
    readRecentGatewayLogErrors.mockResolvedValue([]);
    vi.unstubAllEnvs();
    vi.stubEnv("BUILDERFORCE_AGENTS_GATEWAY_TOKEN", "");
    vi.stubEnv("BUILDERFORCE_AGENTS_GATEWAY_TOKEN", "");
  });

  it("emits drift warning when enabled", async () => {
    const { runServiceRestart } = await import("./lifecycle-core.js");

    await runServiceRestart({
      serviceNoun: "Gateway",
      service,
      renderStartHints: () => [],
      opts: { json: true },
      checkTokenDrift: true,
    });

    expect(loadConfig).toHaveBeenCalledTimes(1);
    const jsonLine = runtimeLogs.find((line) => line.trim().startsWith("{"));
    const payload = JSON.parse(jsonLine ?? "{}") as { warnings?: string[] };
    expect(payload.warnings?.[0]).toContain("gateway install --force");
  });

  it("skips drift warning when disabled", async () => {
    const { runServiceRestart } = await import("./lifecycle-core.js");

    await runServiceRestart({
      serviceNoun: "Node",
      service,
      renderStartHints: () => [],
      opts: { json: true },
    });

    expect(loadConfig).not.toHaveBeenCalled();
    expect(service.readCommand).not.toHaveBeenCalled();
    const jsonLine = runtimeLogs.find((line) => line.trim().startsWith("{"));
    const payload = JSON.parse(jsonLine ?? "{}") as { warnings?: string[] };
    expect(payload.warnings).toBeUndefined();
  });

  it("waits for health probe when runtime does not report running", async () => {
    const { runServiceRestart } = await import("./lifecycle-core.js");
    service.readRuntime.mockResolvedValue({ status: "stopped" });
    const waitUntilHealthy = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    await runServiceRestart({
      serviceNoun: "Gateway",
      service,
      renderStartHints: () => [],
      opts: { json: true },
      waitUntilHealthy,
    });

    const jsonLine = runtimeLogs.find((line) => line.trim().startsWith("{"));
    const payload = JSON.parse(jsonLine ?? "{}") as { ok?: boolean; result?: string };
    expect(waitUntilHealthy).toHaveBeenCalledTimes(2);
    expect(payload.ok).toBe(true);
    expect(payload.result).toBe("restarted");
  });

  it("still fails when runtime is stopped and health probe never succeeds", async () => {
    const { runServiceRestart } = await import("./lifecycle-core.js");
    service.readRuntime.mockResolvedValue({ status: "stopped" });
    const waitUntilHealthy = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    readRecentGatewayLogErrors
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(["gateway start blocked"]);

    await expect(
      runServiceRestart({
        serviceNoun: "Gateway",
        service,
        renderStartHints: () => [],
        opts: { json: true },
        waitUntilHealthy,
      }),
    ).rejects.toThrow("__exit__:1");
  });
});
