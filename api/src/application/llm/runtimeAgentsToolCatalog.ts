/**
 * The RUNTIME AGENTS tool catalog — `runtime.agents.list|status|start|steer|cancel`, spread into
 * `builtinMcpService`'s `CATALOG` (docs/specs/make.md W12 "define agents without code").
 *
 * An agent is DECLARED in the project's manifest (`builderforce.json`, `agents.<id>`) by role and
 * RUN by the browser host. This file is the authorized, validated gateway between the two:
 *   - every tool first proves the project is the caller's own (`ownedProjectId`, the same check
 *     the manifest tools run) and validates its arguments against its own `parameters` schema;
 *   - `start` re-validates the manifest with the runtime's own validator, finds the declaration,
 *     refuses a model id (agents are declared by role, never by model) and refuses a tool
 *     allowlist naming anything that is not a catalog key (`env.*` keys are the runtime's own);
 *   - the run itself is dispatched through an injected {@link RuntimeAgentsPort}; with none wired
 *     the tool answers `runtime-unavailable` instead of pretending.
 *
 * Every refusal is `{ ok: false, code, error, … }` with a stable `code` the model can act on.
 */
import { ENV_TOOL_PREFIX } from '@seanhogg/builderforce-webcontainers-core';
import {
  AGENT_ROLE_PATTERN,
  manifestHasErrors,
  parseManifest,
  type AppManifest,
  type ManifestIssue,
} from '@seanhogg/builderforce-webcontainers-core/manifest';
import { MANIFEST_PATH } from '@builderforce/app-detect/manifest';
import {
  PROJECT_MANIFEST_FILES,
  isRecord,
  issueReport,
  ownedProjectId,
  type ManifestFileStore,
} from './appManifestToolCatalog';
import { prepareBuiltinToolArgs } from './builtinToolArgs';
import { type BuiltinCtx, type BuiltinTool } from './builtinToolContext';

type Json = Record<string, unknown>;

/** Bounds on free text a model sends, so one call cannot push an unbounded prompt into a run. */
export const RUNTIME_AGENT_TASK_MAX_LENGTH = 8_000;
export const RUNTIME_AGENT_MESSAGE_MAX_LENGTH = 4_000;
export const RUNTIME_AGENT_ID_MAX_LENGTH = 64;
export const RUNTIME_RUN_ID_MAX_LENGTH = 128;

/** Declaration / argument keys that pick a model; the host's router does that from the role. */
const MODEL_KEYS = ['model', 'models', 'modelId', 'provider'] as const;
/** Characters of a model id (`anthropic/claude`, `gpt-4o:latest`, `claude-3.5`), never of a role. */
const MODEL_ID_CHARS = /[/:.]/;
/** Well-known model-family prefixes: `gpt-4o` and `claude-sonnet` pass the role pattern but are not roles. */
const MODEL_FAMILY_PREFIX = /^(gpt|claude|gemini|llama|mistral|mixtral|grok|deepseek|qwen|o\d)(-|\d|$)/;
/** The issue code the runtime's validator raises for a model id in a declaration. */
const MODEL_ID_ISSUE = 'agent-model-id';

/** The typed codes a refusal carries. */
export type RuntimeAgentsCode =
  | 'invalid-argument'
  | 'invalid-agent-id'
  | 'manifest-missing'
  | 'manifest-invalid'
  | 'agent-not-declared'
  | 'model-id-refused'
  | 'tool-not-in-catalog'
  | 'runtime-unavailable';

/** What `start` hands the host: the declaration reduced to what a run needs, by role. */
export interface RuntimeAgentStartInput {
  projectId: number;
  agentId: string;
  task: string;
  /** The declared role (or workload) — never a model id. */
  role: string;
  /** The declaration's tool allowlist, already checked against the catalog. */
  tools: string[];
  correlation?: { environmentId: string; runtimeId: string; agentId?: string; correlationId?: string };
}

/** Which project a run call is on behalf of, so the host can refuse a run from another project. */
export interface RuntimeAgentsScope {
  projectId: number;
}

