/**
 * The verifier's process runner: argument arrays only, `.cmd` for the package managers only,
 * and an argument cmd.exe could expand is refused before anything starts.
 */
import { describe, expect, it } from "vitest";
import { launchPlan, spawnEnvFor, systemCmdPath } from "./execRunner";
import { targetedTestCommand } from "./targetedTests";

/** The injected console node: proves launchPlan uses the resolver, not process.execPath or a bare name. */
const FAKE_NODE = "C:\\nodejs\\node.exe";

describe("launchPlan", () => {
  it("regression: node on Windows is the resolved PATH node (never node.cmd, never a cwd lookup), spawned without a shell", () => {
    const cliNode = (): string => { throw new Error("the version-floored CLI node is not for a bare node"); };
    expect(launchPlan(["node", "C:\\r\\scripts\\run-checks.mjs", "C:\\r\\scripts\\checks.manifest.mjs"], "win32", "C:\\r", () => null, cliNode, () => undefined, () => "C:\\cmd.exe", () => FAKE_NODE)).toEqual({
      file: FAKE_NODE,
      args: ["C:\\r\\scripts\\run-checks.mjs", "C:\\r\\scripts\\checks.manifest.mjs"],
      verbatim: false,
    });
  });

  it("regression: npx/npm are spawned via the node executable + the resolved CLI entry, not the mis-resolving cmd shim", () => {
    // Windows: `cmd.exe /d /v:off /s /c "npx.cmd …"` with verbatim quoting makes npx.cmd
    // mis-resolve its own location and die with `Cannot find module …/npm/bin/npx-cli.js`
    // (exit 1, no findings). The plan must bypass the shim entirely.
    const fakeCli = "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
    expect(launchPlan(["npx", "--no-install", "vitest", "run", "src\\runStore\\deterministicFinish.test.ts"], "win32", "C:\\r", () => fakeCli, () => FAKE_NODE))
      .toEqual({ file: FAKE_NODE, args: [fakeCli, "--no-install", "vitest", "run", "src\\runStore\\deterministicFinish.test.ts"], verbatim: false });
    const fakeNpmCli = "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    expect(launchPlan(["npm", "test"], "win32", "C:\\r", (_cwd, cli) => (cli === "npm-cli.js" ? fakeNpmCli : null), () => FAKE_NODE))
      .toEqual({ file: FAKE_NODE, args: [fakeNpmCli, "test"], verbatim: false });
  });

  it("regression: an npx-cli.js stub whose sibling npm-prefix.js is missing falls back to the cmd shim (never dies at require-time)", () => {
    // A partial `npm` package can ship only the CLI entry: `node <stub>/npx-cli.js` then dies
    // with `Cannot find module …/npm/bin/npm-prefix.js` (exit 1, no findings). The resolver
    // must reject that entry so launchPlan falls through to the npm beside the running node.
    expect(launchPlan(["npx", "--no-install", "vitest", "run"], "win32", "C:\\r", () => null))
      .toEqual({ file: systemCmdPath(), args: ["/d", "/v:off", "/s", "/c", '""npx.cmd" "--no-install" "vitest" "run""'], verbatim: true });
  });

  it("npx/npm fall back to the cmd shim only when the CLI entry cannot be resolved", () => {
    expect(launchPlan(["npx", "vitest"], "win32", "C:\\r", () => null))
      .toEqual({ file: systemCmdPath(), args: ["/d", "/v:off", "/s", "/c", '""npx.cmd" "vitest""'], verbatim: true });
  });

  it("launches a package-manager shim through cmd.exe with every argument quoted", () => {
    const plan = launchPlan(["pnpm", "run", "typecheck"], "win32");
    expect(plan).toEqual({ file: systemCmdPath(), args: ["/d", "/v:off", "/s", "/c", '""pnpm.cmd" "run" "typecheck""'], verbatim: true });
  });

  it("regression: the cmd shim runs through the injected absolute shell, never a bare cmd.exe (cwd-first search)", () => {
    const shell = "C:\\Windows\\System32\\cmd.exe";
    expect(launchPlan(["pnpm", "run", "typecheck"], "win32", "C:\\r", () => null, () => FAKE_NODE, () => undefined, () => shell)?.file).toBe(shell);
  });

  it("regression: a file path cmd would expand is refused on the cmd shim path, never interpolated", () => {
    // pnpm/yarn go through cmd.exe: a % or " there IS interpolated by the shell, so it must refuse.
    expect(launchPlan(["pnpm", "run", "C:\\r\\%PATH%.test.ts"], "win32")).toBeNull();
    expect(launchPlan(["pnpm", "run", 'C:\\r\\a".test.ts'], "win32")).toBeNull();
    // npx/npm are spawned directly through node (no shell): % and " are literal arguments.
    const plan = launchPlan(targetedTestCommand("vitest", ['C:\\r\\a".test.ts']), "win32", undefined, () => "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js");
    expect(plan?.args.at(-1)).toBe('C:\\r\\a".test.ts');
  });

  it("node keeps its name off Windows", () => {
    expect(launchPlan(["node", "x.js"], "linux")).toEqual({ file: "node", args: ["x.js"], verbatim: false });
  });

  it("regression: on Windows a bare non-shim program (git) is resolved on PATH, never left to libuv's cwd-first search", () => {
    const gitExe = "C:\\Program Files\\Git\\cmd\\git.exe";
    const which = (p: string): string | undefined => (p === "git" ? gitExe : undefined);
    expect(launchPlan(["git", "status"], "win32", "C:\\r", () => null, () => FAKE_NODE, which))
      .toEqual({ file: gitExe, args: ["status"], verbatim: false });
    // Not on PATH: the bare name goes through unchanged.
    expect(launchPlan(["tool", "a"], "win32", "C:\\r", () => null, () => FAKE_NODE, which))
      .toEqual({ file: "tool", args: ["a"], verbatim: false });
  });

  it("npx/npm resolve the node once and hand it to the CLI resolver", () => {
    const seen: string[] = [];
    const plan = launchPlan(["npx", "vitest"], "win32", "C:\\r", (_cwd, _cli, node) => { seen.push(node); return "C:\\n\\npx-cli.js"; }, () => FAKE_NODE);
    expect(seen).toEqual([FAKE_NODE]);
    expect(plan?.file).toBe(FAKE_NODE);
  });

  it("on POSIX every argument is passed as-is — `$(…)` and backticks are never expanded", () => {
    const argv = targetedTestCommand("vitest", ["/r/$(rm -rf ~)`x`.test.ts"]);
    expect(launchPlan(argv, "linux")).toEqual({ file: "npx", args: ["--no-install", "vitest", "run", "/r/$(rm -rf ~)`x`.test.ts"], verbatim: false });
  });
});

