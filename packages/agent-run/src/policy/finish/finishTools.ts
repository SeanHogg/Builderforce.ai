/**
 * policy/finish/finishTools.ts — the small deterministic helpers the finish gates and
 * the honest-summary gate share, ported from
 * `api/src/application/runtime/cloudAgentTools.ts` + the deliverable classification in
 * `api/src/application/delivery/deliverableEvidence.ts`.
 *
 * No `node:*` imports, no DOM.
 */

// ── Honesty: a claimed check that could not have run ─────────────────────────

/**
 * True when a finish SUMMARY claims a build / type-check / lint / test passed — which a
 * shell-less executor cannot have run. The honesty gate blocks a fabricated "checks pass"
 * claim once and forces an honest summary. Deliberately narrow (a check noun AND a success
 * verb) to avoid false positives on legitimate descriptions of the work. The cloud's own
 * matcher (`cloudAgentTools.assertsUnrunVerification`), now the agent's.
 */
export function assertsUnrunVerification(summary: string): boolean {
  const s = summary.toLowerCase();
  const check = /(type[\s-]?check|typecheck|typescript|\btsc\b|lint|eslint|\btest(s|ing|ed)?\b|\bbuild(s|ing)?\b|compil)/;
  const pass = /(pass(es|ed|ing)?|succeed(s|ed)?|success|green|no\s+errors?|error[\s-]?free|will\s+now\s+pass|are\s+resolved|is\s+resolved)/;
  return check.test(s) && pass.test(s);
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
