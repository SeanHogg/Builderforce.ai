import { MANIFEST_READ_PATHS } from '@builderforce/app-detect/manifest';
import { canvasAppFiles } from '../canvasApp';

/**
 * THE APP'S DECLARED AGENTS — the `agents` section of the session app's manifest
 * (`.builderforce/builderforce.json`, W12), read off the board's own code card.
 *
 * The manifest is a file of the app, and the app's files ARE the board's code cards
 * (`canvasAppFiles`), so this reads the same file the App surface runs — never a second
 * copy. The canonical path wins over a legacy root manifest, in `MANIFEST_READ_PATHS`
 * order, exactly as every other reader of the manifest picks it.
 *
 * The file is untrusted input: a declaration that is not an object is skipped, and every
 * field is read loosely. Validation (roles, ceilings) is the runtime's; this only says
 * what the room may show and which agent a station stands for.
 *
 * Pure: no React, no I/O.
 */

export interface ManifestAgent {
  /** The declaration's key — the agent's id in the manifest. */
  id: string;
  role: string | null;
  workload: string | null;
  /** Project-relative path to the agent's instructions. */
  instructions: string | null;
  tools: string[];
  skills: string[];
  memory: string | null;
}

/** The declaration fields a reading lists, in order. `role` always; the rest when declared. */
export const MANIFEST_AGENT_DECLARATION_FIELDS = ['role', 'workload', 'instructions', 'memory'] as const satisfies readonly (keyof ManifestAgent)[];

export type ManifestAgentDeclarationField = (typeof MANIFEST_AGENT_DECLARATION_FIELDS)[number];

/** The declaration as field/value rows: the role always (`noRole` when it declares none), then each other field it has. */
export function manifestAgentDeclarationRows(agent: ManifestAgent, noRole: string): Array<readonly [ManifestAgentDeclarationField, string]> {
  return MANIFEST_AGENT_DECLARATION_FIELDS.flatMap((field) => {
    const value = agent[field] ?? (field === 'role' ? noRole : null);
    return value ? [[field, value] as const] : [];
  });
}

/*
 * ── THE RUNTIME'S AGENT VOCABULARY, MIRRORED ─────────────────────────────────────
 * The core the frontend installs from npm (`@seanhogg/builderforce-webcontainers-core`
 * 2026.11.12) does not yet export its agent vocabulary, so the three names the declaration
 * form needs are stated here, each a copy of `packages/core/src/capabilities/agents.ts` or
 * `packages/core/src/agents/contract.ts`. They are named by the validator's own issue
 * paths (`agents.<id>.budget.<key>`, `agents.<id>.tools`), so a drift surfaces as a typed
 * refusal from `app_manifest.add_agent`, never as a silently accepted declaration. Once a
 * published core exports them, these become re-exports.
 */

/** Core `AGENT_BUDGET_KEYS`: the limits an agent's `budget` may set. */
export const AGENT_BUDGET_KEYS = ['tokens', 'usd', 'steps'] as const;

export type AgentBudgetKey = (typeof AGENT_BUDGET_KEYS)[number];

/** Core `TOOL_KEY_PATTERN`: a tool key is dotted lowercase segments, never a wildcard. */
export const TOOL_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/** Core `ENV_TOOL_KEYS`: the environment tools the runtime itself provides. */
export const ENV_TOOL_KEYS = ['env.fs.read', 'env.fs.write', 'env.fs.list', 'env.run', 'env.preview.fetch', 'env.services.status'] as const;

type BoardNodes = ReadonlyArray<{ id: string; data: Readonly<Record<string, unknown>> }>;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((entry) => (text(entry) ? [text(entry)!] : [])) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** The manifest's parsed JSON, or null when the board holds none (or it does not parse). */
function boardManifest(nodes: BoardNodes): Record<string, unknown> | null {
  const files = canvasAppFiles(nodes as ReadonlyArray<{ id: string; data: { [key: string]: unknown; kind: string } }>);
  const file = MANIFEST_READ_PATHS.map((path) => files.find((candidate) => candidate.path === path)).find(Boolean);
  if (!file) return null;
  try {
    const parsed: unknown = JSON.parse(file.source);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * One declaration (`agents.<id>`) as the room reads it. Exported so the declaration form
 * previews a draft through the SAME reading the agent station will apply once it is written.
 */
export function readManifestAgent(id: string, declaration: Readonly<Record<string, unknown>>): ManifestAgent {
  return {
    id,
    role: text(declaration.role),
    workload: text(declaration.workload),
    instructions: text(declaration.instructions),
    tools: strings(declaration.tools),
    skills: strings(declaration.skills),
    memory: text(declaration.memory),
  };
}

/** Every agent the session app's manifest declares, in declaration order. */
export function manifestAgents(nodes: BoardNodes): ManifestAgent[] {
  const agents = boardManifest(nodes)?.agents;
  if (!isRecord(agents)) return [];
  return Object.entries(agents).flatMap(([id, declaration]) => (isRecord(declaration) && id.trim() ? [readManifestAgent(id, declaration)] : []));
}
