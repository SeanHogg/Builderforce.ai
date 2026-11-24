/**
 * The APP MANIFEST tool catalog — `app_manifest.schema`, `app_manifest.validate` and
 * `app_manifest.add_agent`, spread into `builtinMcpService`'s `CATALOG` (docs/specs/make.md
 * "W11 contract — the app manifest ai resource" §8; W12 "define agents without code").
 *
 * There is exactly one schema and one validator: the runtime's own, from
 * `@seanhogg/builderforce-webcontainers-core/manifest` (the pure core export). This file only
 * adapts them to the tool shape; it never restates a field, rule or capability.
 *
 * `add_agent` is the one WRITE. The manifest file is the only store of a declared agent, so
 * the tool reads `builderforce.json`, merges the declaration, runs the runtime's validator
 * over the RESULT and writes it back only when that reports no error. A refusal carries the
 * validator's own typed issues (`agent-model-id`, `policy-widening`, …) and writes nothing.
 */
import {
  APP_MANIFEST_SCHEMA_V1,
  BUILTIN_CAPABILITIES,
  RESOURCE_CAPABILITIES,
  describeManifestIssue,
  manifestHasErrors,
  parseManifest,
  toApplicationSpec,
  validateManifest,
  type AppManifest,
  type ManifestIssue,
  type ManifestTargetId,
} from '@seanhogg/builderforce-webcontainers-core/manifest';
import { MANIFEST_PATH, MANIFEST_READ_PATHS } from '@builderforce/app-detect/manifest';
import { ownedProjectId } from './appBlueprintToolCatalog';
import { ReplayRouteError, replayRoute, type BuiltinCtx, type BuiltinTool } from './builtinToolContext';

/**
 * The caller's own project, or a tool error — THE access check a project-scoped manifest
 * (or `runtime.agents.*`) tool runs before it reads or writes anything. It is the blueprint
 * catalog's tenant boundary, re-exported here so there is exactly one.
 */
export { ownedProjectId };

type Json = Record<string, unknown>;

// --- tiny JSON-schema helpers (same shapes the other catalogs use) ---
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;
const obj = (properties: Json, required: string[] = []): Json => ({ type: 'object', properties, required });

const TARGETS: readonly ManifestTargetId[] = ['browser', 'cloudflare', 'aws', 'azure', 'gcp'];
const DEFAULT_TARGET: ManifestTargetId = 'browser';

/** A short field guide beside the schema, so the agent need not infer the rules from it. */
const FIELD_GUIDE = [
  'version must be 1.',
  'Every service requires `runtime` and `command`.',
  'A service `role` is one of the roles the schema enumerates; `uses` names resources declared in `resources`.',
  'An `ai` resource gives a service AI_BASE_URL; no key ever lives in the process or the repo.',
  'Environment overrides (`environments`) may only change entries the base manifest already has.',
];

function manifestToolError(message: string, details?: Json): Json {
  return { ok: false as const, error: message, ...details };
}

function isTarget(raw: unknown): raw is ManifestTargetId {
  return typeof raw === 'string' && (TARGETS as readonly string[]).includes(raw);
}

/** Each issue as the typed record plus the one-line sentence a person reads. */
function describeIssues(issues: readonly ManifestIssue[]): Array<ManifestIssue & { message: string }> {
  return issues.map((issue) => ({ ...issue, message: describeManifestIssue(issue) }));
}

/** The issues split the way every manifest tool replies with them. */
export function issueReport(issues: readonly ManifestIssue[]) {
  const described = describeIssues(issues);
  return {
    errors: described.filter((i) => i.severity === 'error'),
    warnings: described.filter((i) => i.severity !== 'error'),
    issues: described,
  };
}

