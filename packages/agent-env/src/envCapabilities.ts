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
import { ENV_TOOL_KEYS, type EnvironmentToolPort } from "./envContract.js";
import { ENV_TOOL_MUTATES, envToolKeyOf, envToolName, isEnvToolKey, type IdempotencyKey } from "./idempotentTools.js";

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

const schemaOf = (key: string): ToolSchema => ({ type: "function", function: { name: envToolName(key), ...ENV_TOOL_SPECS[key]! } });

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
  const envAllowed = ENV_TOOL_KEYS.filter((key) => allowed.has(key));
  const schemas = envAllowed.map(schemaOf);
  const granted = new Set<Capability>([...(deps.catalog?.capabilities ?? [])].filter((capability) => allowed.has(capability)));

  const platform: PlatformTools = {
    schemas: () => schemas,
    // Every allowlisted environment tool is required: the allowlist IS the menu (with `brief`, which names them for the selector).
    selection: { query: "", limit: DEFAULT_TOOL_LIMIT, required: new Set(schemas.map((schema) => schema.function.name)) },
    declared: (name) => {
      const key = envToolKeyOf(name);
      return key ? { mutates: ENV_TOOL_MUTATES[key] === true } : undefined;
    },
    async execute(name, args, env) {
      const key = envToolKeyOf(name);
      if (!key || !isEnvToolKey(key)) return { data: { ok: false, error: `\`${name}\` is not a tool of this environment.` }, isError: true };
      const idempotencyKey: IdempotencyKey | undefined = env.callId === undefined ? undefined : { runId: deps.runId, step: env.step, toolCallId: env.callId };
      return toolResult(await deps.port.call(key, args, idempotencyKey));
    },
  };

  const brief = schemas.length ? `Your environment tools: ${schemas.map((schema) => schema.function.name).join(", ")}.` : "You have no environment tools.";
  return { capabilities: { ...deps.catalog, capabilities: granted }, platform, brief };
}
