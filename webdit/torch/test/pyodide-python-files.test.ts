import { describe, expect, it } from "vitest";
import { torchPythonFiles } from "../src/pyodide";
// @ts-expect-error — a plain .mjs build script, no declarations
import { collectPythonFiles } from "../scripts/gen-python-files.mjs";

/** `src/pyodide/python-files.ts` is generated from `python/`; it must never drift from it. */
describe("bundled Python package", () => {
  it("matches python/ exactly (run `pnpm gen:python` after editing a .py file)", () => {
    const onDisk = Object.fromEntries(collectPythonFiles() as Array<[string, string]>);
    expect(torchPythonFiles()).toEqual(onDisk);
  });

  it("ships the torch package and the peft shim", () => {
    const files = Object.keys(torchPythonFiles());
    for (const path of ["torch/__init__.py", "torch/nn/__init__.py", "torch/nn/functional.py", "torch/optim/__init__.py", "torch/utils/peft.py", "peft/__init__.py"]) {
      expect(files).toContain(path);
    }
  });
});
