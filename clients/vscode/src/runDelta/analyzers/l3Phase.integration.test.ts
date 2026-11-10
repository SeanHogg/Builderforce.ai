/**
 * The two phases end to end (PRD 41 §6 "Agent run", §12.5), NOT skipped: `runDelta.test.ts` is skipped here because its
 * repositories use the knowledge file's pre-images (`localSqliteAvailable()` is false on a Node without `node:sqlite`).
 * This one needs no SQLite: a real git repository (the before side comes from the base commit), the in-memory local-first
 * store, the REAL finalize gate, and fakes for the analyzers and the L3 queue.
 *
 *   phase 1  stored with every analyzer `pending`; a blocking analyzer kind is `analyzer-pending:<tool>`; the hold is
 *            extended and NOT settled;
 *   phase 2  the queued job recomputes, revises the record (a new digest), re-posts the card, and the hold settles with
 *            the final codes — or `unmeasured` when the job failed.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, type LocalFirstStore } from "@builderforce/local-first";
import { composeAnchor } from "@seanhogg/builderforce-memory/knowledge";

const git = vi.hoisted(() => ({ roots: [] as string[] }));
vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));
vi.mock("../../gitChanges", async () => {
  const model = await import("../../gitChangeModel");
  const { execSync: exec } = await import("node:child_process");
  return {
    refreshPendingChanges: () => undefined,
    detectPendingChanges: async () => model.toChangeSet(git.roots.map((root) => ({
      root, name: path.basename(root), branch: "main",
      changes: model.parsePorcelain(exec("git status --porcelain=v1 --untracked-files=all", { cwd: root }).toString(), root),
    }))),
  };
});
vi.mock("../../gitApi", async () => {
  const { execSync: exec } = await import("node:child_process");
  return {
    runGit: async (cwd: string, args: string) => {
      try { return exec(`git ${args}`, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || undefined; } catch { return undefined; }
    },
  };
});

import { recordChangeSetAroundRun } from "../../runChangeSets";
import { startRunDelta, type L3Scheduler, type RunDeltaDeps } from "../finalizeRunDelta";
import { repoGit } from "../gitSide";
import { createRunHoldGate } from "../runHoldGate";
import type { RunDeltaCard, RunDeltaRecordValue } from "../runDeltaRecords";
import { settleInterruptedDeltas } from "./l3Recovery";
import type { PreparedAnalyzers } from "./repoAnalyzers";

const dirs: string[] = [];
afterEach(async () => { git.roots = []; for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true }); });
const sh = (cwd: string, cmd: string) => execSync(cmd, { cwd, stdio: ["ignore", "pipe", "ignore"] }).toString();

async function repo(files: Record<string, string>): Promise<string> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "bf-l3-")));
  dirs.push(root);
  sh(root, "git init -q -b main");
  sh(root, "git config user.email t@t && git config user.name t && git config core.autocrlf false");
  for (const [rel, body] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), body);
  }
  sh(root, "git add -A && git commit -q -m base");
  git.roots = [root];
  return root;
}

const leak = {
  kind: "secret-leak", severity: "error" as const, confidence: "measured" as const, params: { rule: "aws" },
  identity: { id: "secret-leak:src/a.ts#aws:1", anchor: composeAnchor("secret-leak", 1, "file", "src/a.ts#aws"), anchorKind: "file" as const, members: ["src/a.ts"] },
  evidence: [{ side: "after" as const, path: "src/a.ts", line: 1 }],
};

/** A queue that keeps the job until the test runs it (the L3 gate opening). */
function heldQueue() {
  const jobs: Array<(signal: AbortSignal) => Promise<void>> = [];
  return { jobs, queue: (_root: string, run: (signal: AbortSignal) => Promise<void>) => { jobs.push(run); } };
}

async function autonomousRun(store: LocalFirstStore, root: string, l3: L3Scheduler) {
  const gate = createRunHoldGate({ budgetMs: 30_000, finalizeCeilingMs: 120_000 });
  gate.expect("run-l3");
  const hold = gate.port("run-l3");
  const extend = vi.spyOn(hold, "extend");
  const settled = vi.spyOn(hold, "settled");
  const cards: RunDeltaCard[] = [];
  const errors: unknown[] = [];
  const deps: RunDeltaDeps = {
    store, deviceId: () => "device-1", sources: async (r) => ({ git: repoGit(r) }),
    post: (card) => cards.push(card), telemetry: () => undefined, onError: (e) => errors.push(e), l3,
  };
  let delta: Promise<void> | undefined;
  await recordChangeSetAroundRun({
    store, deviceId: "device-1", runId: "run-l3", author: "agent:test", capture: {},
    onFinalized: (closed) => { hold.begin(closed.committed.length > 0); delta = startRunDelta(deps, { chatId: 7, mode: "autonomous", closed, hold }); },
    onError: (e) => errors.push(e),
  }, async () => { await fs.writeFile(path.join(root, "src/a.ts"), "export const a = 2;\n"); });
  await delta;
  const verdict = gate.beforeTerminal({ runId: "run-l3", status: "completed" });
  return { cards, errors, extend, settled, verdict };
}

const rows = async (store: LocalFirstStore) => (await store.read((tx) => tx.list<RunDeltaRecordValue>("run-delta"))).filter((r) => !!r.payload.delta);

