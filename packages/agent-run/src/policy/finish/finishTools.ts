/**
 * policy/finish/finishTools.ts — the small deterministic helpers the finish gates and
 * the honest-summary gate share, ported from
 * `api/src/application/runtime/cloudAgentTools.ts` + the deliverable classification in
 * `api/src/application/delivery/deliverableEvidence.ts`.
 *
 * No `node:*` imports, no DOM.
 */

// ── Honesty: a claimed check that could not have run ─────────────────────────

/** Verb shapes that mean "a build/type-check/test was RUN". */
const CHECK_CLAIM_RE = /\b(type[- ]?check(?:ed)?|ran\s+tests?|tests?\s+pass(?:ed)?|build\s+(?:is\s+)?(?:green|pass(?:ed)?|succeeded)|lint(?:ing)?\s+clean|compil(?:es|ed)|ci\s+(?:is\s+)?green)\b/i;
/** Shapes that assert the claim positively ("passed", "green"), not merely that it was attempted. */
const PASS_CLAIM_RE = /\b(pass(?:ed)?|green|succeeded|ok|clean|resolved|fixed)\b/i;

/**
 * Whether a finish SUMMARY asserts a build/type-check/lint/test ran and passed that the
 * executor could not have run (no shell) — the honesty gate refuses to let a claim like
 * "all tests passed" ship when nothing was (or could be) executed.
 */
export function assertsUnrunVerification(summary: string): boolean {
  if (!summary || typeof summary !== "string") return false;
  return CHECK_CLAIM_RE.test(summary) && PASS_CLAIM_RE.test(summary);
}

// ── No code deliverable: the run is finishing with only docs (or nothing) ────

const DOCUMENT_EXTENSIONS = new Set([
  ".md", ".mdx", ".rst", ".adoc", ".asciidoc", ".txt",
]);

/** One deterministic definition of a documentation-only path (shared by the agent's
 *  finish gate and the Manager's review gate, so they classify the same set). */
export function isDocumentationPath(path: string): boolean {
  const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  if (!normalized) return false;
  if (normalized.startsWith("docs/") || normalized.startsWith("specs/")) return true;
  const file = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = file.lastIndexOf(".");
  return dot >= 0 && DOCUMENT_EXTENSIONS.has(file.slice(dot));
}

/** True when the run wrote NOTHING but documentation — a code-bound run finishing
 *  doc-only has no code deliverable. */
export function hasNoCodeDeliverable(writtenPaths: Iterable<string>): boolean {
  for (const path of writtenPaths) {
    if (!path.trim()) continue;
    if (!isDocumentationPath(path)) return false;
  }
  // Nothing but documentation (or nothing at all) was written: no code deliverable.
  return true;
}

// ── Anti-stub: how many times a finish may be blocked for placeholder code ───

/** A run may be blocked for placeholders at most this many times before the gate relents. */
export const MAX_PLACEHOLDER_FINISH_BLOCKS = 2;
