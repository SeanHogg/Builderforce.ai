import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linked: true,
  throwOn: undefined as string | undefined,
  stop: vi.fn(async (_id: string) => {}),
  queue: vi.fn(async () => true),
  resume: vi.fn(async () => {}),
}));

vi.mock("./knowledgeRoots", () => ({
  reviewedRoots: () => ["r1", "r2"],
  rootById: (id: string) => ({ rootId: id }),
}));
vi.mock("./knowledgeService", () => ({
  linkedKnowledgeClient: () => (mocks.linked ? {} : undefined),
  log: vi.fn(),
  workspaceFolders: () => [],
  openRoot: (_s: unknown, root: { rootId: string }) => {
    if (mocks.throwOn === root.rootId) throw new Error("boom");
    return { pump: { rootId: root.rootId }, manifest: {} };
  },
}));
vi.mock("./knowledgeReplica", () => ({
  stopReplicaPump: mocks.stop,
  queueFirstSyncOnce: mocks.queue,
  resumeReplica: mocks.resume,
}));

import { replicateReviewedRoots } from "./knowledgeReplicate";
import { pendingBinding } from "./pendingBinding";

const context = {
  globalState: { get: () => undefined, update: async () => {} },
  workspaceState: {},
  secrets: {},
} as never;

describe("replicateReviewedRoots + pendingBinding", () => {
  beforeEach(() => {
    mocks.linked = true;
    mocks.throwOn = undefined;
    vi.clearAllMocks();
  });

  it("unlinking stops every root's pump", async () => {
    expect(await replicateReviewedRoots(context, false)).toBe(true);
    expect(mocks.stop.mock.calls.map((c) => c[0])).toEqual(["r1", "r2"]);
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("a root that fails makes the bind report failure", async () => {
    mocks.throwOn = "r2";
    expect(await replicateReviewedRoots(context, true)).toBe(false);
    expect(mocks.queue).toHaveBeenCalledTimes(1);
  });

  it("revoke or sign-out edge stops the pumps; a failed bind is retried", async () => {
    const state = { linked: true };
    const watcher = pendingBinding({
      linkedTo: () => (state.linked ? 7 : undefined),
      onLink: () => replicateReviewedRoots(context, true),
      onUnlink: async () => { await replicateReviewedRoots(context, false); },
    });
    mocks.throwOn = "r1";
    await watcher.check(); // fails: not bound
    mocks.throwOn = undefined;
    await watcher.check(); // retried, now bound
    expect(mocks.queue).toHaveBeenCalledTimes(3);
    state.linked = false; // revoked
    mocks.linked = false;
    await watcher.check();
    expect(mocks.stop.mock.calls.map((c) => c[0])).toEqual(["r1", "r2"]);
  });
});
