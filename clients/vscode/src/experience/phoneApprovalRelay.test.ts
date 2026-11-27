import { describe, expect, it, vi } from "vitest";
import { CLOSE_NOTE, POLL_MS, createPhoneApprovalRelay, type ApprovalsHttp, type RelayRequest } from "./phoneApprovalRelay";

const req: RelayRequest = { runId: "r1", skill: "Invoice", step: 3, action: "click Send", description: "Send the invoice?", expiresInMs: 900_000 };

function setup(statuses: Array<string | Error>, active = true) {
  const queue = [...statuses];
  const http: ApprovalsHttp = {
    create: vi.fn(async () => ({ approvalId: "a1" })),
    get: vi.fn(async () => {
      const next = queue.shift() ?? "pending";
      if (next instanceof Error) throw next;
      return { status: next };
    }),
    resolve: vi.fn(async () => ({})),
  };
  const sleeps: number[] = [];
  const report = vi.fn();
  const relay = createPhoneApprovalRelay({
    http,
    isActive: () => active,
    now: () => 1_000_000,
    sleep: async (ms) => void sleeps.push(ms),
    report,
  });
  return { http, relay, sleeps, report };
}

describe("phoneApprovalRelay.open", () => {
  it("posts a synapse.step approval carrying the run, skill, step and action, expiring after the window", async () => {
    const { http, relay } = setup([]);
    expect(await relay.open(req)).toBe("a1");
    expect(http.create).toHaveBeenCalledWith({
      actionType: "synapse.step",
      description: "Send the invoice?",
      metadata: { runId: "r1", skill: "Invoice", step: 3, action: "click Send" },
      expiresAt: new Date(1_000_000 + 900_000).toISOString(),
    });
  });

  it("does nothing while the relay is off (signed out or phone approvals disabled)", async () => {
    const { http, relay } = setup([], false);
    expect(await relay.open(req)).toBeUndefined();
    expect(http.create).not.toHaveBeenCalled();
  });

  it("reports a failed post and answers undefined", async () => {
    const { http, relay, report } = setup([]);
    const boom = new Error("500");
    (http.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(boom);
    expect(await relay.open(req)).toBeUndefined();
    expect(report).toHaveBeenCalledWith(boom, "phoneApprovals:open");
  });
});

describe("phoneApprovalRelay.answer", () => {
  it("polls every 3 s while pending, then maps approved to true", async () => {
    const { relay, sleeps } = setup(["pending", "pending", "approved"]);
    expect(await relay.answer("a1", new AbortController().signal)).toBe(true);
    expect(sleeps).toEqual([POLL_MS, POLL_MS]);
  });

  it.each(["rejected", "expired"])("maps %s to false", async (status) => {
    const { relay } = setup([status]);
    expect(await relay.answer("a1", new AbortController().signal)).toBe(false);
  });

  it("keeps polling through a failed read, reporting it", async () => {
    const { relay, report } = setup([new Error("blip"), "approved"]);
    expect(await relay.answer("a1", new AbortController().signal)).toBe(true);
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("stops polling once aborted and answers undefined", async () => {
    const { http, relay } = setup([]);
    const ac = new AbortController();
    const sleep = vi.fn(async () => ac.abort());
    const aborting = createPhoneApprovalRelay({ http, isActive: () => true, now: () => 0, sleep, report: vi.fn() });
    expect(await aborting.answer("a1", ac.signal)).toBeUndefined();
    expect(http.get).toHaveBeenCalledTimes(1);
  });
});

describe("phoneApprovalRelay.close", () => {
  it("resolves the approval with the Synapse note, approve or reject", async () => {
    const { http, relay } = setup([]);
    await relay.close("a1", true);
    await relay.close("a1", false);
    expect(http.resolve).toHaveBeenNthCalledWith(1, "a1", "approve", CLOSE_NOTE);
    expect(http.resolve).toHaveBeenNthCalledWith(2, "a1", "reject", CLOSE_NOTE);
  });

  it("reports a failed PATCH instead of throwing", async () => {
    const { http, relay, report } = setup([]);
    (http.resolve as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("409"));
    await expect(relay.close("a1", true)).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledWith(expect.any(Error), "phoneApprovals:close");
  });
});
