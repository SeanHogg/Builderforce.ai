/**
 * Absolute gate for an administrative send ban.
 *
 * Connectivity is not permission. A revoked permission must not start a send, and a
 * permission that flips to denied during a flush must abort that flush: the send is not
 * acknowledged, it is not retried, and the caller keeps the durable rows. The outbox
 * already aborts the signal it passes to `send`, but a sender that ignores the signal
 * would still resolve and the row would be dropped — {@link guardSend} rejects the flush
 * itself so that cannot happen.
 *
 * This does not cancel a socket or a raw fetch the sender already opened. That is a
 * separate gate (G02).
 */

import type { OutboxSendContext, OutboxSendPermission } from "./types.js";

export type OutboxPermission = "granted" | "revoked";

export interface SendableSplit<T> {
  /** Rows that may leave. Same array reference as `entries` when every row may leave. */
  send: readonly T[];
  /** Rows that stay queued. Same array reference as `entries` when none may leave. */
  held: readonly T[];
}

export const PERMISSION_REVOKED = "permission_revoked";

export function permissionRevokedError(): Error & { code: typeof PERMISSION_REVOKED } {
  const error = new Error(PERMISSION_REVOKED) as Error & { code: typeof PERMISSION_REVOKED };
  error.code = PERMISSION_REVOKED;
  return error;
}

export function isPermissionRevoked(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === PERMISSION_REVOKED;
}

/**
 * Split a batch by permission. Anything other than `"granted"` holds every row. Neither
 * side is a copy: the caller must not mutate the arrays it gets back.
 */
export function filterSendable<T>(entries: readonly T[], permission: OutboxPermission): SendableSplit<T> {
  if (permission === "granted") return { send: entries, held: [] };
  return { send: [], held: entries };
}

/** Throw when permission is anything but granted. A granted permission returns. */
export function assertSendAllowed(permission: OutboxPermission): void {
  if (permission !== "granted") throw permissionRevokedError();
}

/**
 * A permission the outbox can subscribe to. `revoke` notifies listeners so an in-flight
 * {@link guardSend} rejects and the outbox aborts its own signal.
 */
export interface RevokeGate extends OutboxSendPermission {
  permission(): OutboxPermission;
  grant(): void;
  revoke(): void;
}

export function createRevokeGate(initial: OutboxPermission = "granted"): RevokeGate {
  let current: OutboxPermission = initial;
  const listeners = new Set<(allowed: boolean) => void>();
  const notify = (): void => {
    const allowed = current === "granted";
    for (const listener of [...listeners]) listener(allowed);
  };
  return {
    permission: () => current,
    isAllowed: () => current === "granted",
    grant() {
      if (current === "granted") return;
      current = "granted";
      notify();
    },
    revoke() {
      if (current === "revoked") return;
      current = "revoked";
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Run `send` only while `permission` is granted. A permission that is already denied never
 * calls `send`. A permission that flips to denied, or an outer abort (the outbox's own
 * signal), rejects with `permission_revoked` and does not acknowledge a later success.
 * The rejection has no HTTP status, so a durable row is requeued rather than dead-lettered.
 * This function does not schedule a retry.
 */
export function guardSend<T>(
  permission: OutboxSendPermission,
  send: (signal: AbortSignal) => Promise<T> | T,
  outer?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const stop = permission.subscribe((allowed) => {
    if (!allowed) controller.abort();
  });
  const onOuter = (): void => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onOuter, { once: true });
  }
  if (!permission.isAllowed()) controller.abort();

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      stop();
      outer?.removeEventListener("abort", onOuter);
    };
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      fn();
    };
    const failRevoked = (): void => finish(() => reject(permissionRevokedError()));

    if (controller.signal.aborted) {
      failRevoked();
      return;
    }
    controller.signal.addEventListener("abort", failRevoked, { once: true });

    Promise.resolve()
      .then(() => {
        if (settled || !permission.isAllowed()) {
          failRevoked();
          return undefined;
        }
        return send(controller.signal);
      })
      .then(
        (value) => {
          if (settled) return;
          if (!permission.isAllowed() || controller.signal.aborted) failRevoked();
          else finish(() => resolve(value as T));
        },
        (error: unknown) => {
          if (settled) return;
          if (!permission.isAllowed() || controller.signal.aborted) failRevoked();
          else finish(() => reject(error));
        },
      );
  });
}

/**
 * Wrap an outbox `send` so a denied permission cannot acknowledge the batch. The outbox
 * aborts `ctx.signal` when permission flips; senders that ignore that signal still have
 * their flush rejected here, so the durable row stays queued and is not retried while
 * the ban holds.
 */
export function gateOutboxSend<T, K>(
  permission: OutboxSendPermission,
  send: (key: K, items: T[], ctx: OutboxSendContext) => Promise<unknown> | unknown,
): (key: K, items: T[], ctx: OutboxSendContext) => Promise<unknown> {
  return (key, items, ctx) =>
    guardSend(permission, (signal) => send(key, items, { ...ctx, signal }), ctx.signal);
}
