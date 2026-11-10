import { describe, expect, it, vi } from "vitest";
import { chatTicketLinkId, createMemoryLocalFirstStore, newLocalRecord, type ExecutionValue, type LocalFirstStore } from "@builderforce/local-first";
import { RUN_DELTA_RELEASE_REFUSED, type RunDelta } from "@builderforce/run-delta";
import { installRunRecovery } from "../installRunRecovery";
import { recordLocalAuditGate } from "../localAuditGate";
import { getLocalAuditRun, startLocalAuditRun } from "../localAuditStore";
import { authorizeRelease, type ReleaseAuthorityDeps } from "./releaseAuthority";
import { releaseHeldRun, type ReleaseHeldRunDeps } from "./releaseHeldRun";
import { readRunDeltas, storeRunDelta, type RunDeltaCard } from "./runDeltaRecords";
import { holdReason } from "./runHoldGate";

const at = new Date("2026-11-10T12:00:00.000Z");
const ctx = () => ({ globalState: { get: () => undefined, update: async () => undefined } });
const hold = { reason: holdReason(["guard-removed"]), rules: ["guard-removed"] };

async function journal(store: LocalFirstStore) {
  const recovery = installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at });
  await recovery.recovered;
  return recovery;
}

function deps(store: LocalFirstStore, recovery: ReleaseHeldRunDeps["recovery"], over: Partial<ReleaseHeldRunDeps> = {}) {
  const posted: RunDeltaCard[] = [];
  const repost = vi.fn(async (runId: string) => { posted.push(...await readRunDeltas(store, { runId })); });
  const log = vi.fn();
  const d: ReleaseHeldRunDeps = {
    recovery, store, journaled: async () => true, releaser: async () => "user-42", repost, log, now: () => at, ...over,
  };
  return { deps: d, repost, posted, log };
}

/** A stored delta of a run whose delta computed `guard-removed` (the record itself claims no hold). */
async function storedDelta(store: LocalFirstStore, runId: string): Promise<void> {
  await storeRunDelta(store, { deviceId: "device-1", at: at.toISOString() }, {
    value: {
      runId, repository: "https://example.test/repo.git", changeSetId: `changeset:${runId}:0000000000000000`, chatId: 7,
      mode: "autonomous", delta: { blocking: ["guard-removed"] } as unknown as RunDelta, computedMs: 1,
    },
    local: { kind: "local", runId, chatId: 7, root: "/repo", repo: "https://example.test/repo.git" },
  });
}

const execution = (store: LocalFirstStore, runId: string) => store.read((tx) => tx.get<ExecutionValue>("execution", runId));

describe("audited release of a held run (PRD 41 §12.5)", () => {
  it("releases a held run: completed, hold kept, waiver added, cards released — and a second release is refused not_held", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    await recovery.recordStarted({ runId: "run-held", chatId: 7 });
    await storedDelta(store, "run-held");
    // Before the hold is journaled, the card is not held (the execution says so, not the record).
    expect((await readRunDeltas(store, { runId: "run-held" }))[0]?.blocked).toBeUndefined();
    await recovery.recordHeld({ runId: "run-held", hold });
    expect((await readRunDeltas(store, { runId: "run-held" }))[0]).toMatchObject({ blocked: { rules: ["guard-removed"] } });
    const { deps: d, posted } = deps(store, recovery);

    const waiver = await releaseHeldRun(d, "run-held");
    expect(waiver).toEqual({ by: "user-42", at: at.toISOString(), rules: ["guard-removed"] });
    expect(posted).toEqual([expect.objectContaining({ runId: "run-held", blocked: { rules: ["guard-removed"] }, released: true })]);
    expect((await readRunDeltas(store, { runId: "run-held" }))[0]?.released).toBe(true);
    expect((await execution(store, "run-held"))?.payload).toMatchObject({ status: "completed", hold, waiver });
    await expect(releaseHeldRun(d, "run-held")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.notHeld);
    expect(await installRunRecovery(ctx(), { store, deviceId: "device-1", now: () => at }).recovered).toEqual([]);
  });

  it("releases an unmeasured hold the same way", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    await recovery.recordStarted({ runId: "run-unmeasured", chatId: 7 });
    await recovery.recordHeld({ runId: "run-unmeasured", hold: { reason: "run_delta_unmeasured", rules: [] } });
    const { deps: d } = deps(store, recovery);
    expect(await releaseHeldRun(d, "run-unmeasured")).toEqual({ by: "user-42", at: at.toISOString(), rules: [] });
  });

  it("refuses a run that is not held at its gate, and writes nothing", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    await recovery.recordStarted({ runId: "run-done", chatId: 7 });
    await recovery.recordFinished({ runId: "run-done", status: "completed" });
    await recovery.recordStarted({ runId: "run-live", chatId: 8 });
    await recovery.recordStarted({ runId: "run-other-hold", chatId: 9 });
    await recovery.recordHeld({ runId: "run-other-hold", hold: { reason: "policy:manual", rules: [] } });
    const { deps: d, repost } = deps(store, recovery);
    for (const runId of ["run-done", "run-live", "run-unknown", "run-other-hold"]) {
      await expect(releaseHeldRun(d, runId)).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.notHeld);
    }
    expect(repost).not.toHaveBeenCalled();
    expect((await execution(store, "run-done"))?.payload.waiver).toBeUndefined();
    expect((await execution(store, "run-live"))?.payload.status).toBe("running");
    expect((await execution(store, "run-other-hold"))?.payload.status).toBe("awaiting_input");
  });

  it("regression: a release that arrives before the hold is journaled waits for it, and is refused pending only when it never lands", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    await recovery.recordStarted({ runId: "run-racing", chatId: 7 });
    // The card is up; the hold write lands a moment after the release was asked for.
    let land!: () => void;
    const landed = new Promise<void>((resolve) => { land = resolve; });
    const { deps: d } = deps(store, recovery, { journaled: async () => { await landed; return true; } });
    const release = releaseHeldRun(d, "run-racing");
    await recovery.recordHeld({ runId: "run-racing", hold });
    land();
    await expect(release).resolves.toMatchObject({ by: "user-42" });

    await recovery.recordStarted({ runId: "run-never", chatId: 7 });
    const { deps: late, repost } = deps(store, recovery, { journaled: async () => false });
    await expect(releaseHeldRun(late, "run-never")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.pending);
    expect(repost).not.toHaveBeenCalled();
  });

  it("answers an unexpected failure as error, and logs it", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await journal(store);
    const { deps: d, log } = deps(store, { recordReleased: async () => { throw new Error("disk full"); } });
    await expect(releaseHeldRun(d, "run-x")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.error);
    expect(log).toHaveBeenCalled();
    void recovery;
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
    expect(await recordLocalAuditGate(store, {}, { runId: "not-an-audit", hold })).toBe(false);
  });
});

