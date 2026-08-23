import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("./env-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./env-file.js")>();
  return {
    ...actual,
    readRuntimeEnvVar: vi.fn(),
    readSharedEnvVar: vi.fn(),
    isOfflineMode: vi.fn(() => false),
  };
});
vi.mock("../builderforce/project-context-store.js", () => ({
  loadProjectContext: vi.fn(),
}));
vi.mock("../logger.js", () => ({ logDebug: vi.fn(), logError: vi.fn() }));

import { loadProjectContext } from "../builderforce/project-context-store.js";
import { logError } from "../logger.js";
import { isOfflineMode, readRuntimeEnvVar, readSharedEnvVar } from "./env-file.js";
import {
  isPlatformErrorReportingEnabled,
  logAndReportRuntimeError,
  sendRuntimeErrorReport,
} from "./platform-error-reporter.js";

const env = vi.mocked(readRuntimeEnvVar);
const shared = vi.mocked(readSharedEnvVar);
const offline = vi.mocked(isOfflineMode);
const context = vi.mocked(loadProjectContext);

/** A machine that is linked, opted in, and online. */
function linkedAndOptedIn(): void {
  offline.mockReturnValue(false);
  env.mockImplementation((key) => (key === "BUILDERFORCE_ERROR_REPORTING" ? "1" : undefined));
  shared.mockImplementation((key) => {
    if (key === "BUILDERFORCE_API_KEY") {
      return "host-key";
    }
    if (key === "BUILDERFORCE_URL") {
      return "https://api.example.test";
    }
    return undefined;
  });
  context.mockResolvedValue({
    builderforce: { instanceId: "77", projectId: "12" },
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 202 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe("isPlatformErrorReportingEnabled", () => {
  it("is off unless the operator opts in", () => {
    offline.mockReturnValue(false);
    env.mockReturnValue(undefined);
    expect(isPlatformErrorReportingEnabled()).toBe(false);
  });

  it.each(["1", "true", "yes", "on", "enabled"])("accepts %s as opting in", (value) => {
    offline.mockReturnValue(false);
    env.mockReturnValue(value);
    expect(isPlatformErrorReportingEnabled()).toBe(true);
  });

  it("stays off in offline/air-gapped mode even when the switch is on", () => {
    offline.mockReturnValue(true);
    env.mockReturnValue("1");
    expect(isPlatformErrorReportingEnabled()).toBe(false);
  });
});

describe("sendRuntimeErrorReport", () => {
  it("posts the error to the client-report door with the host credential", async () => {
    linkedAndOptedIn();
    await sendRuntimeErrorReport(new TypeError("relay died"), {
      operation: "gateway/attach",
      workspaceDir: "/repo",
      context: { attempt: 2 },
    });

    const fetchMock = vi.mocked(globalThis.fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(url).toBe("https://api.example.test/api/quality-ingest/client-report");
    expect(headers.Authorization).toBe("Bearer host-key");
    expect(headers["X-AgentHost-Id"]).toBe("77");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ source: "agent-runtime", projectId: 12 });
    expect(body.events[0]).toMatchObject({
      type: "TypeError",
      message: "relay died",
      operation: "gateway/attach",
      context: { attempt: 2 },
    });
  });

  it("sends nothing when reporting is off", async () => {
    linkedAndOptedIn();
    env.mockReturnValue(undefined);
    await sendRuntimeErrorReport(new Error("x"), {
      operation: "op",
      workspaceDir: "/repo",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("sends nothing when the host is not linked", async () => {
    linkedAndOptedIn();
    shared.mockReturnValue(undefined);
    await sendRuntimeErrorReport(new Error("x"), {
      operation: "op",
      workspaceDir: "/repo",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("swallows a transport failure rather than failing the run", async () => {
    linkedAndOptedIn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(
      sendRuntimeErrorReport(new Error("x"), {
        operation: "op",
        workspaceDir: "/repo",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("logAndReportRuntimeError", () => {
  it("logs locally even when nothing can be reported", async () => {
    offline.mockReturnValue(false);
    env.mockReturnValue(undefined);
    await logAndReportRuntimeError(new Error("disk full"), {
      operation: "memory/flush",
    });
    expect(vi.mocked(logError)).toHaveBeenCalledWith("[memory/flush] disk full");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
