import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchAssignedSpec, pushSpec } from "./spec-sync.js";

const BASE_OPTS = { baseUrl: "https://api.test.com", agentNodeId: "42", apiKey: "testkey" };

describe("spec-sync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the spec when available", async () => {
    const mockSpec = {
      id: "abc",
      goal: "Build feature",
      status: "approved",
      prd: null,
      archSpec: null,
      taskList: null,
      projectId: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ spec: mockSpec }),
      }),
    );
    const result = await fetchAssignedSpec(BASE_OPTS);
    expect(result).toEqual(mockSpec);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.test.com/api/agentNodes/42/spec",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer testkey" }),
      }),
    );
  });

  it("returns null when 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const result = await fetchAssignedSpec(BASE_OPTS);
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const result = await fetchAssignedSpec(BASE_OPTS);
    expect(result).toBeNull();
  });

  it("pushes a spec and returns the created record", async () => {
    const mockSpec = {
      id: "xyz",
      goal: "New goal",
      status: "draft",
      prd: null,
      archSpec: null,
      taskList: null,
      projectId: 1,
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => mockSpec,
      }),
    );
    const result = await pushSpec(BASE_OPTS, { goal: "New goal" });
    expect(result?.goal).toBe("New goal");
  });
});
