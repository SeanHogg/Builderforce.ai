import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEditTool, createReadTool, createWriteTool } from "./native-file-tools.js";

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
});
