import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { DEFAULT_SHIP_POLICY, shipPolicyOf } from "@builderforce/run-guards";

vi.mock("vscode", () => ({ l10n: { t: (m: string) => m } }));
const fetchPolicyGates = vi.fn();
const fetchProjectShipPolicy = vi.fn();
vi.mock("./bfApi", () => ({
  fetchPolicyGates: (...a: unknown[]) => fetchPolicyGates(...a),
  fetchProjectShipPolicy: (...a: unknown[]) => fetchProjectShipPolicy(...a),
  probeEditorKey: async () => "unreachable",
}));

// policyGates reads the stored editor key (signed in vs out) through gateway.ts, which needs the vscode host.
const getApiKey = vi.fn(async (): Promise<string | undefined> => undefined);
vi.mock("./gateway", () => ({ getApiKey: () => getApiKey() }));

import { POLICY_GATES_FRESH_MS, POLICY_GATES_STALE_MS, configurePolicyGatesPersistence, resetPolicyGatesCache, resolveRunPolicyGates, resolveRunShipPolicy } from "./policyGates";
import { createPolicyGatesPersistence, loadPolicySnapshot } from "./policySnapshots";

const secrets = {} as never;
const PR = shipPolicyOf("pull_request", "project_settings");

beforeEach(() => {
  fetchPolicyGates.mockReset();
  fetchProjectShipPolicy.mockReset();
  getApiKey.mockReset();
  getApiKey.mockResolvedValue(undefined);
  resetPolicyGatesCache();
  configurePolicyGatesPersistence(undefined);
});

