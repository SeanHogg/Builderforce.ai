import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBuilderForceAgentsDir } from "../builderforce/project-dir.js";
import { syncBuilderForceAgentsDirectory } from "./builderforce-directory-sync.js";

describe("syncBuilderForceAgentsDirectory", () => {
  let tmp: string;
  let sent: Array<{ relPath: string }>;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "bf-dirsync-"));
    sent = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        sent = (JSON.parse(init.body) as { files: Array<{ relPath: string }> }).files;
        return { ok: true, status: 200, statusText: "OK" } as Response;
      }),
    );
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  });

  async function seed(workspaceDir: string): Promise<void> {
    const root = resolveBuilderForceAgentsDir(workspaceDir).root;
    await fs.mkdir(path.join(root, "node_modules", "dep"), { recursive: true });
    await fs.writeFile(path.join(root, "context.md"), "# ctx", "utf-8");
    await fs.writeFile(path.join(root, "node_modules", "dep", "index.js"), "x", "utf-8");
  }

  const params = (workspaceDir: string) => ({ workspaceDir, apiKey: "k", baseUrl: "http://localhost:1", agentNodeId: "n" });

  it("syncs files and skips dependency directories under the root", async () => {
    await seed(tmp);
    const { fileCount } = await syncBuilderForceAgentsDirectory(params(tmp));
    expect(fileCount).toBe(1);
    expect(sent.map((f) => f.relPath)).toEqual(["context.md"]);
  });

  it("regression: a workspace nested under a folder named like build output still syncs", async () => {
    const nested = path.join(tmp, "build", "app");
    await seed(nested);
    const { fileCount } = await syncBuilderForceAgentsDirectory(params(nested));
    expect(fileCount).toBe(1);
    expect(sent.map((f) => f.relPath)).toEqual(["context.md"]);
  });
});
