/**
 * envCapabilities — what one agent in a Web Container may call (W12 phase 3): (the host's catalog ∩ the agent's allowlist) plus
 * the environment's `env.*` tools through its {@link EnvironmentToolPort}.
 *
 * The catalog half is a {@link CapabilityProvider}: the host's services, with only the capabilities the allowlist names advertised
 * (the registry runs a tool's handler only when every capability it needs is advertised, so a service left wired is unreachable).
 * The `env.*` half is the surface's own tools ({@link PlatformTools}): its `execute` is handed the call id and the step, so every
 * call carries its {@link IdempotencyKey} (run id, step, tool-call id) — the seam `idempotentPlatformTools` gates. Only allowlisted
 * tools are advertised; a call to any other `env.*` tool still reaches the port, which refuses it (typed) and tells the Shield.
 *
 * Tool names: a model's function names allow no dots, so `env.fs.read` is advertised as `env_fs_read` ({@link envToolName}).
 */
import { DEFAULT_TOOL_LIMIT, type CapabilityProvider, type PlatformToolResult, type PlatformTools } from "@builderforce/agent-run";
import type { Capability, ToolSchema } from "@builderforce/agent-tools";
import { normalizeInputSchema, requiresWriteApproval, toOpenAI, type McpToolEntry } from "@seanhogg/builderforce-mcp";
import { createMcpServer, withInProcessMcp } from "@seanhogg/builderforce-mcp/server";
import { ENV_TOOL_KEYS, type EnvironmentToolPort } from "./envContract.js";
import { ENV_TOOL_MUTATES, envToolKeyOf, envToolName, type IdempotencyKey } from "./idempotentTools.js";

export { envToolKeyOf, envToolName };

const pathProperty = { type: "string", description: "Project-relative path (no leading slash, no `..`)." };

/** What each `env.*` tool tells the model, and its arguments (the port validates them again). */
const ENV_TOOL_SPECS: Readonly<Record<string, Omit<ToolSchema["function"], "name">>> = {
  "env.fs.read": { description: "Read a project file.", parameters: { type: "object", properties: { path: pathProperty }, required: ["path"] } },
  "env.fs.write": {
    description: "Write a whole project file (created or replaced).",
    parameters: { type: "object", properties: { path: pathProperty, content: { type: "string" } }, required: ["path", "content"] },
  },
  "env.fs.list": { description: "List a project directory.", parameters: { type: "object", properties: { path: pathProperty } } },
  "env.run": {
    description: "Run a command in the environment (e.g. `npm test`) and return its exit code and output.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" }, args: { type: "array", items: { type: "string" } }, cwd: pathProperty },
      required: ["command"],
    },
  },
  "env.preview.fetch": {
    description: "GET a path from one of this environment's own services, by service id.",
    parameters: { type: "object", properties: { service: { type: "string" }, path: { type: "string", description: "Path and query, e.g. `/api/health`." } }, required: ["service"] },
  },
  "env.services.status": { description: "The environment's services: state, port and restarts.", parameters: { type: "object", properties: {} } },
};

const descriptors = new Map<string, McpToolEntry>(ENV_TOOL_KEYS.map((key) => {
  const { description, parameters } = ENV_TOOL_SPECS[key]!;
  return [key, {
    name: envToolName(key),
    description,
    inputSchema: normalizeInputSchema(parameters),
    effect: ENV_TOOL_MUTATES[key] ? "write" : "read",
    surfaces: ["webcontainer"],
  }];
}));
const ENV_MCP_TIMEOUT_MS = 120_000;

export interface EnvCapabilitiesDeps {
  /** The environment's tool port, bound to this agent. */
  port: EnvironmentToolPort;
  /** The agent's effective allowlist: `env.*` keys and catalog keys. */
  allowlist: readonly string[];
  /** The run every key is minted for. */
  runId: string;
  /** The host's catalog services. Absent ⇒ the agent has the `env.*` tools only. */
  catalog?: CapabilityProvider;
}

export interface EnvCapabilities {
  /** (catalog ∩ allowlist), for `RunPorts.capabilities`. */
  capabilities: CapabilityProvider;
  /** The allowlisted `env.*` tools, for `RunPorts.platform`. */
  platform: PlatformTools;
  /**
   * The line that names the agent's environment tools, for its persona. A surface that is not the whole catalog has its tools
   * advertised by the role's core set, a pin or a NAME in the persona or task (`selectCatalog`): naming them keeps every allowlisted
   * tool on the menu from the first turn.
   */
  brief: string;
}

/** The refusal or the answer as the model reads it. A refusal is a failed result, never a throw. */
function toolResult(outcome: Awaited<ReturnType<EnvironmentToolPort["call"]>>): PlatformToolResult {
  if (outcome.ok) return { data: outcome.result };
  return { data: { ok: false, refusal: outcome.refusal, error: outcome.refusal.detail }, isError: true };
}

export function createEnvCapabilities(deps: EnvCapabilitiesDeps): EnvCapabilities {
  const allowed = new Set(deps.allowlist);
  const advertised = [...descriptors].filter(([key]) => allowed.has(key)).map(([, tool]) => tool);
  const schemas = advertised.map(toOpenAI);
  const granted = new Set<Capability>([...(deps.catalog?.capabilities ?? [])].filter((capability) => allowed.has(capability)));

  const platform: PlatformTools = {
    schemas: () => schemas,
    // Every allowlisted environment tool is required: the allowlist IS the menu (with `brief`, which names them for the selector).
    selection: { query: "", limit: DEFAULT_TOOL_LIMIT, required: new Set(schemas.map((schema) => schema.function.name)) },
    declared: (name) => {
      const key = envToolKeyOf(name);
      const descriptor = key ? descriptors.get(key) : undefined;
      return descriptor ? { mutates: requiresWriteApproval(descriptor) } : undefined;
    },
    async execute(name, args, env) {
      const key = envToolKeyOf(name);
      const descriptor = key ? descriptors.get(key) : undefined;
      if (!key || !descriptor) return { data: { ok: false, error: `\`${name}\` is not a tool of this environment.` }, isError: true };
      const idempotencyKey: IdempotencyKey | undefined = env.callId === undefined ? undefined : { runId: deps.runId, step: env.step, toolCallId: env.callId };
      const server = createMcpServer({
        list: () => advertised,
        // The agent-bound port records typed Shield refusals even for a known but withheld tool.
        resolve: (_entries, requested) => requested === descriptor.name ? descriptor : null,
        async callPrepared(_tool, input) {
          const result = toolResult(await deps.port.call(key, input, idempotencyKey));
          return { content: [], structuredContent: { data: result.data }, ...(result.isError ? { isError: true } : {}) };
        },
      }, {
        info: { name: "builderforce-webcontainer", version: "1.0.0" },
        // openRun governs dispatch and the bound environment port enforces its own write policy.
        gate: { approveWrite: () => true },
      });
      const result = await withInProcessMcp(server, (client) =>
        client.callTool({ name: descriptor.name, arguments: args }, undefined, { timeout: ENV_MCP_TIMEOUT_MS }),
      );
      const content = result.structuredContent;
      const data = content && typeof content === "object" && "data" in content ? content.data : content ?? result.content;
      return { data, ...(result.isError ? { isError: true } : {}) };
    },
  };

  const brief = schemas.length ? `Your environment tools: ${schemas.map((schema) => schema.function.name).join(", ")}.` : "You have no environment tools.";
  return { capabilities: { ...deps.catalog, capabilities: granted }, platform, brief };
}