describe("spawnEnvFor", () => {
  const base = { PATH: "C:\\bin" };
  const CODE = "C:\\VSCode\\Code.exe";

  it("the cmd-shim plan never resolves programs from the cwd", () => {
    expect(spawnEnvFor({ file: "C:\\Windows\\System32\\cmd.exe", verbatim: true }, base, CODE, "win32"))
      .toEqual({ PATH: "C:\\bin", NoDefaultCurrentDirectoryInExePath: "1" });
  });

  it("the host's Electron executable is told to run as Node", () => {
    expect(spawnEnvFor({ file: CODE, verbatim: false }, base, CODE, "win32")).toEqual({ PATH: "C:\\bin", ELECTRON_RUN_AS_NODE: "1" });
  });

  it("a real node.exe or any other program inherits the environment unchanged", () => {
    expect(spawnEnvFor({ file: FAKE_NODE, verbatim: false }, base, FAKE_NODE, "win32")).toBeUndefined();
    expect(spawnEnvFor({ file: "C:\\Git\\cmd\\git.exe", verbatim: false }, base, CODE, "win32")).toBeUndefined();
  });
});

describe("systemCmdPath", () => {
  it("a valid absolute ComSpec is used", () => {
    expect(systemCmdPath({ ComSpec: "D:\\Win\\system32\\CMD.EXE", SystemRoot: "C:\\Windows" })).toBe("D:\\Win\\system32\\CMD.EXE");
  });

  it("a relative or odd ComSpec falls back to SystemRoot\\System32\\cmd.exe", () => {
    expect(systemCmdPath({ ComSpec: "cmd.exe", SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\cmd.exe");
    expect(systemCmdPath({ ComSpec: "C:\\r\\evil.exe", SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\cmd.exe");
    expect(systemCmdPath({ ComSpec: ".\\cmd.exe", SystemRoot: "D:\\Win" })).toBe("D:\\Win\\System32\\cmd.exe");
  });

  it("with no environment it is C:\\Windows\\System32\\cmd.exe", () => {
    expect(systemCmdPath({})).toBe("C:\\Windows\\System32\\cmd.exe");
  });
});
