import { describe, expect, it } from "vitest";
import { announcesUntakenAction, claimsMissingToolData, toolNamesMentionedIn } from "./index.js";

describe("MCP tool references", () => {
  it("recognizes deployed canonical namespaces and historical catalog aliases", () => {
    expect(toolNamesMentionedIn(
      "platform__tasks_get workspace__memory_read memory__get connector-github__list_prs "
      + "ext-123__look-up catalog__12ab builtin_tasks_get mcp_abcd1234_show_doc mcp__server__tool",
    )).toEqual([
      "platform__tasks_get", "workspace__memory_read", "memory__get", "connector-github__list_prs",
      "ext-123__look-up", "catalog__12ab", "builtin_tasks_get", "mcp_abcd1234_show_doc", "mcp__server__tool",
    ]);
  });

  it("detects canonical calls written as prose without treating ordinary code names as calls", () => {
    expect(announcesUntakenAction("call platform__tasks_get with id 7")).toBe(true);
    expect(claimsMissingToolData("No results from workspace__memory_read.")).toBe(true);
    expect(announcesUntakenAction("call internal__fixture with id 7")).toBe(false);
    expect(toolNamesMentionedIn("unrelated_workspace__memory_read")).toEqual([]);
  });
});
