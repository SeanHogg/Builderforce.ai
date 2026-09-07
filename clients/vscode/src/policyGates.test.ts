import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchPolicyGates = vi.fn();
vi.mock("./bfApi", () => ({ fetchPolicyGates: (...a: unknown[]) => fetchPolicyGates(...a) }));

import { PolicyGatesUnavailableError, resolveRunPolicyGates } from "./policyGates";

const secrets = {} as never;

beforeEach(() => fetchPolicyGates.mockReset());

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
