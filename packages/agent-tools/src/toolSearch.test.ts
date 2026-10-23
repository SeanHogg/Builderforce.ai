import { describe, expect, it } from "vitest";
import { lexicalStems, rankLexically, searchToolSchemas, TOOL_SEARCH_SCHEMA, TOOL_SEARCH_TOOL } from "./toolSearch.js";
import type { ToolSchema } from "./tool.js";

const tool = (name: string, description: string): ToolSchema => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties: {} } },
});

const CATALOG = [
  tool("builtin_tasks_create", "Create a task on a project board."),
  tool("builtin_tasks_list", "List tasks on a project."),
  tool("builtin_key_results_update", "Update the progress of a key result (OKR)."),
  tool("builtin_incidents_open", "Open an incident for an outage."),
];

describe("lexical scorer", () => {
  it("stems plurals and drops stop words", () => {
    expect([...lexicalStems("Show me the tasks")]).toEqual(["task"]);
  });

  it("ranks a name hit above a description hit, best first", () => {
    const hits = searchToolSchemas(CATALOG, "create a task", 3).map((t) => t.function.name);
    expect(hits[0]).toBe("builtin_tasks_create");
    expect(hits).toContain("builtin_tasks_list");
    expect(hits).not.toContain("builtin_incidents_open");
  });

  it("returns nothing for a query with no signal, and respects the limit", () => {
    expect(searchToolSchemas(CATALOG, "the and of", 5)).toEqual([]);
    expect(searchToolSchemas(CATALOG, "task", 1)).toHaveLength(1);
  });

  it("keeps input order on ties", () => {
    const items = ["alpha beta", "beta alpha"];
    expect(rankLexically(items, "alpha", (s) => [{ text: s, weight: 1 }], 5)).toEqual(items);
  });

  it("exposes a static tool_search schema", () => {
    expect(TOOL_SEARCH_SCHEMA.function.name).toBe(TOOL_SEARCH_TOOL);
    expect(TOOL_SEARCH_SCHEMA.function.parameters.required).toEqual(["query"]);
  });
});
