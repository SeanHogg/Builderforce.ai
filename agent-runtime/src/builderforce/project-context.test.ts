import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  initializeBuilderForceAgentsProject,
  isBuilderForceAgentsProject,
  resolveBuilderForceAgentsDir,
} from "./project-context.js";

// these tests validate that initialization creates the "foundational" files
// including the newly added governance.md template.

describe("project-context initialisation", () => {
  it("creates .builderForceAgents folder and governance file", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cc-test-"));
    try {
      const root = tmp;
      expect(await isBuilderForceAgentsProject(root)).toBe(false);

      await initializeBuilderForceAgentsProject(root);
      expect(await isBuilderForceAgentsProject(root)).toBe(true);

      const dir = resolveBuilderForceAgentsDir(root);
      const expected = [dir.contextPath, dir.architecturePath, dir.rulesPath, dir.governancePath];

      for (const file of expected) {
        const stat = await fs.stat(file);
        expect(stat.isFile()).toBe(true);
      }

      const governance = await fs.readFile(dir.governancePath, "utf-8");
      expect(governance).toContain("# Governance Rules");
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
