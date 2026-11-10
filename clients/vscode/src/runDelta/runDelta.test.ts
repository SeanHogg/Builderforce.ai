import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore } from "@builderforce/local-first";
import { localSqliteAvailable } from "@builderforce/agent-tools/node-local-sqlite";
import { nodeKnowledgeStore, putPreimages, readPreimages, sweepPreimages, unpinPreimages, type NodeKnowledgeStore } from "@builderforce/agent-tools/node-knowledge-store";

const git = vi.hoisted(() => ({ roots: [] as string[] }));

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));

// The pending set is real `git status` of the test repositories (the editor's Git extension is not here).
vi.mock("../gitChanges", async () => {
  const model = await import("../gitChangeModel");
  const { execSync: exec } = await import("node:child_process");
  return {
    refreshPendingChanges: () => undefined,
    detectPendingChanges: async () => model.toChangeSet(git.roots.map((root) => ({
      root, name: path.basename(root), branch: "main",
      changes: model.parsePorcelain(exec("git status --porcelain=v1 --untracked-files=all", { cwd: root }).toString(), root),
    }))),
  };
});

vi.mock("../gitApi", async () => {
  const { execSync: exec } = await import("node:child_process");
  return {
    runGit: async (cwd: string, args: string) => {
      try {
        return exec(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined;
      } catch {
        return undefined;
      }
    },
  };
});

import { captureRunChangeBaseline, type ChangeSetRepoBaseline } from "../runChangeBaseline";
import { recordChangeSetAroundRun, type FinalizedRunChangeSets, type LocalChangeSetValue } from "../runChangeSets";
import { finalizeRunDelta, startRunDelta, type RepoHostSources, type RunDeltaDeps } from "./finalizeRunDelta";
import { repoGit } from "./gitSide";
import { PreimageBudget, PREIMAGE_MAX_FILE_BYTES } from "./preimageBudget";
import { readRunDeltas, type RunDeltaCard, type RunDeltaRecordValue } from "./runDeltaRecords";
import { SideTexts } from "./sideTexts";

const dirs: string[] = [];
const stores: NodeKnowledgeStore[] = [];
afterEach(async () => {
  git.roots = [];
  for (const s of stores.splice(0)) { try { s.close(); } catch { /* closed */ } }
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

const sh = (cwd: string, cmd: string): string => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

/** A git repository with `files` committed on `main`. */
async function repo(files: Record<string, string | Buffer>): Promise<string> {
  const root = await tempDir("bf-delta-");
  sh(root, "git init -q -b main");
  sh(root, "git config user.email t@t && git config user.name t && git config core.autocrlf false");
  await fs.mkdir(path.join(root, ".builderforce", "cache"), { recursive: true });
  await fs.writeFile(path.join(root, ".gitignore"), ".builderforce/cache/\n");
  for (const [rel, body] of Object.entries(files)) await write(root, rel, body);
  sh(root, "git add -A && git commit -q -m base");
  git.roots = [root];
  return root;
}

async function write(root: string, rel: string, body: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
  await fs.writeFile(path.join(root, rel), body);
}

function knowledgeFile(root: string): NodeKnowledgeStore {
  const k = nodeKnowledgeStore(root);
  stores.push(k);
  return k;
}

function sourcesFor(k: NodeKnowledgeStore): (root: string) => Promise<RepoHostSources> {
  return async (root) => ({
    git: repoGit(root),
    preimages: { read: (hashes) => readPreimages(k.persistence, hashes) },
  });
}

function releaseFor(k: NodeKnowledgeStore): RunDeltaDeps["release"] {
  return async (_root, runId) => {
    await unpinPreimages(k.persistence, runId, Date.now());
    await sweepPreimages(k.persistence, Date.now());
  };
}

function deltaDeps(store: LocalFirstStore, sources: RunDeltaDeps["sources"], extra: Partial<RunDeltaDeps> = {}) {
  const cards: RunDeltaCard[] = [];
  const errors: unknown[] = [];
  const events: unknown[] = [];
  const deps: RunDeltaDeps = {
    store, deviceId: () => "device-1", sources,
    post: (card) => cards.push(card),
    telemetry: (event) => events.push(event),
    onError: (error) => errors.push(error),
    ...extra,
  };
  return { deps, cards, errors, events };
}

/** One run through the change set's own wrapper, with the delta started from its `onFinalized`. */
async function runWithDelta(
  store: LocalFirstStore, k: NodeKnowledgeStore, runId: string, edit: () => Promise<void>,
  extra: Partial<RunDeltaDeps> = {}, mode: "interactive" | "autonomous" = "interactive",
) {
  const { deps, cards, errors, events } = deltaDeps(store, sourcesFor(k), { release: releaseFor(k), ...extra });
  let delta: Promise<void> | undefined;
  await recordChangeSetAroundRun(
    {
      store, deviceId: "device-1", runId, author: "agent:test",
      capture: { preimages: (_root, items) => putPreimages(k.persistence, runId, items, Date.now()) },
      onFinalized: (closed) => { delta = startRunDelta(deps, { chatId: 7, mode, closed }); },
      onError: (error) => errors.push(error),
    },
    edit,
  );
  await delta;
  return { cards, errors, events, finalized: delta !== undefined };
}

const GUARDED = "app.get('/api/projects/:id', requireAuth, async (c) => c.json(await load(c)));\n";
const UNGUARDED = "app.get('/api/projects/:id', async (c) => c.json(await load(c)));\n";

describe.skipIf(!localSqliteAvailable())("run delta at run finalization (PRD 41 WS7)", { timeout: 60_000 }, () => {
  it("records security worse with guard-removed when a run removes requireAuth from a route, and posts the card", async () => {
    const root = await repo({ "api/routes.ts": GUARDED });
    const k = knowledgeFile(root);
    const store = createMemoryLocalFirstStore();
    const { cards, errors, events } = await runWithDelta(store, k, "run-guard", () => write(root, "api/routes.ts", UNGUARDED));

    expect(errors).toEqual([]);
    const stored = await store.read((tx) => tx.list<RunDeltaRecordValue>("run-delta"));
    expect(stored).toHaveLength(1);
    const value = stored[0]!.payload;
    expect(stored[0]!.id).toMatch(/^run-delta:run-guard:[0-9a-f]{16}$/);
    const security = value.delta.dimensions.find((d) => d.id === "security")!;
    expect(security.verdict).toBe("worse");
    expect(security.findings.map((f) => [f.ruleId, f.lineage])).toContainEqual(["guard-removed", "introduced"]);
    expect(value.delta.headline).toBe("worse");
    // Interactive runs never block.
    expect(value.blocked).toBeUndefined();

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ chatId: 7, runId: "run-guard", repo: root });
    expect(cards[0]!.delta.digest).toBe(value.delta.digest);
    expect(events).toEqual([expect.objectContaining({ name: "delta.computed", surface: "vscode", headline: "worse" })]);
    // The reopened chat reads the same card back (`run-delta/get`).
    expect(await readRunDeltas(store, { runId: "run-guard" })).toEqual(cards);
    expect(await readRunDeltas(store, { chatId: 7 })).toEqual(cards);
    // The delta's journal event depends on its change set's.
    const snapshot = await store.export();
    const event = snapshot.events.find((e) => e.entityType === "run-delta")!;
    expect(event.dependsOn).toEqual([`change-set:create:${value.changeSetId}`]);
  });

  it("flags an autonomous run's blocking findings on the record (§12.5)", async () => {
    const root = await repo({ "api/routes.ts": GUARDED });
    const k = knowledgeFile(root);
    const store = createMemoryLocalFirstStore();
    await runWithDelta(store, k, "run-audit", () => write(root, "api/routes.ts", UNGUARDED), {}, "autonomous");
    const value = (await store.read((tx) => tx.list<RunDeltaRecordValue>("run-delta")))[0]!.payload;
    expect(value.mode).toBe("autonomous");
    expect(value.blocked?.rules).toContain("guard-removed");
  });

  it("reads delta.json overrides from the baseline, never from the run's own edit of it", async () => {
    // A guard the built-in registry does not know, ranked only by the repository's committed overrides.
    const route = (guard: string) => `app.get('/api/x', ${guard}async (c) => c.json(1));\n`;
    const root = await repo({ "api/r.ts": route("requireTeamLead, "), ".builderforce/delta.json": JSON.stringify({ guards: { requireTeamLead: 20 } }) });
    const k = knowledgeFile(root);
    const store = createMemoryLocalFirstStore();
    await runWithDelta(store, k, "run-weaken", async () => {
      await write(root, "api/r.ts", route(""));
      // The run tries to drop the guard from the registry in the same edit.
      await write(root, ".builderforce/delta.json", JSON.stringify({ guards: {} , blocking: [] }));
    }, {}, "autonomous");
    const value = (await store.read((tx) => tx.list<RunDeltaRecordValue>("run-delta")))[0]!.payload;
    const security = value.delta.dimensions.find((d) => d.id === "security")!;
    expect(security.findings.map((f) => f.ruleId)).toContain("guard-removed");
    expect(value.blocked?.rules).toContain("guard-removed");
  });

  it("excludes a file a parallel run claimed at its current content (outside-run)", async () => {
    const root = await repo({ "api/routes.ts": GUARDED, "src/other.ts": "export const a = 1;\n" });
    const k = knowledgeFile(root);
    const store = createMemoryLocalFirstStore();
    const { errors } = await runWithDelta(store, k, "run-mine", async () => {
      await write(root, "src/other.ts", "export const a = 2;\n");
      await write(root, "api/routes.ts", UNGUARDED);
      // A parallel run on the same tree finalized first and claimed the route file at this content.
      const { nodeContentHash } = await import("../knowledge/nodeSha256");
      await store.transact(async (tx) => {
        await tx.put(newLocalRecord<LocalChangeSetValue>({
          id: "changeset:run-other:0000000000000000", entityType: "change-set", deviceId: "device-1",
          payload: {
            runId: "run-other", repository: root, author: "agent:other", capturedAt: new Date(Date.now() + 1).toISOString(),
            files: [{ path: "api/routes.ts", afterHash: `sha256:${nodeContentHash(Buffer.from(UNGUARDED))}`, attribution: "run-authored", status: "modified" }],
          },
        }));
      });
    });
    expect(errors).toEqual([]);
    const value = (await store.read((tx) => tx.list<RunDeltaRecordValue>("run-delta"))).find((r) => r.payload.runId === "run-mine")!.payload;
    expect(value.delta.excluded).toContainEqual({ path: "api/routes.ts", reason: "changed-outside-run" });
    expect(value.delta.impact.changedFiles).toEqual(["src/other.ts"]);
    expect(value.delta.dimensions.flatMap((d) => d.findings).map((f) => f.ruleId)).not.toContain("guard-removed");
  });

  it("does not let a set finalized BEFORE this run's baseline claim its files", async () => {
    const root = await repo({ "api/routes.ts": GUARDED });
    const k = knowledgeFile(root);
    const store = createMemoryLocalFirstStore();
    const { nodeContentHash } = await import("../knowledge/nodeSha256");
    await store.transact(async (tx) => {
      await tx.put(newLocalRecord<LocalChangeSetValue>({
        id: "changeset:run-old:0000000000000000", entityType: "change-set", deviceId: "device-1",
        payload: {
          runId: "run-old", repository: root, author: "agent:old", capturedAt: new Date(0).toISOString(),
          files: [{ path: "api/routes.ts", afterHash: `sha256:${nodeContentHash(Buffer.from(UNGUARDED))}`, attribution: "run-authored", status: "modified" }],
        },
      }));
    });
    await runWithDelta(store, k, "run-new", () => write(root, "api/routes.ts", UNGUARDED));
    const value = (await store.read((tx) => tx.list<RunDeltaRecordValue>("run-delta")))[0]!.payload;
    expect(value.delta.excluded).toEqual([]);
    expect(value.delta.impact.changedFiles).toEqual(["api/routes.ts"]);
  });

  it("attributes a non-git folder's edits through its working set and keeps its fingerprints out of the synced lifecycle", async () => {
    const folder = await tempDir("bf-folder-run-");
    await write(folder, "src/a.ts", "a\n");
    await write(folder, "src/gone.ts", "g\n");
    git.roots = [];
    const k = knowledgeFile(folder);
    const store = createMemoryLocalFirstStore();
    let closed: FinalizedRunChangeSets | undefined;
    await recordChangeSetAroundRun(
      {
        store, deviceId: "device-1", runId: "run-folder", author: "agent:test",
        capture: { folders: [folder], preimages: (_r, items) => putPreimages(k.persistence, "run-folder", items, Date.now()) },
        onFinalized: (c) => { closed = c; },
      },
      async () => {
        await write(folder, "src/a.ts", "a2\n");
        await write(folder, "src/new.ts", "n\n");
        await fs.rm(path.join(folder, "src/gone.ts"));
      },
    );
    const sets = await store.read((tx) => tx.list<LocalChangeSetValue & { kind?: string }>("change-set"));
    const diff = sets.find((r) => r.payload.kind !== "lifecycle")!.payload;
    expect(diff.files.map((f) => [f.path, f.attribution, f.status])).toEqual([
      ["src/a.ts", "run-modified-existing", "modified"],
      ["src/gone.ts", "run-modified-existing", "deleted"],
      ["src/new.ts", "run-authored", "untracked"],
    ]);
    const lifecycle = sets.find((r) => r.payload.kind === "lifecycle")!.payload as unknown as { baseline: { repos: Array<{ files: object; omittedFiles?: number }> } };
    expect(lifecycle.baseline.repos[0]).toMatchObject({ files: {}, omittedFiles: 2 });

    const { deps, errors } = deltaDeps(store, sourcesFor(k));
    const cards = await finalizeRunDelta(deps, { chatId: 4, mode: "interactive", closed: closed! });
    expect(errors).toEqual([]);
    // The before side of the edited file came from its baseline pre-image.
    expect(cards[0]!.delta.excluded).toEqual([]);
    expect(cards[0]!.delta.impact.changedFiles).toEqual(["src/a.ts", "src/gone.ts", "src/new.ts"]);
  });

  it("stores a run's delta once: a retried finalization posts no second card", async () => {
    const root = await repo({ "api/routes.ts": GUARDED });
    const k = knowledgeFile(root);
    const store = createMemoryLocalFirstStore();
    let closed: FinalizedRunChangeSets | undefined;
    await recordChangeSetAroundRun(
      { store, deviceId: "device-1", runId: "run-once", author: "agent:test", onFinalized: (c) => { closed = c; } },
      () => write(root, "api/routes.ts", UNGUARDED),
    );
    const first = deltaDeps(store, sourcesFor(k));
    const second = deltaDeps(store, sourcesFor(k));
    await finalizeRunDelta(first.deps, { chatId: 3, mode: "interactive", closed: closed! });
    await finalizeRunDelta(second.deps, { chatId: 3, mode: "interactive", closed: closed! });
    expect(first.cards).toHaveLength(1);
    expect(second.cards).toEqual([]);
    expect(await store.read((tx) => tx.list("run-delta"))).toHaveLength(1);
  });

  it("never fails or delays the run: a delta failure is reported and the delta is simply absent", async () => {
    const root = await repo({ "api/routes.ts": GUARDED });
    const store = createMemoryLocalFirstStore();
    const errors: unknown[] = [];
    const result = await recordChangeSetAroundRun(
      {
        store, deviceId: "device-1", runId: "run-fail", author: "agent:test",
        onFinalized: () => { throw new Error("delta exploded"); },
        onError: (error) => errors.push(error),
      },
      async () => { await write(root, "api/routes.ts", UNGUARDED); return "run result"; },
    );
    expect(result).toBe("run result");
    expect(errors).toEqual([expect.objectContaining({ message: "delta exploded" })]);

    // A failing source, and a hung one past the budget: both settle, store nothing, and report.
    const closed: FinalizedRunChangeSets = {
      runId: "run-fail",
      baseline: { capturedAt: new Date(0).toISOString(), repos: [] },
      committed: (await store.read((tx) => tx.list<LocalChangeSetValue>("change-set")))
        .filter((r) => !("kind" in (r.payload as object))).map((r) => ({ id: r.id, root })),
    };
    const failing = deltaDeps(store, async () => { throw new Error("no sources"); }, { store: { ...store, read: () => Promise.reject(new Error("store down")) } as LocalFirstStore });
    await startRunDelta(failing.deps, { chatId: 1, mode: "interactive", closed });
    expect(failing.errors.length).toBeGreaterThan(0);
    expect(failing.cards).toEqual([]);

    const hung = deltaDeps(store, () => new Promise(() => undefined), { budgetMs: 20 });
    await startRunDelta(hung.deps, { chatId: 1, mode: "interactive", closed });
    expect(String(hung.errors[0])).toMatch(/run_delta_budget/);
    expect(await store.read((tx) => tx.list("run-delta"))).toEqual([]);
  });
});

describe.skipIf(!localSqliteAvailable())("baseline pre-images and C1 resolution", { timeout: 60_000 }, () => {
  it("captures the bytes of every dirty file (untracked included) within the caps", async () => {
    const root = await repo({ "a.ts": "a\n", "big.ts": "b\n" });
    await write(root, "a.ts", "a dirty\n");
    await write(root, "new.ts", "untracked\n");
    await write(root, "big.ts", Buffer.alloc(PREIMAGE_MAX_FILE_BYTES + 1, 0x61));
    const k = knowledgeFile(root);
    const baseline = await captureRunChangeBaseline(new Date(0), { preimages: (_r, items) => putPreimages(k.persistence, "run-c", items, 0) });
    const repoBase = baseline.repos[0]!;
    expect(Object.keys(repoBase.files).sort()).toEqual(["a.ts", "big.ts", "new.ts"]);
    expect(repoBase.preimageTooLarge).toEqual(["big.ts"]);
    const hashes = ["a.ts", "new.ts", "big.ts"].map((p) => repoBase.files[p]!.slice("sha256:".length));
    const held = await readPreimages(k.persistence, hashes);
    expect(new TextDecoder().decode(held.get(hashes[0]!))).toBe("a dirty\n");
    expect(new TextDecoder().decode(held.get(hashes[1]!))).toBe("untracked\n");
    expect(held.has(hashes[2]!)).toBe(false);
  });

  it("spends the per-run budget in order and refuses files over the per-file cap", () => {
    const budget = new PreimageBudget(10, 6);
    expect([budget.decide(7), budget.decide(6), budget.decide(5), budget.decide(4), budget.decide(undefined)])
      .toEqual(["too-large", "capture", "too-large", "capture", "absent"]);
  });

  it("captures a non-git folder's whole working set", async () => {
    const folder = await tempDir("bf-folder-");
    await write(folder, "src/x.ts", "x\n");
    await write(folder, "node_modules/dep/i.js", "skip\n");
    const k = knowledgeFile(folder);
    git.roots = [];
    const baseline = await captureRunChangeBaseline(new Date(0), { folders: [folder], preimages: (_r, items) => putPreimages(k.persistence, "run-f", items, 0) });
    expect(baseline.repos).toEqual([expect.objectContaining({ root: folder, kind: "folder", files: { "src/x.ts": expect.stringMatching(/^sha256:/) } })]);
    const hash = baseline.repos[0]!.files["src/x.ts"]!.slice("sha256:".length);
    expect((await readPreimages(k.persistence, [hash])).has(hash)).toBe(true);
  });

  it("resolves before in the C1 order: a clean file by git show, a dirty one by its pre-image, a too-large one unresolved", async () => {
    const root = await repo({ "clean.ts": "clean before\n", "dirty.ts": "dirty base\n", "big.ts": "big base\n" });
    await write(root, "dirty.ts", "dirty at baseline\n");
    await write(root, "big.ts", Buffer.alloc(PREIMAGE_MAX_FILE_BYTES + 1, 0x62));
    const k = knowledgeFile(root);
    const baseline = await captureRunChangeBaseline(new Date(0), { preimages: (_r, items) => putPreimages(k.persistence, "run-r", items, 0) });
    const repoBase: ChangeSetRepoBaseline = baseline.repos[0]!;
    const texts = new SideTexts(repoBase, repoGit(root), (hashes) => readPreimages(k.persistence, hashes));
    const inputs = await texts.inputs([
      { path: "clean.ts", afterHash: "sha256:x", attribution: "run-authored", status: "modified" },
      { path: "dirty.ts", beforeHash: repoBase.files["dirty.ts"]!, afterHash: "sha256:y", attribution: "run-modified-existing", status: "modified" },
      { path: "big.ts", beforeHash: repoBase.files["big.ts"]!, afterHash: "sha256:z", attribution: "run-modified-existing", status: "modified" },
      { path: "brand-new.ts", afterHash: "sha256:w", attribution: "run-authored", status: "untracked" },
    ]);
    const byPath = new Map(inputs.map((f) => [f.path, f]));
    expect(byPath.get("clean.ts")!.beforeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(byPath.get("brand-new.ts")!.beforeHash).toBeUndefined();
    const before = await texts.beforeTexts(inputs.filter((f) => f.beforeHash).map((f) => ({ path: f.path, beforeHash: f.beforeHash! })));
    expect(before.get("clean.ts")).toMatchObject({ text: "clean before\n" });
    expect(before.get("dirty.ts")).toMatchObject({ text: "dirty at baseline\n" });
    expect(before.get("big.ts")).toEqual({ path: "big.ts", reason: "preimage-too-large" });
  });

  it("finalizes with no committed set without failing, and releases the run's pre-images", async () => {
    const root = await repo({ "a.ts": "a\n" });
    await write(root, "a.ts", "dirty\n");
    const k = knowledgeFile(root);
    const store = createMemoryLocalFirstStore();
    const baseline = await captureRunChangeBaseline(new Date(0), { preimages: (_r, items) => putPreimages(k.persistence, "run-n", items, 0) });
    const { deps, errors } = deltaDeps(store, sourcesFor(k), { release: releaseFor(k) });
    expect(await finalizeRunDelta(deps, { chatId: 1, mode: "interactive", closed: { runId: "run-n", baseline, committed: [] } })).toEqual([]);
    expect(errors).toEqual([]);
    const pins = k.persistence.db.prepare("SELECT COUNT(*) AS n FROM preimage_pin WHERE run_id = ?").get("run-n") as { n: number };
    expect(Number(pins.n)).toBe(0);
  });
});
