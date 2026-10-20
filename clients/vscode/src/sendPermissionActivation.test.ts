/**
 * G12 wiring test: the seam that binds the platform policy's send permission into the
 * durable outbox store — the piece the previous slice found missing, where the gate
 * worked in the library but nothing installed it in the real host.
 *
 * The point is not that the outbox refuses a revoked send (`outboxStorage.test.ts` proves
 * that); it is that the HOST's permission is the one being read, and that it keeps
 * answering after it is bound — so a `builderforce.platform.synchronize` toggle moves the
 * gate every durable outbox is already holding.
 */

import { afterEach, describe, expect, it } from "vitest";
import { platformSendPermission, createPlatformPolicy } from "@builderforce/local-first";
import {
  bindOutboxSendPermission,
  boundOutboxSendPermission,
  outboxSendPermission,
} from "./outboxStorage";
import { bindOutboxSendPermissionAtActivation } from "./sendPermissionActivation";

/** Leave the module-level store unbound (its fail-closed state) for the next test. */
afterEach(() => bindOutboxSendPermission(null));

describe("bindOutboxSendPermissionAtActivation", () => {
  it("installs the policy's permission as the gate every durable outbox reads", () => {
    const policy = createPlatformPolicy({ synchronize: true });
    const disposable = bindOutboxSendPermissionAtActivation(platformSendPermission(policy));

    // The store now answers from the POLICY, not from its own default.
    expect(boundOutboxSendPermission()).not.toBeNull();
    expect(outboxSendPermission.isAllowed()).toBe(true);

    // Turning `builderforce.platform.synchronize` off closes the gate the outboxes hold.
    policy.set({ synchronize: false });
    expect(outboxSendPermission.isAllowed()).toBe(false);

    policy.set({ synchronize: true });
    expect(outboxSendPermission.isAllowed()).toBe(true);

    disposable.dispose();
  });

  it("forwards the policy's transitions to an already-registered listener", () => {
    const policy = createPlatformPolicy({ synchronize: true });
    const seen: boolean[] = [];
    const stop = outboxSendPermission.subscribe((allowed) => seen.push(allowed));

    const disposable = bindOutboxSendPermissionAtActivation(platformSendPermission(policy));
    // The bind itself reports the current state, so a subscriber built before activation
    // is not left believing the previous permission.
    expect(seen).toEqual([true]);

    policy.set({ synchronize: false });
    policy.set({ synchronize: true });
    expect(seen).toEqual([true, false, true]);

    stop();
    disposable.dispose();
  });

  it("leaves the store fail-closed when the binding is disposed", () => {
    const policy = createPlatformPolicy({ synchronize: true });
    const disposable = bindOutboxSendPermissionAtActivation(platformSendPermission(policy));
    expect(outboxSendPermission.isAllowed()).toBe(true);

    disposable.dispose();
    expect(boundOutboxSendPermission()).toBeNull();
    expect(outboxSendPermission.isAllowed()).toBe(false);
  });

  it("does not let an earlier owner clear a later binding", () => {
    const first = bindOutboxSendPermissionAtActivation(platformSendPermission(createPlatformPolicy()));
    const second = bindOutboxSendPermissionAtActivation(
      platformSendPermission(createPlatformPolicy({ synchronize: true })),
    );

    // Disposing the stale owner must not reopen (or close) the live gate.
    first.dispose();
    expect(boundOutboxSendPermission()).not.toBeNull();
    expect(outboxSendPermission.isAllowed()).toBe(true);

    second.dispose();
    expect(outboxSendPermission.isAllowed()).toBe(false);
  });
});