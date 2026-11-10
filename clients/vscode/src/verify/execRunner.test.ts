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

  it("launches a package-manager shim through cmd.exe with every argument quoted", () => {
    const plan = launchPlan(["pnpm", "run", "typecheck"], "win32");
    expect(plan).toEqual({ file: "cmd.exe", args: ["/d", "/v:off", "/s", "/c", '""pnpm.cmd" "run" "typecheck""'], verbatim: true });
  });

  it("regression: a file path cmd would expand is refused, never interpolated", () => {
    expect(launchPlan(targetedTestCommand("vitest", ["C:\\r\\%PATH%.test.ts"]), "win32")).toBeNull();
    expect(launchPlan(targetedTestCommand("vitest", ['C:\\r\\a".test.ts']), "win32")).toBeNull();
  });

  it("on POSIX every argument is passed as-is — `$(…)` and backticks are never expanded", () => {
    const argv = targetedTestCommand("vitest", ["/r/$(rm -rf ~)`x`.test.ts"]);
    expect(launchPlan(argv, "linux")).toEqual({ file: "npx", args: ["--no-install", "vitest", "run", "/r/$(rm -rf ~)`x`.test.ts"], verbatim: false });
  });
});
