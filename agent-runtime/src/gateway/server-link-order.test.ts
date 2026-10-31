/**
 * The host's Builderforce link is what the tenant's governance gates and approvals read. A host that
 * linked AFTER cron, the heartbeat, the channels, the plugins or the restart wake started ran those
 * first turns ungated. The link is set once, before any of them, by `linkHostToBuilderforce`.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ offline: vi.fn(), env: vi.fn(), context: vi.fn() }));

vi.mock("../infra/env-file.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../infra/env-file.js")>()),
  isOfflineMode: mocks.offline,
  readSharedEnvVar: mocks.env,
}));
vi.mock("../builderforce/project-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../builderforce/project-context.js")>()),
  loadProjectContext: mocks.context,
}));

import { approvalGate, hostLink } from "../infra/approval-gate.js";
import { linkHostToBuilderforce } from "./server-startup.js";

const read = (name: string): string => fs.readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

const log = { warn: vi.fn(), info: vi.fn() };
const params = { defaultWorkspaceDir: "/work", log } as unknown as Parameters<typeof linkHostToBuilderforce>[0];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.offline.mockReturnValue(false);
  mocks.env.mockImplementation((key: string) => ({ BUILDERFORCE_API_KEY: "bfk_k", BUILDERFORCE_URL: "https://bf.test" })[key]);
  mocks.context.mockResolvedValue({ builderforce: { instanceId: "7" } });
});
afterEach(() => {
  (approvalGate as unknown as { baseUrl: string | null }).baseUrl = null;
});

describe("linkHostToBuilderforce", () => {
  it("links a host that has a key and a host id", async () => {
    await linkHostToBuilderforce(params);
    expect(hostLink()).toEqual({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "bfk_k" });
  });

  it("leaves a host with no key standalone", async () => {
    mocks.env.mockReturnValue(undefined);
    await linkHostToBuilderforce(params);
    expect(hostLink()).toBeNull();
  });

  it("leaves a host with no host id standalone", async () => {
    mocks.context.mockResolvedValue({ builderforce: {} });
    await linkHostToBuilderforce(params);
    expect(hostLink()).toBeNull();
  });

  it("leaves an offline host standalone", async () => {
    mocks.offline.mockReturnValue(true);
    await linkHostToBuilderforce(params);
    expect(hostLink()).toBeNull();
  });

  it("a context that cannot be read leaves the host standalone and says so, rather than stopping the gateway", async () => {
    mocks.context.mockRejectedValue(new Error("EACCES"));
    await expect(linkHostToBuilderforce(params)).resolves.toBeUndefined();
    expect(hostLink()).toBeNull();
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});

describe("startup order", () => {
  const impl = read("./server.impl.ts");
  const at = (needle: string): number => {
    const i = impl.indexOf(needle);
    expect(i, `${needle} is in server.impl.ts`).toBeGreaterThan(-1);
    return i;
  };

  it("links the host before cron, the heartbeat, and the sidecars (channels, plugins, restart wake) start", () => {
    const link = at("await linkHostToBuilderforce(");
    for (const later of ["buildGatewayCronService(", "startHeartbeatRunner({", "cron.start()", "await startGatewaySidecars("]) {
      expect(link, `the link comes before ${later}`).toBeLessThan(at(later));
    }
  });

  it("sets the link in ONE place: the startup services do not link a second time", () => {
    const startup = read("./server-startup.ts");
    expect(startup.match(/initApprovalGate\(/g)).toHaveLength(1);
    const services = startup.slice(startup.indexOf("async function startBuilderforceServices"));
    expect(services).not.toContain("initApprovalGate(");
  });
});
