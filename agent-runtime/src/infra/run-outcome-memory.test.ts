import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRunOutcomeFact,
  commitRunOutcomeMemory,
  runOutcomeFactKey,
  type RunOutcomeMemoryConfig,
} from "./run-outcome-memory.js";

const CFG: RunOutcomeMemoryConfig = {
  gatewayUrl: "https://api.example.test",
  apiKey: "k",
  agentHostId: 3,
  projectId: 42,
};

/** A summary comfortably over the twin's MIN_COMMIT_BODY floor. */
const SUMMARY =
  "Created retry.ts and edited handler.ts; wired exponential backoff into the webhook path.";

function mockFetch() {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof vi.fn>, n = 0): Record<string, unknown> {
  return JSON.parse((fetchMock.mock.calls[n]![1] as { body: string }).body);
}

function fetchUrl(fetchMock: ReturnType<typeof vi.fn>, n = 0): string {
  return String(fetchMock.mock.calls[n]![0]);
}

function fetchHeaders(fetchMock: ReturnType<typeof vi.fn>, n = 0): Record<string, string> {
  return (fetchMock.mock.calls[n]![1] as { headers: Record<string, string> }).headers;
}

describe("run-outcome mirror parity with the cloud commitRunMemory", () => {
  afterEach(() => vi.unstubAllGlobals());

  // THE load-bearing assertion: an on-prem fact must be the same KIND of fact a
  // cloud run commits, or "recalled by the next run" is a claim, not a fact.
  it("writes the SAME run-outcome:<scope>:<id> key shape the cloud twin uses", () => {
    expect(runOutcomeFactKey(CFG, "abc123")).toBe("run-outcome:project-42:abc123");
  });

  it("keeps the key stable per run, so a re-delivered completion upserts instead of duplicating", () => {
    expect(runOutcomeFactKey(CFG, "abc123")).toBe(runOutcomeFactKey(CFG, "abc123"));
  });

  it("falls back to 'run' when the run supplied no id, never emitting a dangling key", () => {
    expect(runOutcomeFactKey(CFG, "   ")).toBe("run-outcome:project-42:run");
  });

  it("bounds the id so a runaway caller cannot push the key past a storage limit", () => {
    expect(runOutcomeFactKey(CFG, "x".repeat(400)).length).toBeLessThanOrEqual(
      "run-outcome:project-42:".length + 120,
    );
  });

  it("carries the changed-path line the cloud twin's body carries", () => {
    expect(
      buildRunOutcomeFact({ summary: SUMMARY, writtenPaths: ["retry.ts", "handler.ts"] }),
    ).toContain("changed: retry.ts, handler.ts");
  });

  it("omits the changed-path line for a run that wrote nothing (a read-only run is still a fact)", () => {
    expect(buildRunOutcomeFact({ summary: SUMMARY, writtenPaths: [] })).not.toContain("changed:");
  });

  it("caps the path list at the twin's 25 so one huge run cannot dominate the store", () => {
    const many = Array.from({ length: 60 }, (_, i) => `file-${i}.ts`);
    expect(
      buildRunOutcomeFact({ summary: SUMMARY, writtenPaths: many }).match(/file-/g)!.length,
    ).toBe(25);
  });

  it("never emits a verify line — the embedded runner has no verify step to report", () => {
    expect(buildRunOutcomeFact({ summary: SUMMARY, writtenPaths: ["retry.ts"] })).not.toMatch(
      /verify/i,
    );
  });
});

describe("commitRunOutcomeMemory over the host-key facts door", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reaches the SAME facts door the per-file write-through beliefs already use", async () => {
    const fetchMock = mockFetch();
    const ok = await commitRunOutcomeMemory(CFG, { summary: SUMMARY, runId: "abc123" });
    expect(ok).toBe(true);
    expect(fetchUrl(fetchMock)).toBe("https://api.example.test/api/agent/projects/42/facts");
  });

  it("authenticates as an agent host — Bearer + X-AgentHost-Id, the pair every agent-runtime caller uses", async () => {
    const fetchMock = mockFetch();
    await commitRunOutcomeMemory(CFG, { summary: SUMMARY, runId: "abc123" });
    const headers = fetchHeaders(fetchMock);
    expect(headers["Authorization"]).toBe("Bearer k");
    expect(headers["X-AgentHost-Id"]).toBe("3");
  });

  it("sends the mirrored key as the fact key", async () => {
    const fetchMock = mockFetch();
    await commitRunOutcomeMemory(CFG, { summary: SUMMARY, runId: "abc123" });
    expect(sentBody(fetchMock).key).toBe("run-outcome:project-42:abc123");
  });

  it("returns false — never throws — when the host cannot reach the store", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(commitRunOutcomeMemory(CFG, { summary: SUMMARY, runId: "abc123" })).resolves.toBe(
      false,
    );
  });

  it("no-ops without a config: a host with no project has no store to reach, and its run still finished", async () => {
    const fetchMock = mockFetch();
    await expect(commitRunOutcomeMemory(null, { summary: SUMMARY, runId: "abc123" })).resolves.toBe(
      false,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a fact below the twin's length floor — a four-word 'learning' teaches nothing", async () => {
    const fetchMock = mockFetch();
    await expect(commitRunOutcomeMemory(CFG, { summary: "done", runId: "abc123" })).resolves.toBe(
      false,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a non-ok gateway as a missed write rather than an error the run must handle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    await expect(commitRunOutcomeMemory(CFG, { summary: SUMMARY, runId: "abc123" })).resolves.toBe(
      false,
    );
  });
});
