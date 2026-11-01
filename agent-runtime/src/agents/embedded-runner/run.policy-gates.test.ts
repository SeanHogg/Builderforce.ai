/**
 * The one seam: `runEmbeddedAgent` — where channel, cron and command runs converge — holds
 * every run to the tenant's governance gates.
 */
import "./run.overflow-compaction.mocks.shared.js";
import type { PolicyGate } from "@builderforce/agent-tools";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The REAL resolver runs (probe skip, unattended conversion, TTL cache): only the host's link and the api's answer are faked.
// `resolveGates` stands for the api's answer and counts the fetches.
const mocks = vi.hoisted(() => ({ resolveGates: vi.fn() }));
vi.mock("../../infra/approval-gate.js", () => ({ hostLink: () => ({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "k" }) }));

import { resetHostPolicyGates } from "../../infra/host-policy-gates.js";
import { runEmbeddedAgent } from "./run.js";
import { runEmbeddedAttempt } from "./run/attempt.js";

const mockedAttempt = vi.mocked(runEmbeddedAttempt);

beforeEach(() => {
  resetHostPolicyGates();
  vi.stubGlobal("fetch", async () => ({ ok: true, status: 200, json: async () => ({ gates: await mocks.resolveGates() }) }));
});
afterEach(() => vi.unstubAllGlobals());

const tenantGates: PolicyGate[] = [{ id: "no-shell", tool: "exec", effect: "block", reason: "off" }];
const approvalGates: PolicyGate[] = [{ id: "ask-first", tool: "exec", effect: "require-approval", reason: "needs a person" }];

function finishedAttempt() {
  mockedAttempt.mockResolvedValue({
    aborted: false,
    promptError: null,
    timedOut: false,
    sessionIdUsed: "s",
    assistantTexts: ["ok"],
    lastAssistant: { usage: { input: 1, output: 1, total: 2 }, stopReason: "end_turn" },
    attemptUsage: { input: 1, output: 1, total: 2 },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

const base = {
  sessionKey: "agent:main:telegram:dm:1",
  sessionFile: "/tmp/session.json",
  workspaceDir: "/tmp/workspace",
  prompt: "hello",
  timeoutMs: 30_000,
};

describe("a run a governance gate refused is not auto-continued", () => {
  // An execution-looking prompt, a tool error, and no reply text: exactly what the continuation policy re-runs.
  const stalled = (over: Record<string, unknown> = {}) => ({
    aborted: false,
    promptError: null,
    timedOut: false,
    sessionIdUsed: "s",
    assistantTexts: [],
    toolMetas: [{ toolName: "exec" }],
    lastToolError: { toolName: "exec", error: "refused" },
    lastAssistant: { usage: { input: 1, output: 1, total: 2 }, stopReason: "stop" },
    attemptUsage: { input: 1, output: 1, total: 2 },
    ...over,
  });
  const run = () => runEmbeddedAgent({ ...base, sessionId: "channel-9", runId: "r9", prompt: "implement the change and run the tests" });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveGates.mockResolvedValue(tenantGates);
  });

  it("control: the same stalled run IS continued when no gate refused it (so the flag is what stops it)", async () => {
    mockedAttempt.mockResolvedValue(stalled() as never);
    await run();
    expect(mockedAttempt.mock.calls.length).toBeGreaterThan(1);
  });

  it("a gate refused one of its calls: it runs once and the refusal is named on the result", async () => {
    mockedAttempt.mockResolvedValue(stalled({ governanceRefusals: ["no-shell"] }) as never);
    const result = await run();

    expect(mockedAttempt).toHaveBeenCalledTimes(1);
    expect(result.meta.agentMeta?.governanceRefusals).toEqual(["no-shell"]);
  });

  it("it ended as a failed run (budget or breaker): it runs once", async () => {
    mockedAttempt.mockResolvedValue(
      stalled({ lastAssistant: { stopReason: "stop", runFailed: true, content: [{ type: "text", text: "The run ended without a reply." }], usage: { input: 1, output: 1, total: 2 } } }) as never,
    );
    await run();

    expect(mockedAttempt).toHaveBeenCalledTimes(1);
  });
});

describe("runEmbeddedAgent governance gates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveGates.mockResolvedValue(tenantGates);
    finishedAttempt();
  });

  it("hands a channel or cron run (no gates of its own) the tenant's gates", async () => {
    await runEmbeddedAgent({ ...base, sessionId: "channel-1", runId: "r1" });

    expect(mocks.resolveGates).toHaveBeenCalledTimes(1);
    expect(mockedAttempt.mock.calls[0]![0]).toMatchObject({ policyGates: tenantGates });
  });

  it("an attended run keeps an approval gate as it is", async () => {
    mocks.resolveGates.mockResolvedValue(approvalGates);
    await runEmbeddedAgent({ ...base, sessionId: "channel-3", runId: "r2" });

    expect(mockedAttempt.mock.calls[0]![0]).toMatchObject({ policyGates: approvalGates });
  });

  it("a memory flush (unattended) has its approval gate refuse at once, and a block gate unchanged", async () => {
    mocks.resolveGates.mockResolvedValue([...approvalGates, ...tenantGates]);
    await runEmbeddedAgent({ ...base, sessionId: "flush-1", runId: "r5", unattended: true });

    expect(mockedAttempt.mock.calls[0]![0]).toMatchObject({
      policyGates: [{ id: "ask-first", tool: "exec", effect: "block", reason: "needs a person" }, tenantGates[0]],
    });
  });

  it("a host with no gates passes none (the session is not handed an empty list)", async () => {
    mocks.resolveGates.mockResolvedValue([]);
    await runEmbeddedAgent({ ...base, sessionId: "channel-2", runId: "r3" });

    expect(mockedAttempt.mock.calls[0]![0]).not.toHaveProperty("policyGates");
  });

  it("a client-chosen `probe-` session id does NOT skip governance: the gateway takes any sessionId from a client", async () => {
    await runEmbeddedAgent({ ...base, sessionId: "probe-client-picked", runId: "r6" });

    expect(mocks.resolveGates).toHaveBeenCalledTimes(1);
    expect(mockedAttempt.mock.calls[0]![0]).toMatchObject({ policyGates: tenantGates });
    // and the attempt is not told it is a probe either (its own probe-only behaviour keys on the flag, not the prefix)
    expect(mockedAttempt.mock.calls[0]![0]).not.toHaveProperty("modelProbe");
  });

  it("a model probe (set by the host, not by a session id) is not a governed run and costs no fetch", async () => {
    await runEmbeddedAgent({ ...base, sessionId: "probe-abc", runId: "r4", modelProbe: true });

    expect(mocks.resolveGates).not.toHaveBeenCalled();
    expect(mockedAttempt.mock.calls[0]![0]).not.toHaveProperty("policyGates");
    expect(mockedAttempt.mock.calls[0]![0]).toMatchObject({ modelProbe: true });
  });
});