/** The host that runs agents (the user's browser tab). A port, so the tools are tested without one. */
export interface RuntimeAgentsPort {
  start(input: RuntimeAgentStartInput): Promise<{ runId: string }>;
  steer(runId: string, message: string, scope: RuntimeAgentsScope): Promise<void>;
  cancel(runId: string, scope: RuntimeAgentsScope): Promise<void>;
  status(runId: string, scope: RuntimeAgentsScope): Promise<unknown>;
}

export interface RuntimeAgentsToolDeps {
  /** The CATALOG's tool keys, read at call time (the catalog contains these very tools). */
  catalogKeys: () => ReadonlySet<string>;
  port?: RuntimeAgentsPort;
  /** Where the manifest lives; default is the project's own files. */
  files?: ManifestFileStore;
}

const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

const PROJECT_ID = { ...N, description: "The project whose manifest declares the agents (must be the caller's own)." };
const AGENT_ID = {
  ...S,
  pattern: AGENT_ROLE_PATTERN.source,
  maxLength: RUNTIME_AGENT_ID_MAX_LENGTH,
  description: 'The agent id: its key under `agents` in builderforce.json.',
};
const RUN_ID = { ...S, maxLength: RUNTIME_RUN_ID_MAX_LENGTH, description: 'The run id `runtime.agents.start` returned.' };

function refusal(code: RuntimeAgentsCode, error: string, details?: Json): Json {
  return { ok: false as const, code, error, ...details };
}

const runtimeUnavailable = (): Json =>
  refusal('runtime-unavailable', 'No agent host is connected: open the project in the browser workspace to run agents.');

/** A bounded, non-blank string argument, or a refusal naming the field. */
function boundedText(value: unknown, field: string, max: number): string | Json {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return refusal('invalid-argument', `Pass \`${field}\` (a non-empty string).`);
  if (text.length > max) return refusal('invalid-argument', `\`${field}\` is too long: at most ${max} characters.`, { field, max });
  return text;
}

function looksLikeModelId(value: string): boolean {
  return MODEL_ID_CHARS.test(value) || MODEL_FAMILY_PREFIX.test(value);
}

/** The agent id, or the refusal: a model id is `model-id-refused`, anything off-pattern `invalid-agent-id`. */
function agentIdArg(raw: unknown): string | Json {
  const id = boundedText(raw, 'agentId', RUNTIME_AGENT_ID_MAX_LENGTH);
  if (typeof id !== 'string') return id;
  if (looksLikeModelId(id)) {
    return refusal('model-id-refused', 'Agents are declared by role, never by model: pass the agent id from the manifest.', { agentId: id });
  }
  if (!AGENT_ROLE_PATTERN.test(id)) {
    return refusal('invalid-agent-id', `The agent id must match ${AGENT_ROLE_PATTERN.source}.`, { agentId: id });
  }
  return id;
}

/** A run id is opaque to us, so only its presence and size are checked. */
function runIdArg(raw: unknown): string | Json {
  return boundedText(raw, 'runId', RUNTIME_RUN_ID_MAX_LENGTH);
}

/** A manifest that parsed, with the issues `parseManifest` raised (it runs `validateManifest` itself). */
interface LoadedManifest {
  manifest: AppManifest;
  issues: ManifestIssue[];
}

/**
 * The project's manifest, or a refusal when there is none or it does not parse. A manifest that
 * parses with error issues is returned WITH them, so `start` can name a model id
 * (`model-id-refused`) before the generic `manifest-invalid`.
 */
async function loadManifest(files: ManifestFileStore, ctx: BuiltinCtx, projectId: number): Promise<LoadedManifest | Json> {
  const stored = await files.read(ctx, projectId);
  if (!stored) return refusal('manifest-missing', `The project has no app manifest (${MANIFEST_PATH}).`, { projectId });
  const parsed = parseManifest(stored.text);
  if (!parsed.manifest) {
    return refusal('manifest-invalid', 'The project manifest does not parse.', { projectId, path: stored.path, ...issueReport(parsed.issues) });
  }
  return { manifest: parsed.manifest, issues: parsed.issues };
}

const manifestInvalid = (projectId: number, issues: ManifestIssue[]): Json =>
  refusal('manifest-invalid', 'The project manifest is invalid; fix it before using its agents.', { projectId, ...issueReport(issues) });

