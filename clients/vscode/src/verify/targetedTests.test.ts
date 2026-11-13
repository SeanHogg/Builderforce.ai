import * as path from "path";
import { describe, expect, it } from "vitest";
import { coLocatedTestNames, targetedTestRecords, testsFor, type TestFileSystem } from "./targetedTests";

const root = path.join(path.sep, "repo", "pkg");
const at = (...parts: string[]) => path.join(root, ...parts);

/** An in-memory package: `files` maps absolute path → contents. */
function memFs(files: Record<string, string>, withList = true): TestFileSystem {
  return {
    readFile: async (p) => files[p] ?? null,
    exists: async (p) => p in files,
    ...(withList
      ? { list: async (dir: string) => Object.keys(files).filter((p) => path.dirname(p) === dir).map((p) => path.basename(p)) }
      : {}),
  };
}

const pkgJson = JSON.stringify({ scripts: { test: "vitest run" } });

describe("testsFor", () => {
  it("regression: a changed TEST file is its own test (never looks for x.test.test.ts)", async () => {
    const fs = memFs({ [at("package.json")]: pkgJson, [at("src", "a.test.ts")]: "" });
    expect(await testsFor(at("src", "a.test.ts"), fs)).toEqual([at("src", "a.test.ts")]);
  });

  it("regression: finds x.<part>.test.ts beside a changed x.ts, as the header promises", async () => {
    const fs = memFs({
      [at("src", "session.ts")]: "",
      [at("src", "session.mint.test.ts")]: "",
      [at("src", "sessionx.test.ts")]: "",
    });
    expect(await testsFor(at("src", "session.ts"), fs)).toEqual([at("src", "session.mint.test.ts")]);
  });

  it("finds x.test.ts and x.spec.tsx without a directory listing", async () => {
    const fs = memFs({ [at("a.ts")]: "", [at("a.test.ts")]: "", [at("a.spec.tsx")]: "" }, false);
    expect(await testsFor(at("a.ts"), fs)).toEqual([at("a.test.ts"), at("a.spec.tsx")]);
  });

  it("coLocatedTestNames lists the four direct candidates", () => {
    expect(coLocatedTestNames(at("a.ts")).map((p) => path.basename(p))).toEqual(["a.test.ts", "a.test.tsx", "a.spec.ts", "a.spec.tsx"]);
  });
});

describe("targetedTestRecords", () => {
  it("regression: a Windows path is passed RELATIVE and with forward slashes", async () => {
    // commit bb4bc9a40: the runner (vitest/jest) matches its file filter against paths
    // RELATIVE to the cwd it runs in. An absolute Windows path matched nothing → vitest
    // "No test files found" → exit 1 → the gate recorded `fail` for a test that never ran.
    // `path.relative` yields backslashes on Windows; the runner's filter does not
    // normalize them, so the separators must be forwarded as `/` or the glob matches
    // nothing the same way (`srca.test.ts`).
    const wp = path.win32;
    const pkg = "C:\\repo\\pkg";
    const at = (...parts: string[]) => wp.join(pkg, ...parts);
    const fs = memFs({ [at("package.json")]: pkgJson, [at("src", "a.ts")]: "", [at("src", "a.test.ts")]: "" });
    const ran: string[][] = [];
    const records = await targetedTestRecords([at("src", "a.ts")], pkg, fs,
      { runFor: async (argv) => { ran.push([...argv]); return { exitCode: 0 }; } },
      { now: () => 1, pathImpl: wp });
    expect(ran).toEqual([["npx", "--no-install", "vitest", "run", "src/a.test.ts"]]);
    expect(records.map((r) => r.outcome)).toEqual(["pass"]);
  });

  it("regression: editing only a test file runs that test", async () => {
    const fs = memFs({ [at("package.json")]: pkgJson, [at("src", "a.test.ts")]: "" });
    const ran: string[][] = [];
    const records = await targetedTestRecords([at("src", "a.test.ts")], root, fs, {
      runFor: async (argv) => { ran.push([...argv]); return { exitCode: 0 }; },
    }, { now: () => 1 });
    expect(ran).toEqual([["npx", "--no-install", "vitest", "run", "src/a.test.ts"]]);
    expect(records.map((r) => r.outcome)).toEqual(["pass"]);
  });

  it("records a timeout (124) as unavailable and a non-zero exit as fail", async () => {
    const fs = memFs({ [at("package.json")]: pkgJson, [at("a.ts")]: "", [at("a.test.ts")]: "" });
    const run = (exitCode: number) => targetedTestRecords([at("a.ts")], root, fs, { runFor: async () => ({ exitCode }) });
    expect((await run(124))[0]?.outcome).toBe("unavailable");
    expect((await run(1))[0]?.outcome).toBe("fail");
  });

  it("runs nothing when the source has no co-located test", async () => {
    const fs = memFs({ [at("package.json")]: pkgJson, [at("a.ts")]: "" });
    expect(await targetedTestRecords([at("a.ts")], root, fs, { runFor: async () => ({ exitCode: 0 }) })).toEqual([]);
  });
});
