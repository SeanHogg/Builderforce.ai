import { defineTool } from "./tool.js";

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export const workspaceMemorySearchTool = defineTool({
  name: "workspace__memory_search",
  description:
    "Search this agent's Markdown workspace notes (.builderforce/MEMORY.md, .builderforce/memory/*.md and any configured session sources) for earlier work, decisions, preferences, or todos. Results include snippets, file paths and line ranges, with a ref for readable Markdown excerpts.",
  parameters: {
    type: "object",
    properties: { query: { type: "string" }, maxResults: { type: "number" }, minScore: { type: "number" } },
    required: ["query"],
  },
  requires: ["workspace.memory"],
  async execute(args, { caps }) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) return { data: { ok: false, error: "query required" } };
    return { data: await caps.workspaceMemory!.search(query, {
      maxResults: number(args.maxResults),
      minScore: number(args.minScore),
    }) };
  },
});

export const workspaceMemoryReadTool = defineTool({
  name: "workspace__memory_read",
  description:
    "Read the Markdown excerpt identified by a ref returned from workspace memory search. Results keep the original path for citations. Search again if the reference is unavailable.",
  parameters: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
  },
  requires: ["workspace.memory"],
  async execute(args, { caps }) {
    const ref = typeof args.ref === "string" ? args.ref.trim() : "";
    if (!ref) return { data: { ok: false, error: "ref required" } };
    return { data: await caps.workspaceMemory!.read(ref) };
  },
});
