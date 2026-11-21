/**
 * The GitPort reads what is PUSHED: the PR base for a pull request, the HEAD blob for each
 * file, and "unavailable" (never a pass) when nothing can be computed.
 */
import { describe, expect, it } from "vitest";
import { createGitPort, type GitRunner } from "./gitPort";

/** A fake git answering by the first argument; `over` replaces any answer. */
function fakeGit(over: (args: readonly string[]) => { stdout: string; exitCode: number } | undefined = () => undefined): { git: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    const o = over(args);
    if (o) return o;
    const a = args.join(" ");
    if (a === "rev-parse --abbrev-ref @{u}") return { stdout: "origin/feature\n", exitCode: 0 };
    if (a === "rev-parse --abbrev-ref HEAD") return { stdout: "feature\n", exitCode: 0 };
    if (a.startsWith("symbolic-ref")) return { stdout: "origin/main\n", exitCode: 0 };
    if (a.startsWith("rev-parse --verify --quiet origin/")) return { stdout: "x\n", exitCode: 0 };
    if (a.startsWith("rev-parse --verify --quiet HEAD:")) return { stdout: `blob-${args[3]}\n`, exitCode: 0 };
    if (a === "merge-base origin/main HEAD") return { stdout: "prbase\n", exitCode: 0 };
    if (a === "merge-base @{u} HEAD") return { stdout: "headitself\n", exitCode: 0 };
    if (a.startsWith("log prbase..HEAD")) return { stdout: "c0ffee0c0ffee0c0ffee0c0ffee0c0ffee0c0ffe\nsrc/a.ts\nsrc/a.test.ts\n", exitCode: 0 };
    if (a.startsWith("log headitself..HEAD")) return { stdout: "", exitCode: 0 };
    if (a === "diff --binary prbase..HEAD") return { stdout: "DIFF", exitCode: 0 };
    if (a === "diff --name-only HEAD --") return { stdout: "src/a.ts\n", exitCode: 0 };
    if (a.startsWith("cat-file blob HEAD:src/a.test.ts")) return { stdout: 'import { a } from "./a.js";\n', exitCode: 0 };
    return { stdout: "", exitCode: 0 };
  };
  return { git, calls };
}

