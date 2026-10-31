/**
 * The one seam: `runEmbeddedAgent` — where channel, cron and CLI runs converge — holds a
 * run to the tenant's governance gates unless its caller named its own.
 */
import "./run.overflow-compaction.mocks.shared.js";
import type { PolicyGate } from "@builderforce/agent-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolveGates: vi.fn() }));
vi.mock("../../infra/host-policy-gates.js", () => ({ resolveHostPolicyGates: mocks.resolveGates }));

import { runEmbeddedAgent } from "./run.js";
import { runEmbeddedAttempt } from "./run/attempt.js";

const mockedAttempt = vi.mocked(runEmbeddedAttempt);

const tenantGates: PolicyGate[] = [{ id: "no-shell", tool: "exec", effect: "block", reason: "off" }];
const ownGates: PolicyGate[] = [{ id: "dispatch-gate", tool: "write", effect: "block" }];

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

  it("a caller that names its own gates keeps them, and no fetch is made", async () => {
    await runEmbeddedAgent({ ...base, sessionId: "dispatch-1", runId: "r2", policyGates: ownGates });

    expect(mocks.resolveGates).not.toHaveBeenCalled();
    expect(mockedAttempt.mock.calls[0]![0]).toMatchObject({ policyGates: ownGates });
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
