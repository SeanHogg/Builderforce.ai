import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
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

  it("regression: edit failures speak this tool's vocabulary (no replaceAll / read_file / oldString)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-"));
    await createWriteTool(dir).execute("c", { path: "d.txt", content: "x x\nunique line\n" });
    const dup = (await createEditTool(dir).execute("c", { path: "d.txt", oldText: "x", newText: "y" }).catch((e: unknown) => e)) as Error;
    expect(dup.message).toMatch(/not unique/);
    expect(dup.message).not.toMatch(/replaceAll|oldString/);
    const miss = (await createEditTool(dir).execute("c", { path: "d.txt", oldText: "uniq line", newText: "y" }).catch((e: unknown) => e)) as Error;
    expect(miss.message).toMatch(/read tool/);
    expect(miss.message).not.toMatch(/read_file|oldString/);
  });

  it("regression: a read past the 2 MiB provider default still pages and reports the true line total", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-"));
    const line = `${"x".repeat(98)}\n`;
    writeFileSync(join(dir, "big.txt"), line.repeat(25_000), "utf-8");
    const r = await createReadTool(dir).execute("c", { path: "big.txt", offset: 24_990, limit: 5 });
    expect((r.content[0] as { text: string }).text).not.toMatch(/larger than/);
    expect((r.content[0] as { text: string }).text.split("\n").length).toBeGreaterThanOrEqual(5);
  });

  it("regression: a ../ escape is refused as outside_root by read, write and edit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-root-"));
    const outside = mkdtempSync(join(tmpdir(), "nft-out-"));
    writeFileSync(join(outside, "secret.txt"), "secret", "utf-8");
    const escape = `../${basename(outside)}/secret.txt`;
    await expect(createReadTool(dir).execute("c", { path: escape })).rejects.toThrow(/outside the workspace/);
    await expect(createWriteTool(dir).execute("c", { path: escape, content: "x" })).rejects.toThrow(/outside the workspace/);
    await expect(
      createEditTool(dir).execute("c", { path: escape, oldText: "secret", newText: "x" }),
    ).rejects.toThrow(/outside the workspace/);
    expect(readFileSync(join(outside, "secret.txt"), "utf-8")).toBe("secret");
  });

  it("regression: an absolute path outside the root is refused, and allowed once unconfined", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-root-"));
    const outside = mkdtempSync(join(tmpdir(), "nft-out-"));
    const file = join(outside, "a.txt");
    writeFileSync(file, "outside text", "utf-8");
    await expect(createReadTool(dir).execute("c", { path: file })).rejects.toThrow(/outside the workspace/);
    const r = await createReadTool(dir, { unconfined: true }).execute("c", { path: file });
    expect((r.content[0] as { text: string }).text).toContain("outside text");
  });

  it("regression: a missing file reports the provider's not_found text, never a host path", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nft-"));
    await expect(createReadTool(dir).execute("c", { path: "nope.txt" })).rejects.toThrow(/file not found: nope\.txt/);
    await expect(
      createEditTool(dir).execute("c", { path: "nope.txt", oldText: "a", newText: "b" }),
    ).rejects.toThrow(/file not found: nope\.txt/);
    for (const run of [
      () => createReadTool(dir).execute("c", { path: "nope.txt" }),
      () => createEditTool(dir).execute("c", { path: "nope.txt", oldText: "a", newText: "b" }),
    ]) {
      const err = (await run().catch((e: unknown) => e)) as Error;
      expect(err.message).not.toContain(dir);
      expect(err.message).not.toContain(tmpdir());
    }
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
