/**
 * The one seam: `runEmbeddedAgent` — where channel, cron and command runs converge — holds
 * every run to the tenant's governance gates.
 */
import "./run.overflow-compaction.mocks.shared.js";
import type { PolicyGate } from "@builderforce/agent-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveGates: vi.fn() }));
vi.mock("../../infra/host-policy-gates.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../infra/host-policy-gates.js")>()),
  resolveHostPolicyGates: mocks.resolveGates,
}));

import { runEmbeddedAgent } from "./run.js";
import { runEmbeddedAttempt } from "./run/attempt.js";

const mockedAttempt = vi.mocked(runEmbeddedAttempt);

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

  it("a model probe is not a governed run and costs no fetch", async () => {
    await runEmbeddedAgent({ ...base, sessionId: "probe-abc", runId: "r4" });

    expect(mocks.resolveGates).not.toHaveBeenCalled();
    expect(mockedAttempt.mock.calls[0]![0]).not.toHaveProperty("policyGates");
  });
});
