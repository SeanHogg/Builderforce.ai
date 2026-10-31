/**
 * A `require-approval` tenant gate on a channel or cron run must not stall the reply. The wait for an approver is bounded
 * (`CHANNEL_APPROVAL_WAIT_MS`), ends when the run is stopped, and never starts at all for a run nobody can approve in time
 * (a memory flush), where the gate refuses at once. In every case the tool does not run and the model reads why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL_APPROVAL_WAIT_MS } from "../run/channelAdapter.js";
import { approvalGate } from "./approval-gate.js";
import { forUnattendedRun, resetHostPolicyGates, resolveHostPolicyGates } from "./host-policy-gates.js";
import { channelAgent, textOf, user } from "./host-policy-gates.testkit.js";

const APPROVAL_GATE = { id: "ask-first", tool: "exec", effect: "require-approval", reason: "needs a person" };

let approvalRequests: number;

/** The host is linked; the api serves the gates, and accepts approval requests that nobody ever answers. */
function linkWithApprovalGate() {
  approvalGate.init({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "bfk_k" });
  approvalRequests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/approval-request")) {
        approvalRequests += 1;
        return { ok: true, status: 200, json: async () => ({ approvalId: `ap-${approvalRequests}` }) };
      }
      return { ok: true, status: 200, json: async () => ({ gates: [APPROVAL_GATE] }) };
    }),
  );
}

beforeEach(() => resetHostPolicyGates());
afterEach(() => {
  (approvalGate as unknown as { baseUrl: string | null }).baseUrl = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a require-approval gate on a channel run", () => {
  it("waits for an approver no longer than the channel bound, then refuses so the model can say so", async () => {
    vi.useFakeTimers();
    linkWithApprovalGate();
    const ran: string[] = [];
    const { agent } = channelAgent(await resolveHostPolicyGates(), ran);

    const prompting = agent.prompt([user("run the build")]);
    await vi.advanceTimersByTimeAsync(CHANNEL_APPROVAL_WAIT_MS - 1);
    expect(approvalRequests).toBe(1);
    expect(ran).toEqual([]);
    // still waiting a moment before the bound: the run has not produced its refusal yet
    let settled = false;
    void prompting.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const produced = await prompting;

    expect(ran).toEqual([]);
    const result = produced.find((m) => m.role === "toolResult") as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("No approver responded in time");
    // the model got to write its reply after the refusal
    expect(produced.at(-1)!.role).toBe("assistant");
  });

  it("stops waiting the moment the run is stopped, and the tool never starts", async () => {
    linkWithApprovalGate();
    const ran: string[] = [];
    const { agent } = channelAgent(await resolveHostPolicyGates(), ran);

    const prompting = agent.prompt([user("run the build")]);
    await vi.waitFor(() => expect(approvalRequests).toBe(1));
    const t0 = Date.now();
    agent.abort();
    await prompting;

    // far inside the 60s bound: the stop ended the wait, not the timer
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(ran).toEqual([]);
  });
});

describe("a require-approval gate on a run nobody can approve (a memory flush)", () => {
  it("refuses at once: no approval is requested and the tool does not run", async () => {
    linkWithApprovalGate();
    const ran: string[] = [];
    const gates = forUnattendedRun(await resolveHostPolicyGates(), true);
    const { agent, seen } = channelAgent(gates, ran);

    const produced = await agent.prompt([user("flush your notes")]);

    expect(approvalRequests).toBe(0);
    expect(ran).toEqual([]);
    expect((seen[0]!.tools ?? []).map((t) => t.name)).not.toContain("exec");
    const result = produced.find((m) => m.role === "toolResult") as unknown as { isError?: boolean };
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("ask-first");
  });
});
