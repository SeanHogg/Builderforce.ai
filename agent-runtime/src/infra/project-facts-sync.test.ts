import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pushProjectFact,
  recallSharedProjectFacts,
  type ProjectFactsSyncConfig,
} from "./project-facts-sync.js";

const CFG: ProjectFactsSyncConfig = {
  gatewayUrl: "https://api.example.test",
  apiKey: "k",
  agentHostId: 3,
  projectId: 42,
};

const KEY = "run-outcome:project-42:abc123";
const CONTENT = "Rewrote the retry path with exponential backoff.\nchanged: src/retry.ts";

/** Mock fetch with an ok response and return the spy. */
function mockFetch(body: Record<string, unknown> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * A gateway that ACCEPTS the connection and never answers: fetch does not settle
 * until the abort signal fires, and if there is no signal it never settles at all
 * — which is exactly the unbounded request the timeout exists to close.
 */
function mockHangingFetch() {
  const fetchMock = vi.fn(
    (_url: string, init: { signal?: AbortSignal } = {}) =>
      new Promise<never>((_resolve, reject) => {
        const signal = init.signal;
        // No signal → this promise never settles: an unbounded request, exactly the bug.
        if (!signal) {
          return;
        }
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Shrink every `AbortSignal.timeout` to a real, tiny duration.
 *
 * NOTE: vitest fake timers CANNOT drive `AbortSignal.timeout` — Node builds that
 * signal from an internal timer the fake clock does not own, so `advanceTimersByTime`
 * leaves `signal.aborted === false` and the real timer still fires afterwards. So the
 * timeout is exercised with REAL timers at a tiny value: the production duration is
 * still asserted separately, by the `timeoutCalls` counter below.
 */
function shrinkTimeouts(realMs = 5): { timeoutCalls: number[] } {
  const timeoutCalls: number[] = [];
  vi.spyOn(AbortSignal, "timeout").mockImplementation(((delayMs?: number) => {
    timeoutCalls.push(delayMs ?? 0);
    // Deliberately does NOT call through to the original: the spy's own property IS
    // `AbortSignal.timeout` by now. A controller + timer builds an equivalent signal.
    const controller = new AbortController();
    setTimeout(controller.abort.bind(controller), realMs);
    return controller.signal;
  }) as typeof AbortSignal.timeout);
  return { timeoutCalls };
}

describe("pushProjectFact", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts the fact to the host-key facts door", async () => {
    const fetchMock = mockFetch();
    expect(await pushProjectFact(CFG, KEY, CONTENT)).toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe("https://api.example.test/api/agent/projects/42/facts");
    expect(init.method).toBe("POST");
    expect(init.headers["Authorization"]).toBe("Bearer k");
    expect(init.headers["X-AgentHost-Id"]).toBe("3");
    const body = JSON.parse(init.body);
    expect(body.key).toBe(KEY);
    expect(body.content).toBe(CONTENT);
    expect(body.source).toBe("onprem");
  });

  it("skips the POST entirely for a blank key or content", async () => {
    const fetchMock = mockFetch();
    expect(await pushProjectFact(CFG, "   ", CONTENT)).toBe(false);
    expect(await pushProjectFact(CFG, KEY, "  ")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns false rather than throwing on a non-ok gateway", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(pushProjectFact(CFG, KEY, CONTENT)).resolves.toBe(false);
  });

  it("returns false rather than throwing when the gateway is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(pushProjectFact(CFG, KEY, CONTENT)).resolves.toBe(false);
  });

  it("BOUNDS the request: aborts after 10s, matching pushMemoryToMesh", async () => {
    const { timeoutCalls } = shrinkTimeouts();
    const fetchMock = mockHangingFetch();

    await pushProjectFact(CFG, KEY, CONTENT);

    // The request must be bounded, and bounded at the sibling's value.
    expect(timeoutCalls).toEqual([10_000]);
    const init = fetchMock.mock.calls[0][1];
    expect(init?.signal).toBeDefined();
    expect(init?.signal?.aborted).toBe(true);
  });

  it("returns false when a non-responding gateway never answers — without hanging", async () => {
    shrinkTimeouts();
    mockHangingFetch();

    // Race against a watchdog: with the timeout present the call wins in ~5ms; with
    // it REMOVED the fetch promise never settles and the watchdog fires instead, so
    // the mutation fails fast and loudly rather than hanging the suite.
    const started = Date.now();
    const result = await Promise.race([
      pushProjectFact(CFG, KEY, CONTENT),
      new Promise<"HUNG">((resolve) => setTimeout(() => resolve("HUNG"), 2_000)),
    ]);
    const elapsed = Date.now() - started;

    // A timeout must be INDISTINGUISHABLE from any other non-ok response: `false`,
    // never a throw — run-outcome-memory.ts handles `false` and any throw alike.
    expect(result).toBe(false);
    expect(elapsed).toBeLessThan(1_000);
  });
});

describe("recallSharedProjectFacts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns the facts array on an ok gateway", async () => {
    mockFetch({ facts: [{ key: "k", content: "c" }] });
    expect(await recallSharedProjectFacts(CFG)).toEqual([{ key: "k", content: "c" }]);
  });

  it("returns [] on a non-ok gateway and never throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(recallSharedProjectFacts(CFG)).resolves.toEqual([]);
  });

  it("returns [] when the gateway throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    await expect(recallSharedProjectFacts(CFG)).resolves.toEqual([]);
  });
});
