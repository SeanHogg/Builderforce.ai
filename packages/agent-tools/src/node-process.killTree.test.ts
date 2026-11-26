import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

/** taskkill comes from `%SystemRoot%\System32`, never PATH — so the tests pin SystemRoot. */
const TASKKILL = "C:\\Windows\\System32\\taskkill.exe";

async function withPlatform<T>(platform: NodeJS.Platform, run: () => Promise<T> | T): Promise<T> {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return await run();
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  }
}

describe("killProcessTree", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    vi.stubEnv("SystemRoot", "C:\\Windows");
    killSpy = vi.spyOn(process, "kill");
    vi.useFakeTimers();
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("on Windows skips delayed force-kill when PID is already gone", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === 4242 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    await withPlatform("win32", async () => {
      const { killProcessTree } = await import("./node-process.js");
      killProcessTree(4242, { graceMs: 25 });

      expect(spawnMock).toHaveBeenCalledTimes(1);
      expect(spawnMock).toHaveBeenNthCalledWith(
        1,
        TASKKILL,
        ["/T", "/PID", "4242"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );

      await vi.advanceTimersByTimeAsync(25);
      expect(spawnMock).toHaveBeenCalledTimes(1);
    });
  });

  it("on Windows force-kills after grace period only when PID still exists", async () => {
    killSpy.mockImplementation((() => true) as typeof process.kill);

    await withPlatform("win32", async () => {
      const { killProcessTree } = await import("./node-process.js");
      killProcessTree(5252, { graceMs: 10 });

      await vi.advanceTimersByTimeAsync(10);

      expect(spawnMock).toHaveBeenCalledTimes(2);
      expect(spawnMock).toHaveBeenNthCalledWith(
        1,
        TASKKILL,
        ["/T", "/PID", "5252"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
      expect(spawnMock).toHaveBeenNthCalledWith(
        2,
        TASKKILL,
        ["/F", "/T", "/PID", "5252"],
        expect.objectContaining({ detached: true, stdio: "ignore" }),
      );
    });
  });

  it("on Unix sends SIGTERM first and skips SIGKILL when process exits", async () => {
    killSpy.mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
      if (pid === -3333 && signal === 0) {
        throw new Error("ESRCH");
      }
      if (pid === 3333 && signal === 0) {
        throw new Error("ESRCH");
      }
      return true;
    }) as typeof process.kill);

    await withPlatform("linux", async () => {
      const { killProcessTree } = await import("./node-process.js");
      killProcessTree(3333, { graceMs: 10 });

      await vi.advanceTimersByTimeAsync(10);

      expect(killSpy).toHaveBeenCalledWith(-3333, "SIGTERM");
      expect(killSpy).not.toHaveBeenCalledWith(-3333, "SIGKILL");
      expect(killSpy).not.toHaveBeenCalledWith(3333, "SIGKILL");
    });
  });

  it("on Unix sends SIGKILL after grace period when process is still alive", async () => {
    killSpy.mockImplementation((() => true) as typeof process.kill);

    await withPlatform("linux", async () => {
      const { killProcessTree } = await import("./node-process.js");
      killProcessTree(4444, { graceMs: 5 });

      await vi.advanceTimersByTimeAsync(5);

      expect(killSpy).toHaveBeenCalledWith(-4444, "SIGTERM");
      expect(killSpy).toHaveBeenCalledWith(-4444, "SIGKILL");
    });
  });
});

describe("killTree (hard kill)", () => {
  let killSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    spawnMock.mockReset();
    killSpy = vi.spyOn(process, "kill").mockImplementation((() => true) as typeof process.kill);
  });

  afterEach(() => {
    killSpy.mockRestore();
    vi.resetModules();
  });

  it("win32: taskkill /T /F runs from the %SystemRoot%\\System32 path, never the bare PATH name", async () => {
    const { killTree } = await import("./node-process.js");
    killTree(777, { platform: "win32", env: { SystemRoot: "C:\\Windows" } });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock).toHaveBeenCalledWith(TASKKILL, ["/T", "/F", "/PID", "777"], expect.objectContaining({ windowsHide: true, stdio: "ignore" }));
    expect(spawnMock.mock.calls[0]?.[0]).not.toBe("taskkill");
  });

  it("win32 with no known system folder never spawns a PATH taskkill: it signals the pid directly", async () => {
    const { killTree } = await import("./node-process.js");
    killTree(778, { platform: "win32", env: {} });
    expect(spawnMock).not.toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalledWith(778, "SIGKILL");
  });

  it("POSIX: SIGKILLs the process group", async () => {
    const { killTree } = await import("./node-process.js");
    killTree(779, { platform: "linux" });
    expect(killSpy).toHaveBeenCalledWith(-779, "SIGKILL");
  });

  it("a failure other than 'already gone' is reported, not swallowed", async () => {
    killSpy.mockImplementation((() => { throw Object.assign(new Error("denied"), { code: "EPERM" }); }) as typeof process.kill);
    const { killTree } = await import("./node-process.js");
    const errors: unknown[] = [];
    killTree(780, { platform: "linux", onError: (e) => errors.push(e) });
    expect(errors).toHaveLength(2); // group, then the bare pid
  });
});
