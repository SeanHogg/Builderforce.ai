import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({
  workspace: { workspaceFolders: [] },
}));

vi.mock("./modelRouting", () => ({
  routeComplete: async () => "",
}));

import { scanCodebase } from "./codebaseScan";

async function tokenOf(root: string): Promise<string> {
  const raw = await fs.readFile(path.join(root, ".builderforce", "scan.json"), "utf8");
  return (JSON.parse(raw) as { versionToken: string }).versionToken;
}

describe("workspace map cache token", () => {
  it("changes when a nested file is rewritten at the same size", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "bf-scan-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "a.ts"), "hello", "utf8");
    await scanCodebase({} as never, root, {} as never, true);
    const before = await tokenOf(root);

    // Same length, and mtime restored, so only a content hash notices.
    const file = path.join(root, "src", "a.ts");
    const st = await fs.stat(file);
    await fs.writeFile(file, "world", "utf8");
    await fs.utimes(file, st.atime, st.mtime);
    await scanCodebase({} as never, root, {} as never, false);
    expect(await tokenOf(root)).not.toBe(before);
  });
});
