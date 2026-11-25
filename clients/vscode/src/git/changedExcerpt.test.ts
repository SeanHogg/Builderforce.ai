import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { readChangedExcerpt } from "./changedExcerpt";

describe("readChangedExcerpt", () => {
  it("returns the head of a changed file and skips a path that escapes the root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-mem-"));
    await fs.writeFile(path.join(root, "a.ts"), "export const token = 1;\n", "utf8");
    const excerpt = await readChangedExcerpt(root, ["a.ts", "../outside.ts", "missing.ts"]);
    expect(excerpt).toContain("## a.ts");
    expect(excerpt).toContain("export const token = 1;");
    expect(excerpt).not.toContain("outside.ts");
  });
});
