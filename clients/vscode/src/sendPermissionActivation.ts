/**
 * G12 activation wiring: the ONE place the host's administrative send permission is bound
 * into the durable outbox store.
 *
 * The gate itself already works — `write-outbox` refuses a denied send, and
 * `outboxStorage.ts` holds one stable permission that every durable outbox reads at send
 * time. What was missing is the HOST binding: nothing called
 * `bindOutboxSendPermission`, so the gate had no administrative source and switching to
 * Local only stopped nothing. This module is the seam that takes the permission the
 * platform policy produces (`platformSendPermission`: open while the mode reaches the
 * platform — NOT the sync switch) and installs it as the store's gate, so the policy's
 * transitions (including a revoke, mid-flush) reach every durable PLATFORM outbox built
 * at module load — activity signals, error reports, queued chat turns, run outcomes. The
 * Brain step rows are not among them: in the editor they are written to the local store.
 *
 * It is a module of its own (rather than a line inside `activate`) so it can be exercised
 * without the extension host: `activate` needs `vscode` and every surface it registers.
 */

import { bindOutboxSendPermission, boundOutboxSendPermission } from "./outboxStorage";

/**
 * What the admin policy exposes: `platformSendPermission(policy)` in `platformPolicy.ts`
 * is exactly this, so the real policy can be handed in unchanged. Declared here rather
 * than imported so this seam carries no dependency on `vscode`.
 */
export interface SendPermissionSource {
  isAllowed(): boolean;
  subscribe(listener: (allowed: boolean) => void): () => void;
}

/**
 * Install `permission` as the gate every durable outbox is read through, and return a
 * Disposable for the extension context.
 *
 * Binding is not a copy: the outboxes read whatever is bound at SEND time, so an outbox
 * built before activation still sees this permission, and a revoke that lands later still
 * aborts a flush already in flight.
 *
 * Disposing clears the binding ONLY if this binding is still the live one — a later bind
 * must not be undone by an earlier owner's dispose. A cleared store is left in its
 * fail-closed state (see `outboxStorage.ts`), never reopened.
 */
export function bindOutboxSendPermissionAtActivation(
  permission: SendPermissionSource,
): { dispose(): void } {
  bindOutboxSendPermission(permission);
  return {
    dispose: () => {
      if (boundOutboxSendPermission() === permission) bindOutboxSendPermission(null);
    },
  };
}