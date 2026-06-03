import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { makeTempWorkspace } from "../test-helpers/workspace.js";

vi.mock("./workspace-templates.js", () => ({
  resolveWorkspaceTemplateDir: vi.fn(async () => path.join(process.cwd(), "__missing_templates__")),
}));

describe("ensureAgentWorkspace with missing packaged templates", () => {
  it("seeds embedded fallback templates instead of throwing", async () => {
    const tempDir = await makeTempWorkspace("builderforce-workspace-");
    const { ensureAgentWorkspace, DEFAULT_AGENTS_FILENAME, DEFAULT_BOOTSTRAP_FILENAME } =
      await import("./workspace.js");

    await expect(
      ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true }),
    ).resolves.toBeDefined();

    const agents = await fs.readFile(path.join(tempDir, DEFAULT_AGENTS_FILENAME), "utf-8");
    const bootstrap = await fs.readFile(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME), "utf-8");

    expect(agents).toContain("# AGENTS");
    expect(bootstrap).toContain("# BOOTSTRAP");
  });
});