describe("who may release a held run (PRD 41 §12.5)", () => {
  const CHAT = "11111111-1111-4111-8111-111111111111";
  const TICKET = "22222222-2222-4222-8222-222222222222";

  async function heldRun(store: LocalFirstStore, runId: string, chatId: number) {
    const recovery = await journal(store);
    await recovery.recordStarted({ runId, chatId });
    await recovery.recordHeld({ runId, hold });
    return recovery;
  }

  /** Chat 7 (client id CHAT) holds a ticket on a board. */
  async function onBoard(store: LocalFirstStore) {
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord({
        id: TICKET, entityType: "ticket", deviceId: "device-1", occurredAt: at.toISOString(), schemaVersion: 1,
        payload: { projectId: "5", title: "Fix auth", status: "todo" },
      }));
      await tx.put(newLocalRecord({
        id: chatTicketLinkId(CHAT, TICKET), entityType: "chat-ticket-link", deviceId: "device-1", occurredAt: at.toISOString(), schemaVersion: 1,
        payload: { chatClientId: CHAT, ticketClientId: TICKET, linkType: "linked" },
      }));
    });
  }

  const authority = (store: LocalFirstStore, over: Partial<ReleaseAuthorityDeps> = {}): ReleaseAuthorityDeps => ({
    store, currentUserId: async () => "user-42", isApprover: async () => false,
    chatClientId: async (chatId) => (chatId === 7 ? CHAT : undefined), ...over,
  });

  it("refuses a signed-out person, or one whose identity cannot be read — never records `local`", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await heldRun(store, "run-a", 8);
    for (const currentUserId of [async () => null, async () => { throw new Error("offline"); }]) {
      const { deps: d } = deps(store, recovery, { releaser: (id) => authorizeRelease(authority(store, { currentUserId }), id) });
      await expect(releaseHeldRun(d, "run-a")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.identityRequired);
    }
    expect((await execution(store, "run-a"))?.payload.waiver).toBeUndefined();
  });

  it("lets the signed-in person release a run on no board", async () => {
    const store = createMemoryLocalFirstStore();
    const recovery = await heldRun(store, "run-b", 8);
    const { deps: d } = deps(store, recovery, { releaser: (id) => authorizeRelease(authority(store), id) });
    expect((await releaseHeldRun(d, "run-b")).by).toBe("user-42");
  });

  it("requires the board's approver authority for a run whose chat holds a board ticket", async () => {
    const store = createMemoryLocalFirstStore();
    await onBoard(store);
    const recovery = await heldRun(store, "run-c", 7);
    const refused = deps(store, recovery, { releaser: (id) => authorizeRelease(authority(store), id) });
    await expect(releaseHeldRun(refused.deps, "run-c")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.notApprover);
    const unknown = deps(store, recovery, { releaser: (id) => authorizeRelease(authority(store, { isApprover: async () => undefined }), id) });
    await expect(releaseHeldRun(unknown.deps, "run-c")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.identityRequired);
    expect((await execution(store, "run-c"))?.payload.status).toBe("awaiting_input");
    const approver = deps(store, recovery, { releaser: (id) => authorizeRelease(authority(store, { isApprover: async () => true }), id) });
    expect((await releaseHeldRun(approver.deps, "run-c")).by).toBe("user-42");
    await expect(releaseHeldRun(approver.deps, "run-c")).rejects.toThrow(RUN_DELTA_RELEASE_REFUSED.notHeld);
  });
});
