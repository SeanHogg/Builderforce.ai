import { describe, expect, it } from "vitest";
import { ReadCoverage, type ReadCoverageTraits } from "./readCoverage.js";
import { singleReadsOf } from "./multiRead.js";
import { parseShellFileRead, shellReadAsFileRead } from "./shellFileRead.js";

const traits: ReadCoverageTraits = {
  visitTarget: (args) => (args as { path?: string }).path,
  activityTarget: (args) => (args as { path?: string }).path,
  questionSeparator: " ∋ ",
  isUnscopedMutation: (tool) => tool === "sh",
  isCodeChangeTool: (tool) => tool === "write_file",
  isLocalWorkspaceTool: (tool) => ["read_file", "write_file", "sh"].includes(tool),
  isRepoPublishTool: () => false,
  isRepoStateReadTool: () => false,
};

const numbered = (n: number, from = 1) => Array.from({ length: n }, (_, i) => `line ${from + i}`).join("\n");

describe("coverage reasons from the SERVED window (PRD 35 E1)", () => {
  // A 534-line file: the tool returned it whole, the transcript budget served lines 1–250.
  const full = { ok: true, path: "doc.md", content: numbered(534), offset: 1, totalLines: 534, truncated: false };
  const served = { ok: true, path: "doc.md", content: numbered(250), offset: 1, totalLines: 534, truncated: true, note: "Showing lines 1–250 of 534." };

  it("does not cover lines the model was never served", () => {
    const c = new ReadCoverage(traits);
    c.record("read_file", { path: "doc.md" });
    c.cacheResult("read_file", { path: "doc.md" }, { result: full, served, anchor: {} });
    expect(c.coveredRead("read_file", { path: "doc.md", offset: 251, limit: 100 })).toBeNull();
    // …and still covers what it was served.
    const hit = c.coveredRead("read_file", { path: "doc.md", offset: 100, limit: 50 })!;
    expect(hit).toMatchObject({ start: 100, end: 149 });
    expect(hit.note).toMatch(/offset 251/);
    // The replay keeps the full result to serve the requested window from.
    expect(hit.cached?.result).toBe(full);
  });

  it("clips to EOF only when the served copy reached it", () => {
    const c = new ReadCoverage(traits);
    c.record("read_file", { path: "doc.md" });
    c.cacheResult("read_file", { path: "doc.md" }, { result: full, served, anchor: {} });
    // The default 1–2000 request is NOT the same question as the 1–250 the model saw.
    expect(c.coveredRead("read_file", { path: "doc.md" })).toBeNull();
  });
});

describe("read_file paths[]", () => {
  it("stands for one single-path read per file", () => {
    expect(singleReadsOf("read_file", { paths: ["a.ts", " ", "b.ts"], limit: 40 })).toEqual([
      { path: "a.ts", limit: 40 },
      { path: "b.ts", limit: 40 },
    ]);
    expect(singleReadsOf("read_file", { path: "a.ts" })).toBeNull();
    expect(singleReadsOf("search_code", { paths: ["a.ts"] })).toBeNull();
  });

  it("records and caches each file, so a later single read of one is covered", () => {
    const c = new ReadCoverage(traits);
    const args = { paths: ["a.ts", "b.ts"] };
    c.record("read_file", args);
    const a = { ok: true, path: "a.ts", content: numbered(30), offset: 1, totalLines: 30, truncated: false };
    const b = { ok: true, path: "b.ts", content: numbered(10), offset: 1, totalLines: 10, truncated: false };
    c.cacheResult("read_file", args, { result: { ok: true, files: [a, b] }, anchor: {} });
    expect(c.isRepeat("read_file", { path: "a.ts" })).toBe(true);
    expect(c.cachedResult("read_file", { path: "b.ts" })?.result).toBe(b);
    expect(c.coveredRead("read_file", { path: "a.ts", offset: 5, limit: 10 })).toMatchObject({ start: 5, end: 14 });
    // The multi call itself is never stubbed.
    expect(c.isRepeat("read_file", args)).toBe(false);
  });

  it("counts a visit per file, and un-arms a file that failed inside the call", () => {
    const c = new ReadCoverage(traits);
    c.record("read_file", { path: "a.ts" });
    const visit = c.record("read_file", { paths: ["a.ts", "gone.ts"] });
    expect(visit?.count).toBe(2);
    c.cacheResult("read_file", { paths: ["a.ts", "gone.ts"] }, {
      result: { ok: true, files: [{ ok: true, path: "a.ts", content: "x" }, { ok: false, path: "gone.ts", error: "not found" }] },
      anchor: {},
    });
    expect(c.isRepeat("read_file", { path: "gone.ts" })).toBe(false);
    expect(c.isRepeat("read_file", { path: "a.ts" })).toBe(true);
  });

  it("covers from each file's served window", () => {
    const c = new ReadCoverage(traits);
    const args = { paths: ["a.ts"] };
    c.record("read_file", args);
    const full = { ok: true, path: "a.ts", content: numbered(500), offset: 1, totalLines: 500, truncated: false };
    const served = { ...full, content: numbered(100), truncated: true };
    c.cacheResult("read_file", args, { result: { ok: true, files: [full] }, served: { ok: true, files: [served] }, anchor: {} });
    expect(c.coveredRead("read_file", { path: "a.ts", offset: 101, limit: 10 })).toBeNull();
    expect(c.coveredRead("read_file", { path: "a.ts", offset: 50, limit: 10 })).not.toBeNull();
  });
});

