import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkCommand, detectManager, execCheck, isCheckId, resolveCheck } from "./knowledgeFixSteps";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

const dirs: string[] = [];
const temp = async (): Promise<string> => { const d = await mkdtemp(join(tmpdir(), "kg-steps-")); dirs.push(d); return d; };
afterEach(async () => { await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });

describe("checkCommand", () => {
  it("runs the project's own script, with the package manager given", () => {
    expect(checkCommand("types", { typecheck: "tsc" }, "npm")).toBe("npm run typecheck");
    expect(checkCommand("tests", { test: "vitest" }, "pnpm")).toBe("pnpm run test");
    expect(checkCommand("tests", { test: "jest" }, "yarn")).toBe("yarn run test");
  });

  it("finds the type check under its usual names, first match wins", () => {
    expect(checkCommand("types", { tsc: "tsc --noEmit", typecheck: "tsgo" }, "npm")).toBe("npm run typecheck");
    expect(checkCommand("types", { tsc: "tsc --noEmit" }, "npm")).toBe("npm run tsc");
  });

  it("is undefined (the check is skipped, never passed) when the project has no such script", () => {
    expect(checkCommand("types", { build: "x" }, "npm")).toBeUndefined();
    expect(checkCommand("types", undefined, "npm")).toBeUndefined();
    expect(checkCommand("tests", { test: 5 }, "npm")).toBeUndefined();
  });

  it("knows exactly the two script checks (the re-scan and the review are not scripts), and not what every object inherits", () => {
    expect(["types", "tests"].every(isCheckId)).toBe(true);
    for (const bad of ["build", "lint", "rescan", "review", "deploy", "constructor", "__proto__", "toString", "hasOwnProperty"]) expect(isCheckId(bad)).toBe(false);
    expect(checkCommand("constructor", { constructor: "x" }, "npm")).toBeUndefined();
  });
});

describe("the package manager", () => {
  it("is the nearest lockfile's, searched up to the repository top (a pnpm monorepo folder uses pnpm)", async () => {
    const top = await temp();
    await mkdir(join(top, ".git"));
    await writeFile(join(top, "pnpm-lock.yaml"), "");
    const sub = join(top, "packages", "app");
    await mkdir(sub, { recursive: true });
    expect(await detectManager(sub)).toBe("pnpm");
    await writeFile(join(sub, "yarn.lock"), "");
    expect(await detectManager(sub)).toBe("yarn"); // nearer wins
  });

  it("is npm with no lockfile, and never climbs past the repository top", async () => {
    const outer = await temp();
    await writeFile(join(outer, "pnpm-lock.yaml"), "");
    const repo = join(outer, "repo");
    await mkdir(join(repo, ".git"), { recursive: true });
    expect(await detectManager(repo)).toBe("npm");
  });
});

describe("running a check", () => {
  it("a project with no script for the check resolves to nothing: no command, nothing to spawn", async () => {
    const root = await temp();
    await writeFile(join(root, "package.json"), JSON.stringify({ scripts: { build: "x" } }));
    expect(await resolveCheck(root, "types")).toBeUndefined();
    expect(await resolveCheck(await temp(), "tests")).toBeUndefined(); // no package.json at all
    await expect(resolveCheck(root, "__proto__")).rejects.toThrow(/no check/);
  });

  it("passes on exit 0, fails with the output tail otherwise", async () => {
    const root = await temp();
    expect(await execCheck(root, "node -e \"process.exit(0)\"")).toEqual({ status: "pass" });
    const fail = await execCheck(root, "node -e \"console.error('boom'); process.exit(3)\"");
    expect(fail.status).toBe("fail");
    expect(fail.detail).toMatch(/failed \(exit 3\)/);
    expect(fail.detail).toContain("boom");
  });
});