/** PRD 48: the project's ship policy, read per run through the gates' cache and snapshot. */
describe("resolveRunShipPolicy", () => {
  it("no project ⇒ the default, without a request", async () => {
    const report = vi.fn();
    await expect(resolveRunShipPolicy(secrets, undefined, report)).resolves.toBe(DEFAULT_SHIP_POLICY);
    expect(fetchProjectShipPolicy).not.toHaveBeenCalled();
  });

  it("returns the project's policy, and a fresh read answers the next run from the cache", async () => {
    fetchProjectShipPolicy.mockResolvedValueOnce(PR);
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn(), 1_000)).resolves.toEqual(PR);
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn(), 1_000 + POLICY_GATES_FRESH_MS - 1)).resolves.toEqual(PR);
    expect(fetchProjectShipPolicy).toHaveBeenCalledTimes(1);
  });

  it("a project with no value ⇒ the default (source `default`)", async () => {
    fetchProjectShipPolicy.mockResolvedValueOnce(undefined);
    const policy = await resolveRunShipPolicy(secrets, 7, vi.fn());
    expect(policy).toBe(DEFAULT_SHIP_POLICY);
    expect(policy.source).toBe("default");
  });

  it("an unreachable API with nothing cached ⇒ the default, and the failure is reported", async () => {
    fetchProjectShipPolicy.mockRejectedValueOnce(new Error("offline"));
    const report = vi.fn();
    await expect(resolveRunShipPolicy(secrets, 7, report)).resolves.toBe(DEFAULT_SHIP_POLICY);
    expect(report).toHaveBeenCalledWith(expect.stringContaining("offline"));
  });

  it("a re-read failure inside the stale window keeps a stricter last known policy", async () => {
    const leave = shipPolicyOf("leave_uncommitted", "project_settings");
    fetchProjectShipPolicy.mockResolvedValueOnce(leave).mockRejectedValueOnce(new Error("blip"));
    await resolveRunShipPolicy(secrets, 7, vi.fn(), 0);
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn(), POLICY_GATES_STALE_MS - 1)).resolves.toEqual(leave);
  });

  it("a stale value is never looser than the default: a remembered commit_push only commits", async () => {
    fetchProjectShipPolicy.mockResolvedValueOnce(shipPolicyOf("commit_push", "project_settings")).mockRejectedValueOnce(new Error("blip"));
    await resolveRunShipPolicy(secrets, 7, vi.fn(), 0);
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn(), POLICY_GATES_FRESH_MS + 1)).resolves.toMatchObject({ mode: "commit" });
  });

  it("the durable snapshot answers after a restart, riding the gates' snapshot (narrowed to the default)", async () => {
    const store = createMemoryLocalFirstStore();
    configurePolicyGatesPersistence(createPolicyGatesPersistence(store, { deviceId: "d" }));
    fetchPolicyGates.mockResolvedValueOnce([]);
    await resolveRunPolicyGates(secrets, 7);
    fetchProjectShipPolicy.mockResolvedValueOnce(PR);
    await resolveRunShipPolicy(secrets, 7, vi.fn());
    expect((await loadPolicySnapshot(store, "project:7"))?.payload.shipPolicy).toEqual(PR);
    // A gate re-read keeps the recorded ship policy.
    resetPolicyGatesCache();
    fetchPolicyGates.mockResolvedValueOnce([]);
    await resolveRunPolicyGates(secrets, 7);
    expect((await loadPolicySnapshot(store, "project:7"))?.payload.shipPolicy).toEqual(PR);
    // "Restart": the memory cache is gone and the API is down — the snapshot's pull_request
    // may be out of date, so it ships no further than the default commit.
    resetPolicyGatesCache();
    fetchProjectShipPolicy.mockRejectedValueOnce(new Error("offline"));
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn())).resolves.toMatchObject({ mode: "commit" });
    // A snapshot stricter than the default is kept as it is.
    const leave = shipPolicyOf("leave_uncommitted", "project_settings");
    fetchProjectShipPolicy.mockResolvedValueOnce(leave);
    await resolveRunShipPolicy(secrets, 7, vi.fn());
    resetPolicyGatesCache();
    fetchProjectShipPolicy.mockRejectedValueOnce(new Error("offline"));
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn())).resolves.toEqual(leave);
  });

  const leave = shipPolicyOf("leave_uncommitted", "project_settings");
  const persisted = () => {
    const store = createMemoryLocalFirstStore();
    configurePolicyGatesPersistence(createPolicyGatesPersistence(store, { deviceId: "d" }));
    return store;
  };

  it("regression: signed in + unreadable (undefined) keeps the recorded ship policy and reports the failure", async () => {
    const store = persisted();
    getApiKey.mockResolvedValue("bfk_stored");
    fetchPolicyGates.mockResolvedValueOnce([]);
    await resolveRunPolicyGates(secrets, 7);
    fetchProjectShipPolicy.mockResolvedValueOnce(leave);
    await resolveRunShipPolicy(secrets, 7, vi.fn());
    resetPolicyGatesCache();

    fetchProjectShipPolicy.mockResolvedValueOnce(undefined);
    const report = vi.fn();
    await expect(resolveRunShipPolicy(secrets, 7, report)).resolves.toEqual(leave);
    expect(report).toHaveBeenCalled();
    expect((await loadPolicySnapshot(store, "project:7"))?.payload.shipPolicy).toEqual(leave);
  });

  it("regression: a genuinely unset project (null) still records null and uses the default", async () => {
    const store = persisted();
    getApiKey.mockResolvedValue("bfk_stored");
    fetchPolicyGates.mockResolvedValueOnce([]);
    await resolveRunPolicyGates(secrets, 7);
    fetchProjectShipPolicy.mockResolvedValueOnce(leave);
    await resolveRunShipPolicy(secrets, 7, vi.fn());
    resetPolicyGatesCache();

    fetchProjectShipPolicy.mockResolvedValueOnce(null);
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn())).resolves.toBe(DEFAULT_SHIP_POLICY);
    expect((await loadPolicySnapshot(store, "project:7"))?.payload.shipPolicy ?? null).toBeNull();
  });

  it("regression: signed out ⇒ the default, nothing cached or recorded", async () => {
    const store = persisted();
    fetchPolicyGates.mockResolvedValueOnce([]);
    await resolveRunPolicyGates(secrets, 7);
    fetchProjectShipPolicy.mockResolvedValueOnce(leave);
    getApiKey.mockResolvedValue("bfk_stored");
    await resolveRunShipPolicy(secrets, 7, vi.fn());
    resetPolicyGatesCache();
    getApiKey.mockResolvedValue(undefined);

    fetchProjectShipPolicy.mockResolvedValue(undefined);
    await expect(resolveRunShipPolicy(secrets, 7, vi.fn())).resolves.toBe(DEFAULT_SHIP_POLICY);
    await resolveRunShipPolicy(secrets, 7, vi.fn());
    expect(fetchProjectShipPolicy).toHaveBeenCalledTimes(3); // no cache entry answered the repeat
    expect((await loadPolicySnapshot(store, "project:7"))?.payload.shipPolicy).toEqual(leave);
  });
});