describe("run delta phases 1 → 2 with the finalize gate", { timeout: 120_000 }, () => {
  it("phase 1 stores pending and extends the hold without settling; phase 2 revises, re-posts and settles with the final codes", async () => {
    const root = await repo({ "src/a.ts": "export const a = 1;\n", ".builderforce/delta.json": JSON.stringify({ blocking: ["secret-leak"] }) });
    const store = createMemoryLocalFirstStore();
    const q = heldQueue();
    const analyze = async (): Promise<PreparedAnalyzers> => ({
      before: [{ tool: "gitleaks", version: "8.18.4", status: "ok", findings: [] }],
      after: [{ tool: "gitleaks", version: "8.18.4", status: "ok", findings: [leak] }],
    });
    const run = await autonomousRun(store, root, { analyze, queue: q.queue });
    expect(run.errors).toEqual([]);

    // Phase 1: stored with the analyzers pending; the blocking analyzer waits; the hold waits too.
    const phase1 = (await rows(store))[0]!.payload.delta;
    expect(phase1.blocking).toContain("analyzer-pending:gitleaks");
    expect(phase1.dimensions.find((d) => d.id === "security")!.measuredBy).toContainEqual({ tool: "gitleaks", version: "", status: "pending" });
    expect(run.extend).toHaveBeenCalled();
    expect(run.settled).not.toHaveBeenCalled();
    expect(q.jobs).toHaveLength(1);

    // Phase 2 (the L3 gate opened): a revision with a new digest, re-posted; the hold settles holding the leak.
    await q.jobs[0]!(new AbortController().signal);
    const finalRow = (await rows(store))[0]!;
    expect(finalRow.version).toBe(2);
    expect(finalRow.payload.delta.digest).not.toBe(phase1.digest);
    expect(finalRow.payload.delta.blocking).toEqual(["secret-leak"]);
    expect(run.cards.map((c) => c.delta.digest)).toEqual([phase1.digest, finalRow.payload.delta.digest]);
    expect(run.settled).toHaveBeenCalledTimes(1);
    expect(await run.verdict).toMatchObject({ rules: ["secret-leak"] });
    const events = (await store.export()).events.filter((e) => e.entityType === "run-delta");
    expect(events.map((e) => e.operation)).toEqual(["create", "update"]);
  });

  it("a failed phase 2 still lands a final delta (analyzers failed) and holds the run unmeasured", async () => {
    const root = await repo({ "src/a.ts": "export const a = 1;\n", ".builderforce/delta.json": JSON.stringify({ blocking: ["secret-leak"] }) });
    const store = createMemoryLocalFirstStore();
    const q = heldQueue();
    const run = await autonomousRun(store, root, { analyze: async () => { throw new Error("boom"); }, queue: q.queue });
    await q.jobs[0]!(new AbortController().signal);
    const final = (await rows(store))[0]!.payload.delta;
    const gitleaks = final.dimensions.find((d) => d.id === "security")!.measuredBy.filter((m) => m.tool === "gitleaks");
    expect(gitleaks.every((m) => m.status === "failed" && m.reason === "analyzer-threw")).toBe(true);
    expect(final.blocking).not.toContain("analyzer-pending:gitleaks");
    expect(run.settled).toHaveBeenCalledTimes(1);
    expect(await run.verdict).toMatchObject({ reason: expect.stringContaining("unmeasured") });
  });

  it("after a restart, a delta left pending is settled interrupted, revised and re-posted — never pending across restarts", async () => {
    const root = await repo({ "src/a.ts": "export const a = 1;\n", ".builderforce/delta.json": JSON.stringify({ blocking: ["secret-leak"] }) });
    const store = createMemoryLocalFirstStore();
    await autonomousRun(store, root, { analyze: async () => ({ before: [], after: [] }), queue: () => undefined }); // the job is lost
    const phase1 = (await rows(store))[0]!.payload.delta;
    expect(phase1.blocking).toContain("analyzer-pending:gitleaks");

    const posted: RunDeltaCard[] = [];
    expect(await settleInterruptedDeltas(store, { post: (c) => posted.push(c) })).toBe(1);
    const row = (await rows(store))[0]!;
    const all = row.payload.delta.dimensions.flatMap((d) => d.measuredBy);
    expect(all.some((m) => m.status === "pending")).toBe(false);
    expect(all.filter((m) => m.tool === "gitleaks")).toContainEqual({ tool: "gitleaks", version: "", status: "failed", reason: "interrupted", side: "after" });
    expect(row.payload.delta.blocking).not.toContain("analyzer-pending:gitleaks");
    expect(row.payload.delta.blocking.some((c) => c.startsWith("not-comparable:"))).toBe(true);
    expect(row.payload.delta.digest).not.toBe(phase1.digest);
    expect(posted.map((c) => c.delta.digest)).toEqual([row.payload.delta.digest]);
    expect(await settleInterruptedDeltas(store, { post: (c) => posted.push(c) })).toBe(0); // once
  });

  it("an interactive run's phase 2 revises the card; nothing waits on a hold", async () => {
    const root = await repo({ "src/a.ts": "export const a = 1;\n" });
    const store = createMemoryLocalFirstStore();
    const q = heldQueue();
    const cards: RunDeltaCard[] = [];
    let delta: Promise<void> | undefined;
    await recordChangeSetAroundRun({
      store, deviceId: "device-1", runId: "run-i", author: "agent:test", capture: {},
      onFinalized: (closed) => {
        delta = startRunDelta({
          store, deviceId: () => "device-1", sources: async (r) => ({ git: repoGit(r) }), post: (c) => cards.push(c), telemetry: () => undefined,
          onError: () => undefined, l3: { analyze: async () => ({ before: [], after: [] }), queue: q.queue },
        }, { chatId: 7, mode: "interactive", closed });
      },
      onError: () => undefined,
    }, async () => { await fs.writeFile(path.join(root, "src/a.ts"), "export const a = 2;\n"); });
    await delta;
    await q.jobs[0]!(new AbortController().signal);
    expect(cards).toHaveLength(2);
    expect(cards[1]!.delta.dimensions.flatMap((d) => d.measuredBy).some((m) => m.status === "pending")).toBe(false);
  });
});
