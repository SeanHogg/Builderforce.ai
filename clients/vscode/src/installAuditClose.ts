/**
 * Host installer for local audit close (G08).
 *
 * Re-export shim over `planAuditClose`, `closeAuditLocally`, `refuseCloudLaunch`,
 * and `readClosedAudit`. Nothing is written, and nothing is launched, until a
 * helper is called.
 *
 * Not called from extension activation. `extension.ts` is shared and must not be
 * edited from this slice, so `activate` does not push this installer. A completed
 * local audit therefore still has no durable closed-locally state on the live
 * path, and nothing here stops a cloud audit launch at activation.
 *
 * This module imports no editor API, calls no network, and starts no cloud audit.
 */
import {
  closeAuditLocally,
  planAuditClose,
  readClosedAudit,
  refuseCloudLaunch,
} from "./auditCloseCheckpoint";

/**
 * The line activation would push onto `context.subscriptions`. It is not present
 * in `extension.ts`. Installing remains idempotent and disposable so a later
 * activation edit can hold it without this module importing `vscode`.
 */
export const EXTENSION_ACTIVATION_LINE = "context.subscriptions.push(installAuditClose());";

export interface InstalledAuditClose {
  readonly planAuditClose: typeof planAuditClose;
  readonly closeAuditLocally: typeof closeAuditLocally;
  readonly refuseCloudLaunch: typeof refuseCloudLaunch;
  readonly readClosedAudit: typeof readClosedAudit;
}

const installed: InstalledAuditClose = {
  planAuditClose,
  closeAuditLocally,
  refuseCloudLaunch,
  readClosedAudit,
};

/**
 * Install the existing local-close helpers. Idempotent: a second call returns
 * the same helpers and does not close, read, or launch.
 *
 * The result is a disposable so activation can hold it for the host's lifetime.
 * Disposal is intentionally a no-op — the helpers are pure module-level bindings
 * with no subscription, listener or handle to release. Calling this does not
 * install the path into activation; that wiring is still missing.
 */
export function installAuditClose(): InstalledAuditClose & { dispose(): void } {
  return Object.assign(installed, {
    dispose(): void {
      // Nothing to release: installing only exposes pure helpers.
    },
  });
}
