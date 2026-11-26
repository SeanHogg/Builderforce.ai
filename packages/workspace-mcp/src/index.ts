import {
  fileOutlineTool,
  findSymbolTool,
  repoMapTool,
  searchCodeTool,
  type CapabilityProvider,
  type ToolDefinition,
} from "@builderforce/agent-tools";
import { extractCodeRefs } from "@builderforce/repo-map";
import { advertiseName, normalizeInputSchema, type McpToolEntry } from "@seanhogg/builderforce-mcp";
import { createMcpServer } from "@seanhogg/builderforce-mcp/server";
import { workspaceRepoMap } from "./repoMap.js";
import { workspacePath, workspaceRepoRead, workspaceGitHistory } from "./workspaceFiles.js";

export const WORKSPACE_MCP_INFO = { name: "builderforce-workspace", version: "1.0.0" };

interface Workspace {
  root: string;
  caps: CapabilityProvider;
}

type ResolveWorkspace = (root?: string) => Workspace | Promise<Workspace>;

export interface WorkspaceMcpTool extends McpToolEntry {
  legacyName?: string;
  run(args: Record<string, unknown>): Promise<unknown>;
}

type WorkspaceHandler = (workspace: Workspace, args: Record<string, unknown>) => Promise<unknown>;

function fromDefinition(tool: ToolDefinition): WorkspaceHandler {
  return async ({ root, caps }, args) => (await tool.execute(args, { workspaceRoot: root, caps })).data;
}

function scopedTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
  resolve: ResolveWorkspace,
  run: WorkspaceHandler,
): WorkspaceMcpTool {
  const schema = normalizeInputSchema(parameters);
  return {
    name: advertiseName("workspace", name),
    description,
    inputSchema: normalizeInputSchema({
      ...schema,
      properties: {
        ...schema.properties,
        projectRoot: { type: "string", description: "Absolute path to the workspace root" },
      },
    }),
    effect: "read",
    surfaces: ["workspace"],
    async run({ projectRoot, ...args }) {
      if (projectRoot !== undefined && (typeof projectRoot !== "string" || !projectRoot.trim())) {
        throw new Error("projectRoot must be an absolute workspace path");
      }
      const { root, caps } = await resolve(projectRoot);
      return run({ root, caps: { ...caps, repoRead: workspaceRepoRead(root, caps.repoRead) } }, args);
    },
  };
}

async function checkWorkspaceReferences({ root, caps }: Workspace, args: Record<string, unknown>) {
  if (!Array.isArray(args.texts) || args.texts.length > 50
    || !args.texts.every((value) => typeof value === "string" && value.length <= 10_000)) {
    throw new Error("texts must contain up to 50 strings of at most 10000 characters each");
  }
  const byText = args.texts.map((value: string) => extractCodeRefs(value).slice(0, 50));
  const checks = new Map<string, Promise<"found" | "missing" | "unverified">>();
  const results = [];
  for (const [index, references] of byText.entries()) {
    const missing = [];
    const unverified = [];
    for (const reference of references) {
      const key = `${reference.kind}:${reference.reference}`;
      let check = checks.get(key);
      if (!check && checks.size === 50) {
        unverified.push(reference);
        continue;
      }
      if (!check) {
        check = reference.kind === "path"
          ? workspacePath(root, reference.reference).then((path) => path ? "found" : "missing")
          : caps.symbols?.find(reference.reference, { limit: 50 }).then((result) => {
              const exact = (result.matches ?? []).some((match) => match.name === reference.reference);
              return exact ? "found" : !result.ok || result.partialIndex || result.truncated ? "unverified" : "missing";
            }) ?? Promise.resolve("unverified");
        checks.set(key, check);
      }
      const status = await check.catch(() => "unverified");
      if (status === "missing") missing.push(reference);
      if (status === "unverified") unverified.push(reference);
    }
    results.push({ index, missing, ...(unverified.length ? { unverified } : {}) });
  }
  return { results };
}

export function createWorkspaceMcpTools(resolve: ResolveWorkspace, options: { requireRoot?: boolean } = {}): readonly WorkspaceMcpTool[] {
  const fromTool = (name: string, tool: ToolDefinition, run = fromDefinition(tool)) => {
    const { description, parameters } = tool.schema.function;
    return scopedTool(name, description, parameters, resolve, run);
  };
  const tools = [
    fromTool("search", searchCodeTool),
    fromTool("symbol", findSymbolTool),
    fromTool("outline", fileOutlineTool),
    fromTool("map", repoMapTool, workspaceRepoMap),
    scopedTool("references", "Verify paths and definitions named in prose against the workspace.", {
      type: "object",
      properties: { texts: { type: "array", maxItems: 50, items: { type: "string", maxLength: 10_000 } } },
      required: ["texts"],
    }, resolve, checkWorkspaceReferences),
    scopedTool("git_history", "Show recent git commits for the workspace or a path in it.", {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative path to inspect" },
        author: { type: "string", description: "Git author filter" },
        limit: { type: "number", description: "Maximum commits to return (default 20, maximum 50)" },
      },
    }, resolve, workspaceGitHistory),
  ];
  return options.requireRoot ? tools.map((tool) => ({
    ...tool,
    inputSchema: { ...tool.inputSchema, required: ["projectRoot", ...(tool.inputSchema.required ?? [])] },
  })) : tools;
}

export function createWorkspaceMcpServer(tools: readonly WorkspaceMcpTool[], compatibility: readonly WorkspaceMcpTool[] = []) {
  return createMcpServer({
    list: () => tools,
    resolve: (entries, name) => entries.find((entry) => entry.name === name)
      ?? compatibility.find((entry) => entry.legacyName === name || entry.name === name)
      ?? null,
    call: (entry, args) => entry.run(args),
  }, { info: WORKSPACE_MCP_INFO, gate: {} });
}
