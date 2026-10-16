import { describe, expect, it, beforeEach } from "vitest";
import { isModelRole } from "@builderforce/agent-tools";
import {
  AGENT_ROLE_MODEL_ROLES,
  CODE_CREATOR_ROLE,
  findAgentRole,
  getBuiltInAgentRoles,
  modelRoleForAgentRole,
} from "./agent-roles.js";
import { globalPersonaRegistry } from "./personas.js";
import type { AgentRole } from "./types.js";

describe("agent-roles", () => {
  beforeEach(() => {
    // Clear any custom personas registered by previous tests
    globalPersonaRegistry.unregisterForTest("my-custom-agent");
    globalPersonaRegistry.unregisterForTest("security-specialist");
    globalPersonaRegistry.unregisterForTest("temp-role");
    globalPersonaRegistry.unregisterForTest("code-creator");
  });

  it("returns built-in roles by name", () => {
    const role = findAgentRole("code-creator");
    expect(role).toBe(CODE_CREATOR_ROLE);
  });

  it("returns null for unknown role when no custom roles registered", () => {
    const role = findAgentRole("unknown-role");
    expect(role).toBeNull();
  });

  it("registers and finds custom roles via PersonaRegistry", () => {
    const customRole: AgentRole = {
      name: "my-custom-agent",
      description: "A custom test agent",
      capabilities: ["custom-workflow"],
      tools: ["view", "bash"],
      systemPrompt: "You are a custom agent.",
      model: "test/model",
    };

    globalPersonaRegistry.register({
      ...customRole,
      source: "project-local",
      active: false,
    });

    const found = findAgentRole("my-custom-agent");
    expect(found).not.toBeNull();
    expect(found?.name).toBe("my-custom-agent");
    expect(found?.description).toBe("A custom test agent");
    expect(found?.tools).toEqual(["view", "bash"]);
    expect(found?.model).toBe("test/model");
  });

  it("does not replace built-in roles with custom roles of same name", () => {
    // Even if a custom role with same name is registered, built-in takes precedence
    const conflictingRole: AgentRole = {
      name: "code-creator",
      description: "Custom override attempt",
      capabilities: ["code-generation"],
      tools: ["edit"],
      systemPrompt: "Overridden prompt",
      model: "override/model",
    };

    globalPersonaRegistry.register({
      ...conflictingRole,
      source: "project-local",
      active: false,
    });

    // Should still get the built-in role
    const role = findAgentRole("code-creator");
    expect(role).toBe(CODE_CREATOR_ROLE);
    expect(role?.description).not.toBe("Custom override attempt");
  });

  it("can find both built-in and custom roles simultaneously", () => {
    const customRole: AgentRole = {
      name: "security-specialist",
      description: "Focuses on security audits",
      capabilities: ["security-audit"],
      tools: ["view", "grep", "bash"],
      systemPrompt: "You are a security specialist.",
      model: "claude-sonnet",
    };

    globalPersonaRegistry.register({
      ...customRole,
      source: "project-local",
      active: false,
    });

    // Built-in still works
    expect(findAgentRole("code-reviewer")?.name).toBe("code-reviewer");
    // Custom role is also findable
    expect(findAgentRole("security-specialist")?.description).toBe("Focuses on security audits");
  });

  it("unregisterForTest removes custom roles", () => {
    const customRole: AgentRole = {
      name: "temp-role",
      description: "Temporary",
      capabilities: ["temporary"],
      tools: [],
      systemPrompt: "Temp",
      model: "test",
    };

    globalPersonaRegistry.register({
      ...customRole,
      source: "project-local",
      active: false,
    });
    expect(findAgentRole("temp-role")).not.toBeNull();

    globalPersonaRegistry.unregisterForTest("temp-role");

    expect(findAgentRole("temp-role")).toBeNull();
    // Built-in still works
    expect(findAgentRole("code-creator")).toBe(CODE_CREATOR_ROLE);
  });
});

describe("orchestrator role → ModelRole (AGENT_ROLE_MODEL_ROLES)", () => {
  it("maps EVERY built-in role onto a shared call purpose", () => {
    for (const role of getBuiltInAgentRoles()) {
      expect(isModelRole(modelRoleForAgentRole(role.name)), role.name).toBe(true);
    }
    // …and lists nothing that is not a built-in role.
    const builtIns = new Set(getBuiltInAgentRoles().map((r) => r.name));
    for (const name of Object.keys(AGENT_ROLE_MODEL_ROLES)) {
      expect(builtIns.has(name), name).toBe(true);
    }
  });

  it("writes code as code, reviews as verify, designs as plan", () => {
    expect(modelRoleForAgentRole("code-creator")).toBe("code");
    expect(modelRoleForAgentRole("refactor-agent")).toBe("code");
    expect(modelRoleForAgentRole("code-reviewer")).toBe("verify");
    expect(modelRoleForAgentRole("validator-agent")).toBe("verify");
    expect(modelRoleForAgentRole("architecture-advisor")).toBe("plan");
    expect(modelRoleForAgentRole("bug-analyzer")).toBe("plan");
  });

  it("declares no purpose for a persona, a remote target or nothing", () => {
    expect(modelRoleForAgentRole("my-custom-agent")).toBeUndefined();
    expect(modelRoleForAgentRole("remote:auto")).toBeUndefined();
    expect(modelRoleForAgentRole("toString")).toBeUndefined();
    expect(modelRoleForAgentRole(undefined)).toBeUndefined();
  });

  it("pins no model on a built-in role — the router chooses, the operator may override", () => {
    for (const role of getBuiltInAgentRoles()) {
      expect(role.model, role.name).toBeUndefined();
    }
  });
});
