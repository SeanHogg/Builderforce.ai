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
    // timed out reads as timed out, not as a person's no
    expect(textOf(result)).toContain("No approver answered");
    expect(textOf(result)).toContain("ask-first");
    expect(textOf(result)).not.toContain("declined");
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
    const produced = await prompting;

    // far inside the 60s bound: the stop ended the wait, not the timer
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(ran).toEqual([]);
    // and the refusal reads as a stop, not as a person's no
    const result = produced.find((m) => m.role === "toolResult");
    expect(result).toBeDefined();
    expect(textOf(result)).toContain("stopped");
    expect(textOf(result)).not.toContain("declined");
  });

  it("a Stop that has already happened posts nothing for the dead run", async () => {
    linkWithApprovalGate();
    const stopped = new AbortController();
    stopped.abort();

    const answer = await approvalGate.request({ actionType: "tool.exec", description: "run it", failClosed: true, signal: stopped.signal });

    expect(answer.decision).toBe("rejected");
    expect(approvalRequests).toBe(0);
  });

  it("a Stop while the request is still in flight abandons it: refused, never auto-approved, nothing left waiting", async () => {
    approvalGate.init({ baseUrl: "https://bf.test", agentNodeId: "7", apiKey: "bfk_k" });
    // an api that accepts the connection and never answers; the request settles only when its signal fires
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      ),
    );
    const stop = new AbortController();

    const asking = approvalGate.request({ actionType: "tool.exec", description: "run it", signal: stop.signal });
    stop.abort();
    const answer = await asking;

    // a caller that would otherwise auto-approve on a failed request (no failClosed) is still refused
    expect(answer.decision).toBe("rejected");
    expect((approvalGate as unknown as { pending: Map<string, unknown> }).pending.size).toBe(0);
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
