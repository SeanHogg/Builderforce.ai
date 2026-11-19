import { describe, expect, it } from "vitest";
import { isScratchScriptPath } from "./index.js";

describe("isScratchScriptPath", () => {
  // regression: VS Code chat #275 — `_split.cjs` helpers written into `frontend/`.
  it("matches an underscore-named .cjs/.mjs helper and anything in the per-run scratch folder", () => {
    expect(isScratchScriptPath("frontend/_split.cjs")).toBe(true);
    expect(isScratchScriptPath("tools\\_probe.MJS")).toBe(true);
    expect(isScratchScriptPath("/tmp/builderforce-scratch/run-9/probe.js")).toBe(true);
    expect(isScratchScriptPath("C:\\Temp\\builderforce-scratch\\shared\\x.ts")).toBe(true);
  });

  it("never matches real project files that start with an underscore", () => {
    for (const p of ["pages/_app.ts", "pages/_document.tsx", "public/_worker.js", "src/_notes.md", "src/x_y.cjs"]) {
      expect(isScratchScriptPath(p), p).toBe(false);
    }
  });
});