describe("createGitPort", () => {
  it("regression: a pull request after the branch was pushed diffs against the PR base, not @{u}", async () => {
    const { git } = fakeGit();
    const out = await createGitPort(git).outgoing("/r", { pullRequest: {} });
    expect(out.unavailable).toBeUndefined();
    expect(out.diff).toBe("DIFF");
    expect(out.files.map((f) => f.absPath)).toEqual(["/r/src/a.ts", "/r/src/a.test.ts"]);
  });

  it("regression: hashes the HEAD blob, and a file also modified in the working tree is unavailable", async () => {
    const { git } = fakeGit();
    const out = await createGitPort(git).outgoing("/r", { pullRequest: {} });
    const [a, test] = out.files;
    expect(a?.hash).toBe("blob-HEAD:src/a.ts");
    expect(a?.unavailable).toMatch(/working tree/);
    expect(test?.unavailable).toBeUndefined();
    expect(test?.imports).toEqual(["/r/src/a.js"]);
  });

  it("regression: an empty outgoing set (the pushed branch's own upstream) is unavailable, with nothing to review", async () => {
    const { git } = fakeGit();
    const out = await createGitPort(git).outgoing("/r");
    expect(out.files).toEqual([]);
    expect(out.diff).toBe("");
    expect(out.unavailable).toMatch(/no outgoing commits/);
  });

  it("an empty set because HEAD is already on @{u} (merge-base == HEAD) is upToDate, naming HEAD and the upstream", async () => {
    const { git } = fakeGit((args) => (args.join(" ") === "rev-parse HEAD" ? { stdout: "headitself\n", exitCode: 0 } : undefined));
    const out = await createGitPort(git).outgoing("/r");
    expect(out.files).toEqual([]);
    expect(out.upToDate).toEqual({ head: "headitself", upstream: "origin/feature", ref: "HEAD", uncommitted: [] });
  });

  it("an upToDate checkout reports its uncommitted paths (absolute)", async () => {
    const { git } = fakeGit((args) => {
      const a = args.join(" ");
      if (a === "rev-parse HEAD") return { stdout: "headitself\n", exitCode: 0 };
      if (a.startsWith("status --porcelain")) return { stdout: " M src/a.ts\0?? new.ts\0R  b.ts\0old-b.ts\0", exitCode: 0 };
      return undefined;
    });
    const out = await createGitPort(git).outgoing("/r");
    expect(out.upToDate?.uncommitted).toEqual(["/r/src/a.ts", "/r/new.ts", "/r/b.ts"]);
  });

  it("regression: a named ref is read in place of HEAD — merge-base, log, diff and blob ids", async () => {
    const { git, calls } = fakeGit((args) => {
      const a = args.join(" ");
      if (a === "merge-base origin/main feat/x") return { stdout: "prbase\n", exitCode: 0 };
      if (a.startsWith("log prbase..feat/x")) return { stdout: "c0ffee0c0ffee0c0ffee0c0ffee0c0ffee0c0ffe\nsrc/a.ts\n", exitCode: 0 };
      if (a === "diff --binary prbase..feat/x") return { stdout: "FEATDIFF", exitCode: 0 };
      if (a.startsWith("rev-parse --verify --quiet feat/x:")) return { stdout: `blob-${args[3]}\n`, exitCode: 0 };
      if (a.startsWith("log prbase..HEAD")) throw new Error("read HEAD instead of the named ref");
      return undefined;
    });
    const out = await createGitPort(git).outgoing("/r", { pullRequest: {}, ref: "feat/x" });
    expect(out.diff).toBe("FEATDIFF");
    expect(out.files.map((f) => f.hash)).toEqual(["blob-feat/x:src/a.ts"]);
    expect(out.upToDate).toBeUndefined();
    expect(calls.map((c) => c.join(" "))).toContain("diff --name-only feat/x --");
  });

  it("regression: baseBranch describes the TARGET ref, not the checkout", async () => {
    const { git } = fakeGit((args) => (args.join(" ") === "rev-parse --abbrev-ref main@{u}" ? { stdout: "origin/main\n", exitCode: 0 } : undefined));
    // The checkout is `feature`; pushing `main` by ref is a base-branch push.
    const out = await createGitPort(git).outgoing("/r", { ref: "main" });
    expect(out.baseBranch).toBe(true);
  });

  it("an empty set whose merge-base is NOT HEAD is not upToDate", async () => {
    const { git } = fakeGit((args) => (args.join(" ") === "rev-parse HEAD" ? { stdout: "other\n", exitCode: 0 } : undefined));
    const out = await createGitPort(git).outgoing("/r");
    expect(out.upToDate).toBeUndefined();
    expect(out.unavailable).toMatch(/no outgoing commits/);
  });

  it("regression: no upstream is unavailable, never an empty pass", async () => {
    const { git } = fakeGit((args) => (args.includes("@{u}") ? { stdout: "", exitCode: 128 } : undefined));
    const out = await createGitPort(git).outgoing("/r");
    expect(out.unavailable).toMatch(/no upstream/);
  });

  it("regression: onBaseBranch is true when HEAD is on a base branch origin contains, with no path differing", async () => {
    // The change reached the base branch WITHOUT this run pushing it (another session's
    // commit swept it, a later run pushed it, the user pushed): `shippedToBaseBranch`
    // counted only this run's own push, so the ticket stayed `in_review` forever.
    const { git } = fakeGit((args) => {
      const a = args.join(" ");
      if (a === "rev-parse --verify --quiet HEAD") return { stdout: "abc123\n", exitCode: 0 };
      if (a === "rev-parse --abbrev-ref HEAD") return { stdout: "main\n", exitCode: 0 };
      if (a === "merge-base origin/main HEAD") return { stdout: "abc123\n", exitCode: 0 };
      if (a === "rev-parse HEAD") return { stdout: "abc123\n", exitCode: 0 };
      return undefined;
    });
    expect(await createGitPort(git).onBaseBranch!("/r", ["src/a.ts"])).toBe(true);
  });

  it("regression: onBaseBranch is false on a feature branch, or when origin's base does not contain HEAD", async () => {
    const feature = fakeGit((args) => {
      const a = args.join(" ");
      if (a === "rev-parse --abbrev-ref HEAD") return { stdout: "feature/x\n", exitCode: 0 };
      return undefined;
    });
    expect(await createGitPort(feature.git).onBaseBranch!("/r", ["src/a.ts"])).toBe(false);
    const ahead = fakeGit((args) => {
      const a = args.join(" ");
      if (a === "rev-parse --abbrev-ref HEAD") return { stdout: "main\n", exitCode: 0 };
      if (a === "merge-base origin/main HEAD") return { stdout: "older\n", exitCode: 0 };
      if (a === "rev-parse HEAD") return { stdout: "abc123\n", exitCode: 0 };
      return undefined;
    });
    expect(await createGitPort(ahead.git).onBaseBranch!("/r", ["src/a.ts"])).toBe(false);
  });
});
