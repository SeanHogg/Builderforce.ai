import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as subagentSpawn from "../agents/subagent-spawn.js";
import type { ILocalResultBroker } from "../builderforce/ports.js";
import { BuilderforceAgentTransport, parseAutoTarget } from "./agent-transport.js";
import { CompositeAgentTransport, transportKindForTarget } from "./composite-agent-transport.js";
import { LocalAgentTransport } from "./local-agent-transport.js";
import * as remoteResultBroker from "./remote-result-broker.js";
import * as remoteSubagent from "./remote-subagent.js";

const baseOpts = { baseUrl: "https://api.example.test", myAgentNodeId: "1", apiKey: "k" };

afterEach(() => {
  vi.restoreAllMocks();
});

// ── parseAutoTarget ──────────────────────────────────────────────────────────

describe("parseAutoTarget", () => {
  it("returns null for non-auto targets", () => {
    expect(parseAutoTarget("42")).toBeNull();
    expect(parseAutoTarget("code-creator")).toBeNull();
  });
  it("returns [] for bare auto", () => {
    expect(parseAutoTarget("auto")).toEqual([]);
  });
  it("parses inline capability list", () => {
    expect(parseAutoTarget("auto[gpu,high-memory]")).toEqual(["gpu", "high-memory"]);
  });
  it("trims whitespace and drops empties", () => {
    expect(parseAutoTarget("auto[ a , , b ]")).toEqual(["a", "b"]);
  });
});

// ── transportKindForTarget ──────────────────────────────────────────────────

describe("transportKindForTarget", () => {
  it("recognizes remote: prefix", () => {
    expect(transportKindForTarget("remote:42")).toBe("remote");
    expect(transportKindForTarget("remote:auto[gpu]")).toBe("remote");
  });
  it("recognizes local: prefix", () => {
    expect(transportKindForTarget("local:code-creator")).toBe("local");
  });
  it("defaults bare role names to local", () => {
    expect(transportKindForTarget("code-creator")).toBe("local");
  });
});

// ── BuilderforceAgentTransport ──────────────────────────────────────────────

describe("BuilderforceAgentTransport", () => {
  it("auto-routes to first online peer satisfying capabilities", async () => {
    vi.spyOn(remoteSubagent, "fetchFleetEntries").mockResolvedValue([
      {
        id: 1,
        name: "self",
        slug: "self",
        online: true,
        connectedAt: null,
        lastSeenAt: null,
        capabilities: ["gpu"],
      },
      {
        id: 2,
        name: "peer-no-gpu",
        slug: "p2",
        online: true,
        connectedAt: null,
        lastSeenAt: null,
        capabilities: [],
      },
      {
        id: 3,
        name: "peer-gpu",
        slug: "p3",
        online: true,
        connectedAt: null,
        lastSeenAt: null,
        capabilities: ["gpu"],
      },
    ]);
    const dispatchSpy = vi
      .spyOn(remoteSubagent, "dispatchToRemoteAgentNode")
      .mockResolvedValue({ status: "accepted" });
    const awaitSpy = vi.spyOn(remoteResultBroker, "awaitRemoteResult").mockResolvedValue("ok");

    const transport = new BuilderforceAgentTransport(baseOpts);
    const result = await transport.dispatch({
      target: "remote:auto[gpu]",
      input: "do work",
      correlationId: "corr-1",
    });

    expect(result).toEqual({ status: "accepted", targetId: "3", output: "ok" });
    // Excludes self (id=1) and the peer without gpu (id=2); picks id=3
    expect(dispatchSpy).toHaveBeenCalledWith(
      baseOpts,
      "3",
      "do work",
      expect.objectContaining({ correlationId: "corr-1" }),
    );
    expect(awaitSpy).toHaveBeenCalledWith("corr-1", expect.any(Number));
  });

  it("returns failed when no peer satisfies required capabilities", async () => {
    vi.spyOn(remoteSubagent, "fetchFleetEntries").mockResolvedValue([
      {
        id: 2,
        name: "peer",
        slug: "p2",
        online: true,
        connectedAt: null,
        lastSeenAt: null,
        capabilities: [],
      },
    ]);

    const transport = new BuilderforceAgentTransport(baseOpts);
    const result = await transport.dispatch({
      target: "remote:auto[python]",
      input: "x",
    });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toMatch(/python/);
    }
  });

  it("returns failed when awaitRemoteResult times out (never reports completed on an unseen result)", async () => {
    vi.spyOn(remoteSubagent, "dispatchToRemoteAgentNode").mockResolvedValue({ status: "accepted" });
    vi.spyOn(remoteResultBroker, "awaitRemoteResult").mockRejectedValue(new Error("timeout"));

    const transport = new BuilderforceAgentTransport(baseOpts);
    const result = await transport.dispatch({
      target: "remote:7",
      input: "x",
      correlationId: "corr-2",
    });

    // The remote agentNode accepted the task but never called back. We must NOT
    // report success: otherwise the orchestrator marks the task completed on a
    // result we never received and advances autonomous workflows prematurely.
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.targetId).toBe("7");
      expect(result.error).toMatch(/not received/);
    }
  });

  it("propagates rejection error from dispatchToRemoteAgentNode", async () => {
    vi.spyOn(remoteSubagent, "dispatchToRemoteAgentNode").mockResolvedValue({
      status: "rejected",
      error: "delivery failed",
    });

    const transport = new BuilderforceAgentTransport(baseOpts);
    const result = await transport.dispatch({ target: "remote:9", input: "x" });

    expect(result).toEqual({ status: "failed", error: "delivery failed", targetId: "9" });
  });
});

