import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acceptAllEdits,
  acceptEdit,
  activateStaging,
  buildStagedSummary,
  buildUnifiedDiff,
  deactivateStaging,
  getStagedEdit,
  hasStagedEdits,
  isStagingActive,
  rejectAllEdits,
  rejectEdit,
  resetStagingForTests,
  resolveStagedTarget,
  stageEdit,
} from "./staged-edits.js";

afterEach(() => {
  resetStagingForTests();
  delete process.env.BUILDERFORCE_AGENTS_STAGED;
});

describe("staged-edits buffer", () => {
  it("is off by default and on via flag or env", () => {
    expect(isStagingActive()).toBe(false);
    activateStaging();
    expect(isStagingActive()).toBe(true);
    deactivateStaging();
    expect(isStagingActive()).toBe(false);
    process.env.BUILDERFORCE_AGENTS_STAGED = "true";
    expect(isStagingActive()).toBe(true);
  });

  it("stages, diffs, accepts, and writes to disk", async () => {
    const dir = mkdtempSync(join(tmpdir(), "staged-"));
    const file = join(dir, "a.ts");
    writeFileSync(file, "alpha\nkeep\nomega\n", "utf-8");

    const staged = stageEdit({
      filePath: file,
      proposedContent: "alpha\nkeep\nchanged\n",
      toolCallId: "t1",
      label: "edit",
    });
    expect(staged.staged).toBe(true);
    expect(hasStagedEdits()).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("alpha\nkeep\nomega\n");

    const diff = buildUnifiedDiff(getStagedEdit(file)!);
    expect(diff).toContain("-omega");
    expect(diff).toContain("+changed");
    expect(diff).toContain(" keep");
    expect(diff).not.toMatch(/^-alpha/m);

    const accepted = await acceptEdit(file);
    expect(accepted.accepted).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("alpha\nkeep\nchanged\n");
    expect(hasStagedEdits()).toBe(false);
  });

  it("accumulates sequential edits against the original disk snapshot", async () => {
    const dir = mkdtempSync(join(tmpdir(), "staged-"));
    const file = join(dir, "b.ts");
    writeFileSync(file, "one\n", "utf-8");
    stageEdit({ filePath: file, proposedContent: "two\n", toolCallId: "a" });
    stageEdit({ filePath: file, proposedContent: "three\n", toolCallId: "b" });
    const edit = getStagedEdit(file)!;
    expect(edit.originalContent).toBe("one\n");
    expect(edit.proposedContent).toBe("three\n");
    expect(edit.toolCallId).toBe("b");
  });

  it("rejects without touching disk and resolves a basename target", async () => {
    const dir = mkdtempSync(join(tmpdir(), "staged-"));
    const file = join(dir, "MixedCase.ts");
    writeFileSync(file, "old\n", "utf-8");
    stageEdit({ filePath: file, proposedContent: "new\n", toolCallId: "t" });
    expect(resolveStagedTarget("mixedcase.ts")?.filePath).toBe(file);
    const rejected = rejectEdit("MixedCase.ts");
    expect(rejected.rejected).toBe(true);
    expect(readFileSync(file, "utf-8")).toBe("old\n");
    expect(hasStagedEdits()).toBe(false);
  });

  it("acceptAll snapshots keys so every file is applied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "staged-"));
    const a = join(dir, "a.txt");
    const b = join(dir, "b.txt");
    stageEdit({ filePath: a, proposedContent: "A", toolCallId: "1" });
    stageEdit({ filePath: b, proposedContent: "B", toolCallId: "2" });
    const { accepted, failed } = await acceptAllEdits();
    expect(failed).toEqual([]);
    expect(accepted.sort()).toEqual([a, b].sort());
    expect(readFileSync(a, "utf-8")).toBe("A");
    expect(readFileSync(b, "utf-8")).toBe("B");
  });

  it("rejectAll clears the buffer", () => {
    stageEdit({ filePath: "ghost.ts", proposedContent: "x", toolCallId: "1" });
    expect(rejectAllEdits().rejected).toHaveLength(1);
    expect(hasStagedEdits()).toBe(false);
    expect(buildStagedSummary()).toBe("No staged changes.");
  });
});
