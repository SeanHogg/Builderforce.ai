import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { memoryWorkspaceFs } from "./memoryWorkspaceFs.js";
import { nodeWorkspaceFs } from "./node-workspace.js";
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
