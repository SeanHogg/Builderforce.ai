import { execSync } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore, newLocalRecord, type LocalFirstStore } from "@builderforce/local-first";
import type { RunDelta, RunDeltaCardPayload } from "@builderforce/run-delta";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));
vi.mock("../gitChanges", () => ({ refreshPendingChanges: () => undefined, detectPendingChanges: async () => ({ repos: [] }) }));
vi.mock("../gitApi", () => ({ getGitApi: async () => undefined, watchGitRepositories: () => ({ dispose() {} }), runGit: async () => undefined }));

import { nodeContentHash } from "../knowledge/nodeSha256";
import type { LocalChangeSetValue } from "../runChangeSets";
import { atRunEnd } from "./atRunEnd";
import { MAX_FILE_BYTES, baselinePicks, parseLsTreeSizes } from "./recordNaturalness";
import { predictionShownEvent, readRunPredictions, runPredictionId, withPredicted } from "./runDeltaPredictions";
import type { StoredRunDelta } from "./runDeltaRecords";
import { provenRunTexts } from "./runTexts";
import { handleRunDeltaRequest } from "./runDeltaSurface";
import { runLineCounts } from "../runOutcomes/recordRunOutcome";

const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await fs.rm(d, { recursive: true, force: true });
});

/** A repository file with an identifier no other file uses. */
function repoText(n: number, local: string, offset: number): string {
  const lines: string[] = [];
  for (let k = offset; k < offset + n; k++) {
    lines.push(`export function ${local}Handler${k % 11}(input: string): number {`);
    lines.push(`    const value${k % 7} = ${local}Compute(item${k % 5}, ${k % 3});`);
    lines.push(`    if (value${k % 7} > limit) return value${k % 7};`);
    lines.push(`    return input.length + ${k % 4};`);
    lines.push("}");
  }
  return lines.join("\n");
}

const LOCALS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa"];
const BEFORE = ["export function handler1(input: string): number {", "    return input.length + 1;", "}"].join("\n");
const ODD = "    x ^= ~~y >>> 3 ?? (q as never)!.z % @w;";
const IDIOM = "    const value2 = sharedCompute(item3, 1);";
const sha = (text: string): string => `sha256:${nodeContentHash(new TextEncoder().encode(text))}`;

