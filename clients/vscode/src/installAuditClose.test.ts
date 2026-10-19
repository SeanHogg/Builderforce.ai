import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { ensureLocalAuditDefinitions, startLocalAuditRun } from "./localAuditStore";
import { EXTENSION_ACTIVATION_LINE, installAuditClose } from "./installAuditClose";
import { closeAuditLocally } from "./auditCloseCheckpoint";

const NOW = "2026-10-19T00:00:00.000Z";
const here = dirname(fileURLToPath(import.meta.url));

/** Comments are not an install. Only executable source is evidence. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * True only when `activate` contains the install as a statement. A comment, a
 * block comment, or a string that merely quotes the call does not count.
 */
function activateInstallsAuditClose(source: string): boolean {
  const code = stripComments(source);
  const start = code.search(/export function activate\b/);
  if (start < 0) return false;
  const after = code.slice(start + 1);
  const nextExport = after.search(/\nexport (?:async )?function /);
  const body = nextExport < 0 ? code.slice(start) : code.slice(start, start + 1 + nextExport);
  return /(^|\n)\s*context\.subscriptions\.push\(installAuditClose\(\)\);/.test(body);
}

describe("installAuditClose", () => {
  it("returns the existing helpers and does not close or launch on install", () => {
    const installed = installAuditClose();
    expect(installed.planAuditClose).toBeTypeOf("function");
    expect(installed.closeAuditLocally).toBeTypeOf("function");
    expect(installed.refuseCloudLaunch).toBeTypeOf("function");
    expect(installed.readClosedAudit).toBeTypeOf("function");
    expect(installAuditClose()).toBe(installed);
    expect(installed.refuseCloudLaunch(null)).toEqual({ launch: true });
    expect(installed.refuseCloudLaunch(undefined)).toEqual({ launch: true });
  });

  it("reads a completed local close as closed locally and refuses a cloud launch", async () => {
    const store = createMemoryLocalFirstStore();
    await ensureLocalAuditDefinitions(store, { deviceId: "dev-1", now: () => new Date(NOW) });
    const { planAuditClose, closeAuditLocally, readClosedAudit, refuseCloudLaunch } = installAuditClose();

    const plan = planAuditClose({
      auditId: "quality-audit",
      projectId: 11,
      requestId: "req-install-close",
      runFinished: true,
      hostClosing: true,
    });
    expect(plan.action).toBe("complete-local");
    if (plan.action !== "complete-local") return;
    expect(plan.checkpoint).toMatchObject({
      auditId: "quality-audit",
      projectId: 11,
      requestId: "req-install-close",
      status: "completed",
      launchCloud: false,
      closedLocally: true,
    });

    const closed = await closeAuditLocally({
      store,
      deviceId: "dev-1",
      auditId: "quality-audit",
      projectId: 11,
      runId: "req-install-close",
      now: NOW,
      source: { surface: "vsix", trigger: "close" },
    });
    expect(closed.record.record.payload.closedLocally).toBe(true);
    expect(closed.record.record.payload.status).toBe("completed");
    expect(closed.cloud).toEqual({ launch: false, reason: "locally_complete" });

    const read = await readClosedAudit(store, "req-install-close");
    expect(read?.record.payload.closedLocally).toBe(true);
    expect(read?.record.payload.status).toBe("completed");
    expect(refuseCloudLaunch(read)).toEqual({ launch: false, reason: "locally_complete" });

    const restarted = createMemoryLocalFirstStore(await store.export());
    const reread = await readClosedAudit(restarted, "req-install-close");
    expect(reread?.record.payload.closedLocally).toBe(true);
    expect(reread?.record.payload.status).toBe("completed");
    expect(refuseCloudLaunch(reread)).toEqual({ launch: false, reason: "locally_complete" });
  });

  it("does not refuse a cloud launch for an audit that is still open", async () => {
    const store = createMemoryLocalFirstStore();
    await ensureLocalAuditDefinitions(store, { deviceId: "dev-1", now: () => new Date(NOW) });
    const { readClosedAudit, refuseCloudLaunch, closeAuditLocally } = installAuditClose();
    await startLocalAuditRun(store, { deviceId: "dev-1", now: () => new Date(NOW) }, {
      auditId: "quality-audit",
      projectId: 11,
      runId: "still-open",
      trigger: "manual",
      source: { surface: "vsix", trigger: "manual" },
    });
    expect(refuseCloudLaunch(await readClosedAudit(store, "still-open"))).toEqual({ launch: true });

    const closed = await closeAuditLocally({
      store,
      deviceId: "dev-1",
      auditId: "quality-audit",
      projectId: 11,
      runId: "still-open",
      now: NOW,
      source: { surface: "vsix", trigger: "close" },
    });
    expect(closed.record.record.payload.closedLocally).toBe(true);
    expect(closed.cloud).toEqual({ launch: false, reason: "locally_complete" });
    expect(refuseCloudLaunch(await readClosedAudit(store, "still-open"))).toEqual({
      launch: false,
      reason: "locally_complete",
    });
  });

  it("is installed from extension activation and still never reaches the editor or the network", () => {
    // G08: activation MUST install the close path. A close that activation never
    // installs is not a closed ticket — so this assertion is inverted from the state
    // the slice started in. What must NOT change is inertness: installing wires
    // nothing, calls nothing, and launches nothing.
    const extension = readFileSync(resolve(here, "extension.ts"), "utf8");
    expect(activateInstallsAuditClose(extension)).toBe(true);
    expect(activateInstallsAuditClose(`// ${EXTENSION_ACTIVATION_LINE}\nexport function activate() {}\n`)).toBe(false);
    expect(activateInstallsAuditClose(`/* ${EXTENSION_ACTIVATION_LINE} */\nexport function activate() {}\n`)).toBe(false);
    expect(activateInstallsAuditClose(`export function activate() {\n  "${EXTENSION_ACTIVATION_LINE}"\n}\n`)).toBe(false);
    expect(activateInstallsAuditClose(`export function activate() {\n  ${EXTENSION_ACTIVATION_LINE}\n}\n`)).toBe(true);
    const source = readFileSync(resolve(here, "installAuditClose.ts"), "utf8");
    expect(source).not.toMatch(/from ["']vscode["']/);
    expect(source).not.toContain("fetch(");
    expect(source).not.toContain("startSystemAudit");
    expect(source).not.toContain("node:fs");
  });

  it("is disposable so activation can hold it for the host lifetime", () => {
    const installed = installAuditClose();
    expect(installed.dispose).toBeTypeOf("function");
    expect(() => installed.dispose()).not.toThrow();
    // Disposal is a no-op: the helpers stay usable and are still the same bindings.
    expect(installed.closeAuditLocally).toBe(closeAuditLocally);
    expect(installAuditClose()).toBe(installed);
  });
});