describe("a shell print of one file is a read of it", () => {
  it("parses the recognised forms, folding in one cd", () => {
    expect(parseShellFileRead("cat docs/a.md")).toEqual({ path: "docs/a.md", from: 1 });
    expect(parseShellFileRead("cd Builderforce.ai && sed -n '251,400p' docs/specs/35.md")).toEqual({ path: "Builderforce.ai/docs/specs/35.md", from: 251, count: 150 });
    expect(parseShellFileRead('sed -n "12p" ./a.ts')).toEqual({ path: "a.ts", from: 12, count: 1 });
    expect(parseShellFileRead("head -n 40 a.ts")).toEqual({ path: "a.ts", from: 1, count: 40 });
    expect(parseShellFileRead("head -40 a.ts")).toEqual({ path: "a.ts", from: 1, count: 40 });
    expect(parseShellFileRead("head a.ts")).toEqual({ path: "a.ts", from: 1, count: 10 });
    expect(parseShellFileRead("tail -n +300 a.ts")).toEqual({ path: "a.ts", from: 300 });
    expect(parseShellFileRead("tail -n 20 a.ts")).toEqual({ path: "a.ts", count: 20 });
  });

  it("refuses anything that is more than one plain print of one workspace file", () => {
    for (const command of [
      "cat a.ts | grep x",
      "cat a.ts b.ts",
      "cat *.ts",
      "cat $FILE",
      "cat /etc/passwd",
      "cat ../outside.ts",
      "cd .. && cat a.ts",
      "cat a.ts > b.ts",
      "sed -i 's/a/b/' a.ts",
      "sed -n '5,3p' a.ts",
      "tail -f log.txt",
      "git show HEAD:a.ts",
      "cat a.ts; rm a.ts",
    ]) {
      expect(parseShellFileRead(command), command).toBeNull();
    }
  });

  it("turns a print into the read_file it stands for", () => {
    const sed = shellReadAsFileRead("sed -n '251,260p' doc.md", `${numbered(10, 251)}\n`)!;
    expect(sed.args).toEqual({ path: "doc.md", offset: 251, limit: 10 });
    expect(sed.result).toMatchObject({ ok: true, offset: 251, truncated: true });
    // A print that ran out before its count reached EOF.
    const short = shellReadAsFileRead("sed -n '530,600p' doc.md", numbered(5, 530))!;
    expect(short.result).toMatchObject({ offset: 530, totalLines: 534, truncated: false });
    const cat = shellReadAsFileRead("cat doc.md", numbered(534))!;
    expect(cat.args).toEqual({ path: "doc.md" });
    expect(cat.result).toMatchObject({ offset: 1, totalLines: 534, truncated: false });
    expect(shellReadAsFileRead("tail -n 20 doc.md", numbered(20, 515))).toBeNull();
    expect(shellReadAsFileRead("cat doc.md", "")).toBeNull();
  });

  it("feeds coverage, so read_file of the same window is not read twice", () => {
    const c = new ReadCoverage(traits);
    const print = shellReadAsFileRead("sed -n '251,400p' doc.md", numbered(150, 251))!;
    c.record("read_file", print.args);
    c.cacheResult("read_file", print.args, { result: print.result, anchor: {} });
    expect(c.coveredRead("read_file", { path: "doc.md", offset: 300, limit: 50 })).toMatchObject({ start: 300, end: 349 });
    expect(c.coveredRead("read_file", { path: "doc.md", offset: 380, limit: 50 })).toBeNull();
  });
});
