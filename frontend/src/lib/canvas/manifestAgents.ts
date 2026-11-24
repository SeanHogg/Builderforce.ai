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

/** Every agent the session app's manifest declares, in declaration order. */
export function manifestAgents(nodes: BoardNodes): ManifestAgent[] {
  const agents = boardManifest(nodes)?.agents;
  if (!isRecord(agents)) return [];
  return Object.entries(agents).flatMap(([id, declaration]) => (isRecord(declaration) && id.trim() ? [{
    id,
    role: text(declaration.role),
    workload: text(declaration.workload),
    instructions: text(declaration.instructions),
    tools: strings(declaration.tools),
    skills: strings(declaration.skills),
    memory: text(declaration.memory),
  }] : []));
}
