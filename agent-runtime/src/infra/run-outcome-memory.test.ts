import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRunOutcomeFact,
  checkResultFromToolEvent,
  commitRunOutcomeMemory,
  recordOnPremVerify,
  runOutcomeFactKey,
  type OnPremVerifyEvent,
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

  it("records a verify skip, not a passed check, when the run wrote files but ran no check tool", () => {
    const fact = buildRunOutcomeFact({ summary: SUMMARY, writtenPaths: ["retry.ts"], toolNames: ["read", "edit"] });
    expect(fact).toContain("verify skipped (no_check_ran)");
    expect(fact).not.toMatch(/verify recorded/);
  });

  it("records only the check tools the agent's own loop already ran — never a runtime shell", () => {
    const fact = buildRunOutcomeFact({
      summary: SUMMARY,
      writtenPaths: ["retry.ts"],
      toolNames: ["edit", "test", "test", "exec"],
    });
    expect(fact).toContain("verify recorded: test, exec (agent tools, not a runtime shell)");
  });

  it("skips verify when nothing was written, even if a check tool ran", () => {
    expect(
      buildRunOutcomeFact({ summary: SUMMARY, writtenPaths: [], toolNames: ["test"] }),
    ).toContain("verify skipped (nothing_written)");
  });

  it("records nothing when the run changed nothing and ran no check", () => {
    const fact = buildRunOutcomeFact({ summary: SUMMARY, writtenPaths: [], toolNames: ["read"] });
    expect(fact).not.toContain("verify ");
    expect(fact).not.toContain("changed:");
    const recorded = recordOnPremVerify({ writtenPaths: [], toolNames: ["read"] }, () => {
      throw new Error("must not be called");
    });
    expect(recorded).toEqual({ note: null, outcome: null });
  });
});

describe("record-only on-prem verify", () => {
  it("records the outcome when the tool loop already ran a check", () => {
    const events: OnPremVerifyEvent[] = [];
    const recorded = recordOnPremVerify(
      {
        writtenPaths: ["retry.ts"],
        results: [{ command: "npm test", exitCode: 0 }],
      },
      (event) => events.push(event),
    );
    expect(recorded.note).toContain("verify passed: npm test (exit 0)");
    expect(recorded.note).toContain("agent tools, not a runtime shell");
    expect(recorded.outcome).toMatchObject({
      surface: "on-prem",
      kind: "ran",
      reason: "verify_passed",
      commands: ["npm test"],
      failedCommands: [],
      mayFinish: true,
    });
    expect(events.map((e) => ("type" in e ? e.type : e.toolName))).toEqual([
      "verify_started",
      "in_run_verify",
    ]);
    const timeline = events[1];
    expect(timeline).toMatchObject({ toolName: "in_run_verify", category: "tool" });
    expect(JSON.stringify(events)).not.toContain("verify_completed");
  });

  it("records a failed check without blocking finish", () => {
    const recorded = recordOnPremVerify({
      writtenPaths: ["retry.ts"],
      results: [{ command: "npm run typecheck", exitCode: 1 }],
    });
    expect(recorded.note).toContain("verify failed: npm run typecheck (exit 1)");
    expect(recorded.outcome?.reason).toBe("verify_failed");
    expect(recorded.outcome?.mayFinish).toBe(true);
  });

  it("does not emit verify_started when no check result is in hand", () => {
    const events: OnPremVerifyEvent[] = [];
    const wrote = recordOnPremVerify(
      { writtenPaths: ["retry.ts"], toolNames: ["read", "edit"] },
      (event) => events.push(event),
    );
    expect(wrote.note).toBe("verify skipped (no_check_ran)");
    expect(events).toEqual([]);

    const namedOnly = recordOnPremVerify(
      { writtenPaths: ["retry.ts"], toolNames: ["test", "exec"] },
      (event) => events.push(event),
    );
    expect(namedOnly.note).toContain("verify recorded: test, exec");
    expect(events).toEqual([]);
  });

  it("does not fail the run when the recorder throws", () => {
    expect(() =>
      recordOnPremVerify(
        { writtenPaths: ["retry.ts"], results: [{ command: "run_checks", exitCode: 0 }] },
        () => {
          throw new Error("recorder down");
        },
      ),
    ).not.toThrow();
    const recorded = recordOnPremVerify(
      { writtenPaths: ["retry.ts"], results: [{ command: "run_checks", exitCode: 0 }] },
      () => {
        throw new Error("recorder down");
      },
    );
    expect(recorded.note).toContain("verify passed: run_checks (exit 0)");
    expect(recorded.outcome?.mayFinish).toBe(true);
  });

  it("reads a finished run_checks result and ignores a start or a non-check", () => {
    expect(
      checkResultFromToolEvent({
        phase: "result",
        name: "run_checks",
        isError: false,
        result: { ok: true, ran: true },
      }),
    ).toEqual({ command: "run_checks", exitCode: 0 });
    expect(
      checkResultFromToolEvent({
        phase: "start",
        name: "run_checks",
        args: {},
      }),
    ).toBeNull();
    expect(
      checkResultFromToolEvent({
        phase: "result",
        name: "run_checks",
        result: { ok: false, ran: false },
      }),
    ).toBeNull();
    expect(
      checkResultFromToolEvent(
        { phase: "result", name: "run_command", isError: true },
        { command: "npm test" },
      ),
    ).toEqual({ command: "npm test", exitCode: 1 });
    expect(
      checkResultFromToolEvent(
        { phase: "result", name: "run_command", isError: false, result: { exitCode: 0 } },
        { command: "git status" },
      ),
    ).toBeNull();
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
