import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, type ExecutionValue, type LocalFirstStore } from "@builderforce/local-first";
import { installRunRecovery } from "../installRunRecovery";
import { getLocalAuditRun, recordLocalAuditGate, startLocalAuditRun } from "../localAuditStore";
import type { RunDelta } from "@builderforce/run-delta";
import { RUN_DELTA_RELEASE_REFUSED } from "../runRecovery";
import { readRunDeltas, storeRunDelta, type RunDeltaCard } from "./runDeltaRecords";
import { releaseHeldRun, releaserOf, type ReleaseHeldRunDeps } from "./releaseHeldRun";
import { holdReason } from "./runHoldGate";

const at = new Date("2026-11-10T12:00:00.000Z");
const ctx = () => ({ globalState: { get: () => undefined, update: async () => undefined } });
const hold = { reason: holdReason(["guard-removed"]), rules: ["guard-removed"] };

async function journal(store: LocalFirstStore) {
  const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
  await recovery.recovered;
  return recovery;
}

function deps(store: LocalFirstStore, recovery: ReleaseHeldRunDeps["recovery"]) {
  const posted: RunDeltaCard[] = [];
  const repost = vi.fn(async (runId: string) => { posted.push(...await readRunDeltas(store, { runId })); });
  return { deps: { recovery, store, by: async () => "user-42", repost, log: vi.fn(), now: () => at } satisfies ReleaseHeldRunDeps, repost, posted };
}

/** A stored delta that held its run on `guard-removed`. */
async function heldDelta(store: LocalFirstStore, runId: string): Promise<void> {
  await storeRunDelta(store, { deviceId: "device-1", at: at.toISOString() }, {
    value: {
      runId, repository: "https://example.test/repo.git", changeSetId: `changeset:${runId}:0000000000000000`, chatId: 7,
      mode: "autonomous", delta: { blocking: ["guard-removed"] } as unknown as RunDelta, computedMs: 1, blocked: { rules: ["guard-removed"] },
    },
    local: { kind: "local", runId, chatId: 7, root: "/repo", repo: "https://example.test/repo.git" },
  });
}

const execution = (store: LocalFirstStore, runId: string) => store.read((tx) => tx.get<ExecutionValue>("execution", runId));

describe("audited release of a held run (PRD 41 §12.5)", () => {
  it("releases a held run: completed, hold kept, waiver added, cards released", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    await recovery.recordStarted({ runId: "run-held", chatId: 7 });
    await recovery.recordHeld({ runId: "run-held", hold });
    await heldDelta(store, "run-held");
    expect((await readRunDeltas(store, { runId: "run-held" }))[0]?.released).toBeUndefined();
    const { deps: d, posted } = deps(store, recovery);

    const waiver = await releaseHeldRun(d, "run-held");
    expect(waiver).toEqual({ by: "user-42", at: at.toISOString(), rules: ["guard-removed"] });
    // The card is posted again, released — and reads back released for a reopened chat.
    expect(posted).toEqual([expect.objectContaining({ runId: "run-held", blocked: { rules: ["guard-removed"] }, released: true })]);
    expect((await readRunDeltas(store, { runId: "run-held" }))[0]?.released).toBe(true);
    const row = await execution(store, "run-held");
    expect(row?.payload).toMatchObject({ status: "completed", hold, waiver });
    // Released once: a second release is refused.
    await expect(releaseHeldRun(d, "run-held")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED);
    // Not interrupted by the next activation.
    expect(await installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at }).recovered).toEqual([]);
  });

  it("refuses a run that is not held at its gate, and writes nothing", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    await recovery.recordStarted({ runId: "run-done", chatId: 7 });
    await recovery.recordFinished({ runId: "run-done", status: "completed" });
    await recovery.recordStarted({ runId: "run-live", chatId: 8 });
    // Held, but for something other than the finalize gate: not releasable here.
    await recovery.recordStarted({ runId: "run-other-hold", chatId: 9 });
    await recovery.recordHeld({ runId: "run-other-hold", hold: { reason: "policy:manual", rules: [] } });
    const { deps: d, repost } = deps(store, recovery);
    for (const runId of ["run-done", "run-live", "run-unknown", "run-other-hold"]) {
      await expect(releaseHeldRun(d, runId)).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED);
    }
    expect(repost).not.toHaveBeenCalled();
    expect((await execution(store, "run-done"))?.payload.waiver).toBeUndefined();
    expect((await execution(store, "run-live"))?.payload.status).toBe("running");
    expect((await execution(store, "run-other-hold"))?.payload.status).toBe("awaiting_input");
  });

  it("puts an audit's hold, then its waiver, on its audit-run record, never moving its status", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    const { runId } = await startLocalAuditRun(store, { deviceId: "device-1", now: () => at }, { auditId: "soc2-audit", trigger: "manual", runId: "audit-run-1" });
    await recovery.recordStarted({ runId, chatId: 7 });
    await recovery.recordHeld({ runId, hold });
    expect(await recordLocalAuditGate(store, { now: () => at }, { runId, hold })).toBe(true);
    expect((await getLocalAuditRun(store, runId))?.record.payload.hold).toEqual(hold);

    const { deps: d } = deps(store, recovery);
    const waiver = await releaseHeldRun(d, runId);
    const audit = (await getLocalAuditRun(store, runId))?.record.payload;
    expect(audit).toMatchObject({ hold, waiver });
    expect(audit?.status).toBe("running");
    // A run that is not an audit's: nothing written.
    expect(await recordLocalAuditGate(store, {}, { runId: "not-an-audit", hold })).toBe(false);
  });

  it("names the releaser by the signed-in user id, else local", async () => {
    expect(await releaserOf(async () => "user-7")).toBe("user-7");
    expect(await releaserOf(async () => null)).toBe("local");
    expect(await releaserOf(async () => { throw new Error("offline"); })).toBe("local");
  });
});
