import {
  fileOutlineTool,
  findSymbolTool,
  repoMapTool,
  searchCodeTool,
  semanticSearchTool,
  type CapabilityProvider,
  type RepoSemanticCapability,
  type ToolDefinition,
} from "@builderforce/agent-tools";
import {
  desktopCompressAvailable,
  desktopCompressProse,
} from "@builderforce/agent-tools/node-desktop";
import { extractCodeRefs } from "@builderforce/repo-map";
import { searchWorkspaceCodeIndex, workspaceCodeEmbedder, type EmbedderPort } from "@seanhogg/builderforce-code-index";
import { advertiseName, normalizeInputSchema, type McpToolEntry } from "@seanhogg/builderforce-mcp";
import { createMcpServer } from "@seanhogg/builderforce-mcp/server";
import { workspaceRepoMap } from "./repoMap.js";
import { workspacePath, workspaceRepoRead, workspaceGitHistory } from "./workspaceFiles.js";

export const WORKSPACE_MCP_INFO = { name: "builderforce-workspace", version: "1.0.0" };
const INDEX_WAIT_MS = 5_000;

interface Workspace {
  root: string;
  caps: CapabilityProvider;
}

type ResolveWorkspace = (root?: string) => Workspace | Promise<Workspace>;

export interface WorkspaceMcpTool extends McpToolEntry {
  legacyName?: string;
  available?(): Promise<boolean>;
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

interface WorkspaceMcpOptions {
  requireRoot?: boolean;
  grammar?: () => { wasmDir?: string };
  embedder?: () => Promise<EmbedderPort | undefined>;
}

/** Default index policy for the Workspace catalog and its saved search calls. */
export async function searchWorkspaceMcpIndex(
  input: Omit<Parameters<typeof searchWorkspaceCodeIndex>[0], "embedder" | "waitForIndexMs">,
  loadEmbedder: () => Promise<EmbedderPort | undefined> = workspaceCodeEmbedder,
): ReturnType<typeof searchWorkspaceCodeIndex> {
  const embedder = input.extension ? undefined : await loadEmbedder().catch(() => undefined);
  return searchWorkspaceCodeIndex({ ...input, embedder, waitForIndexMs: INDEX_WAIT_MS });
}

/**
 * The local `repo.semantic` backing over a workspace: `search` is the shared code index
 * ({@link searchWorkspaceMcpIndex}), `repoMap` the reference-ranked repo map
 * ({@link workspaceRepoMap}). The editor and the on-prem runtime serve `semantic_search` /
 * `repo_map` through this when Builderforce Desktop is not answering.
 */
export function workspaceSemantic(
  { root, caps }: Workspace,
  options: Pick<WorkspaceMcpOptions, "grammar" | "embedder"> = {},
): RepoSemanticCapability {
  return {
    search: (query, { scope, limit } = {}) => searchWorkspaceMcpIndex({
      root, files: caps.repoRead!, query, limit: limit ?? 8, scope, ...options.grammar?.(),
    }, options.embedder),
    repoMap: (args = {}) => workspaceRepoMap({ caps }, args),
  };
}

async function findWorkspaceCode(workspace: Workspace, args: Record<string, unknown>, options: WorkspaceMcpOptions) {
  const { root, caps } = workspace;
  return fromDefinition(semanticSearchTool)({ root, caps: { ...caps, semantic: workspaceSemantic(workspace, options) } }, args);
}

async function compressWorkspaceProse(_workspace: Workspace, args: Record<string, unknown>) {
  const { text, rate, kind = "text" } = args;
  if (typeof text !== "string" || text.length > 100_000) {
    throw new Error("text must be a string of at most 100000 characters");
  }
  if (kind !== "markdown" && kind !== "text" && kind !== "log" && kind !== "code") {
    throw new Error("kind must be markdown, text, log, or code");
  }
  if (rate !== undefined && (typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0 || rate > 1)) {
    throw new Error("rate must be greater than 0 and at most 1");
  }
  if (!await desktopCompressAvailable()) throw new Error("The workspace compressor is unavailable");
  return desktopCompressProse(text, kind, { ...(rate !== undefined ? { rate } : {}) });
}

async function checkWorkspaceReferences({ root, caps }: Workspace, args: Record<string, unknown>) {
  if (!Array.isArray(args.texts) || args.texts.length > 50
    || !args.texts.every((value) => typeof value === "string" && value.length <= 10_000)) {
    throw new Error("texts must contain up to 50 strings of at most 10000 characters each");
  }
  const byText = args.texts.map((value: string) => extractCodeRefs(value));
  const checks = new Map<string, Promise<"found" | "missing" | "unverified">>();
  const results = [];
  for (const [index, references] of byText.entries()) {
    const missing = [];
    const unverified = [];
    for (const reference of references.slice(0, 50)) {
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
    results.push({
      index,
      missing,
      ...(unverified.length ? { unverified } : {}),
      ...(references.length > 50 ? { partial: true } : {}),
    });
  }
  return { results };
}

export function createWorkspaceMcpTools(resolve: ResolveWorkspace, options: WorkspaceMcpOptions = {}): readonly WorkspaceMcpTool[] {
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
    scopedTool("find", "Find code definitions and surrounding source by name or intent. Uses a local code index with keyword ranking and embeddings when a local embedder is ready.",
      semanticSearchTool.schema.function.parameters, resolve, (workspace, args) => findWorkspaceCode(workspace, args, options)),
    {
      ...scopedTool("compress", "Compress prose with the optional workspace compressor. Code remains verbatim.", {
        type: "object",
        properties: {
          text: { type: "string", maxLength: 100_000 },
          kind: { type: "string", enum: ["markdown", "text", "log", "code"] },
          rate: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        },
        required: ["text"],
      }, resolve, compressWorkspaceProse),
      available: desktopCompressAvailable,
    },
  ];
  return options.requireRoot ? tools.map((tool) => ({
    ...tool,
    inputSchema: { ...tool.inputSchema, required: ["projectRoot", ...(tool.inputSchema.required ?? [])] },
  })) : tools;
}

export function resolveWorkspaceMcpTool(
  tools: readonly WorkspaceMcpTool[],
  compatibility: readonly WorkspaceMcpTool[],
  name: string,
): WorkspaceMcpTool | null {
  return tools.find((entry) => entry.name === name)
    ?? compatibility.find((entry) => entry.legacyName === name || entry.name === name)
    ?? null;
}

export function createWorkspaceMcpServer(tools: readonly WorkspaceMcpTool[], compatibility: readonly WorkspaceMcpTool[] = []) {
  return createMcpServer({
    async list() {
      const available: WorkspaceMcpTool[] = [];
      for (const tool of tools) {
        if (!tool.available || await tool.available()) available.push(tool);
      }
      return available;
    },
    resolve: (entries, name) => resolveWorkspaceMcpTool(entries, compatibility, name),
    call: (entry, args) => entry.run(args),
  }, { info: WORKSPACE_MCP_INFO, gate: {} });
}
