/**
 * PRD 49 gate. Pure: no model call, no filesystem. The caller supplies `exists`.
 * A throw from `exists` is an I/O failure — this function does not catch it.
 * A blocked gate (`passed: false`) is a successful check.
 */
import { ARTIFACT_REL, METHODOLOGY_ORDER, METHODOLOGY_PERSONAS } from "./methodologyPersonas.js";
import type { ArtifactId, PersonaPlugin } from "./types.js";

export interface GateResult {
  /** Persona name. */
  role: string;
  missing: ArtifactId[];
  /** Producer name for each missing artifact. */
  producers: Partial<Record<ArtifactId, string>>;
  passed: boolean;
}

export interface ChatPersonaState {
  /** Active role name, or null when the role is off. */
  role: string | null;
  lastRequest: string | null;
  /** Missing artifacts per role name, from the last successful check of every role. */
  hints: Record<string, ArtifactId[]>;
}

/** A chat record with no `persona` field loads as role off. */
export const PERSONA_OFF: ChatPersonaState = { role: null, lastRequest: null, hints: {} };

export function loadChatPersona(record: { persona?: ChatPersonaState } | null | undefined): ChatPersonaState {
  return record?.persona ?? { role: null, lastRequest: null, hints: {} };
}

function methodologyIndex(name: string): number {
  const index = (METHODOLOGY_ORDER as readonly string[]).indexOf(name);
  return index === -1 ? METHODOLOGY_ORDER.length : index;
}

/** First role in methodology order whose `produces` includes the artifact. */
export function producerOf(artifact: ArtifactId, roles: readonly PersonaPlugin[]): string | null {
  const ordered = roles
    .map((role, index) => ({ role, index }))
    .sort((a, b) => {
      const byOrder = methodologyIndex(a.role.name) - methodologyIndex(b.role.name);
      return byOrder !== 0 ? byOrder : a.index - b.index;
    });
  return ordered.find((entry) => entry.role.methodology?.produces?.includes(artifact))?.role.name ?? null;
}

/**
 * Spec cross-check. Earliest role that does not require the artifact and whose
 * `next` role does. Successor means `next`, not sort order.
 */
export function successorProducer(artifact: ArtifactId, roles: readonly PersonaPlugin[]): string | null {
  const byName = new Map(roles.map((role) => [role.name, role]));
  const ordered = [...roles].sort((a, b) => methodologyIndex(a.name) - methodologyIndex(b.name));
  for (const role of ordered) {
    const requires = role.methodology?.requires ?? [];
    if (requires.includes(artifact)) continue;
    const next = role.methodology?.next ? byName.get(role.methodology.next) : undefined;
    if (next?.methodology?.requires?.includes(artifact)) return role.name;
  }
  return null;
}

function artifactPath(methodologyDir: string, artifact: ArtifactId): string {
  const dir = methodologyDir.replace(/[/\\]+$/, "");
  return `${dir}/${ARTIFACT_REL[artifact]}`;
}

/**
 * @param roles producer lookup. Defaults to the four built-ins. Pass the
 * resolved registry when a user or project persona may have replaced one.
 */
export function checkGate(
  role: PersonaPlugin,
  methodologyDir: string,
  exists: (path: string) => boolean,
  roles: readonly PersonaPlugin[] = METHODOLOGY_PERSONAS,
): GateResult {
  const required = role.methodology?.requires ?? [];
  const missing = required.filter((artifact) => !exists(artifactPath(methodologyDir, artifact)));
  const producers: Partial<Record<ArtifactId, string>> = {};
  for (const artifact of missing) {
    const producer = producerOf(artifact, roles);
    if (producer) producers[artifact] = producer;
  }
  return { role: role.name, missing, producers, passed: missing.length === 0 };
}