/** Narrows on the success shape: a refusal (`Json`) is not a {@link LoadedManifest}, but a `LoadedManifest` is a `Json`. */
const isLoaded = (value: LoadedManifest | Json): value is LoadedManifest => !(isRecord(value) && value.ok === false);

/** The declared role (or workload), when it is a string. */
function declaredRole(declaration: Json): string | undefined {
  const role = declaration.role ?? declaration.workload;
  return typeof role === 'string' ? role : undefined;
}

function declaredTools(declaration: Json): string[] {
  return Array.isArray(declaration.tools) ? declaration.tools.filter((t): t is string => typeof t === 'string') : [];
}

function declarations(manifest: AppManifest): Array<[string, Json]> {
  const agents = isRecord(manifest.agents) ? manifest.agents : {};
  return Object.entries(agents).filter((entry): entry is [string, Json] => isRecord(entry[1]));
}

/** Runs one tool body behind the shared preamble: schema-checked args, then the caller's own project. */
function guarded(
  name: string,
  parameters: Json,
  body: (ctx: BuiltinCtx, a: Json, projectId: number) => Promise<unknown>,
): BuiltinTool['run'] {
  return async (ctx, raw) => {
    const a = prepareBuiltinToolArgs(name, parameters, raw);
    const projectId = await ownedProjectId(ctx, a.projectId);
    if (typeof projectId !== 'number') return projectId;
    return body(ctx, a, projectId);
  };
}