async function repo(files: Record<string, string>): Promise<{ root: string; base: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-naturalness-"));
  dirs.push(root);
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  const git = (args: string) => execSync(`git -c user.name=t -c user.email=t@example.test ${args}`, { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  git("init -q");
  git("add -A");
  git("commit -q -m base");
  return { root, base: git("rev-parse HEAD") };
}

const baselineFiles = (): Record<string, string> => ({
  ...Object.fromEntries(LOCALS.map((l, i) => [`src/${l}.ts`, repoText(30, l, i * 3)])),
  "node_modules/dep/index.ts": `${ODD}\n`.repeat(50),
  "README.md": "not code\n",
});

async function putChangeSet(store: LocalFirstStore, id: string, base: string, files: LocalChangeSetValue["files"]): Promise<void> {
  const payload = { runId: "run-1", repository: "local-repo", branch: "main", baseCommit: base, author: "agent", capturedAt: "2026-11-10T00:00:00.000Z", files } as unknown as LocalChangeSetValue;
  await store.transact(async (tx) => {
    await tx.put(newLocalRecord<LocalChangeSetValue>({
      id, entityType: "change-set", deviceId: "d", destination: { kind: "unbound" }, occurredAt: "2026-11-10T00:00:00.000Z", schemaVersion: 1, payload,
    }));
  });
}

const storedOf = (root: string, changeSetId: string): StoredRunDelta => ({
  value: { runId: "run-1", repository: "local:abc", changeSetId, chatId: 7, mode: "interactive", delta: {} as RunDelta, computedMs: 0 },
  local: { kind: "local", runId: "run-1", chatId: 7, root, repo: root },
});

const endDeps = (store: LocalFirstStore, over: Partial<Parameters<typeof atRunEnd>[0]> = {}) => {
  const errors: unknown[] = [];
  return { errors, deps: { store, deviceId: () => "d", log: (_: string, e: unknown) => { errors.push(e); }, enabled: () => true, ...over } };
};

describe("naturalness at run end (PRD 41 §D6)", () => {
  it("stores the run's unusual lines once, device-only, with what replays it", async () => {
    const { root, base } = await repo({ ...baselineFiles(), "src/c.ts": BEFORE });
    const after = BEFORE.replace("    return", `${IDIOM}\n${ODD}\n    return`);
    await fs.writeFile(path.join(root, "src", "c.ts"), after);
    const store = createMemoryLocalFirstStore();
    await putChangeSet(store, "changeset:run-1:k1", base, [{ path: "src/c.ts", afterHash: sha(after), attribution: "run-authored", status: "modified" }]);
    const { errors, deps } = endDeps(store);

    expect(await atRunEnd(deps, [storedOf(root, "changeset:run-1:k1")])).toBe(true); // a row the card shows: re-post
    expect(await atRunEnd(deps, [storedOf(root, "changeset:run-1:k1")])).toBe(false); // a second pass keeps the first row

    expect(errors).toEqual([]);
    const rows = await readRunPredictions(store, { chatId: 7 });
    expect(rows).toHaveLength(1);
    expect(await readRunPredictions(store, { runId: "run-1" })).toEqual(rows);
    const row = rows[0]!;
    expect(row.naturalness.prediction).toMatchObject({ id: "naturalness.unusual-lines", status: "ok", value: 1 });
    expect(row.naturalness.unusual.map((u) => [u.path, u.line])).toEqual([["src/c.ts", 3]]);
    expect(row.baseCommit).toBe(base);
    expect(row.afterHashes).toEqual({ "src/c.ts": sha(after).slice("sha256:".length) });
    expect(row.baselinePicks.every((p) => p.startsWith("src/") && p.endsWith(".ts"))).toBe(true); // no node_modules, no .md
    expect(row.root).toBe(root);
    expect(await store.read((tx) => tx.get("run-delta", runPredictionId("changeset:run-1:k1")))).toBeTruthy();
    expect(await store.read((tx) => tx.pending())).toEqual([]); // put, never journaled
  }, 60_000); // real git processes are slow on Windows

  it("scores only the run's lines in a file dirty at baseline (its pre-image is the before side)", async () => {
    const { root, base } = await repo({ ...baselineFiles(), "src/c.ts": BEFORE });
    const dirty = BEFORE.replace("    return", `${ODD}\n    return`); // the person's own edit, before the run
    const after = dirty.replace("    return", `${IDIOM}\n    return`);
    await fs.writeFile(path.join(root, "src", "c.ts"), after);
    const store = createMemoryLocalFirstStore();
    await putChangeSet(store, "changeset:run-1:k2", base, [
      { path: "src/c.ts", beforeHash: sha(dirty), afterHash: sha(after), attribution: "run-modified-existing", status: "modified" },
    ]);
    const preimages = async (hashes: readonly string[]) =>
      new Map(hashes.filter((h) => h === sha(dirty).slice(7)).map((h) => [h, new TextEncoder().encode(dirty)] as const));
    const { deps } = endDeps(store, { preimages: () => preimages });

    await atRunEnd(deps, [storedOf(root, "changeset:run-1:k2")]);

    const [row] = await readRunPredictions(store, { runId: "run-1" });
    expect(row!.naturalness.scoredLines).toBe(1);
    expect(row!.naturalness.unusual).toEqual([]);
  }, 60_000);

  it("skips a file whose before side is oversized (never scores all its lines as new), and honours the kill switch", async () => {
    const big = `${"const filler = 1;\n".repeat(Math.ceil(MAX_FILE_BYTES / 18) + 10)}`;
    const { root, base } = await repo({ ...baselineFiles(), "src/big.ts": big });
    const after = `${big}${IDIOM}\n`;
    await fs.writeFile(path.join(root, "src", "big.ts"), after);
    const store = createMemoryLocalFirstStore();
    const files = [{ path: "src/big.ts", afterHash: sha(after), attribution: "run-authored" as const, status: "modified" }];
    await putChangeSet(store, "changeset:run-1:k3", base, files);
    const proven = await provenRunTexts({ root, changeSet: { baseCommit: base, files }, maxBytes: MAX_FILE_BYTES });
    expect(proven.map((f) => [f.before.state, f.after.state])).toEqual([["unreadable", "unreadable"]]);

    await atRunEnd(endDeps(store).deps, [storedOf(root, "changeset:run-1:k3")]);
    expect((await readRunPredictions(store, { runId: "run-1" }))[0]!.naturalness.prediction.status).toBe("not-applicable");

    const off = createMemoryLocalFirstStore();
    await putChangeSet(off, "changeset:run-1:k3", base, files);
    expect(await atRunEnd(endDeps(off, { enabled: () => false }).deps, [storedOf(root, "changeset:run-1:k3")])).toBe(false); // nothing to re-post
    const [disabled] = await readRunPredictions(off, { runId: "run-1" });
    expect(disabled!.naturalness.prediction.status).toBe("model-disabled");
    expect(disabled!.baselinePicks).toEqual([]);
  }, 60_000);
});

describe("baseline picks (budgeted from the tree listing alone)", () => {
  it("keeps code files of the changed languages, small, outside skipped folders, not the run's", () => {
    const listing = [
      `100644 blob ${"a".repeat(40)}     120\tsrc/a.ts`,
      `100644 blob ${"b".repeat(40)} ${MAX_FILE_BYTES + 1}\tsrc/huge.ts`,
      `100644 blob ${"c".repeat(40)}      80\tnode_modules/x/index.ts`,
      `100644 blob ${"d".repeat(40)}      80\tdist/out.ts`,
      `100644 blob ${"e".repeat(40)}      80\tREADME.md`,
      `100644 blob ${"f".repeat(40)}      80\ttools/run.py`,
      `100644 blob ${"0".repeat(40)}      80\tsrc/run.ts`,
      `160000 commit ${"1".repeat(40)}       -\tvendor-sub`,
    ].join("\0");
    const entries = parseLsTreeSizes(listing);
    expect(entries).toHaveLength(7);
    expect(baselinePicks(entries, new Set(["js"]), new Set(["src/run.ts"]))).toEqual(["src/a.ts"]);
  });
});

describe("runLineCounts with the run's pre-images (PRD 41 §D1 size features)", () => {
  it("proves a file dirty at baseline through its pre-image, and refuses it without one", async () => {
    const { root, base } = await repo({ "src/c.ts": BEFORE });
    const dirty = BEFORE.replace("    return", `${ODD}\n    return`);
    const after = dirty.replace("    return", `${IDIOM}\n    return`);
    await fs.writeFile(path.join(root, "src", "c.ts"), after);
    const cs = {
      baseCommit: base, capturedAt: "2026-11-10T00:00:00.000Z",
      files: [{ path: "src/c.ts", beforeHash: sha(dirty), afterHash: sha(after), attribution: "run-modified-existing", status: "modified" }],
    } as unknown as LocalChangeSetValue;
    const preimages = async (hashes: readonly string[]) =>
      new Map(hashes.filter((h) => h === sha(dirty).slice(7)).map((h) => [h, new TextEncoder().encode(dirty)] as const));
    expect(await runLineCounts(root, cs, preimages)).toEqual([{ path: "src/c.ts", at: cs.capturedAt, added: 1, deleted: 0 }]);
    expect(await runLineCounts(root, cs)).toBeUndefined();
  }, 60_000);
});

describe("an ok prediction of 0 (L7)", () => {
  it("is never attached to a card and never counted as shown", async () => {
    const zero = { id: "naturalness.unusual-lines", modelId: "naturalness.trigram", modelVersion: "1.2.0", featureSchemaVersion: 3, value: 0,
      explanation: [], status: "ok" as const, inputDigest: "0".repeat(64) };
    const row = { kind: "prediction" as const, runId: "r", chatId: 1, repository: "x", changeSetId: "changeset:r:k", root: "/repo", at: "t",
      baselinePicks: [], afterHashes: {}, naturalness: { prediction: zero } } as never;
    const out = withPredicted([{ chatId: 1, runId: "r", repo: "x", root: "/repo", delta: {} }] as unknown as RunDeltaCardPayload[], [row]);
    expect((out[0] as { predicted?: unknown }).predicted).toBeUndefined();
    const shown = vi.fn();
    const answers: unknown[] = [];
    await handleRunDeltaRequest("run-delta/prediction-shown", { prediction: zero }, {
      runHost: { predictionShown: shown }, openFile: async () => undefined, respond: (_ok, result) => { answers.push(result); },
    });
    expect(shown).not.toHaveBeenCalled();
    expect(answers).toEqual([false]);
  });
});

describe("run-delta/get predictions", () => {
  it("attaches a card's ok predictions by run and root, and prediction.shown carries codes only", () => {
    const ok = { id: "naturalness.unusual-lines", modelId: "naturalness.trigram", modelVersion: "1.1.0", featureSchemaVersion: 2, value: 2,
      explanation: [{ feature: "line#0", contribution: 5.1 }], status: "ok" as const, inputDigest: "0".repeat(64) };
    const row = { kind: "prediction" as const, runId: "r", chatId: 1, repository: "x", changeSetId: "changeset:r:k", root: "/repo", at: "t",
      baselinePicks: [], afterHashes: {}, naturalness: { prediction: ok } } as never;
    const cards = [
      { chatId: 1, runId: "r", repo: "x", root: "/repo", delta: {} },
      { chatId: 1, runId: "r", repo: "y", root: "/other", delta: {} },
      { chatId: 1, runId: "r", status: "pending" },
    ] as unknown as RunDeltaCardPayload[];
    const out = withPredicted(cards, [row]);
    expect(out.map((c) => (c as { predicted?: unknown[] }).predicted?.length ?? 0)).toEqual([1, 0, 0]);
    expect(predictionShownEvent(ok)).toEqual({
      name: "prediction.shown", surface: "vscode", prediction: "naturalness.unusual-lines", model: "naturalness.trigram", version: "1.1.0", status: "ok", value: 2,
    });
  });
});
