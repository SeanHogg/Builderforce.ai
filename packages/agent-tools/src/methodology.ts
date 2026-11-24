/**
 * PRD 49 methodology roles and their gate — the ONE copy, shared by `agent-runtime`'s
 * persona registry and the editor's run host. Pure: no `node:*`, no model call, no
 * filesystem (the caller supplies `exists`), and no `agent-runtime` types: a role is
 * the structural {@link MethodologyRole}, which a runtime `PersonaPlugin` satisfies.
 */
import type { WriteScopeEntry } from "./writeScope.js";

export type ArtifactId = "prd" | "design" | "mockup" | "diagram" | "support";
export type PersonaColour = "analyst" | "designer" | "engineer" | "support";
export type PersonaRoute = "plan" | "pipeline" | "quick";
export type PersonaKnowledge = "context" | "first";

/** Absent means the role has no gate and may write anywhere. */
export interface PersonaMethodology {
  colour?: PersonaColour;
  /** Route kind. Not a model id. */
  route?: PersonaRoute;
  knowledge?: PersonaKnowledge;
  requires?: ArtifactId[];
  produces?: ArtifactId[];
  recordsRun?: boolean;
  /** Registry `name` of the next role. Successor means this field, not sort order. */
  next?: string;
  /** Appended to the persona system block after the Role line. */
  work?: string;
  writeScope?: WriteScopeEntry[];
}

/** What the gate and the run host read of a role. */
export interface MethodologyRole {
  name: string;
  methodology?: PersonaMethodology;
}

/** A built-in role as data; the runtime adds its plugin fields (`tools`, `source`). */
export interface MethodologyRoleSpec extends MethodologyRole {
  description: string;
  capabilities: string[];
}

/** Methodology order. Not alphabetical. Successor is `next`. */
export const METHODOLOGY_ORDER = ["analyst", "designer", "engineer", "support"] as const;

/** Run records are not an artifact. A record is `methodology/runs/<runId>.md`. */
export const RUN_RECORD_DIR = "runs";

/** Paths relative to the methodology folder. A `*` segment means any file there. */
export const ARTIFACT_REL: Record<ArtifactId, string> = {
  prd: "prd.md",
  design: "design/design.md",
  mockup: "design/*.html",
  diagram: "design/*.drawio",
  support: "support/*.md",
};

export const METHODOLOGY_ROLES: readonly MethodologyRoleSpec[] = [
  {
    name: "analyst",
    description: "Writes the PRD for this request and stops. Does not design or implement.",
    capabilities: ["Write the PRD"],
    methodology: {
      colour: "analyst",
      route: "plan",
      knowledge: "context",
      produces: ["prd"],
      recordsRun: false,
      next: "designer",
      writeScope: [{ key: "methodology" }],
      work: "Write methodology/prd.md for this request. Do not design or implement.",
    },
  },
  {
    name: "designer",
    description: "Writes the design, diagrams, and HTML mockup from the PRD. Does not implement.",
    capabilities: ["Write the design", "Write the mockup"],
    methodology: {
      colour: "designer",
      route: "plan",
      knowledge: "context",
      requires: ["prd"],
      produces: ["design", "diagram", "mockup"],
      recordsRun: false,
      next: "engineer",
      writeScope: [{ key: "methodology" }],
      work: "Write the design, diagrams, and HTML mockup under methodology/design/. Do not implement.",
    },
  },
  {
    name: "engineer",
    description: "Implements the PRD and the mockup, and records the run.",
    capabilities: ["Implement the request"],
    methodology: {
      colour: "engineer",
      route: "pipeline",
      knowledge: "context",
      requires: ["prd", "mockup"],
      recordsRun: true,
      writeScope: [{ key: "root" }],
      work: "Implement the PRD and the mockup. Record the run when it finishes.",
    },
  },
  {
    name: "support",
    description: "Answers from the methodology pack first, and writes notes only under support/.",
    capabilities: ["Answer from the methodology pack"],
    methodology: {
      colour: "support",
      route: "plan",
      knowledge: "first",
      produces: ["support"],
      recordsRun: false,
      writeScope: [{ key: "methodology", sub: "support" }],
      work: "Answer from the methodology pack first. Write notes only under methodology/support/.",
    },
  },
];

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

/** The state as a chat record stores it: hints are plain strings until read back through {@link chatPersonaOf}. */
export interface StoredChatPersona {
  role: string | null;
  lastRequest: string | null;
  hints: Record<string, readonly string[]>;
}

export function isArtifactId(value: string): value is ArtifactId {
  return Object.prototype.hasOwnProperty.call(ARTIFACT_REL, value);
}

/**
 * The persona state a chat record holds; none ⇒ role off (a fresh object, never the shared
 * constant). A stored hint that is not a known artifact is dropped — the record is storage, not a contract.
 */
export function chatPersonaOf(record: { persona?: StoredChatPersona | null } | null | undefined): ChatPersonaState {
  const stored = record?.persona;
  if (!stored) return { role: null, lastRequest: null, hints: {} };
  const hints = Object.fromEntries(Object.entries(stored.hints ?? {}).map(([role, ids]) => [role, ids.filter(isArtifactId)]));
  return { role: stored.role ?? null, lastRequest: stored.lastRequest ?? null, hints };
}

function methodologyIndex(name: string): number {
  const index = (METHODOLOGY_ORDER as readonly string[]).indexOf(name);
  return index === -1 ? METHODOLOGY_ORDER.length : index;
}

/** First role in methodology order whose `produces` includes the artifact. */
export function producerOf(artifact: ArtifactId, roles: readonly MethodologyRole[]): string | null {
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
export function successorProducer(artifact: ArtifactId, roles: readonly MethodologyRole[]): string | null {
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
 * The gate. A throw from `exists` is an I/O failure — this function does not catch it.
 * A blocked gate (`passed: false`) is a successful check.
 *
 * @param roles producer lookup. Defaults to the four built-ins. Pass the resolved
 * registry when a user or project persona may have replaced one.
 */
export function checkGate(
  role: MethodologyRole,
  methodologyDir: string,
  exists: (path: string) => boolean,
  roles: readonly MethodologyRole[] = METHODOLOGY_ROLES,
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
