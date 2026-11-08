import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import { fakeServer } from "../../../../packages/agent-tools/src/knowledge/replicaTestkit.test-util.js";
import { onPremOnlyPackSpies } from "./onPremKnowledge.pack.testkit.js";
import { onPremKnowledgeRowsHost } from "./onPremKnowledge.js";
import { closeOnPremManifests, flushReplicasOnExit, onPremReplicaHost, onPremRootPorts, resumeQueuedReplicas, type ExitSignals } from "./onPremReplica.js";
import { onPremRootId } from "./index/onPremKnowledgeIndex.js";

const caps = {} as CapabilityProvider;

/** A linked client whose only wire is the pack (`sync*`): every per-file route is a spy that must stay unused. */
function packClient() {
  const server = fakeServer();
  const spies = onPremOnlyPackSpies();
  const client = { ...server.client, ...spies.client, scopes: vi.fn(async () => []), judgeEstimate: vi.fn() } as unknown as KnowledgeClient;
  return { client, server, spies };
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kg-pack-"));
  await mkdir(join(root, "docs"));
  await writeFile(join(root, "docs", "a.md"), "# A\n\nSome words about A.\n");
  return root;
}

afterEach(async () => {
  await onPremReplicaHost().disposeReplicas();
  closeOnPremManifests();
});

describe("the exit flush", () => {
  function fakeProcess() {
    const emitter = new EventEmitter();
    const kill = vi.fn();
    return Object.assign(emitter, { pid: 1, kill }) as unknown as ExitSignals & EventEmitter & { kill: typeof kill };
  }

  it("re-raises the signal only when no other handler owns the exit", async () => {
    const proc = fakeProcess();
    flushReplicasOnExit(proc, 50);
    proc.emit("SIGTERM");
    await new Promise((r) => setTimeout(r, 20));
    expect(proc.kill).toHaveBeenCalledWith(1, "SIGTERM");
  });

  it("leaves the exit to another handler registered for the signal", async () => {
    const proc = fakeProcess();
    proc.once("SIGINT", () => undefined);
    flushReplicasOnExit(proc, 50);
    proc.emit("SIGINT");
    await new Promise((r) => setTimeout(r, 20));
    expect(proc.kill).not.toHaveBeenCalled();
  });
});

describe("resuming queues", () => {
  it("resumes a subfolder root whose queue file records its root id, with no local scope", async () => {
    const root = await workspace();
    const { client } = packClient();
    const host = onPremReplicaHost();
    const sub = onPremRootPorts(root, onPremRootId(root, "docs"), undefined);
    const subId = onPremRootId(root, "docs");
    const queue = host.replicaQueueFor(subId, sub.files);
    await queue.adopt(7);
    await queue.flush(); // writes the root's queue file (recording its root id)
    await host.disposeReplicas();
    const resumed: string[] = [];
    const real = host.resumeReplica.bind(host);
    vi.spyOn(host, "resumeReplica").mockImplementation(async (source) => { resumed.push(source.rootId); return real(source); });
    await resumeQueuedReplicas(root, onPremRootId(root), undefined, { client, projectId: 7 });
    expect(resumed).toContain(subId);
  });
});

describe("the on-prem review uploads ONE pack", () => {
  it("syncs the local store and never writes per file", async () => {
    const root = await workspace();
    const { client, server, spies } = packClient();
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked: { client, projectId: 7 } });
    const session = (await host.openReview("docs"))!;
    const plan = await session.plan(new AbortController().signal);
    await session.review(plan, new AbortController().signal);
    expect(server.syncs().length).toBeGreaterThan(0);
    expect(spies.putExtracted).not.toHaveBeenCalled();
    expect(spies.storePutExtracted).not.toHaveBeenCalled();
    expect(spies.storeWrite).not.toHaveBeenCalled();
  });

  it("an aborted first review on a root the server already holds deletes nothing", async () => {
    const root = await workspace();
    const { client, server } = packClient();
    server.s.leaves.set("f:old.md", "d1"); // the server already holds a leaf the empty local store lacks
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked: { client, projectId: 7 } });
    const session = (await host.openReview("docs"))!;
    const plan = await session.plan(new AbortController().signal);
    const abort = new AbortController();
    abort.abort();
    await session.review(plan, abort.signal).catch(() => undefined);
    await onPremReplicaHost().disposeReplicas();
    for (const sync of server.syncs()) {
      const deletes = (sync as { pack?: { deletes?: { files?: string[]; facts?: unknown[]; relations?: unknown[] } } }).pack?.deletes;
      expect((deletes?.files?.length ?? 0) + (deletes?.facts?.length ?? 0) + (deletes?.relations?.length ?? 0)).toBe(0);
    }
    expect(server.s.leaves.has("f:old.md")).toBe(true);
  });
});
