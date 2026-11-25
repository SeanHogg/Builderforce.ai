import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Where a conversation lands (the agent chat area vs an editor tab) is decided in ONE
 * place. An entry point that calls `BuilderForcePanel.open` directly would open a tab
 * while every other entry opens the chat view — two answers to "open my chat".
 */
describe("openWorkspace is the only way into the workspace", () => {
  it("no module but the router opens the editor panel directly", () => {
    const callers = readdirSync(__dirname)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .filter((name) => readFileSync(join(__dirname, name), "utf8").includes("BuilderForcePanel.open("));
    expect(callers).toEqual(["openWorkspace.ts"]);
  });

  it("sends a reuse-mode chat to the chat view and boards to the editor", () => {
    const router = readFileSync(join(__dirname, "openWorkspace.ts"), "utf8");
    expect(router).toMatch(/surface === "chat" && !opts\?\.sessionId && getSessionTabMode\(\) === "reuse"/);
    expect(router).toContain("revealChatView(intent)");
  });
});
