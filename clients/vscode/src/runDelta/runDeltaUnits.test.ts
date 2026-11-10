import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({ workspace: { workspaceFolders: [] }, l10n: { t: (m: string) => m } }));
import type { RunDelta } from "@builderforce/run-delta";
import { headSwitched, parseCatFileBatch, type RepoGit } from "./gitSide";
import { confinedPath } from "./openCode";
import { placeRepo, toKnowledgePath, toRepoPath } from "./repoPlacement";
import { redactDropped, syncedRepository } from "./runDeltaRecords";
import { deltaAttribution } from "./attribution";

const ROOT = process.platform === "win32" ? "C:/work" : "/work";

describe("repository placement (one rule for capture, read and release)", () => {
  it("maps a nested repository into its workspace folder with a prefix", () => {
    const p = placeRepo(`${ROOT}/mono/app`, [`${ROOT}/mono`])!;
    expect(p).toMatchObject({ folder: `${ROOT}/mono`, add: "app/", strip: "" });
    expect(toKnowledgePath(p, "src/a.ts")).toBe("app/src/a.ts");
    expect(toRepoPath(p, "app/src/a.ts")).toBe("src/a.ts");
    expect(toRepoPath(p, "other/x.ts")).toBeUndefined();
  });

  it("maps a repository ABOVE the opened folder (a monorepo subfolder) to that folder, stripping its prefix", () => {
    const p = placeRepo(`${ROOT}/mono`, [`${ROOT}/mono/packages/web`])!;
    expect(p).toMatchObject({ folder: `${ROOT}/mono/packages/web`, add: "", strip: "packages/web/" });
    expect(toKnowledgePath(p, "packages/web/src/a.ts")).toBe("src/a.ts");
    expect(toKnowledgePath(p, "packages/api/src/b.ts")).toBeUndefined();
    expect(toRepoPath(p, "src/a.ts")).toBe("packages/web/src/a.ts");
  });

  it("places nothing outside the workspace", () => {
    expect(placeRepo(`${ROOT}/elsewhere`, [`${ROOT}/mono`])).toBeUndefined();
  });
});

describe("Open code confinement", () => {
  const delta = {
    impact: { changedFiles: ["src/a.ts"], renamed: [], dependents: ["src/b.ts"], entryPoints: [] },
    excluded: [], dimensions: [{ findings: [{ evidence: [{ side: "after", path: "src/c.ts" }] }] }],
  } as unknown as RunDelta;

  it("opens only a path the stored delta names, under the root", () => {
    expect(confinedPath(`${ROOT}/repo`, delta, "src/a.ts")).toMatch(/repo[\\/]src[\\/]a\.ts$/);
    expect(confinedPath(`${ROOT}/repo`, delta, "src/c.ts")).toMatch(/c\.ts$/);
  });

  it("refuses absolute paths, parent segments and paths the delta does not name", () => {
    expect(confinedPath(`${ROOT}/repo`, delta, "../secret.txt")).toBeUndefined();
    expect(confinedPath(`${ROOT}/repo`, delta, "src/../../x")).toBeUndefined();
    expect(confinedPath(`${ROOT}/repo`, delta, `${ROOT}/repo/src/a.ts`)).toBeUndefined();
    expect(confinedPath(`${ROOT}/repo`, delta, "C:\\Windows\\win.ini")).toBeUndefined();
    expect(confinedPath(`${ROOT}/repo`, delta, "src/unlisted.ts")).toBeUndefined();
  });
});

describe("head-switched", () => {
  const git = (head: { commit?: string; branch?: string }, ancestor: boolean | undefined): RepoGit => ({
    blobs: async () => new Map(), head: async () => head, isAncestor: async () => ancestor,
  });

  it("is a switch only when HEAD left the baseline's history", async () => {
    expect(await headSwitched(git({ commit: "b", branch: "other" }, false), { baseCommit: "a", branch: "main" })).toBe(true);
    expect(await headSwitched(git({ commit: "b", branch: "feature" }, true), { baseCommit: "a", branch: "main" })).toBe(false);
    expect(await headSwitched(git({ commit: "b", branch: "main" }, false), { baseCommit: "a", branch: "main" })).toBe(false);
    expect(await headSwitched(git({ commit: "a", branch: "x" }, false), { baseCommit: "a", branch: "main" })).toBe(false);
  });

  it("falls through to the ancestry test on a detached HEAD", async () => {
    expect(await headSwitched(git({ commit: "b" }, false), { baseCommit: "a" })).toBe(true);
    expect(await headSwitched(git({ commit: "b" }, true), { baseCommit: "a" })).toBe(false);
    expect(await headSwitched(git({ commit: "b" }, undefined), { baseCommit: "a" })).toBe(false);
  });
});

describe("batched blob reads and synced-record privacy", () => {
  it("parses git cat-file --batch output as bytes, missing blobs as null", () => {
    const out = Buffer.concat([Buffer.from("abc blob 3\n"), Buffer.from([0x61, 0x0d, 0x0a]), Buffer.from("\nmain:gone missing\n")]);
    const blobs = parseCatFileBatch(out, ["a.txt", "gone"])!;
    expect([...blobs.get("a.txt")!]).toEqual([0x61, 0x0d, 0x0a]);
    expect(blobs.get("gone")).toBeNull();
  });

  it("never syncs a local path or a repo's own override names", () => {
    expect(syncedRepository("https://github.com/acme/repo.git")).toBe("https://github.com/acme/repo.git");
    expect(syncedRepository("C:\\work\\repo")).toMatch(/^local:[0-9a-f]{16}$/);
    expect(syncedRepository("/home/me/repo")).toMatch(/^local:[0-9a-f]{16}$/);
    const red = redactDropped(["invalid:guards.secretGuardName", "unknown-key:x", ...Array.from({ length: 30 }, (_, i) => `invalid:io.${i}`)]);
    expect(red[0]).toMatch(/^invalid:guards#[0-9a-f]{8}$/);
    expect(red.join(" ")).not.toContain("secretGuardName");
    expect(red).toHaveLength(21);
    expect(red[20]).toBe("truncated:12");
  });

  it("keeps a file the run's tools wrote, and is conservative only without that evidence", () => {
    const file = { path: "a.ts", attribution: "run-authored" };
    expect(deltaAttribution(file, { overlap: true })).toBe("outside-run");
    expect(deltaAttribution(file, { overlap: true, writes: new Set(["a.ts"]) })).toBe("run-authored");
    expect(deltaAttribution(file, { overlap: false })).toBe("run-authored");
  });
});
