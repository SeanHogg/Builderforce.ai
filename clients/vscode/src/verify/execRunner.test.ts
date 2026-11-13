/**
 * The verifier's process runner: argument arrays only, `.cmd` for the package managers only,
 * and an argument cmd.exe could expand is refused before anything starts.
 */
import { describe, expect, it } from "vitest";
import { launchPlan } from "./execRunner";
import { targetedTestCommand } from "./targetedTests";

describe("launchPlan", () => {
  it("regression: node stays node on Windows (node.cmd does not exist), spawned without a shell", () => {
    expect(launchPlan(["node", "C:\\r\\scripts\\run-checks.mjs", "C:\\r\\scripts\\checks.manifest.mjs"], "win32")).toEqual({
      file: "node",
      args: ["C:\\r\\scripts\\run-checks.mjs", "C:\\r\\scripts\\checks.manifest.mjs"],
      verbatim: false,
    });
  });

  it("regression: npx/npm are spawned via the node executable + the resolved CLI entry, not the mis-resolving cmd shim", () => {
    // Windows: `cmd.exe /d /v:off /s /c "npx.cmd …"` with verbatim quoting makes npx.cmd
    // mis-resolve its own location and die with `Cannot find module …/npm/bin/npx-cli.js`
    // (exit 1, no findings). The plan must bypass the shim entirely.
    const fakeCli = "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js";
    expect(launchPlan(["npx", "--no-install", "vitest", "run", "src\\runStore\\deterministicFinish.test.ts"], "win32", "C:\\r", () => fakeCli))
      .toEqual({ file: process.execPath, args: [fakeCli, "--no-install", "vitest", "run", "src\\runStore\\deterministicFinish.test.ts"], verbatim: false });
    const fakeNpmCli = "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js";
    expect(launchPlan(["npm", "test"], "win32", "C:\\r", (_cwd, cli) => (cli === "npm-cli.js" ? fakeNpmCli : null)))
      .toEqual({ file: process.execPath, args: [fakeNpmCli, "test"], verbatim: false });
  });

  it("npx/npm fall back to the cmd shim only when the CLI entry cannot be resolved", () => {
    expect(launchPlan(["npx", "vitest"], "win32", "C:\\r", () => null))
      .toEqual({ file: "cmd.exe", args: ["/d", "/v:off", "/s", "/c", '""npx.cmd" "vitest""'], verbatim: true });
  });

  it("launches a package-manager shim through cmd.exe with every argument quoted", () => {
    const plan = launchPlan(["pnpm", "run", "typecheck"], "win32");
    expect(plan).toEqual({ file: "cmd.exe", args: ["/d", "/v:off", "/s", "/c", '""pnpm.cmd" "run" "typecheck""'], verbatim: true });
  });

  it("regression: a file path cmd would expand is refused on the cmd shim path, never interpolated", () => {
    // pnpm/yarn go through cmd.exe: a % or " there IS interpolated by the shell, so it must refuse.
    expect(launchPlan(["pnpm", "run", "C:\\r\\%PATH%.test.ts"], "win32")).toBeNull();
    expect(launchPlan(["pnpm", "run", 'C:\\r\\a".test.ts'], "win32")).toBeNull();
    // npx/npm are spawned directly through node (no shell): % and " are literal arguments.
    const plan = launchPlan(targetedTestCommand("vitest", ['C:\\r\\a".test.ts']), "win32", undefined, () => "C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npx-cli.js");
    expect(plan?.args.at(-1)).toBe('C:\\r\\a".test.ts');
  });

  it("on POSIX every argument is passed as-is — `$(…)` and backticks are never expanded", () => {
    const argv = targetedTestCommand("vitest", ["/r/$(rm -rf ~)`x`.test.ts"]);
    expect(launchPlan(argv, "linux")).toEqual({ file: "npx", args: ["--no-install", "vitest", "run", "/r/$(rm -rf ~)`x`.test.ts"], verbatim: false });
  });
});
