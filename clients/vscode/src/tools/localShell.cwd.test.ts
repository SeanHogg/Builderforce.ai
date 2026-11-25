import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalShell } from "./localShell";

/** The shared tools hand a directory to the shell as `cwd`; the shell spawns the command THERE (no `cd` in the text). */
describe("createLocalShell — the working directory", () => {
  let dir: string;
  let script: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "local-shell-cwd-"));
    fs.mkdirSync(path.join(dir, "sub"));
    script = path.join(dir, "where.js");
    fs.writeFileSync(script, "console.log(process.cwd());");
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const real = (p: string) => fs.realpathSync(p);
  const command = () => `node "${script}"`;

  it("runs in the root by default and in the named directory when given one", async () => {
    const shell = createLocalShell(dir);
    expect(real(((await shell.run(command())).stdout ?? "").trim())).toBe(real(dir));
    expect(real(((await shell.run(command(), { cwd: "sub" })).stdout ?? "").trim())).toBe(real(path.join(dir, "sub")));
  });

  it("refuses a directory outside the workspace or one that is not there, without running anything", async () => {
    const shell = createLocalShell(dir);
    expect(await shell.run(command(), { cwd: ".." })).toMatchObject({ ok: false, error: expect.stringContaining("outside the workspace") });
    expect(await shell.run(command(), { cwd: "missing" })).toMatchObject({ ok: false, error: expect.stringContaining("does not exist") });
    expect(await shell.start(command(), { cwd: ".." })).toMatchObject({ ok: false });
  });
});
