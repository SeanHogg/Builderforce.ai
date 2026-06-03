import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setInstallIdForTests } from "./install-id.js";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

// Ensure getInstallId returns null by default so state dir is legacy ~/.builderforce.
// vi.mock cannot intercept paths.ts's import of install-id (setup file loads paths.ts
// before the mock is registered), so we use the setInstallIdForTests override instead.
beforeEach(() => {
  setInstallIdForTests(() => null);
});
afterEach(() => {
  setInstallIdForTests(null);
});

describe("oauth paths", () => {
  it("prefers BUILDERFORCE_AGENTS_OAUTH_DIR over BUILDERFORCE_AGENTS_STATE_DIR", () => {
    const env = {
      BUILDERFORCE_AGENTS_OAUTH_DIR: "/custom/oauth",
      BUILDERFORCE_AGENTS_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from BUILDERFORCE_AGENTS_STATE_DIR when unset", () => {
    const env = {
      BUILDERFORCE_AGENTS_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  it("uses BUILDERFORCE_AGENTS_STATE_DIR when set", () => {
    const env = {
      BUILDERFORCE_AGENTS_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("uses profile-based state dir when BUILDERFORCE_AGENTS_PROFILE is set (multi-instance)", () => {
    const env = { BUILDERFORCE_AGENTS_PROFILE: "work" } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(
      path.resolve("/home/test", ".builderforce-work"),
    );
  });

  it("treats BUILDERFORCE_AGENTS_PROFILE=default as no profile", () => {
    const env = { BUILDERFORCE_AGENTS_PROFILE: "default" } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/home/test", ".builderforce"));
  });

  it("prefers BUILDERFORCE_AGENTS_STATE_DIR over BUILDERFORCE_AGENTS_PROFILE", () => {
    const env = {
      BUILDERFORCE_AGENTS_STATE_DIR: "/custom/state",
      BUILDERFORCE_AGENTS_PROFILE: "work",
    } as NodeJS.ProcessEnv;
    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/custom/state"));
  });

  it("uses install-id subdir when getInstallId returns id and no legacy config", () => {
    setInstallIdForTests(() => "a1b2c3d4");
    expect(resolveStateDir({} as NodeJS.ProcessEnv, () => "/home/test")).toBe(
      path.resolve("/home/test", ".builderforce", "a1b2c3d4"),
    );
  });

  it("uses legacy flat ~/.builderforce when legacy config exists and install-id dir does not", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cc-state-"));
    try {
      const legacyDir = path.join(root, ".builderforce");
      await fs.mkdir(legacyDir, { recursive: true });
      await fs.writeFile(path.join(legacyDir, "builderforce.json"), "{}", "utf-8");
      setInstallIdForTests(() => "newinstall");
      const result = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(result).toBe(legacyDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("uses BUILDERFORCE_AGENTS_HOME for default state/config locations", () => {
    const env = {
      BUILDERFORCE_AGENTS_HOME: "/srv/builderforce-home",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/builderforce-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".builderforce"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".builderforce", "builderforce.json"));
  });

  it("prefers BUILDERFORCE_AGENTS_HOME over HOME for default state/config locations", () => {
    const env = {
      BUILDERFORCE_AGENTS_HOME: "/srv/builderforce-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;

    const resolvedHome = path.resolve("/srv/builderforce-home");
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".builderforce"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".builderforce", "builderforce.json"));
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [path.join(resolvedHome, ".builderforce", "builderforce.json")];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.builderforce when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-state-"));
    try {
      const newDir = path.join(root, ".builderforce");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-config-"));
    try {
      const legacyDir = path.join(root, ".builderforce");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "builderforce.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyPath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "builderforce-config-override-"));
    try {
      const legacyDir = path.join(root, ".builderforce");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "builderforce.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { BUILDERFORCE_AGENTS_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "builderforce.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