// ── LocalAgentTransport ──────────────────────────────────────────────────────

describe("LocalAgentTransport", () => {
  let broker: ILocalResultBroker;
  let awaitResultMock: ILocalResultBroker["awaitResult"];
  let transport: LocalAgentTransport;

  beforeEach(() => {
    awaitResultMock = vi.fn(async () => "subagent output");
    broker = { awaitResult: awaitResultMock };
    transport = new LocalAgentTransport({
      getContext: () => ({}),
      localResultBroker: broker,
    });
  });

  it("discover() exposes built-in roles tagged kind: 'local'", async () => {
    const entries = await transport.discover();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.kind === "local")).toBe(true);
    expect(entries.every((e) => e.online)).toBe(true);
    expect(entries.map((e) => e.id)).toContain("code-creator");
  });

  it("discover() filters by required capabilities", async () => {
    const entries = await transport.discover(["__no_role_has_this_cap__"]);
    expect(entries).toEqual([]);
  });

  it("dispatch('local:code-creator', …) spawns + awaits + returns output", async () => {
    const spawnSpy = vi.spyOn(subagentSpawn, "spawnSubagentDirect").mockResolvedValue({
      status: "accepted",
      runId: "run-1",
      childSessionKey: "sess-1",
    });

    const result = await transport.dispatch({
      target: "local:code-creator",
      input: "build a thing",
      timeoutMs: 5000,
    });

    expect(spawnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ task: "build a thing", agentId: "code-creator" }),
      {},
    );
    expect(awaitResultMock).toHaveBeenCalledWith("run-1", "sess-1", 5000);
    expect(result).toEqual({
      status: "accepted",
      targetId: "code-creator",
      output: "subagent output",
      childSessionKey: "sess-1",
    });
  });

  it("dispatch with bare role (no prefix) is treated as local", async () => {
    const spawnSpy = vi.spyOn(subagentSpawn, "spawnSubagentDirect").mockResolvedValue({
      status: "accepted",
      runId: "run-2",
      childSessionKey: "sess-2",
    });

    const result = await transport.dispatch({ target: "code-reviewer", input: "review" });

    expect(spawnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "code-reviewer" }),
      {},
    );
    expect(result.status).toBe("accepted");
  });

  it("dispatch returns failed for unknown role", async () => {
    const spawnSpy = vi.spyOn(subagentSpawn, "spawnSubagentDirect");
    const result = await transport.dispatch({ target: "local:not-a-real-role", input: "x" });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toMatch(/Unknown agent role/);
    }
  });

  it("dispatch('local:auto') picks first available role", async () => {
    vi.spyOn(subagentSpawn, "spawnSubagentDirect").mockResolvedValue({
      status: "accepted",
      runId: "run-3",
      childSessionKey: "sess-3",
    });

    const result = await transport.dispatch({ target: "local:auto", input: "x" });
    expect(result.status).toBe("accepted");
    if (result.status === "accepted") {
      // First built-in role is code-creator
      expect(result.targetId).toBe("code-creator");
    }
  });

  it("dispatch returns failed on spawn rejection", async () => {
    vi.spyOn(subagentSpawn, "spawnSubagentDirect").mockResolvedValue({
      status: "forbidden",
      error: "spawn blocked",
    });

    const result = await transport.dispatch({ target: "local:code-creator", input: "x" });
    expect(result).toEqual({ status: "failed", error: "spawn blocked", targetId: "code-creator" });
  });

  it("returns failed when awaitResult times out (no false 'accepted' on an unseen result)", async () => {
    vi.spyOn(subagentSpawn, "spawnSubagentDirect").mockResolvedValue({
      status: "accepted",
      runId: "run-x",
      childSessionKey: "sess-x",
    });
    const throwingBroker: ILocalResultBroker = {
      awaitResult: vi.fn(async () => {
        throw new Error("await timeout");
      }),
    };
    const throwingTransport = new LocalAgentTransport({
      getContext: () => ({}),
      localResultBroker: throwingBroker,
    });

    const result = await throwingTransport.dispatch({ target: "local:code-creator", input: "x" });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.targetId).toBe("code-creator");
      expect(result.error).toMatch(/result not received/);
    }
  });
});

