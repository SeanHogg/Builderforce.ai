import { describe, expect, it, vi } from "vitest";
import { previewOf, stillReported, type KnipReport } from "./knowledgeKnipReport";

vi.mock("vscode", async () => (await import("./vscodeL10nMock")).vscodeL10nMock);

const report: KnipReport = {
  files: ["src/dead.ts", "src/other.ts"],
  issues: [
    { file: "src/api.ts", exports: [{ name: "oldHelper", line: 12 }, { name: "legacy" }] },
    { file: "src/clean.ts", exports: [] },
  ],
};

describe("stillReported (the re-scan)", () => {
  it("an unused-file finding is gone when its file is no longer in knip's list", () => {
    expect(stillReported(report, "unused-file", ["src/dead.ts"])).toEqual(["src/dead.ts"]);
    expect(stillReported(report, "unused-file", ["src/gone.ts"])).toEqual([]);
  });

  it("an unused-export finding is gone when knip names no export in its file", () => {
    expect(stillReported(report, "unused-export", ["src/api.ts"])).toEqual(["src/api.ts"]);
    expect(stillReported(report, "unused-export", ["src/clean.ts"])).toEqual([]);
  });

  it("a named unused-export finding is gone when knip no longer names THAT export, whatever else the file still has", () => {
    expect(stillReported(report, "unused-export", ["src/api.ts"], "legacy")).toEqual(["src/api.ts"]);
    expect(stillReported(report, "unused-export", ["src/api.ts"], "removedAlready")).toEqual([]);
  });

  it("reads Windows separators and ./ the same", () => {
    expect(stillReported(report, "unused-file", [".\\src\\dead.ts"])).toEqual(["src/dead.ts"]);
  });

  it("has nothing to say about a kind knip does not report", () => {
    expect(stillReported(report, "cycle", ["src/dead.ts"])).toEqual([]);
  });
});

describe("previewOf (what the fix removes)", () => {
  it("lists each unused export knip names, with its line", () => {
    expect(previewOf(report, "unused-export", ["src/api.ts"])).toEqual([
      { path: "src/api.ts", removed: 2, lines: ["- export oldHelper  (line 12)", "- export legacy"] },
    ]);
  });

  it("lists ONLY the export a finding names: the fix removes that one, not its neighbours", () => {
    expect(previewOf(report, "unused-export", ["src/api.ts"], "legacy")).toEqual([{ path: "src/api.ts", removed: 1, lines: ["- export legacy"] }]);
  });

  it("marks a whole file for removal, and lists a file knip no longer reports with nothing to remove", () => {
    expect(previewOf(report, "unused-file", ["src/dead.ts", "src/gone.ts"])).toEqual([
      { path: "src/dead.ts", removed: 1, lines: ["- (the whole file)"] },
      { path: "src/gone.ts" },
    ]);
  });
});
