import { describe, expect, it } from "vitest";
import {
  createMemoryLocalFirstStore,
  newLocalRecord,
  type LocalFirstStore,
} from "@builderforce/local-first";
import {
  changeSetLifecycleId,
  hashRunChangeBaseline,
} from "./changeSetLifecycle";
import {
  findChangeSetById,
  listChangeSetsForDestination,
  listChangeSetsForRoot,
  readRunChangeSets,
  summarizeRunChangeSets,
} from "./changeSetReader";
import type { LocalChangeSetValue } from "./runChangeSets";
import type { RunChangeBaseline } from "./runChangeBaseline";

function baselineFor(root: string, capturedAt = "2026-11-08T00:00:00.000Z"): RunChangeBaseline {
  return {
    capturedAt,
    repos: [
      {
        root,
        name: "ws",
        repository: "github:owner/ws",
        branch: "main",
        baseCommit: "abc123",
        files: { "src/a.ts": "sha256:0" },
      },
    ],
  };
}

async function seed(store: LocalFirstStore): Promise<void> {
  const baseline = baselineFor("/ws");
  const lifecycle = newLocalRecord({
    id: changeSetLifecycleId("run-1"),
    entityType: "change-set",
    deviceId: "device-1",
    destination: { kind: "unbound" },
    occurredAt: "2026-11-08T00:00:00.000Z",
    schemaVersion: 1,
    payload: {
      kind: "lifecycle",
      runId: "run-1",
      repository: "github:owner/ws",
      files: [],
      author: "agent:brain-host",
      baselineHash: hashRunChangeBaseline(baseline),
      baseline,
      finalizedAt: "2026-11-08T00:01:00.000Z",
      changeSetIds: ["changeset:run-1:0aaaaaaaaaaaaaaa"],
    },
  });
  const changeSet = newLocalRecord<LocalChangeSetValue>({
    id: "changeset:run-1:0aaaaaaaaaaaaaaa",
    entityType: "change-set",
    deviceId: "device-1",
    destination: { kind: "unbound" },
    occurredAt: "2026-11-08T00:01:00.000Z",
    schemaVersion: 1,
    payload: {
      runId: "run-1",
      repository: "github:owner/ws",
      branch: "main",
      baseCommit: "abc123",
      files: [
        {
          path: "src/a.ts",
          beforeHash: "sha256:0",
          afterHash: "sha256:1",
          attribution: "run-modified-existing",
          status: "modified",
        },
        {
          path: "src/b.ts",
          afterHash: "sha256:2",
          attribution: "run-authored",
          status: "added",
        },
      ],
      author: "agent:brain-host",
      capturedAt: "2026-11-08T00:01:00.000Z",
    },
  });
  // A second run on another root, to prove the filters select rather than dump.
  const other = newLocalRecord<LocalChangeSetValue>({
    id: "changeset:run-2:0bbbbbbbbbbbbbbb",
    entityType: "change-set",
    deviceId: "device-1",
    destination: { kind: "bound", projectId: "p1" },
    occurredAt: "2026-11-08T01:00:00.000Z",
    schemaVersion: 1,
    payload: {
      runId: "run-2",
      repository: "github:owner/other",
      files: [
        { path: "x.ts", afterHash: "sha256:3", attribution: "run-authored", status: "added" },
      ],
      author: "agent:audit",
      capturedAt: "2026-11-08T01:00:00.000Z",
    },
  });
  await store.transact(async (tx) => {
    await tx.put(lifecycle);
    await tx.put(changeSet);
    await tx.put(other);
  });
}

describe("changeSetReader", () => {
  it("reads one run's change sets, excluding the lifecycle row", async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const views = await readRunChangeSets(store, "run-1");
    expect(views.map((view) => view.id)).toEqual(["changeset:run-1:0aaaaaaaaaaaaaaa"]);
    expect(views[0].files).toEqual([
      {
        path: "src/a.ts",
        beforeHash: "sha256:0",
        afterHash: "sha256:1",
        attribution: "run-modified-existing",
        status: "modified",
      },
      {
        path: "src/b.ts",
        afterHash: "sha256:2",
        attribution: "run-authored",
        status: "added",
      },
    ]);
    expect(views[0].branch).toBe("main");
    expect(views[0].baseCommit).toBe("abc123");
  });

  it("summarizes a finished run with its lifecycle row", async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const summary = await summarizeRunChangeSets(store, "run-1");
    expect(summary.phase).toBe("finished");
    expect(summary.lifecycle?.baselineHash).toMatch(/^sha256:/);
    expect(summary.changeSets).toHaveLength(1);
  });

  it("reports absent for a run that never recorded a baseline", async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const summary = await summarizeRunChangeSets(store, "run-missing");
    expect(summary.phase).toBe("absent");
    expect(summary.lifecycle).toBeUndefined();
    expect(summary.changeSets).toEqual([]);
  });

  it("lists change sets for a root through the lifecycle baseline", async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const views = await listChangeSetsForRoot(store, "/ws");
    expect(views.map((view) => view.runId)).toEqual(["run-1"]);
    expect(await listChangeSetsForRoot(store, "/elsewhere")).toEqual([]);
  });

  it("lists change sets for a destination by key", async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const bound = await listChangeSetsForDestination(store, { kind: "bound", projectId: "p1" });
    expect(bound.map((view) => view.runId)).toEqual(["run-2"]);
    const unbound = await listChangeSetsForDestination(store, { kind: "unbound" });
    expect(unbound.map((view) => view.runId)).toEqual(["run-1"]);
    expect(await listChangeSetsForDestination(store, { kind: "bound", projectId: "p2" })).toEqual(
      [],
    );
  });

  it("finds a record by id and rejects lifecycle ids", async () => {
    const store = createMemoryLocalFirstStore();
    await seed(store);
    const found = await findChangeSetById(store, "changeset:run-1:0aaaaaaaaaaaaaaa");
    expect(found?.runId).toBe("run-1");
    expect(await findChangeSetById(store, changeSetLifecycleId("run-1"))).toBeUndefined();
    expect(await findChangeSetById(store, "changeset:nope:0cc")).toBeUndefined();
  });
});
