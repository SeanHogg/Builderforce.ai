import { beforeEach, describe, expect, it, vi } from "vitest";

const authed = vi.fn();
const reportExtensionError = vi.fn(async () => undefined);
vi.mock("./transport", () => ({ authed: (...a: unknown[]) => authed(...a) }));
vi.mock("../diagnostics/errorReporter", () => ({ reportExtensionError: (...a: unknown[]) => reportExtensionError(...(a as [])) }));

import { createApproval, getApproval, listHumanRequests, resolveHumanRequest } from "./approvals";

const secrets = {} as never;

beforeEach(() => {
  authed.mockReset();
  reportExtensionError.mockClear();
});

describe("listHumanRequests", () => {
  it("defaults to pending and unwraps the approvals array", async () => {
    authed.mockResolvedValueOnce({ approvals: [{ id: "a" }] });
    await expect(listHumanRequests(secrets)).resolves.toEqual([{ id: "a" }]);
    expect(authed).toHaveBeenCalledWith(secrets, "/api/approvals?status=pending");
  });

  it("narrows to an agent host", async () => {
    authed.mockResolvedValueOnce({ approvals: [] });
    await listHumanRequests(secrets, { agentHostId: 7 });
    expect(authed).toHaveBeenCalledWith(secrets, "/api/approvals?status=pending&agentHostId=7");
  });

  it("answers [] when signed out", async () => {
    authed.mockResolvedValueOnce(undefined);
    await expect(listHumanRequests(secrets)).resolves.toEqual([]);
  });

  it("reports a failed read and answers []", async () => {
    const boom = new Error("down");
    authed.mockRejectedValueOnce(boom);
    await expect(listHumanRequests(secrets)).resolves.toEqual([]);
    expect(reportExtensionError).toHaveBeenCalledWith(boom, { operation: "approvals:list" });
  });
});

describe("resolveHumanRequest", () => {
  it("PATCHes approve as approved with the review note", async () => {
    authed.mockResolvedValueOnce({ id: "a1", status: "approved" });
    await resolveHumanRequest(secrets, "a/1", "approve", "ok");
    const [, url, init] = authed.mock.calls[0]!;
    expect(url).toBe("/api/approvals/a%2F1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ status: "approved", reviewNote: "ok" });
  });

  it("sends an answer as responseText", async () => {
    authed.mockResolvedValueOnce({ id: "a1" });
    await resolveHumanRequest(secrets, "a1", "answer", "yes");
    expect(JSON.parse(authed.mock.calls[0]![2].body)).toEqual({ status: "answered", responseText: "yes" });
  });

  it("throws when signed out", async () => {
    authed.mockResolvedValueOnce(undefined);
    await expect(resolveHumanRequest(secrets, "a1", "reject")).rejects.toThrow("not signed in");
  });
});

describe("createApproval / getApproval", () => {
  it("POSTs a kind:approval with the given action", async () => {
    authed.mockResolvedValueOnce({ approvalId: "a9", status: "pending" });
    const r = await createApproval(secrets, { actionType: "synapse.step", description: "d", metadata: { runId: "r" }, expiresAt: "2026-01-01T00:00:00.000Z" });
    expect(r).toEqual({ approvalId: "a9", status: "pending" });
    const [, url, init] = authed.mock.calls[0]!;
    expect(url).toBe("/api/approvals");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toMatchObject({ kind: "approval", actionType: "synapse.step", metadata: { runId: "r" } });
  });

  it("reads one approval's status by id", async () => {
    authed.mockResolvedValueOnce({ status: "approved" });
    await expect(getApproval(secrets, "a9")).resolves.toEqual({ status: "approved" });
    expect(authed).toHaveBeenCalledWith(secrets, "/api/approvals/a9");
  });

  it("throws when signed out", async () => {
    authed.mockResolvedValueOnce(undefined);
    await expect(getApproval(secrets, "a9")).rejects.toThrow("not signed in");
    authed.mockResolvedValueOnce(undefined);
    await expect(createApproval(secrets, { actionType: "x", description: "d" })).rejects.toThrow("not signed in");
  });
});
