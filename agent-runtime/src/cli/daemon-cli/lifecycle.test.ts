import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.fn(() => ({}));
const resolveGatewayPortMock = vi.fn(() => 18789);
const inspectPortUsageMock = vi.fn();
const runServiceStartMock = vi.fn();
const runServiceRestartMock = vi.fn();

const service = {
  readRuntime: vi.fn(),
};

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
  resolveGatewayPort: (...args: Parameters<typeof resolveGatewayPortMock>) =>
    resolveGatewayPortMock(...args),
}));

vi.mock("../../daemon/service.js", () => ({
  resolveGatewayService: () => service,
}));

vi.mock("../../infra/ports.js", () => ({
  inspectPortUsage: (...args: unknown[]) => inspectPortUsageMock(...args),
  classifyPortListener: (listener: { commandLine?: string }) =>
    listener.commandLine?.includes("dist\\index.js gateway") ? "gateway" : "unknown",
}));

vi.mock("./lifecycle-core.js", () => ({
  runServiceRestart: (...args: unknown[]) => runServiceRestartMock(...args),
  runServiceStart: (...args: unknown[]) => runServiceStartMock(...args),
  runServiceStop: vi.fn(),
  runServiceUninstall: vi.fn(),
}));

describe("gateway daemon stale process cleanup", () => {
  beforeEach(() => {
    loadConfigMock.mockClear();
    resolveGatewayPortMock.mockClear();
    inspectPortUsageMock.mockReset();
    runServiceStartMock.mockReset();
    runServiceRestartMock.mockReset();
    service.readRuntime.mockReset();
    vi.restoreAllMocks();
  });

  it("does not kill listeners when service runtime is running", async () => {
    service.readRuntime.mockResolvedValue({ status: "running" });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { clearStaleGatewayProcessIfNeeded } = await import("./lifecycle.js");

    await clearStaleGatewayProcessIfNeeded();

    expect(inspectPortUsageMock).not.toHaveBeenCalled();
    expect(killSpy).not.toHaveBeenCalled();
  });

  it("kills stale gateway listeners when runtime is stopped", async () => {
    service.readRuntime.mockResolvedValue({ status: "stopped" });
    inspectPortUsageMock
      .mockResolvedValueOnce({
        status: "busy",
        listeners: [{ pid: 27428, commandLine: "node.exe dist\\index.js gateway --port 18789" }],
      })
      .mockResolvedValueOnce({
        status: "free",
        listeners: [],
      });
    const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

    const { clearStaleGatewayProcessIfNeeded } = await import("./lifecycle.js");

    await clearStaleGatewayProcessIfNeeded();

    expect(killSpy).toHaveBeenCalledWith(27428);
  });

  it("cleans stale listeners before restart", async () => {
    service.readRuntime.mockResolvedValue({ status: "stopped" });
    inspectPortUsageMock
      .mockResolvedValueOnce({
        status: "busy",
        listeners: [{ pid: 27428, commandLine: "node.exe dist\\index.js gateway --port 18789" }],
      })
      .mockResolvedValueOnce({
        status: "free",
        listeners: [],
      });
    vi.spyOn(process, "kill").mockImplementation(() => true);
    runServiceRestartMock.mockResolvedValue(true);

    const { runDaemonRestart } = await import("./lifecycle.js");

    await runDaemonRestart({ json: true });

    expect(runServiceRestartMock).toHaveBeenCalledTimes(1);
  });
});
