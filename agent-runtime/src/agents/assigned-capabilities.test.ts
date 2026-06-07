import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { globalPersonaRegistry } from "../builderforce/personas.js";
import type { PersonaPlugin } from "../builderforce/types.js";
import {
  buildAssignedCapabilityAppend,
  buildAssignedPersonaPrompt,
  readAssignedArtifactSlugs,
} from "./assigned-capabilities.js";
import { buildAgentSystemPrompt } from "./system-prompt.js";

const TEST_PERSONA = "test-persona-xyz";

function registerActivePersona(name: string): void {
  const plugin: PersonaPlugin = {
    name,
    description: "Senior reviewer",
    capabilities: [],
    tools: [],
    persona: { voice: "terse", perspective: "security-first", decisionStyle: "evidence-based" },
    outputFormat: { structure: "markdown", outputPrefix: "🔒" },
    source: "builderforce-assigned",
    active: false,
  };
  globalPersonaRegistry.register(plugin);
  globalPersonaRegistry.activate(name);
}

async function makeSidecar(slugs: {
  skills?: string[];
  personas?: string[];
  content?: string[];
}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cap-"));
  await fs.mkdir(path.join(dir, ".builderforce"), { recursive: true });
  await fs.writeFile(
    path.join(dir, ".builderforce", "assigned-artifacts.json"),
    JSON.stringify({ skills: [], personas: [], content: [], ...slugs }),
    "utf-8",
  );
  return dir;
}

describe("buildAssignedPersonaPrompt", () => {
  afterEach(() => {
    globalPersonaRegistry.deactivate(TEST_PERSONA);
    globalPersonaRegistry.unregisterForTest(TEST_PERSONA);
  });

  it("returns '' when no personas are active", () => {
    expect(buildAssignedPersonaPrompt()).toBe("");
  });

  it("builds a persona block from the active (assigned) personas", () => {
    registerActivePersona(TEST_PERSONA);
    const block = buildAssignedPersonaPrompt();
    expect(block).toContain("--- Agent Persona ---");
    expect(block).toContain(`Role: ${TEST_PERSONA}`);
    expect(block).toContain("Voice: terse");
    expect(block).toContain("Perspective: security-first");
  });
});

describe("readAssignedArtifactSlugs", () => {
  it("reads the slugs written by artifacts.sync", async () => {
    const dir = await makeSidecar({ skills: ["s1"], personas: ["p1"], content: ["c1"] });
    expect(await readAssignedArtifactSlugs(dir)).toEqual({
      skills: ["s1"],
      personas: ["p1"],
      content: ["c1"],
    });
  });

  it("returns empty arrays when no sidecar is present", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cap-"));
    expect(await readAssignedArtifactSlugs(dir)).toEqual({ skills: [], personas: [], content: [] });
  });
});

describe("buildAssignedCapabilityAppend (V2 preamble)", () => {
  afterEach(() => {
    globalPersonaRegistry.deactivate(TEST_PERSONA);
    globalPersonaRegistry.unregisterForTest(TEST_PERSONA);
  });

  it("combines persona, skill refs, and content refs", async () => {
    registerActivePersona(TEST_PERSONA);
    const dir = await makeSidecar({ skills: ["code-review"], content: ["style-guide"] });
    const block = await buildAssignedCapabilityAppend(dir);
    expect(block).toContain("## Persona (mandatory)");
    expect(block).toContain(`Role: ${TEST_PERSONA}`);
    expect(block).toContain("## Skills (mandatory)");
    expect(block).toContain("code-review");
    expect(block).toContain("## Content");
    expect(block).toContain("style-guide");
  });

  it("returns '' when nothing is assigned", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cap-"));
    expect(await buildAssignedCapabilityAppend(dir)).toBe("");
  });
});

describe("buildAgentSystemPrompt persona section (V1)", () => {
  it("injects a Persona section when personaPrompt is provided", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/w",
      personaPrompt: "--- Agent Persona ---\nRole: Reviewer\n---",
      toolNames: ["read"],
    });
    expect(prompt).toContain("## Persona (mandatory)");
    expect(prompt).toContain("Role: Reviewer");
  });

  it("omits the Persona section for subagent/minimal mode", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/w",
      personaPrompt: "--- Agent Persona ---\nRole: Reviewer\n---",
      promptMode: "minimal",
      toolNames: ["read"],
    });
    expect(prompt).not.toContain("## Persona (mandatory)");
  });
});
