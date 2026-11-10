import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord } from "@builderforce/local-first";

// The reader is host-free, but `runChangeSets.ts` (which defines the record shape it
// reads) transitively imports `./gitChanges` → `vscode`. Mock the extension-host API
// the same way every other vscode-client test does, and stub the git ports so no real
// working tree is touched.
vi.mock("vscode", () => ({
  window: { onDidChangeActiveColorTheme: () => ({ dispose() {} }), showWarningMessage: vi.fn() },
  commands: { executeCommand: vi.fn() },
  l10n: { t: (s: string) => s },
}));
vi.mock("./gitChanges", () => ({
  detectPendingChanges: vi.fn(async () => ({ repos: [] })),
  detectPendingDiff: vi.fn(),
  refreshPendingChanges: vi.fn(),
  watchPendingChanges: () => ({ dispose() {} }),
}));
import type { EntityDestination } from "@builderforce/local-first";
import type { ChangeAttribution, RunChangeBaseline } from "./runChangeBaseline";
import {
  beginChangeSet,
  finishChangeSet,
  changeSetLifecycleId,
  type ChangeSetLifecycleValue,
} from "./changeSetLifecycle";
import { runChangeSetId, type LocalChangeSetValue } from "./runChangeSets";
import {
  findChangeSetById,
  listChangeSetsForDestination,
  listChangeSetsForRoot,
  readRunChangeSets,
  summarizeRunChangeSets,
} from "./changeSetReader";

const DEVICE = "device:test";
const RUN_A = "run-a";
const RUN_B = "run-b";
const ROOT = "/repo/agentic";

function baselineFor(runId: string, root: string = ROOT): RunChangeBaseline {
  return {
    capturedAt: "2026-11-09T00:00:00.000Z",
    repos: [
      {
        repository: "SeanHogg/Builderforce.ai",
        name: "Builderforce.ai",
        root,
        branch: "main",
        baseCommit: "abc123",
        files: { "src/a.ts": "sha256:1" },
      },
    ],
  };
}

async function seedChangeSet(
  store: Awaited<ReturnType<typeof createMemoryLocalFirstStore>>,
  args: {
    runId: string;
    root?: string;
    filePath: string;
    status?: string;
    attribution?: ChangeAttribution;
    destination?: EntityDestination;
    capturedAt?: string;
  },
): Promise<string> {
  const root = args.root ?? ROOT;
  const id = runChangeSetId(args.runId, root);
  const record = newLocalRecord<LocalChangeSetValue>({
    id,
    entityType: "change-set",
    deviceId: DEVICE,
    destination: args.destination ?? { kind: "unbound" },
    occurredAt: args.capturedAt ?? "2026-11-09T00:00:00.000Z",
    schemaVersion: 1,
    payload: {
      runId: args.runId,
      repository: "SeanHogg/Builderforce.ai",
      branch: "main",
      baseCommit: "abc123",
      files: [
        {
          path: args.filePath,
          beforeHash: "sha256:before",
          afterHash: "sha256:after",
          attribution: args.attribution ?? "run-authored",
          status: args.status ?? "modified",
        },
      ],
      author: "agent:audit",
      capturedAt: args.capturedAt ?? "2026-11-09T00:00:00.000Z",
    },
  });
  await store.transact(async (tx) => {
    await tx.put(record);
  });
  return id;
}

async function seedLifecycle(
  store: Awaited<ReturnType<typeof createMemoryLocalFirstStore>>,
  args: { runId: string; root?: string; finalized?: boolean },
): Promise<void> {
  const baseline = baselineFor(args.runId, args.root);
  let lifecycle = beginChangeSet({ runId: args.runId, baseline, author: "agent:audit" });
  if (args.finalized) {
    lifecycle = finishChangeSet(lifecycle, {
      finalizedAt: "2026-11-09T01:00:00.000Z",
      changeSetIds: [runChangeSetId(args.runId, args.root ?? ROOT)],
    });
  }
  const payload: ChangeSetLifecycleValue = {
    kind: "lifecycle",
    runId: lifecycle.runId,
    repository: lifecycle.baseline.repos.map((r) => r.repository).sort().join("\n") || "workspace",
    files: [],
    author: lifecycle.author,
    baselineHash: lifecycle.baselineHash,
    baseline: lifecycle.baseline,
    ...(lifecycle.finalizedAt ? { finalizedAt: lifecycle.finalizedAt } : {}),
    ...(lifecycle.finalizationHash ? { finalizationHash: lifecycle.finalizationHash } : {}),
    ...(lifecycle.changeSetIds ? { changeSetIds: lifecycle.changeSetIds } : {}),
  };
  const record = newLocalRecord<ChangeSetLifecycleValue>({
    id: changeSetLifecycleId(args.runId),
    entityType: "change-set",
    deviceId: DEVICE,
    destination: { kind: "unbound" },
    occurredAt: "2026-11-09T00:00:00.000Z",
    schemaVersion: 1,
    payload,
  });
  await store.transact(async (tx) => {
    await tx.put(record);
  });
}

