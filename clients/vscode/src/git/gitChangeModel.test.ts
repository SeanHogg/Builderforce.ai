import { describe, expect, it } from "vitest";
import {
  dedupeChanges,
  parsePorcelain,
  relativeTo,
  repoName,
  statusKindOf,
  toChangeSet,
  unquotePath,
  type PendingChange,
  GIT_STATUS,
} from "./gitChangeModel";

/**
 * The parsing IS the feature: every surface's "N changes pending" count and every
 * row the user clicks to open a diff is derived from these pure functions. A
 * mis-parsed rename or a double-counted staged-then-edited file is a number the user
 * cannot reconcile with the Source Control view sitting right next to it.
 */

const ROOT = "C:/repo";

describe("statusKindOf", () => {
  it("maps the index/worktree variants onto one vocabulary", () => {
    expect(statusKindOf(GIT_STATUS.MODIFIED)).toBe("modified");
    expect(statusKindOf(GIT_STATUS.INDEX_MODIFIED)).toBe("modified");
    expect(statusKindOf(GIT_STATUS.INDEX_ADDED)).toBe("added");
    expect(statusKindOf(GIT_STATUS.INTENT_TO_ADD)).toBe("added");
    expect(statusKindOf(GIT_STATUS.DELETED)).toBe("deleted");
    expect(statusKindOf(GIT_STATUS.INDEX_DELETED)).toBe("deleted");
    expect(statusKindOf(GIT_STATUS.INDEX_RENAMED)).toBe("renamed");
    expect(statusKindOf(GIT_STATUS.UNTRACKED)).toBe("untracked");
    expect(statusKindOf(GIT_STATUS.TYPE_CHANGED)).toBe("typechange");
  });

  it("treats every unmerged variant as a conflict", () => {
    for (const status of [
      GIT_STATUS.ADDED_BY_US,
      GIT_STATUS.ADDED_BY_THEM,
      GIT_STATUS.DELETED_BY_US,
      GIT_STATUS.DELETED_BY_THEM,
      GIT_STATUS.BOTH_ADDED,
      GIT_STATUS.BOTH_DELETED,
      GIT_STATUS.BOTH_MODIFIED,
    ]) {
      expect(statusKindOf(status)).toBe("conflict");
    }
  });
});

describe("parsePorcelain", () => {
  it("reads modified, staged, added and deleted entries", () => {
    const out = [" M src/a.ts", "M  src/b.ts", "A  src/c.ts", " D src/d.ts"].join("\n");
    expect(parsePorcelain(out, ROOT)).toEqual<PendingChange[]>([
      { path: `${ROOT}/src/a.ts`, relativePath: "src/a.ts", repoRoot: ROOT, status: "modified", staged: false },
      { path: `${ROOT}/src/b.ts`, relativePath: "src/b.ts", repoRoot: ROOT, status: "modified", staged: true },
      { path: `${ROOT}/src/c.ts`, relativePath: "src/c.ts", repoRoot: ROOT, status: "added", staged: true },
      { path: `${ROOT}/src/d.ts`, relativePath: "src/d.ts", repoRoot: ROOT, status: "deleted", staged: false },
    ]);
  });

  it("reports untracked files without calling them staged", () => {
    const [change] = parsePorcelain("?? new/file.ts", ROOT);
    expect(change).toMatchObject({ status: "untracked", staged: false, relativePath: "new/file.ts" });
  });

  it("keeps the destination of a rename, not the original", () => {
    const [change] = parsePorcelain("R  src/old.ts -> src/new.ts", ROOT);
    expect(change).toMatchObject({ status: "renamed", relativePath: "src/new.ts", staged: true });
  });

  it("marks unmerged entries as conflicts rather than staged edits", () => {
    const rows = parsePorcelain(["UU src/x.ts", "AA src/y.ts", "DU src/z.ts"].join("\n"), ROOT);
    expect(rows.map((r) => r.status)).toEqual(["conflict", "conflict", "conflict"]);
    expect(rows.every((r) => !r.staged)).toBe(true);
  });

  it("prefers the working-tree letter for display while still reporting staged", () => {
    // Staged an add, then deleted the file again: the pending edit is the deletion.
    const [change] = parsePorcelain("AD src/gone.ts", ROOT);
    expect(change).toMatchObject({ status: "deleted", staged: true });
  });

  it("unquotes paths git escaped, and ignores blank lines", () => {
    const rows = parsePorcelain(['?? "src/a file.ts"', "", "   "].join("\n"), ROOT);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.relativePath).toBe("src/a file.ts");
  });

  it("survives CRLF output", () => {
    expect(parsePorcelain(" M src/a.ts\r\n M src/b.ts\r\n", ROOT).map((r) => r.relativePath)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("dedupeChanges", () => {
  const change = (path: string, staged: boolean, status: PendingChange["status"] = "modified"): PendingChange => ({
    path,
    relativePath: path.slice(ROOT.length + 1),
    repoRoot: ROOT,
    status,
    staged,
  });

  it("counts a staged-then-edited file once and remembers it is staged", () => {
    const rows = dedupeChanges([change(`${ROOT}/src/a.ts`, false), change(`${ROOT}/src/a.ts`, true)]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.staged).toBe(true);
    expect(rows[0]!.status).toBe("modified");
  });

  it("treats paths differing only in case as one file (Windows)", () => {
    expect(dedupeChanges([change(`${ROOT}/src/A.ts`, false), change(`${ROOT}/SRC/a.ts`, true)])).toHaveLength(1);
  });

  it("sorts by repo-relative path so the list is stable between repaints", () => {
    const rows = dedupeChanges([change(`${ROOT}/z.ts`, false), change(`${ROOT}/a.ts`, false)]);
    expect(rows.map((r) => r.relativePath)).toEqual(["a.ts", "z.ts"]);
  });

  it("does not mutate the input rows", () => {
    const input = [change(`${ROOT}/a.ts`, false), change(`${ROOT}/a.ts`, true)];
    dedupeChanges(input);
    expect(input[0]!.staged).toBe(false);
  });
});

describe("toChangeSet", () => {
  it("drops clean repositories and totals distinct files", () => {
    const set = toChangeSet([
      { root: ROOT, name: "repo", changes: parsePorcelain(" M a.ts\n M b.ts", ROOT) },
      { root: "C:/clean", name: "clean", changes: [] },
    ]);
    expect(set.total).toBe(2);
    expect(set.repos.map((r) => r.name)).toEqual(["repo"]);
  });
});

describe("path helpers", () => {
  it("makes paths repo-relative regardless of separator or case", () => {
    expect(relativeTo("C:\\repo", "C:\\repo\\src\\a.ts")).toBe("src/a.ts");
    expect(relativeTo("C:/Repo", "C:/repo/src/a.ts")).toBe("src/a.ts");
  });

  it("leaves a path outside the root alone", () => {
    expect(relativeTo("C:/repo", "D:/other/a.ts")).toBe("D:/other/a.ts");
  });

  it("names a repository after its root folder", () => {
    expect(repoName("C:\\code\\Builderforce.ai")).toBe("Builderforce.ai");
    expect(repoName("/home/me/project/")).toBe("project");
  });

  it("unquotes only actually-quoted paths", () => {
    expect(unquotePath('"a b.ts"')).toBe("a b.ts");
    expect(unquotePath('"a\\"b.ts"')).toBe('a"b.ts');
    expect(unquotePath("plain.ts")).toBe("plain.ts");
  });
});
