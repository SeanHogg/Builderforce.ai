import { describe, expect, it, vi } from "vitest";
import { createMemoryLocalFirstStore } from "@builderforce/local-first";
import { freezeRunFeatures, type RunOutcomeLabel } from "@builderforce/run-delta/predict";

import { matchCommit } from "./commitAttribution";
import { needsGitLabels } from "./localLabels";
import { labelBatch } from "./labelBatch";
import { parseBirths, parseLog, parseNumstat } from "./outcomeGit";
import { readRunOutcomes, recordRunFeatures, runOutcomeId, runOutcomeIdOfChangeSet, updateRunOutcome } from "./runOutcomeRecords";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));
vi.mock("../gitChanges", () => ({ refreshPendingChanges: () => undefined, detectPendingChanges: async () => ({ repos: [] }) }));
vi.mock("../gitApi", () => ({ getGitApi: async () => undefined, watchGitRepositories: () => ({ dispose() {} }), runGit: async () => undefined }));

const AT = "2026-11-01T00:00:00.000Z";
const features = freezeRunFeatures({
  runId: "run-1", repository: "https://example.test/r.git", finalizedAt: AT, entryPoint: "vscode", mode: "interactive",
  fileLines: [{ path: "src/a.ts", at: AT, added: 3, deleted: 1 }],
});
const label = (over: Partial<RunOutcomeLabel>): RunOutcomeLabel => ({
  kind: "followup-fix", value: null, status: "censored", windowEndsAt: "2026-12-01T00:00:00.000Z", evidence: {}, labellerVersion: 1, computedAt: AT, ...over,
});

describe("run-outcome record (PRD 41 §D1)", () => {
  it("has a UUID-shaped id derived from the change set's run and repository key", () => {
    expect(runOutcomeIdOfChangeSet("changeset:run-1:abc123")).toBe(runOutcomeId("run-1", "abc123"));
    expect(runOutcomeId("run-1", "abc123")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("freezes features once, then merges attribution and labels; an unchanged re-label writes nothing", async () => {
    const store = createMemoryLocalFirstStore();
    const id = runOutcomeId("run-1", "k");
    expect(await recordRunFeatures(store, { id, features, deviceId: "d", at: AT })).toBe(true);
    const other = freezeRunFeatures({ runId: "run-1", repository: features.repository, finalizedAt: AT, entryPoint: "vscode", mode: "autonomous" });
    expect(await recordRunFeatures(store, { id, features: other, deviceId: "d", at: AT })).toBe(false);

    const attribution = { commitSha: "a".repeat(40), path: "src/a.ts", committedAt: AT, source: "vscode-git" as const };
    expect(await updateRunOutcome(store, id, { attribution: [attribution], deviceId: "d", at: AT })).toBe(true);
    expect(await updateRunOutcome(store, id, { attribution: [attribution], deviceId: "d", at: AT })).toBe(false);
    expect(await updateRunOutcome(store, id, { labels: [label({})], deviceId: "d", at: AT })).toBe(true);
    expect(await updateRunOutcome(store, id, { labels: [label({ computedAt: "2026-11-02T00:00:00.000Z" })], deviceId: "d", at: AT })).toBe(false);

    const [row] = await readRunOutcomes(store, features.repository);
    expect(row?.value.features.digest).toBe(features.digest);
    expect(row?.value.attribution).toHaveLength(1);
    expect(row?.value.labels).toHaveLength(1);
    expect(needsGitLabels(row!.value)).toBe(true);
  });

  it("does not need git labels without attribution or once both are final", () => {
    const value = { kind: "run-outcome" as const, runId: "r", repository: "x", features, attribution: [], labels: [] };
    expect(needsGitLabels(value)).toBe(false);
    const attributed = { ...value, attribution: [{ commitSha: "a", path: "p", committedAt: AT, source: "vscode-git" as const }] };
    expect(needsGitLabels({ ...attributed, labels: [label({ status: "final", value: false }), label({ kind: "reverted", status: "final", value: false })] })).toBe(false);
  });
});

describe("label batch (one shared history per repository)", () => {
  it("labels each run only from the commits after its own run end", () => {
    const sha = "a".repeat(40);
    const attribution = [{ commitSha: sha, path: "src/a.ts", addedLines: 2, committedAt: AT, source: "vscode-git" as const }];
    const revert = { sha: "r".repeat(40), at: "2026-11-03T00:00:00.000Z", message: `This reverts commit ${sha}.`, changes: [] };
    const out = labelBatch({
      now: "2026-11-05T00:00:00.000Z", history: [revert],
      runs: [
        { id: "early", run: { runId: "r1", finalizedAt: AT, attribution } },
        { id: "late", run: { runId: "r2", finalizedAt: "2026-11-04T00:00:00.000Z", attribution } },
      ],
    });
    expect(out.find((o) => o.id === "early")?.labels.find((l) => l.kind === "reverted")?.value).toBe(true);
    expect(out.find((o) => o.id === "late")?.labels.find((l) => l.kind === "reverted")?.value).toBeNull();
  });
});

describe("commit attribution", () => {
  it("attributes a committed path whose normalized hash is the run's after-hash", () => {
    const runs = [{ outcomeId: "o1", files: new Map([["src/a.ts", "h1"], ["src/b.ts", "h2"]]) }];
    const out = matchCommit(runs, {
      sha: "c1", at: AT, branch: "feat",
      files: new Map([["src/a.ts", { hash: "h1", added: 3 }], ["src/b.ts", { hash: "other", added: 1 }], ["src/c.ts", { added: 2 }]]),
    });
    expect([...out]).toEqual([["o1", [{ commitSha: "c1", path: "src/a.ts", committedAt: AT, addedLines: 3, source: "vscode-git", branch: "feat" }]]]);
  });
});

describe("git output parsing", () => {
  it("reads numstat, renames included", () => {
    expect([...parseNumstat("3\t1\tsrc/a.ts\n-\t-\tlogo.png\n2\t0\tsrc/{old => new}.ts\n")]).toEqual([
      ["src/a.ts", { added: 3, deleted: 1 }], ["logo.png", { added: 0, deleted: 0 }], ["src/new.ts", { added: 2, deleted: 0 }],
    ]);
  });
  it("reads every path's oldest add time from ONE log", () => {
    const out = `\u001e2026-10-02T00:00:00Z\n\nsrc/b.ts\n\u001e2026-09-01T00:00:00Z\n\nsrc/a.ts\nsrc/b.ts\n`;
    expect([...parseBirths(out)]).toEqual([["src/b.ts", "2026-09-01T00:00:00Z"], ["src/a.ts", "2026-09-01T00:00:00Z"]]);
  });
  it("reads a log with messages and numstat", () => {
    const out = `\u001eabc\u001f${AT}\u001ffix: thing\n\nbody\n\n3\t1\tsrc/a.ts\n\u001edef\u001f${AT}\u001fsecond\n`;
    const commits = parseLog(out);
    expect(commits.map((c) => [c.sha, c.message, [...c.files.keys()]])).toEqual([["abc", "fix: thing\n\nbody", ["src/a.ts"]], ["def", "second", []]]);
  });
});
