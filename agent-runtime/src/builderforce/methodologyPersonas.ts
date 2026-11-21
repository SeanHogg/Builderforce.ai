/**
 * PRD 49 methodology personas. Data, not branches. Registered through the
 * existing `registerBuiltins` — there is no second registry.
 */
import type { ArtifactId, PersonaPlugin } from "./types.js";

/** Methodology order. Not `listAll()` alphabetical order. Successor is `next`. */
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

export const METHODOLOGY_PERSONAS: readonly PersonaPlugin[] = [
  {
    name: "analyst",
    description: "Writes the PRD for this request and stops. Does not design or implement.",
    capabilities: ["Write the PRD"],
    tools: [],
    source: "builtin",
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
    tools: [],
    source: "builtin",
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
    tools: [],
    source: "builtin",
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
    tools: [],
    source: "builtin",
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

/** Register the four roles on the existing registry. Keyed by `name`. */
export function registerMethodologyPersonas(registry: {
  registerBuiltins(roles: Array<PersonaPlugin>): void;
}): void {
  registry.registerBuiltins([...METHODOLOGY_PERSONAS]);
}
