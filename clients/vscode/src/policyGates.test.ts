import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";

const fetchPolicyGates = vi.fn();
vi.mock("./bfApi", () => ({ fetchPolicyGates: (...a: unknown[]) => fetchPolicyGates(...a) }));

import { POLICY_GATES_FRESH_MS, POLICY_GATES_STALE_MS, PolicyGatesUnavailableError, configurePolicyGatesPersistence, resetPolicyGatesCache, resolveRunPolicyGates } from "./policyGates";
import { createPolicyGatesPersistence, loadPolicySnapshot, snapshotPermitsOfflineRun } from "./policySnapshots";

const secrets = {} as never;

beforeEach(() => {
  fetchPolicyGates.mockReset();
  resetPolicyGatesCache();
  configurePolicyGatesPersistence(undefined);
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

/**
 * G09 — signing out clears the in-memory cache. A previously managed project must
 * still be governed by its durable snapshot, not refused for having no memory left.
 */
describe("resolveRunPolicyGates snapshot survives sign-out", () => {
  const gates = [{ id: "g", tool: "run_command", effect: "block" as const }];
  const readAt = 1_700_000_000_000;

  it("permits an offline run from the durable snapshot after the in-memory cache is cleared", async () => {
    const store = createMemoryLocalFirstStore();
    configurePolicyGatesPersistence(createPolicyGatesPersistence(store, {
      deviceId: "device-1",
      now: () => new Date(readAt),
    }));
    fetchPolicyGates.mockResolvedValueOnce(gates);
    await expect(resolveRunPolicyGates(secrets, 7, readAt)).resolves.toEqual(gates);

    resetPolicyGatesCache();
    const held = await loadPolicySnapshot(store, "project:7");
    expect(held?.payload.gates).toEqual(gates);
    expect(snapshotPermitsOfflineRun(held!.payload, new Date(readAt + POLICY_GATES_STALE_MS))).toBe(true);

    fetchPolicyGates.mockRejectedValueOnce(new Error("offline"));
    await expect(resolveRunPolicyGates(secrets, 7, readAt + POLICY_GATES_STALE_MS)).resolves.toEqual(gates);
  });

  it("still fails closed when sign-out cleared the cache and no snapshot was saved", async () => {
    configurePolicyGatesPersistence(createPolicyGatesPersistence(createMemoryLocalFirstStore(), { deviceId: "device-1" }));
    fetchPolicyGates.mockRejectedValueOnce(new Error("offline"));
    await expect(resolveRunPolicyGates(secrets, 7, readAt)).rejects.toBeInstanceOf(PolicyGatesUnavailableError);
  });
});

describe("activation wires policy snapshot persistence", () => {
  it("calls configurePolicyGatesPersistence from activate", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "extension.ts"), "utf8");
    const activate = source.slice(source.indexOf("export function activate"));
    expect(activate).toMatch(/configurePolicyGatesPersistence\(\s*createPolicyGatesPersistence\(/);
  });
});
