import { describe, expect, it } from "vitest";
import { classifyTool, HOST_READ_ONLY_TOOLS, isMutatingTool } from "./tool-side-effect.js";

describe("classifyTool precedence: catalog > host declaration > host read-only names > read-only action > mutate", () => {
  it("the catalog wins over a declaration", () => {
    expect(classifyTool("write_file", { mutates: false })).toBe("mutate");
    expect(classifyTool("read_file", { mutates: true })).toBe("read");
  });

  it("a host declaration decides an unclassified tool, either way", () => {
    expect(classifyTool("page_lookup", { mutates: false })).toBe("read");
    expect(classifyTool("page_edit", { mutates: true })).toBe("mutate");
  });

  it("an explicit mutates:true beats the host read-only list", () => {
    for (const name of HOST_READ_ONLY_TOOLS) expect(classifyTool(name, { mutates: true }), name).toBe("mutate");
  });

  it("the host read-only names are reads without a declaration", () => {
    expect(classifyTool("memory_get")).toBe("read");
    expect(classifyTool("agents_list")).toBe("read");
    expect(classifyTool("GREP")).toBe("read");
  });

  it("a read-only action clears an action-dispatched host tool; any other action does not", () => {
    expect(classifyTool("process", undefined, { action: "list" })).toBe("read");
    expect(classifyTool("cron", undefined, { action: "poll" })).toBe("read");
    expect(classifyTool("process", undefined, { action: "send-keys" })).toBe("mutate");
    expect(classifyTool("process")).toBe("mutate");
  });

  it("regression: a model-supplied read-only action never clears a tool that does not dispatch on it", () => {
    expect(classifyTool("sessions_send", undefined, { action: "get" })).toBe("mutate");
    expect(classifyTool("create_issue", undefined, { action: "list" })).toBe("mutate");
    expect(classifyTool("mcp__tracker__create_issue", undefined, { action: "list" })).toBe("mutate");
    expect(classifyTool("browser", undefined, { action: "list" })).toBe("read");
    expect(classifyTool("browser", undefined, { action: "click" })).toBe("mutate");
    expect(classifyTool("process", undefined, { action: "list" })).toBe("read");
    expect(classifyTool("browser_actions", undefined, { action: "list" })).toBe("read");
    expect(classifyTool("nodes", undefined, { action: "status" })).toBe("read");
  });

  it("an unclassified name with nothing else to go on is a mutation", () => {
    expect(classifyTool("mcp__x__tool")).toBe("mutate");
    expect(isMutatingTool("mcp__x__tool")).toBe(true);
    expect(isMutatingTool("mcp__x__tool", { mutates: false })).toBe(false);
  });
});
