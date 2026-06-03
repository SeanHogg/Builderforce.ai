import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setInstallIdForTests } from "./install-id.js";
import { createConfigIO } from "./io.js";

// Prevent getInstallId from returning a real hash (paths.ts is loaded by setup file
// before any vi.mock would apply, so we use the setInstallIdForTests override).
beforeEach(() => {
  setInstallIdForTests(() => null);
});
afterEach(() => {
  setInstallIdForTests(null);
});

async function withTempHome(run: (home: string) => Promise<void>): Promise<void> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-config-"));
  try {
    await run(home);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
}

async function writeConfig(
  home: string,
  dirname: ".builderforce",
  port: number,
  filename: string = "builderforce.json",
) {
  const dir = path.join(home, dirname);
  await fs.mkdir(dir, { recursive: true });
  const configPath = path.join(dir, filename);
  await fs.writeFile(configPath, JSON.stringify({ gateway: { port } }, null, 2));
  return configPath;
}

describe("config io paths", () => {
  it("uses ~/.builderforce/builderforce.json when config exists", async () => {
    await withTempHome(async (home) => {
      const configPath = await writeConfig(home, ".builderforce", 19001);
      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
      });
      expect(io.configPath).toBe(configPath);
      expect(io.loadConfig().gateway?.port).toBe(19001);
    });
  });

  it("defaults to ~/.builderforce/builderforce.json when config is missing", async () => {
    await withTempHome(async (home) => {
      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
      });
      expect(io.configPath).toBe(path.join(home, ".builderforce", "builderforce.json"));
    });
  });

  it("uses BUILDERFORCE_AGENTS_HOME for default config path", async () => {
    await withTempHome(async (home) => {
      const io = createConfigIO({
        env: { BUILDERFORCE_AGENTS_HOME: path.join(home, "svc-home") } as NodeJS.ProcessEnv,
        homedir: () => path.join(home, "ignored-home"),
      });
      expect(io.configPath).toBe(path.join(home, "svc-home", ".builderforce", "builderforce.json"));
    });
  });

  it("honors explicit BUILDERFORCE_AGENTS_CONFIG_PATH override", async () => {
    await withTempHome(async (home) => {
      const customPath = await writeConfig(home, ".builderforce", 20002, "custom.json");
      const io = createConfigIO({
        env: { BUILDERFORCE_AGENTS_CONFIG_PATH: customPath } as NodeJS.ProcessEnv,
        homedir: () => home,
      });
      expect(io.configPath).toBe(customPath);
      expect(io.loadConfig().gateway?.port).toBe(20002);
    });
  });
});
