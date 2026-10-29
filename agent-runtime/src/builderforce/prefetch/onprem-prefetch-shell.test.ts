import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { onPremShell } from "./onprem-prefetch-port.js";

/**
 * The PreFetch executor's shell IS the on-prem shell (`buildNodeShell`): the working directory
 * arrives as `ShellRunOptions.cwd` and is where the process really starts, validated by the ONE
 * `resolveShellCwd`, so a directory outside the root, or one that is not there, runs nothing. A
 * real process reports its own cwd, so this asserts where it ran, not what it was handed.
 */
describe("onPremShell — the working directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "prefetch-shell-"));
  mkdirSync(path.join(root, "app"));
  writeFileSync(path.join(root, "where.js"), 'console.log(process.cwd());');
  afterAll(() => rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));

  const where = (cwd?: string) => onPremShell(root).run(`node "${path.join(root, "where.js")}"`, cwd ? { cwd } : undefined);
  const real = (p: string) => realpathSync(p);

  it("starts a command in the named directory, and one without in the root", async () => {
    expect(real((await where("app")).stdout?.trim() ?? "")).toBe(real(path.join(root, "app")));
    expect(real((await where()).stdout?.trim() ?? "")).toBe(real(root));
  });

  it("refuses a directory outside the root, or one that is not there, without starting anything", async () => {
    expect(await where("../elsewhere")).toMatchObject({ ok: false, error: expect.stringContaining("outside the workspace") });
    expect(await where("nope")).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
  });
});
