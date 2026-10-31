/**
 * The tenant's governance gates for runs that have no dispatch payload (channel, cron):
 * fetched through the host's one Builderforce link, parsed by the same `coercePolicyGates`
 * a ticket's payload goes through, held briefly, and never able to fail or stall a run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ link: vi.fn(), warn: vi.fn() }));
vi.mock("./approval-gate.js", () => ({ hostLink: mocks.link }));
vi.mock("../logger.js", () => ({ logWarn: mocks.warn }));

import {
  POLICY_GATES_FETCH_TIMEOUT_MS,
  POLICY_GATES_RETRY_MS,
  POLICY_GATES_TTL_MS,
  forUnattendedRun,
  resetHostPolicyGates,
  resolveHostPolicyGates,
} from "./host-policy-gates.js";

const LINK = { baseUrl: "https://api.test", agentNodeId: "7", apiKey: "bfk_secret" };
const WIRE = [
  { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" },
  { id: "careful", effect: "inject-directive", directive: "Never touch production." },
];

const answer = (gates: unknown, init: { ok?: boolean; status?: number } = {}) => ({
  ok: init.ok ?? true,
  status: init.status ?? 200,
  json: async () => ({ gates }),
});

let fetchMock: ReturnType<typeof vi.fn>;

/** The run starts at this clock reading (only Date is faked, so the abort timer and microtasks stay real). */
const resolveAt = (ms: number) => {
  vi.setSystemTime(ms);
  return resolveHostPolicyGates();
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  resetHostPolicyGates();
  vi.clearAllMocks();
  mocks.link.mockReturnValue(LINK);
  fetchMock = vi.fn(async () => answer(WIRE));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resolveHostPolicyGates", () => {
  it("fetches the tenant's gates with the host's key and id, and parses them with coercePolicyGates", async () => {
    const gates = await resolveAt(1_000);

    expect(gates).toEqual([
      { id: "no-shell", tool: "exec", effect: "block", reason: "shell is off" },
      { id: "careful", effect: "inject-directive", directive: "Never touch production." },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://api.test/api/agent/governance/policy-gates");
    expect(init.headers.Authorization).toBe("Bearer bfk_secret");
    expect(init.headers["X-AgentHost-Id"]).toBe("7");
  });

  it("drops a hand-edited gate with an unknown effect rather than enforcing a guess", async () => {
    fetchMock.mockResolvedValue(answer([...WIRE, { id: "bogus", effect: "explode", tool: "x" }]));
    const gates = await resolveAt(1_000);
    expect(gates.map((g) => g.id)).toEqual(["no-shell", "careful"]);
  });

  it("an unlinked host has no gates, makes no call and says nothing", async () => {
    mocks.link.mockReturnValue(null);
    expect(await resolveAt(1_000)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
  });

  it("serves a second run inside the TTL from memory", async () => {
    await resolveAt(1_000);
    const again = await resolveAt(1_000 + POLICY_GATES_TTL_MS - 1);
    expect(again).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads again once the TTL has passed, so a policy edit reaches the channel", async () => {
    await resolveAt(1_000);
    fetchMock.mockResolvedValue(answer([{ id: "only", effect: "block", tool: "write" }]));
    const gates = await resolveAt(1_000 + POLICY_GATES_TTL_MS);
    expect(gates.map((g) => g.id)).toEqual(["only"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a policy that was emptied really is empty (an empty answer is not a failure)", async () => {
    await resolveAt(1_000);
    fetchMock.mockResolvedValue(answer([]));
    expect(await resolveAt(1_000 + POLICY_GATES_TTL_MS)).toEqual([]);
  });

  it("shares one request between runs that start together", async () => {
    const [a, b, c] = await Promise.all([
      resolveAt(1_000),
      resolveAt(1_000),
      resolveAt(1_000),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  describe("when the fetch fails", () => {
    it("keeps the last good gates and warns naming the failure", async () => {
      await resolveAt(1_000);
      fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));

      const gates = await resolveAt(1_000 + POLICY_GATES_TTL_MS);

      expect(gates.map((g) => g.id)).toEqual(["no-shell", "careful"]);
      expect(mocks.warn).toHaveBeenCalledTimes(1);
      expect(mocks.warn.mock.calls[0]![0]).toContain("connect ECONNREFUSED");
      expect(mocks.warn.mock.calls[0]![0]).toContain("last good");
    });

    it("with none held, runs with none and warns naming the failure", async () => {
      fetchMock.mockResolvedValue(answer(null, { ok: false, status: 503 }));

      expect(await resolveAt(1_000)).toEqual([]);
      expect(mocks.warn).toHaveBeenCalledTimes(1);
      expect(mocks.warn.mock.calls[0]![0]).toContain("HTTP 503");
      expect(mocks.warn.mock.calls[0]![0]).toContain("running with none");
    });

    it("does not retry on every message: one wait per retry window, one warning", async () => {
      fetchMock.mockRejectedValue(new Error("timeout"));
      await resolveAt(1_000);
      await resolveAt(1_500);
      await resolveAt(1_000 + POLICY_GATES_RETRY_MS - 1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(mocks.warn).toHaveBeenCalledTimes(1);

      fetchMock.mockResolvedValue(answer(WIRE));
      const recovered = await resolveAt(1_000 + POLICY_GATES_RETRY_MS);
      expect(recovered).toHaveLength(2);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("a malformed answer never replaces a good set with an empty one", async () => {
      await resolveAt(1_000);
      fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ nope: true }) });
      const gates = await resolveAt(1_000 + POLICY_GATES_TTL_MS);
      expect(gates).toHaveLength(2);
      expect(mocks.warn.mock.calls[0]![0]).toContain("malformed");
    });
  });

  it("a hung fetch is bounded by the abort timeout: the run proceeds on what it holds and warns", async () => {
    const abort = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(abort.signal);
    // a server that accepts the connection and never answers; it settles only when the signal fires
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted due to timeout")));
        }),
    );

    const pending = resolveAt(1_000);
    expect(timeout).toHaveBeenCalledWith(POLICY_GATES_FETCH_TIMEOUT_MS);
    abort.abort();

    expect(await pending).toEqual([]);
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0]![0]).toContain("aborted due to timeout");
  });

  it("times a slow answer from when it arrived, not from when the request left", async () => {
    fetchMock.mockImplementation(async () => {
      vi.setSystemTime(1_000 + 50_000); // the answer takes 50s
      return answer(WIRE);
    });
    await resolveAt(1_000);
    fetchMock.mockClear();

    await resolveAt(1_000 + 70_000); // 20s after it arrived, 70s after the request left
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a re-linked host does not inherit the previous tenant's gates", async () => {
    await resolveAt(1_000);
    mocks.link.mockReturnValue({ ...LINK, apiKey: "bfk_other_tenant" });
    fetchMock.mockRejectedValue(new Error("down"));
    expect(await resolveAt(1_000 + 1)).toEqual([]);
  });
});

describe("forUnattendedRun", () => {
  const gates = [
    { id: "ask-first", effect: "require-approval" as const, tool: "exec", reason: "needs a person" },
    { id: "no-write", effect: "block" as const, tool: "write" },
    { id: "careful", effect: "inject-directive" as const, directive: "Be careful." },
  ];

  it("turns an approval gate into a refusal on the same tool and leaves the rest alone", () => {
    const out = forUnattendedRun(gates, true);
    expect(out[0]).toEqual({ id: "ask-first", effect: "block", tool: "exec", reason: "needs a person" });
    expect(out[1]).toBe(gates[1]);
    expect(out[2]).toBe(gates[2]);
  });

  it("is the identity for an attended run", () => {
    expect(forUnattendedRun(gates, false)).toBe(gates);
  });
});
