import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { PersonaRegistry, loadPersonaFromFile } from "./personas.js";
import type { PersonaPlugin } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePlugin(name: string, source: PersonaPlugin["source"] = "builtin"): PersonaPlugin {
  return {
    name,
    description: `${name} description`,
    capabilities: [],
    tools: [],
    source,
    active: false,
  };
}

// ---------------------------------------------------------------------------
// PersonaRegistry
// ---------------------------------------------------------------------------

describe("PersonaRegistry", () => {
  let registry: PersonaRegistry;

  beforeEach(() => {
    registry = new PersonaRegistry();
  });

  it("resolves null for unknown name", () => {
    expect(registry.resolve("unknown")).toBeNull();
  });

  it("registers and resolves a built-in persona", () => {
    registry.registerBuiltins([makePlugin("code-creator")]);
    const resolved = registry.resolve("code-creator");
    expect(resolved).not.toBeNull();
    expect(resolved?.source).toBe("builtin");
  });

  it("higher-precedence source wins over lower", () => {
    registry.registerBuiltins([makePlugin("my-role")]);
    // project-local has higher precedence than builtin
    registry.register(makePlugin("my-role", "project-local"));
    expect(registry.resolve("my-role")?.source).toBe("project-local");
  });

  it("lower-precedence source does NOT override higher", () => {
    registry.register(makePlugin("my-role", "marketplace"));
    // user-global is lower than marketplace
    registry.register(makePlugin("my-role", "user-global"));
    expect(registry.resolve("my-role")?.source).toBe("marketplace");
  });

  it("builderforce-assigned is the highest-precedence source", () => {
    registry.register(makePlugin("my-role", "marketplace"));
    registry.register(makePlugin("my-role", "builderforce-assigned"));
    expect(registry.resolve("my-role")?.source).toBe("builderforce-assigned");
  });

  it("listAll returns all registered personas sorted by name", () => {
    registry.registerBuiltins([makePlugin("zzz"), makePlugin("aaa")]);
    const names = registry.listAll().map((p) => p.name);
    expect(names).toEqual(["aaa", "zzz"]);
  });

  it("activate marks persona active and creates assignment", () => {
    registry.registerBuiltins([makePlugin("code-creator")]);
    const ok = registry.activate("code-creator");
    expect(ok).toBe(true);
    expect(registry.resolve("code-creator")?.active).toBe(true);
    expect(registry.getAssignments()).toHaveLength(1);
    expect(registry.getAssignments()[0]?.name).toBe("code-creator");
  });

  it("activate returns false for unknown persona", () => {
    expect(registry.activate("does-not-exist")).toBe(false);
  });

  it("activate does not duplicate assignment on second call", () => {
    registry.registerBuiltins([makePlugin("code-creator")]);
    registry.activate("code-creator");
    registry.activate("code-creator");
    expect(registry.getAssignments()).toHaveLength(1);
  });

  it("deactivate marks persona inactive", () => {
    registry.registerBuiltins([makePlugin("code-creator")]);
    registry.activate("code-creator");
    registry.deactivate("code-creator");
    expect(registry.resolve("code-creator")?.active).toBe(false);
  });

  it("listActive returns only active personas", () => {
    registry.registerBuiltins([makePlugin("a"), makePlugin("b"), makePlugin("c")]);
    registry.activate("b");
    const active = registry.listActive().map((p) => p.name);
    expect(active).toEqual(["b"]);
  });

  it("applyAssignments marks matching personas active", () => {
    registry.registerBuiltins([makePlugin("code-creator"), makePlugin("code-reviewer")]);
    registry.applyAssignments([{ name: "code-creator", assignedAt: "2026-01-01T00:00:00Z" }]);
    expect(registry.resolve("code-creator")?.active).toBe(true);
    expect(registry.resolve("code-reviewer")?.active).toBe(false);
  });

  it("applyAssignments stores assignments even for not-yet-registered personas", () => {
    registry.applyAssignments([{ name: "future-role" }]);
    expect(registry.getAssignments()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// loadPersonaFromFile
// ---------------------------------------------------------------------------

describe("loadPersonaFromFile", () => {
  it("parses a minimal PERSONA.yaml file", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "persona-test-"));
    const filePath = path.join(dir, "test.yaml");
    await fs.writeFile(
      filePath,
      [
        "name: test-role",
        "description: A test persona",
        "capabilities:",
        "  - write code",
        "tools:",
        "  - view",
        "  - bash",
        "model: anthropic/claude-sonnet-4-20250514",
        "thinking: high",
      ].join("\n"),
      "utf-8",
    );

    const plugin = await loadPersonaFromFile(filePath, "project-local");
    expect(plugin).not.toBeNull();
    expect(plugin?.name).toBe("test-role");
    expect(plugin?.source).toBe("project-local");
    expect(plugin?.filePath).toBe(filePath);
    expect(plugin?.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(plugin?.tools).toEqual(["view", "bash"]);

    await fs.rm(dir, { recursive: true });
  });

  it("parses marketplace metadata fields from PERSONA.yaml", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "persona-test-"));
    const filePath = path.join(dir, "marketplace.yaml");
    await fs.writeFile(
      filePath,
      [
        "name: security-specialist",
        "description: Security-focused reviewer",
        "marketplaceId: acme/security-specialist",
        "version: '2.0.0'",
        "author: acme-corp",
        "license: Commercial",
        "requiresLicense: true",
        "tags: [security, compliance]",
        "capabilities: []",
        "tools: [view, grep]",
      ].join("\n"),
      "utf-8",
    );

    const plugin = await loadPersonaFromFile(filePath, "marketplace");
    expect(plugin?.pluginMetadata?.marketplaceId).toBe("acme/security-specialist");
    expect(plugin?.pluginMetadata?.version).toBe("2.0.0");
    expect(plugin?.pluginMetadata?.requiresLicense).toBe(true);
    expect(plugin?.pluginMetadata?.tags).toEqual(["security", "compliance"]);

    await fs.rm(dir, { recursive: true });
  });

  it("returns null for a file missing the required name field", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "persona-test-"));
    const filePath = path.join(dir, "bad.yaml");
    await fs.writeFile(filePath, "description: no name here\ntools: []\n", "utf-8");

    const plugin = await loadPersonaFromFile(filePath, "project-local");
    expect(plugin).toBeNull();

    await fs.rm(dir, { recursive: true });
  });

  it("returns null for a non-existent file", async () => {
    const plugin = await loadPersonaFromFile("/tmp/does-not-exist.yaml", "user-global");
    expect(plugin).toBeNull();
  });
});