export function isRecord(value: unknown): value is Json {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The project's manifest file as stored: the path it was read from, and its text. */
export interface StoredManifest {
  path: string;
  text: string;
}

/**
 * Where the manifest lives — the project's own files. A port, so the write path is tested
 * without a Worker; the default replays the project file routes, which carry their own
 * write gate and archive the version they replace.
 */
export interface ManifestFileStore {
  /** The manifest, canonical path first then the legacy ones; null when the project has none. */
  read(ctx: BuiltinCtx, projectId: number): Promise<StoredManifest | null>;
  /** Write the manifest to its canonical path (a legacy file is read, never written). */
  write(ctx: BuiltinCtx, projectId: number, text: string): Promise<void>;
}

const projectFileRoute = (projectId: number, path: string) =>
  `/api/projects/${projectId}/files/${path.split('/').map(encodeURIComponent).join('/')}`;

export const PROJECT_MANIFEST_FILES: ManifestFileStore = {
  async read(ctx, projectId) {
    for (const path of MANIFEST_READ_PATHS) {
      try {
        const body = await replayRoute(ctx, 'GET', projectFileRoute(projectId, path));
        // The route answers text; `replayRoute` hands JSON text back already parsed.
        return { path, text: typeof body === 'string' ? body : JSON.stringify(body) };
      } catch (error) {
        // Missing at this path is the next path's turn; anything else is a real failure.
        if (error instanceof ReplayRouteError && error.status === 404) continue;
        throw error;
      }
    }
    return null;
  },
  async write(ctx, projectId, text) {
    await replayRoute(ctx, 'PUT', projectFileRoute(projectId, MANIFEST_PATH), undefined, { rawText: text });
  },
};

export interface AppManifestToolDeps {
  files: ManifestFileStore;
}

/**
 * The manifest with `agent` declared as `agents.<id>`. `capabilities.agents` is enabled
 * (with no ceilings of its own) when the manifest has not enabled it yet — declaring an
 * agent IS opting into the capability; a manifest that already sets ceilings keeps them.
 */
function withAgent(manifest: AppManifest, id: string, agent: Json): AppManifest {
  const capabilities = isRecord(manifest.capabilities) ? manifest.capabilities : {};
  const agents = isRecord(manifest.agents) ? manifest.agents : {};
  return {
    ...manifest,
    capabilities: Object.hasOwn(capabilities, 'agents') ? capabilities : { ...capabilities, agents: {} },
    agents: { ...agents, [id]: agent },
  } as AppManifest;
}

async function addAgent(deps: AppManifestToolDeps, ctx: BuiltinCtx, a: Json): Promise<Json> {
  const projectId = await ownedProjectId(ctx, a.projectId);
  if (typeof projectId !== 'number') return projectId;
  const id = typeof a.id === 'string' ? a.id.trim() : '';
  if (!id) return manifestToolError('Pass the agent `id` (its key under `agents`).');
  if (!isRecord(a.agent)) return manifestToolError('Pass the declaration as `agent` (an object).');

  const stored = await deps.files.read(ctx, projectId);
  if (!stored) {
    return manifestToolError(`The project has no app manifest (${MANIFEST_PATH}); create one before declaring an agent.`, { projectId });
  }
  const parsed = parseManifest(stored.text);
  if (!parsed.manifest || manifestHasErrors(parsed.issues)) {
    return manifestToolError('The project manifest does not parse; nothing was written.', { projectId, path: stored.path, ...issueReport(parsed.issues) });
  }
  if (isRecord(parsed.manifest.agents) && Object.hasOwn(parsed.manifest.agents, id)) {
    return manifestToolError(`An agent "${id}" is already declared; nothing was written.`, { projectId, agentId: id });
  }

  const next = withAgent(parsed.manifest, id, a.agent);
  const issues = validateManifest(next, { capabilities: BUILTIN_CAPABILITIES });
  if (manifestHasErrors(issues)) {
    return manifestToolError('The declaration was refused; nothing was written.', { projectId, agentId: id, ...issueReport(issues) });
  }
  await deps.files.write(ctx, projectId, `${JSON.stringify(next, null, 2)}\n`);
  return {
    ok: true,
    projectId,
    agentId: id,
    path: MANIFEST_PATH,
    agent: a.agent,
    warnings: issueReport(issues).warnings,
    instruction: `The agent is declared. Start a run with runtime.agents.start { projectId: ${projectId}, agentId: "${id}" }.`,
  };
}

/** The read-only rows: they take no store. */
const READ_TOOLS: BuiltinTool[] = [
  {
    tool: 'app_manifest.schema',
    mutates: false,
    description:
      'Get the app manifest v1 (builderforce.json) JSON schema, a short field guide, and the resource ' +
      'capability matrix for a deployment target (browser, cloudflare, aws, azure, gcp; default browser) — ' +
      'which resources, including the ai resource, that target can host. Read this before writing a manifest.',
    parameters: obj({ target: { ...S, enum: [...TARGETS] } }),
    run: async (_ctx, a) => {
      if (a.target !== undefined && !isTarget(a.target)) {
        return manifestToolError(`Unknown target: expected one of ${TARGETS.join(', ')}`, { target: a.target });
      }
      const target: ManifestTargetId = isTarget(a.target) ? a.target : DEFAULT_TARGET;
      const capabilities = Object.fromEntries(
        Object.entries(RESOURCE_CAPABILITIES).map(([type, row]) => [type, row[target]]),
      );
      return { ok: true, target, schema: APP_MANIFEST_SCHEMA_V1, fieldGuide: FIELD_GUIDE, capabilities };
    },
  },
  {
    tool: 'app_manifest.validate',
    mutates: false,
    description:
      'Validate an app manifest v1 (builderforce.json). Pass the manifest as `content` (a JSON string or an object). ' +
      'Returns { ok, errors, warnings, issues } from the runtime\'s own validator. With `environment`, also reports ' +
      'which resources that environment\'s target declines to host.',
    parameters: obj({ content: { description: 'The manifest: a JSON string or an object.' }, environment: S, projectId: N }),
    run: async (_ctx, a) => {
      if (a.path !== undefined) {
        return manifestToolError('Reading a manifest from the repo is not supported yet: pass the manifest as `content`.');
      }
      const text =
        typeof a.content === 'string' ? a.content
        : a.content && typeof a.content === 'object' ? JSON.stringify(a.content)
        : null;
      if (text === null || !text.trim()) return manifestToolError('Pass the manifest as `content` (a JSON string or an object).');

      const parsed = parseManifest(text);
      const issues: ManifestIssue[] = [...parsed.issues];
      let declined: Array<{ id: string; reason: string }> = [];
      if (parsed.manifest) {
        issues.push(...validateManifest(parsed.manifest));
        if (typeof a.environment === 'string' && a.environment.trim()) {
          const projectId = Number.isFinite(Number(a.projectId)) ? String(Number(a.projectId)) : 'validate';
          const spec = toApplicationSpec(parsed.manifest, a.environment.trim(), { projectId });
          issues.push(...spec.issues);
          declined = spec.declined;
        }
      }
      return {
        ok: !manifestHasErrors(issues),
        ...issueReport(issues),
        ...(declined.length ? { declined } : {}),
      };
    },
  },
];

/** The catalog over a manifest store; `APP_MANIFEST_TOOLS` is it over the project's files. */
export function createAppManifestTools(deps: AppManifestToolDeps): BuiltinTool[] {
  return [
    ...READ_TOOLS,
    {
      tool: 'app_manifest.add_agent',
      mutates: true,
      description:
        "Declare an autonomous agent in the project's app manifest (builderforce.json) without writing code. " +
        'Pass `projectId`, the agent `id` (its key under `agents`) and the declaration as `agent`: a `role` or ' +
        '`workload` (never a model id), an optional `instructions` path, `tools` (catalog keys; [] is allowed), ' +
        '`triggers` ({ manual: true } | { cron, timezone? } | { service, event }) and `budget` ({ tokens, usd, steps }). ' +
        'The merged manifest is checked by the runtime\'s validator; any error refuses the declaration with typed ' +
        'issues and writes nothing. Enables `capabilities.agents` when the manifest has not yet.',
      parameters: obj({
        projectId: N,
        id: S,
        agent: { type: 'object', description: 'The agent declaration (the manifest\'s `agents.<id>`).', additionalProperties: true },
      }, ['projectId', 'id', 'agent']),
      run: (ctx, a) => addAgent(deps, ctx, a),
    },
  ];
}

export const APP_MANIFEST_TOOLS: BuiltinTool[] = createAppManifestTools({ files: PROJECT_MANIFEST_FILES });