describe("changeSetReader", () => {
  it("returns empty for a run with no records", async () => {
    const store = await createMemoryLocalFirstStore();
    expect(await readRunChangeSets(store, RUN_A)).toEqual([]);
    const summary = await summarizeRunChangeSets(store, RUN_A);
    expect(summary.runId).toBe(RUN_A);
    expect(summary.phase).toBe("absent");
    expect(summary.changeSets).toEqual([]);
  });

  it("reads a run's own change-set records, excluding the lifecycle row", async () => {
    const store = await createMemoryLocalFirstStore();
    await seedLifecycle(store, { runId: RUN_A, finalized: true });
    const id = await seedChangeSet(store, { runId: RUN_A, filePath: "src/a.ts" });

    const views = await readRunChangeSets(store, RUN_A);
    expect(views).toHaveLength(1);
    expect(views[0].id).toBe(id);
    expect(views[0].runId).toBe(RUN_A);
    expect(views[0].files[0].path).toBe("src/a.ts");
    expect(views[0].files[0].attribution).toBe("run-authored");
  });

  it("summarizeRunChangeSets reports partial vs finished lifecycle phases", async () => {
    const store = await createMemoryLocalFirstStore();
    await seedLifecycle(store, { runId: RUN_A });
    await seedChangeSet(store, { runId: RUN_A, filePath: "src/a.ts" });

    const partial = await summarizeRunChangeSets(store, RUN_A);
    expect(partial.phase).toBe("partial");
    expect(partial.changeSets).toHaveLength(1);

    await seedLifecycle(store, { runId: RUN_B, finalized: true });
    await seedChangeSet(store, { runId: RUN_B, filePath: "src/b.ts" });
    const finished = await summarizeRunChangeSets(store, RUN_B);
    expect(finished.phase).toBe("finished");
    expect(finished.changeSets).toHaveLength(1);
  });

  it("listChangeSetsForRoot matches through the lifecycle baseline's repos[].root", async () => {
    const store = await createMemoryLocalFirstStore();
    await seedLifecycle(store, { runId: RUN_A, root: "/repo/agentic", finalized: true });
    await seedChangeSet(store, { runId: RUN_A, root: "/repo/agentic", filePath: "src/a.ts" });

    // A run on a different root must NOT be returned for ROOT.
    await seedLifecycle(store, { runId: RUN_B, root: "/repo/other", finalized: true });
    await seedChangeSet(store, { runId: RUN_B, root: "/repo/other", filePath: "src/c.ts" });

    const forRoot = await listChangeSetsForRoot(store, "/repo/agentic");
    expect(forRoot).toHaveLength(1);
    expect(forRoot[0].runId).toBe(RUN_A);

    const forOther = await listChangeSetsForRoot(store, "/repo/other");
    expect(forOther).toHaveLength(1);
    expect(forOther[0].runId).toBe(RUN_B);
  });

  it("listChangeSetsForDestination filters by the sync-layer destination key", async () => {
    const store = await createMemoryLocalFirstStore();
    const dest: EntityDestination = { kind: "bound", projectId: "11" };
    await seedLifecycle(store, { runId: RUN_A, finalized: true });
    await seedChangeSet(store, { runId: RUN_A, filePath: "src/a.ts", destination: dest });
    await seedChangeSet(store, { runId: RUN_B, filePath: "src/b.ts", destination: { kind: "unbound" } });

    const forDest = await listChangeSetsForDestination(store, dest);
    expect(forDest).toHaveLength(1);
    expect(forDest[0].runId).toBe(RUN_A);
  });

  it("findChangeSetById returns the view, and undefined for a lifecycle id", async () => {
    const store = await createMemoryLocalFirstStore();
    await seedLifecycle(store, { runId: RUN_A, finalized: true });
    const id = await seedChangeSet(store, { runId: RUN_A, filePath: "src/a.ts" });

    const found = await findChangeSetById(store, id);
    expect(found).toBeDefined();
    expect(found?.runId).toBe(RUN_A);

    // The lifecycle record is a change-set entity but must not surface as a diff.
    expect(await findChangeSetById(store, changeSetLifecycleId(RUN_A))).toBeUndefined();
    expect(await findChangeSetById(store, "changeset:missing:0")).toBeUndefined();
  });
});
