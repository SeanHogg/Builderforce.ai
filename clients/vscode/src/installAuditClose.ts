/**
 * Host installer for local audit close (G08).
 *
 * Re-export shim over `planAuditClose`, `closeAuditLocally`, `refuseCloudLaunch`,
 * and `readClosedAudit`. Nothing is written, and nothing is launched, until a
 * helper is called.
 *
 * Called from extension activation. `activate` already pushes this installer with
 * `context.subscriptions.push(installAuditClose());` (the first subscription in
 * `extension.ts` `activate`, not a comment). Do not add a second install. The
 * helpers stay inert until called: this module writes nothing and launches nothing
 * on its own.
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
 * The statement `activate` already pushes onto `context.subscriptions`:
 * `context.subscriptions.push(installAuditClose());`. It is executable code in
 * `extension.ts`, not a comment that cites the call.
 * Installing remains idempotent and disposable so activation can hold it without
 * this module importing `vscode`.
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
 * with no subscription, listener or handle to release. Activation already holds
 * this path via `context.subscriptions.push(installAuditClose());` in `activate`.
 * Do not install it a second time.
 */
export function installAuditClose(): InstalledAuditClose & { dispose(): void } {
  return Object.assign(installed, {
    dispose(): void {
      // Nothing to release: installing only exposes pure helpers.
    },
  });
}
