import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { readOneFile } from "./fileRead.js";
import { gzipText } from "./gzipText.js";
import { memoryWorkspaceFs } from "./memoryWorkspaceFs.js";
import { nodeWorkspaceFs } from "./node-workspace.js";
import { createRepoCapabilities } from "./workspace.js";
import { runWorkspaceConformance } from "./workspaceConformance.test-util.js";

runWorkspaceConformance("memoryWorkspaceFs", async () => {
  const fs = memoryWorkspaceFs({});
  return {
    fs,
    async seed(files) {
      for (const [path, content] of Object.entries(files)) fs.files.set(path, content);
    },
  };
});

it("reads a gzip file as text and preserves the archive when a text edit is refused", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-workspace-gzip-"));
  try {
    const path = "pack.gz";
    const bytes = await gzipText("a gzip search term");
    await writeFile(join(root, path), bytes);
    const caps = createRepoCapabilities(nodeWorkspaceFs(root));
    expect(await readOneFile(path, {}, { capabilities: new Set(["repo.read"]), ...caps })).toMatchObject({
      ok: true, content: "a gzip search term", decompressed: true,
    });
    expect(await caps.repoRead.searchCode("search term")).toMatchObject({ ok: true, total: 1 });
    expect(await caps.repoWrite.editFile(path, "search", "edited")).toMatchObject({ ok: false, code: "unsupported" });
    expect(await readFile(join(root, path))).toEqual(Buffer.from(bytes));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

runWorkspaceConformance("nodeWorkspaceFs (temp dir)", async () => {
  const root = await mkdtemp(join(tmpdir(), "bf-conformance-"));
  return {
    fs: nodeWorkspaceFs(root),
    async seed(files) {
      for (const [path, content] of Object.entries(files)) {
        const abs = join(root, path);
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, content, "utf8");
      }
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
});