// ── CompositeAgentTransport ──────────────────────────────────────────────────

describe("CompositeAgentTransport", () => {
  it("routes remote: targets to the remote transport", async () => {
    const local = { discover: vi.fn(async () => []), dispatch: vi.fn() };
    const remote = {
      discover: vi.fn(async () => []),
      dispatch: vi.fn(async () => ({ status: "accepted" as const, targetId: "42", output: "r" })),
    };
    const composite = new CompositeAgentTransport({ local, remote });

    const result = await composite.dispatch({ target: "remote:42", input: "x" });
    expect(remote.dispatch).toHaveBeenCalledOnce();
    expect(local.dispatch).not.toHaveBeenCalled();
    expect(result.status).toBe("accepted");
  });

  it("routes local: targets to the local transport", async () => {
    const local = {
      discover: vi.fn(async () => []),
      dispatch: vi.fn(async () => ({
        status: "accepted" as const,
        targetId: "code-creator",
        output: "l",
      })),
    };
    const remote = { discover: vi.fn(async () => []), dispatch: vi.fn() };
    const composite = new CompositeAgentTransport({ local, remote });

    await composite.dispatch({ target: "local:code-creator", input: "x" });
    expect(local.dispatch).toHaveBeenCalledOnce();
    expect(remote.dispatch).not.toHaveBeenCalled();
  });

  it("routes bare role names (no prefix) to the local transport", async () => {
    const local = {
      discover: vi.fn(async () => []),
      dispatch: vi.fn(async () => ({
        status: "accepted" as const,
        targetId: "code-creator",
        output: "l",
      })),
    };
    const composite = new CompositeAgentTransport({ local });

    await composite.dispatch({ target: "code-creator", input: "x" });
    expect(local.dispatch).toHaveBeenCalledOnce();
  });

  it("returns helpful failed result when the requested kind isn't wired", async () => {
    const local = {
      discover: vi.fn(async () => []),
      dispatch: vi.fn(async () => ({ status: "accepted" as const, targetId: "x" })),
    };
    const composite = new CompositeAgentTransport({ local });

    const result = await composite.dispatch({ target: "remote:42", input: "x" });
    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toMatch(/BUILDERFORCE_API_KEY/);
    }
  });

  it("discover() concatenates entries from all wired transports", async () => {
    const local = {
      discover: vi.fn(async () => [
        {
          id: "code-creator",
          name: "code-creator",
          online: true,
          capabilities: [],
          kind: "local" as const,
        },
      ]),
      dispatch: vi.fn(),
    };
    const remote = {
      discover: vi.fn(async () => [
        { id: "42", name: "peer", online: true, capabilities: ["gpu"], kind: "remote" as const },
      ]),
      dispatch: vi.fn(),
    };
    const composite = new CompositeAgentTransport({ local, remote });

    const entries = await composite.discover();
    expect(entries.map((e) => e.id).toSorted()).toEqual(["42", "code-creator"]);
  });
});
