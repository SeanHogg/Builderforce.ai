import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchQuotaStatus, checkAndWarnQuota } from "./quota-monitor.js";

const BASE_OPTS = { baseUrl: "https://api.test.com", agentNodeId: "42", apiKey: "testkey" };

describe("quota-monitor", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns quota when fetch succeeds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          period: "30d",
          since: "2026-01-01T00:00:00Z",
          totalInputTokens: 100_000,
          totalOutputTokens: 50_000,
          totalTokens: 150_000,
        }),
      }),
    );
    const result = await fetchQuotaStatus(BASE_OPTS);
    expect(result?.totalTokens).toBe(150_000);
    expect(result?.nearLimit).toBe(false);
  });

  it("marks nearLimit=true when budgetTokens is set and exceeded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          period: "30d",
          since: "2026-01-01T00:00:00Z",
          totalInputTokens: 80_000,
          totalOutputTokens: 20_000,
          totalTokens: 100_000,
          budgetTokens: 110_000,
        }),
      }),
    );
    const result = await fetchQuotaStatus({ ...BASE_OPTS, warnThreshold: 0.8 });
    expect(result?.nearLimit).toBe(true);
    expect(result?.pctUsed).toBeCloseTo(100_000 / 110_000);
  });

  it("returns null on fetch failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const result = await fetchQuotaStatus(BASE_OPTS);
    expect(result).toBeNull();
  });

  it("checkAndWarnQuota does not throw when quota is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(checkAndWarnQuota(BASE_OPTS)).resolves.not.toThrow();
  });
});
