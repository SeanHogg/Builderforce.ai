import { describe, expect, it, vi } from "vitest";
import { pendingBinding } from "./pendingBinding";

function harness(initial: { project: boolean; signedIn: boolean; synchronize: boolean; id?: number }) {
  const state = { ...initial, id: initial.id ?? 7 };
  const onLink = vi.fn(async () => true);
  const onUnlink = vi.fn(async () => {});
  const watcher = pendingBinding({
    linkedTo: () => (state.project && state.signedIn && state.synchronize ? state.id : undefined),
    onLink,
    onUnlink,
  });
  return { state, onLink, onUnlink, watcher };
}

describe("pending binding (PRD 41 A2)", () => {
  it("signed out with a selection, then the grant arrives: binds exactly once", async () => {
    const { state, onLink, watcher } = harness({ project: true, signedIn: false, synchronize: false });
    await watcher.check();
    expect(onLink).not.toHaveBeenCalled();
    state.signedIn = true; // signed in, sync still off
    await watcher.check();
    expect(onLink).not.toHaveBeenCalled();
    state.synchronize = true; // the grant arrives
    await watcher.check();
    await watcher.check();
    await watcher.check(); // later capability changes while linked do not rebind
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("a selection change followed by a capability change gives a single bind", async () => {
    const { state, onLink, watcher } = harness({ project: false, signedIn: true, synchronize: true });
    await watcher.check();
    state.project = true; // onProjectChange -> check()
    await watcher.check();
    await watcher.check(); // the capability change that follows
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("concurrent checks coalesce: one bind", async () => {
    const { onLink, watcher } = harness({ project: true, signedIn: true, synchronize: true });
    await Promise.all([watcher.check(), watcher.check(), watcher.check()]);
    expect(onLink).toHaveBeenCalledTimes(1);
  });

  it("revoked sync or sign-out unlinks exactly once, and a regained link binds again", async () => {
    const { state, onLink, onUnlink, watcher } = harness({ project: true, signedIn: true, synchronize: true });
    await watcher.check();
    state.synchronize = false; // revoked
    await watcher.check();
    await watcher.check();
    expect(onUnlink).toHaveBeenCalledTimes(1);
    state.synchronize = true;
    await watcher.check();
    expect(onLink).toHaveBeenCalledTimes(2);
    state.signedIn = false; // sign-out
    await watcher.check();
    expect(onUnlink).toHaveBeenCalledTimes(2);
  });

  it("never unlinks something that was never bound", async () => {
    const { onUnlink, watcher } = harness({ project: true, signedIn: false, synchronize: true });
    await watcher.check();
    await watcher.check();
    expect(onUnlink).not.toHaveBeenCalled();
  });

  it("a failed bind does not count as bound: the next check retries it", async () => {
    const { onLink, onUnlink, watcher } = harness({ project: true, signedIn: true, synchronize: true });
    onLink.mockResolvedValueOnce(false);
    await watcher.check();
    await watcher.check();
    expect(onLink).toHaveBeenCalledTimes(2);
    await watcher.check();
    expect(onLink).toHaveBeenCalledTimes(2); // bound now
    expect(onUnlink).not.toHaveBeenCalled();
  });

  it("a thrown bind is also retried", async () => {
    const { onLink, watcher } = harness({ project: true, signedIn: true, synchronize: true });
    onLink.mockRejectedValueOnce(new Error("boom"));
    await watcher.check();
    await watcher.check();
    expect(onLink).toHaveBeenCalledTimes(2);
  });

  it("switching to another project binds the new one", async () => {
    const { state, onLink, watcher } = harness({ project: true, signedIn: true, synchronize: true, id: 1 });
    await watcher.check();
    state.id = 2;
    await watcher.check();
    expect(onLink).toHaveBeenCalledTimes(2);
  });
});
