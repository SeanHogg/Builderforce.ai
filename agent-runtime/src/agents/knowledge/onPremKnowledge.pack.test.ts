import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CapabilityProvider } from "@builderforce/agent-tools";
import type { KnowledgeClient } from "@builderforce/knowledge-client";
import { filesManifestKey } from "@seanhogg/builderforce-memory/knowledge";
import { fakeServer } from "../../../../packages/agent-tools/src/knowledge/replicaTestkit.test-util.js";
import { onPremOnlyPackSpies } from "./onPremKnowledge.pack.testkit.js";
import { onPremKnowledgeRowsHost } from "./onPremKnowledge.js";
import { closeOnPremManifests, onPremReplicaHost, onPremRootPorts } from "./onPremReplica.js";

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

  it("marks a root reviewed against the server before (manifest entries, empty local store) additive", async () => {
    const root = await workspace();
    const { client } = packClient();
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked: { client, projectId: 7 } });
    const session = (await host.openReview("docs"))!;
    const ports = onPremRootPorts(root, session.rootId, undefined);
    await ports.manifest.set(filesManifestKey(session.rootId), [{ id: "a.md", hash: "h1" }]);
    await session.plan(new AbortController().signal);
    expect(await onPremReplicaHost().replicaQueueFor(session.rootId, ports.files).additive()).toBe(true);
  });

  it("leaves a fresh root (no manifest entries) subtractive", async () => {
    const root = await workspace();
    const { client } = packClient();
    const host = onPremKnowledgeRowsHost({ workspaceRoot: root, caps, linked: { client, projectId: 7 } });
    const session = (await host.openReview("docs"))!;
    const ports = onPremRootPorts(root, session.rootId, undefined);
    await session.plan(new AbortController().signal);
    expect(await onPremReplicaHost().replicaQueueFor(session.rootId, ports.files).additive()).toBe(false);
  });
});
