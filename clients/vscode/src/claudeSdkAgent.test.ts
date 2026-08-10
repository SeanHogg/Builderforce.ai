import { describe, expect, it } from "vitest";
import { originalToolName, packagedClaudeExecutable, sdkPolicyDecision } from "./claudeSdkAgent";

describe("Claude SDK VSIX adapter", () => {
  it("maps BuilderForce MCP names back to canonical tool names", () => {
    expect(originalToolName("mcp__builderforce__builtin_tasks_create")).toBe("builtin_tasks_create");
    expect(originalToolName("Read")).toBe("Read");
  });

  it("applies canonical file-tool governance to native Claude tools", () => {
    expect(sdkPolicyDecision([
      { id: "no-shell", tool: "run_command", effect: "block", reason: "locked workspace" },
    ], "Bash")).toEqual({
      action: "block",
      gateId: "no-shell",
      reason: "locked workspace",
    });
  });

  it("applies platform-tool governance after MCP namespacing", () => {
    expect(sdkPolicyDecision([
      { id: "approve-task", tool: "builtin_tasks_create", effect: "require-approval" },
    ], "mcp__builderforce__builtin_tasks_create")).toMatchObject({
      action: "require-approval",
      gateId: "approve-task",
    });
  });

  it("resolves the native runtime beside the bundled extension", () => {
    expect(packagedClaudeExecutable("C:\\extension\\out")).toMatch(
      process.platform === "win32"
        ? /[\\/]claude-agent-sdk[\\/]claude\.exe$/
        : /[\\/]claude-agent-sdk[\\/]claude$/,
    );
  });
});
