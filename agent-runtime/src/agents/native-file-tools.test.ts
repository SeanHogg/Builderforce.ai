import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  activateStaging,
  getStagedEdit,
  hasStagedEdits,
  resetStagingForTests,
} from "../builderforce/staged-edits.js";
import { createEditTool, createReadTool, createWriteTool } from "./native-file-tools.js";

afterEach(() => {
  resetStagingForTests();
  delete process.env.BUILDERFORCE_AGENTS_STAGED;
});

describe("native file tools", () => {
  it("write → read round-trips, and edit replaces a unique span", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-"));
    const write = createWriteTool(dir);
    const read = createReadTool(dir);
    const edit = createEditTool(dir);

    const w = await write.execute("c", { path: "a.txt", content: "hello\nworld\n" });
    expect((w.content[0] as { text: string }).text).toContain("wrote");

    const r = await read.execute("c", { path: "a.txt" });
    expect((r.content[0] as { text: string }).text).toContain("hello");

    const e = await edit.execute("c", { path: "a.txt", oldText: "world", newText: "there" });
    expect((e.content[0] as { text: string }).text).toContain("edited");
    expect(readFileSync(join(dir, "a.txt"), "utf-8")).toBe("hello\nthere\n");
  });

  it("read honors offset/limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-"));
    await createWriteTool(dir).execute("c", { path: "n.txt", content: "1\n2\n3\n4\n5" });
    const r = await createReadTool(dir).execute("c", { path: "n.txt", offset: 2, limit: 2 });
    expect((r.content[0] as { text: string }).text).toContain("2\n3");
  });

  it("edit fails on a non-unique match", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-"));
    await createWriteTool(dir).execute("c", { path: "d.txt", content: "x x" });
    await expect(
      createEditTool(dir).execute("c", { path: "d.txt", oldText: "x", newText: "y" }),
    ).rejects.toThrow(/not unique/);
  });

  it("write/edit buffer to the staged map instead of disk when staging is on", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-"));
    activateStaging();
    const write = createWriteTool(dir);
    const edit = createEditTool(dir);
    const read = createReadTool(dir);

    const w = await write.execute("w1", { path: "new.txt", content: "hello\n" });
    expect((w.content[0] as { text: string }).text).toMatch(/Staged new file/);
    expect(existsSync(join(dir, "new.txt"))).toBe(false);
    expect(hasStagedEdits()).toBe(true);

    const rNew = await read.execute("r1", { path: "new.txt" });
    expect((rNew.content[0] as { text: string }).text).toContain("hello");

    writeFileSync(join(dir, "exist.txt"), "alpha\nomega\n", "utf-8");
    const e = await edit.execute("e1", {
      path: "exist.txt",
      oldText: "omega",
      newText: "beta",
    });
    expect((e.content[0] as { text: string }).text).toMatch(/Staged edit/);
    expect(readFileSync(join(dir, "exist.txt"), "utf-8")).toBe("alpha\nomega\n");
    expect(getStagedEdit(join(dir, "exist.txt"))?.proposedContent).toBe("alpha\nbeta\n");

    const e2 = await edit.execute("e2", {
      path: "exist.txt",
      oldText: "beta",
      newText: "gamma",
    });
    expect((e2.content[0] as { text: string }).text).toMatch(/Staged edit/);
    expect(getStagedEdit(join(dir, "exist.txt"))?.proposedContent).toBe("alpha\ngamma\n");
    expect(getStagedEdit(join(dir, "exist.txt"))?.originalContent).toBe("alpha\nomega\n");
  });
});
