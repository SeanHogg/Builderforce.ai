import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { ensureLocalAuditDefinitions, getLocalAuditRun, startLocalAuditRun } from "./localAuditStore";
import { closeAuditLocally, planAuditClose, readClosedAudit, refuseCloudLaunch, type AuditCloseInput } from "./auditCloseCheckpoint";

const IDS = { auditId: "quality-audit", projectId: 7, requestId: "close-1" };

function input(overrides: Partial<AuditCloseInput> = {}): AuditCloseInput {
  return { ...IDS, runFinished: false, hostClosing: false, ...overrides };
}

describe("planAuditClose", () => {
  it("records a local completion and does not launch cloud", () => {
    const plan = planAuditClose(input({ runFinished: true, hostClosing: true }));

    expect(plan).toEqual({
      action: "complete-local",
      checkpoint: {
        ...IDS,
        status: "completed",
        launchCloud: false,
        closedLocally: true,
      },
    });
    expect(plan).not.toHaveProperty("job");
    if (plan.action !== "complete-local") return;
    expect(plan.checkpoint.status).toBe("completed");
    expect(plan.checkpoint.launchCloud).toBe(false);
    expect(plan.checkpoint).not.toHaveProperty("accountId");
  });

  it("prefers a finished local run over an interrupted next-start", () => {
    const plan = planAuditClose(input({ runFinished: true, hostClosing: true, launchCloud: false }));
    expect(plan.action).toBe("complete-local");
    if (plan.action !== "complete-local") return;
    expect(plan.checkpoint.status).toBe("completed");
  });

  it("defers an unfinished host close as a local next-start job", () => {
    const plan = planAuditClose(input({ runFinished: false, hostClosing: true }));

    expect(plan.action).toBe("defer-local");
    if (plan.action !== "defer-local") return;
    expect(plan.job).toEqual({
      ...IDS,
      status: "interrupted",
      launchCloud: false,
      kind: "next-start",
    });
    expect(plan.job.status).not.toBe("completed");
    expect(plan.job.launchCloud).toBe(false);
    expect(plan).not.toHaveProperty("checkpoint");
  });

  it("does not mark an unfinished close completed when the host is not shutting down", () => {
    const plan = planAuditClose(input({ runFinished: false, hostClosing: false }));
    expect(plan.action).toBe("defer-local");
    if (plan.action !== "defer-local") return;
    expect(plan.job.status).toBe("interrupted");
    expect(plan.job.launchCloud).toBe(false);
  });

  it("refuses a cloud launch that has no account", () => {
    const plan = planAuditClose(input({
      launchCloud: true,
      runFinished: true,
      hostClosing: true,
      dispatchAllowed: true,
    }));

    expect(plan).toEqual({ action: "refuse-cloud", reason: "missing-account" });
  });

  it("refuses a cloud launch whose account id is blank", () => {
    const plan = planAuditClose(input({
      launchCloud: true,
      accountId: "   ",
      dispatchAllowed: true,
      hostClosing: true,
    }));

    expect(plan).toEqual({ action: "refuse-cloud", reason: "missing-account" });
  });

  it("refuses a cloud launch without explicit dispatch permission", () => {
    const omitted = planAuditClose(input({
      launchCloud: true,
      accountId: "acct-1",
      runFinished: true,
      hostClosing: true,
    }));
    const denied = planAuditClose(input({
      launchCloud: true,
      accountId: "acct-1",
      dispatchAllowed: false,
      hostClosing: true,
      runFinished: false,
    }));

    expect(omitted).toEqual({ action: "refuse-cloud", reason: "dispatch-not-allowed" });
    expect(denied).toEqual({ action: "refuse-cloud", reason: "dispatch-not-allowed" });
  });

  it("does not launch cloud from close even when identity and dispatch are present", () => {
    const finished = planAuditClose(input({
      launchCloud: true,
      accountId: "acct-1",
      dispatchAllowed: true,
      runFinished: true,
      hostClosing: true,
    }));
    const interrupted = planAuditClose(input({
      launchCloud: true,
      accountId: "acct-1",
      dispatchAllowed: true,
      runFinished: false,
      hostClosing: true,
    }));

    expect(finished.action).toBe("complete-local");
    expect(interrupted.action).toBe("defer-local");
    if (finished.action === "complete-local") expect(finished.checkpoint.launchCloud).toBe(false);
    if (interrupted.action === "defer-local") {
      expect(interrupted.job.launchCloud).toBe(false);
      expect(interrupted.job.status).toBe("interrupted");
    }
    expect(finished).not.toHaveProperty("launch");
    expect(interrupted).not.toHaveProperty("launch");
  });
});

