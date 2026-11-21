/**
 * Gate types the editor run host needs. The check itself lives in
 * `agent-runtime` (`methodologyGate.ts`). This port is the same contract so the
 * VSIX does not take a dependency on the runtime package.
 */
export type ArtifactId = "prd" | "design" | "mockup" | "diagram" | "support";

export interface GateRole {
  name: string;
  methodology?: {
    requires?: ArtifactId[];
    produces?: ArtifactId[];
    next?: string;
  };
}

export interface GateResult {
  role: string;
  missing: ArtifactId[];
  producers: Partial<Record<ArtifactId, string>>;
  passed: boolean;
}

const ARTIFACT_REL: Record<ArtifactId, string> = {
  prd: "prd.md",
  design: "design/design.md",
  mockup: "design/*.html",
  diagram: "design/*.drawio",
  support: "support/*.md",
};

const ORDER = ["analyst", "designer", "engineer", "support"];

/** The four built-ins, same requires/produces/next as the runtime registry. */
export const METHODOLOGY_PERSONAS: readonly GateRole[] = [
  { name: "analyst", methodology: { produces: ["prd"], next: "designer" } },
  { name: "designer", methodology: { requires: ["prd"], produces: ["design", "diagram", "mockup"], next: "engineer" } },
  { name: "engineer", methodology: { requires: ["prd", "mockup"] } },
  { name: "support", methodology: { produces: ["support"] } },
];

function producerOf(artifact: ArtifactId, roles: readonly GateRole[]): string | undefined {
  const ordered = [...roles].sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));
  return ordered.find((role) => role.methodology?.produces?.includes(artifact))?.name;
}

export function checkGate(role: GateRole, methodologyDir: string, exists: (path: string) => boolean, roles: readonly GateRole[] = METHODOLOGY_PERSONAS): GateResult {
  const dir = methodologyDir.replace(/[/\\]+$/, "");
  const missing = (role.methodology?.requires ?? []).filter((artifact) => !exists(`${dir}/${ARTIFACT_REL[artifact]}`));
  const producers: Partial<Record<ArtifactId, string>> = {};
  for (const artifact of missing) {
    const producer = producerOf(artifact, roles);
    if (producer) producers[artifact] = producer;
  }
  return { role: role.name, missing, producers, passed: missing.length === 0 };
}