/** The catalog over a host port and the CATALOG's keys; `RUNTIME_AGENTS_TOOLS` is the default instance. */
export function createRuntimeAgentsTools(deps: RuntimeAgentsToolDeps): BuiltinTool[] {
  const files = deps.files ?? PROJECT_MANIFEST_FILES;

  const startParameters = obj(
    {
      projectId: PROJECT_ID,
      agentId: AGENT_ID,
      task: { ...S, maxLength: RUNTIME_AGENT_TASK_MAX_LENGTH, description: 'What the agent should do.' },
    },
    ['projectId', 'agentId', 'task'],
  );
  const listParameters = obj({ projectId: PROJECT_ID }, ['projectId']);
  const statusParameters = obj({ projectId: PROJECT_ID, runId: RUN_ID }, ['projectId', 'runId']);
  const steerParameters = obj(
    { projectId: PROJECT_ID, runId: RUN_ID, message: { ...S, maxLength: RUNTIME_AGENT_MESSAGE_MAX_LENGTH, description: 'Guidance for the running agent.' } },
    ['projectId', 'runId', 'message'],
  );
  const cancelParameters = statusParameters;

  /** A run-scoped tool: validate the run id, then dispatch through the port (or say there is none). */
  const runCall = (
    name: string,
    mutates: boolean,
    description: string,
    parameters: Json,
    dispatch: (port: RuntimeAgentsPort, runId: string, message: string, scope: RuntimeAgentsScope) => Promise<unknown>,
    needsMessage = false,
  ): BuiltinTool => ({
    tool: name,
    mutates,
    description,
    parameters,
    run: guarded(name, parameters, async (_ctx, a, projectId) => {
      const runId = runIdArg(a.runId);
      if (typeof runId !== 'string') return runId;
      const message = needsMessage ? boundedText(a.message, 'message', RUNTIME_AGENT_MESSAGE_MAX_LENGTH) : '';
      if (typeof message !== 'string') return message;
      if (!deps.port) return runtimeUnavailable();
      const result = await dispatch(deps.port, runId, message, { projectId });
      return { ok: true, projectId, runId, ...(result === undefined ? {} : { result }) };
    }),
  });

  return [
    {
      tool: 'runtime.agents.list',
      mutates: false,
      description:
        "List the agents declared in the project's app manifest (builderforce.json): each id, its role and its tool allowlist. " +
        'Declare a new one with app_manifest.add_agent; start one with runtime.agents.start.',
      parameters: listParameters,
      run: guarded('runtime.agents.list', listParameters, async (ctx, _a, projectId) => {
        const loaded = await loadManifest(files, ctx, projectId);
        if (!isLoaded(loaded)) return loaded;
        if (manifestHasErrors(loaded.issues)) return manifestInvalid(projectId, loaded.issues);
        const agents = declarations(loaded.manifest).map(([id, declaration]) => ({
          id,
          role: declaredRole(declaration) ?? null,
          tools: declaredTools(declaration),
        }));
        return { ok: true, projectId, agents };
      }),
    },
    runCall(
      'runtime.agents.status',
      false,
      'Get the state of an agent run (`runId` from runtime.agents.start).',
      statusParameters,
      (port, runId, _message, scope) => port.status(runId, scope),
    ),
    {
      tool: 'runtime.agents.start',
      mutates: true,
      description:
        'Start a declared agent on a task and get its `runId`. The agent runs in the browser workspace under its ' +
        "manifest declaration: its role and tool allowlist only (every non-env.* tool must be a catalog key). " +
        'Agents are chosen by id, never by model.',
      parameters: startParameters,
      run: guarded('runtime.agents.start', startParameters, async (ctx, a, projectId) => {
        const modelKey = MODEL_KEYS.find((key) => Object.hasOwn(a, key));
        if (modelKey) {
          return refusal('model-id-refused', `Agents are declared by role, never by model: remove \`${modelKey}\`.`, { field: modelKey });
        }
        const agentId = agentIdArg(a.agentId);
        if (typeof agentId !== 'string') return agentId;
        const task = boundedText(a.task, 'task', RUNTIME_AGENT_TASK_MAX_LENGTH);
        if (typeof task !== 'string') return task;

        const loaded = await loadManifest(files, ctx, projectId);
        if (!isLoaded(loaded)) return loaded;
        const { issues } = loaded;
        const modelIssues = issues.filter((i) => i.code === MODEL_ID_ISSUE && (i.path === `agents.${agentId}` || i.path.startsWith(`agents.${agentId}.`)));
        if (modelIssues.length) {
          return refusal('model-id-refused', `Agent "${agentId}" names a model; agents are declared by role.`, { projectId, agentId, ...issueReport(modelIssues) });
        }
        if (manifestHasErrors(issues)) return manifestInvalid(projectId, issues);

        const declaration = declarations(loaded.manifest).find(([id]) => id === agentId)?.[1];
        if (!declaration) return refusal('agent-not-declared', `No agent "${agentId}" is declared in the manifest.`, { projectId, agentId });
        const role = declaredRole(declaration);
        if (!role) return refusal('manifest-invalid', `Agent "${agentId}" declares no role.`, { projectId, agentId });
        if (looksLikeModelId(role)) {
          return refusal('model-id-refused', `Agent "${agentId}" declares the role "${role}", which is a model id; agents are declared by role.`, { projectId, agentId, role });
        }

        const tools = declaredTools(declaration);
        const keys = deps.catalogKeys();
        const unknown = tools.filter((tool) => !tool.startsWith(ENV_TOOL_PREFIX) && !keys.has(tool));
        if (unknown.length) {
          return refusal('tool-not-in-catalog', `Agent "${agentId}" allows tools that are not in the catalog: ${unknown.join(', ')}.`, { projectId, agentId, tools: unknown });
        }

        if (!deps.port) return runtimeUnavailable();
        const { runId } = await deps.port.start({ projectId, agentId, task, role, tools });
        return { ok: true, projectId, agentId, runId, role };
      }),
    },
    runCall(
      'runtime.agents.steer',
      true,
      'Send guidance to a running agent (`runId` from runtime.agents.start).',
      steerParameters,
      (port, runId, message, scope) => port.steer(runId, message, scope),
      true,
    ),
    runCall(
      'runtime.agents.cancel',
      true,
      'Cancel a running agent (`runId` from runtime.agents.start).',
      cancelParameters,
      (port, runId, _message, scope) => port.cancel(runId, scope),
    ),
  ];
}

/**
 * The default instance, with no catalog and no host: it can list, and it refuses every `start`
 * that names a non-env tool. `builtinMcpService` wires the real one over its own `CATALOG`.
 */
export const RUNTIME_AGENTS_TOOLS: BuiltinTool[] = createRuntimeAgentsTools({ catalogKeys: () => new Set() });