const NOW = "2026-10-19T00:00:00.000Z";

describe("closeAuditLocally", () => {
  it("writes a local-complete state a restarted store can read and refuses cloud", async () => {
    const store = createMemoryLocalFirstStore();
    await ensureLocalAuditDefinitions(store, { deviceId: "dev-1", now: () => new Date(NOW) });
    const closed = await closeAuditLocally({
      store,
      deviceId: "dev-1",
      auditId: "quality-audit",
      projectId: 11,
      runId: "req-close",
      now: NOW,
      source: { surface: "vsix", trigger: "close" },
    });
    expect(closed.record.record.payload.closedLocally).toBe(true);
    expect(closed.record.record.payload.status).toBe("completed");
    expect(closed.cloud).toEqual({ launch: false, reason: "locally_complete" });

    const restarted = createMemoryLocalFirstStore(await store.export());
    const read = await readClosedAudit(restarted, "req-close");
    expect(read?.record.payload.closedLocally).toBe(true);
    expect(read?.record.payload.status).toBe("completed");
    expect(refuseCloudLaunch(read)).toEqual({ launch: false, reason: "locally_complete" });
  });

  it("refuses cloud for an already locally complete audit and does not refuse one that is still open", async () => {
    const store = createMemoryLocalFirstStore();
    await ensureLocalAuditDefinitions(store, { deviceId: "dev-1", now: () => new Date(NOW) });
    await startLocalAuditRun(store, { deviceId: "dev-1", now: () => new Date(NOW) }, {
      auditId: "quality-audit",
      projectId: 11,
      runId: "still-open",
      trigger: "manual",
      source: { surface: "vsix", trigger: "manual" },
    });
    expect(refuseCloudLaunch(await getLocalAuditRun(store, "still-open"))).toEqual({ launch: true });

    const closed = await closeAuditLocally({
      store,
      deviceId: "dev-1",
      auditId: "quality-audit",
      projectId: 11,
      runId: "still-open",
      now: NOW,
      source: { surface: "vsix", trigger: "close" },
    });
    expect(closed.cloud.launch).toBe(false);
    expect(refuseCloudLaunch(await readClosedAudit(store, "still-open"))).toEqual({
      launch: false,
      reason: "locally_complete",
    });
  });

  it("fails if recoverInterruptedAuditRuns is never called from closeAuditLocally", () => {
    const source = readFileSync(new URL("./auditCloseCheckpoint.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const start = source.indexOf("export async function closeAuditLocally");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = source.slice(start);
    expect(body).toMatch(/recoverInterruptedAuditRuns\s*\(/);
    expect(body).not.toMatch(/function recoverInterruptedAuditRuns/);
    // A local close must not be a cloud launch, even as a side effect of recovery.
    expect(source).not.toMatch(/startSystemAudit\s*\(/);
    expect(source).not.toMatch(/systemAuditApi/);
    expect(source).not.toMatch(/\bfetch\s*\(/);
  });

  it("keeps a repeated close local-complete and still refuses a cloud launch", async () => {
    const store = createMemoryLocalFirstStore();
    await ensureLocalAuditDefinitions(store, { deviceId: "dev-1", now: () => new Date(NOW) });
    const args = {
      store,
      deviceId: "dev-1",
      auditId: "quality-audit",
      projectId: 11,
      runId: "req-again",
      now: NOW,
      source: { surface: "vsix" as const, trigger: "close" as const },
    };
    const first = await closeAuditLocally(args);
    const second = await closeAuditLocally(args);

    expect(first.record.record.payload.status).toBe("completed");
    expect(first.record.record.payload.closedLocally).toBe(true);
    expect(first.cloud).toEqual({ launch: false, reason: "locally_complete" });
    expect(second.record.record.payload).toMatchObject({
      status: "completed",
      closedLocally: true,
      trigger: "close",
      checkpoint: { safeToResume: false },
    });
    expect(second.cloud).toEqual({ launch: false, reason: "locally_complete" });
    expect(second.record.record.version).toBe(first.record.record.version);

    const snapshot = await store.export();
    expect(snapshot.events.some((event) => /cloud|startSystemAudit/i.test(event.eventId))).toBe(false);
    const restarted = createMemoryLocalFirstStore(snapshot);
    expect(refuseCloudLaunch(await readClosedAudit(restarted, "req-again"))).toEqual({
      launch: false,
      reason: "locally_complete",
    });
    expect((await readClosedAudit(restarted, "req-again"))?.record.payload.status).toBe("completed");
  });
});
