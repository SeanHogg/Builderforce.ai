import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPolicyGates = vi.fn();
vi.mock("./bfApi", () => ({ fetchPolicyGates: (...a: unknown[]) => fetchPolicyGates(...a) }));

import { POLICY_GATES_FRESH_MS, POLICY_GATES_STALE_MS, PolicyGatesUnavailableError, resetPolicyGatesCache, resolveRunPolicyGates } from "./policyGates";

const secrets = {} as never;

beforeEach(() => {
  fetchPolicyGates.mockReset();
  resetPolicyGatesCache();
});

/**
 * GAP A2 — the one resolver both editor surfaces use. Signed out ⇒ no tenant, so no
 * policy; a readable policy ⇒ its gates; an unreadable one ⇒ refuse (fail-closed,
 * the same rule `RuntimeService.withPolicyGates` applies to cloud dispatch).
 */
describe("resolveRunPolicyGates", () => {
  it("returns the tenant's effective gates for the run's project", async () => {
    const gates = [{ id: "g", tool: "run_command", effect: "block" as const }];
    fetchPolicyGates.mockResolvedValueOnce(gates);
    await expect(resolveRunPolicyGates(secrets, 7)).resolves.toEqual(gates);
    expect(fetchPolicyGates).toHaveBeenCalledWith(secrets, 7);
  });

  it("yields no gates when signed out (no tenant policy applies)", async () => {
    fetchPolicyGates.mockResolvedValueOnce(undefined);
    await expect(resolveRunPolicyGates(secrets, undefined)).resolves.toEqual([]);
  });

  it("fails closed when the policy cannot be read", async () => {
    fetchPolicyGates.mockRejectedValueOnce(new Error("HTTP 503"));
    await expect(resolveRunPolicyGates(secrets, 1)).rejects.toBeInstanceOf(PolicyGatesUnavailableError);
  });
});

/**
 * A turn starts every few seconds and gates change every few days: one read answers
 * the next minute of turns, and a read that FAILS falls back to the last-known policy
 * for ten minutes rather than refusing a turn over a network blip. A project that has
 * never been read still fails closed — there is nothing to hold it to.
 */
describe("resolveRunPolicyGates cache", () => {
  const gates = [{ id: "g", tool: "run_command", effect: "block" as const }];

  it("serves a fresh read from cache without a second round-trip", async () => {
    fetchPolicyGates.mockResolvedValueOnce(gates);
    await resolveRunPolicyGates(secrets, 7, 1_000);
    await expect(resolveRunPolicyGates(secrets, 7, 1_000 + POLICY_GATES_FRESH_MS - 1)).resolves.toEqual(gates);
    expect(fetchPolicyGates).toHaveBeenCalledTimes(1);
  });

  it("re-reads once the fresh window has passed", async () => {
    fetchPolicyGates.mockResolvedValueOnce(gates).mockResolvedValueOnce([]);
    await resolveRunPolicyGates(secrets, 7, 1_000);
    await expect(resolveRunPolicyGates(secrets, 7, 1_000 + POLICY_GATES_FRESH_MS)).resolves.toEqual([]);
    expect(fetchPolicyGates).toHaveBeenCalledTimes(2);
  });

  it("holds the last-known policy when a re-read fails inside the stale window", async () => {
    fetchPolicyGates.mockResolvedValueOnce(gates).mockRejectedValueOnce(new Error("offline"));
    await resolveRunPolicyGates(secrets, 7, 1_000);
    await expect(resolveRunPolicyGates(secrets, 7, 1_000 + POLICY_GATES_FRESH_MS)).resolves.toEqual(gates);
  });

  it("fails closed again once the stale window has passed", async () => {
    fetchPolicyGates.mockResolvedValueOnce(gates).mockRejectedValueOnce(new Error("offline"));
    await resolveRunPolicyGates(secrets, 7, 1_000);
    await expect(resolveRunPolicyGates(secrets, 7, 1_000 + POLICY_GATES_STALE_MS)).rejects.toBeInstanceOf(PolicyGatesUnavailableError);
  });

  it("caches per project, so another project's read does not answer this one", async () => {
    fetchPolicyGates.mockResolvedValueOnce(gates).mockResolvedValueOnce([]);
    await resolveRunPolicyGates(secrets, 7, 1_000);
    await expect(resolveRunPolicyGates(secrets, 8, 1_000)).resolves.toEqual([]);
    expect(fetchPolicyGates).toHaveBeenCalledTimes(2);
  });
});
