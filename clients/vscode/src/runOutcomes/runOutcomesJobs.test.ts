import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { freezeRunFeatures } from "@builderforce/run-delta/predict";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));
vi.mock("../gitChanges", () => ({ refreshPendingChanges: () => undefined, detectPendingChanges: async () => ({ repos: [] }) }));
vi.mock("../gitApi", () => ({ getGitApi: async () => undefined, watchGitRepositories: () => ({ dispose() {} }), runGit: async () => undefined }));
// Git always fails here: the labels pass must rotate past the failing batch.
vi.mock("./outcomeGit", async (importOriginal) => ({ ...(await importOriginal<typeof import("./outcomeGit")>()), laterHistory: vi.fn(async () => undefined) }));

import { nodeContentHash } from "../knowledge/nodeSha256";
import type { LocalChangeSetValue } from "../runChangeSets";
import { syncedRepository } from "../runDelta/runDeltaRecords";
import { labelBatch, labelBatchOffThread } from "./labelBatch";
import { batchAt, labelRepository, MAX_RUNS_PER_PASS } from "./localLabels";
import { runLineCounts } from "./recordRunOutcome";
import { laterHistory } from "./outcomeGit";
import { readRunOutcomes, recordRunFeatures, runOutcomeId, updateRunOutcome } from "./runOutcomeRecords";

const AT = "2026-11-01T00:00:00.000Z";
const day = (n: number): string => new Date(Date.parse(AT) + n * 86_400_000).toISOString();

/** One attributed run outcome per run end, in `repository`; returns their record ids. */
async function seedRuns(store: ReturnType<typeof createMemoryLocalFirstStore>, repository: string, ends: readonly string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, finalizedAt] of ends.entries()) {
    const id = runOutcomeId(`seed-${i}`, "k");
    await recordRunFeatures(store, { id, features: freezeRunFeatures({ runId: `seed-${i}`, repository, finalizedAt, entryPoint: "vscode", mode: "interactive" }), deviceId: "d", at: finalizedAt });
    await updateRunOutcome(store, id, { attribution: [{ commitSha: "a".repeat(40), path: "a.ts", committedAt: finalizedAt, source: "vscode-git" }], deviceId: "d", at: finalizedAt });
    ids.push(id);
  }
  return ids;
}

const changeSet = (files: LocalChangeSetValue["files"]): LocalChangeSetValue =>
  ({ runId: "run-1", repository: "x", files, author: "agent", capturedAt: AT }) as LocalChangeSetValue;

describe("runLineCounts (the run's own change, M4)", () => {
  it("counts a file whose disk bytes hash to the recorded afterHash, and refuses one that moved on since", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "run-lines-"));
    await fs.writeFile(path.join(root, "a.ts"), "one\ntwo\n");
    const hash = nodeContentHash(new TextEncoder().encode("one\ntwo\n"));
    const ok = await runLineCounts(root, changeSet([{ path: "a.ts", afterHash: `sha256:${hash}`, attribution: "run-authored", status: "added" }]));
    expect(ok).toEqual([{ path: "a.ts", at: AT, added: 2, deleted: 0 }]);
    const moved = await runLineCounts(root, changeSet([{ path: "a.ts", afterHash: `sha256:${"0".repeat(64)}`, attribution: "run-authored", status: "added" }]));
    expect(moved).toBeUndefined();
    // Size not proven ⇒ the size features stay null (not measured), never zero.
    const features = freezeRunFeatures({ runId: "r", repository: "x", finalizedAt: AT, entryPoint: "vscode", mode: "interactive", ...(moved ? { fileLines: moved } : {}) });
    expect(features.values["size.linesAdded"]).toBeNull();
    expect(features.values["size.filesTouched"]).toBeNull();
  });
});

describe("label worker fallback", () => {
  it("labels in this thread when the worker bundle (out/runOutcomeWorker.js) is absent", async () => {
    const batch = { now: AT, history: [], runs: [{ id: "x", run: { runId: "r", finalizedAt: AT, attribution: [] } }] };
    expect(await labelBatchOffThread(batch)).toEqual(labelBatch(batch));
  });
});

describe("labels pass rotation (LOW 4)", () => {
  it("rotates past a batch whose git read failed, so the same runs never fail every pass", async () => {
    const store = createMemoryLocalFirstStore();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "run-labels-"));
    const repository = syncedRepository(root);
    for (let i = 0; i < MAX_RUNS_PER_PASS + 10; i++) {
      const id = runOutcomeId(`run-${i}`, "k");
      const features = freezeRunFeatures({ runId: `run-${i}`, repository, finalizedAt: AT, entryPoint: "vscode", mode: "interactive" });
      await recordRunFeatures(store, { id, features, deviceId: "d", at: AT });
      await updateRunOutcome(store, id, { attribution: [{ commitSha: "a".repeat(40), path: "a.ts", committedAt: AT, source: "vscode-git" }], deviceId: "d", at: AT });
    }
    const offsets = new Map<string, number>();
    expect(await labelRepository({ store, deviceId: () => "d", offsets }, root)).toBe(0);
    expect(offsets.get(root)).toBe(MAX_RUNS_PER_PASS);
    await labelRepository({ store, deviceId: () => "d", offsets }, root);
    expect(offsets.get(root)).toBe(2 * MAX_RUNS_PER_PASS);
  });

  it("N2: a capped (incomplete) read advances the batch and never writes a final false", async () => {
    const store = createMemoryLocalFirstStore();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "run-capped-"));
    const ids = await seedRuns(store, syncedRepository(root), [AT, AT]);
    vi.mocked(laterHistory).mockResolvedValueOnce({ history: [], complete: false, coveredUntil: AT });
    const offsets = new Map<string, number>();
    expect(await labelRepository({ store, deviceId: () => "d", offsets, now: () => new Date(day(40)) }, root)).toBe(0);
    expect(offsets.get(root)).toBe(2);
    const rows = await readRunOutcomes(store, syncedRepository(root));
    expect(rows.flatMap((r) => r.value.labels)).toEqual([]);
    expect(ids).toHaveLength(2);
  });

  it("N2: a run whose whole window lies inside the covered history gets its final false", async () => {
    const store = createMemoryLocalFirstStore();
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "run-covered-"));
    const [old, recent] = await seedRuns(store, syncedRepository(root), [day(-40), AT]);
    vi.mocked(laterHistory).mockResolvedValueOnce({ history: [], complete: false, coveredUntil: day(-5) });
    await labelRepository({ store, deviceId: () => "d", offsets: new Map(), now: () => new Date(day(40)) }, root);
    const rows = new Map((await readRunOutcomes(store, syncedRepository(root))).map((r) => [r.id, r.value.labels] as const));
    expect(rows.get(old!)?.map((l) => [l.kind, l.value, l.status])).toEqual([["followup-fix", false, "final"], ["reverted", false, "final"]]);
    expect(rows.get(recent!)).toEqual([]);
  });

  it("takes a wrapping batch from the offset", () => {
    const items = Array.from({ length: MAX_RUNS_PER_PASS + 10 }, (_, i) => i);
    expect(batchAt(items, 0)[0]).toBe(0);
    const second = batchAt(items, MAX_RUNS_PER_PASS);
    expect(second.slice(0, 10)).toEqual(items.slice(MAX_RUNS_PER_PASS));
    expect(second).toHaveLength(MAX_RUNS_PER_PASS);
    expect(batchAt([1, 2], 7)).toEqual([1, 2]);
  });
});
