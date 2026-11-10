/**
 * Every threshold the run-findings detectors use, as data (PRD 46 §3.1). A detector reads its numbers here and
 * nowhere else, so tuning one is a one-line change that every surface sees.
 */
import { NARRATION_OVERLAP } from '@seanhogg/builderforce-memory/working';

export const RUN_FINDING_POLICY = Object.freeze({
  /** Read-only turns before the first write that make an analysis overrun. */
  analysisReadTurns: 8,
  /** Read-only turns after a readiness claim that leave it unkept. */
  unkeptReadTurns: 2,
  /** Turns that each made exactly one write, at which the run is writing serially. */
  serialSingleWriteTurns: 4,
  /** Prompt : completion ratio and prompt total at which the run's prompt is bloated. */
  promptBloatRatio: 50,
  promptBloatMinTokens: 500_000,
  /** Writes of one path that make churn. */
  editChurnWrites: 4,
  /** Argument bytes of one non-write call that are oversized. */
  oversizedArgBytes: 4 * 1024,
  /** Identical text (bytes) two calls of one tool must share to count as a copied block. */
  sharedArgBytes: 1024,
  /** A turn this slow (ms) is slow. */
  slowTurnMs: 60_000,
  /** Word-set overlap at which a pre-call text repeats the last kept one: memory's B7 fold threshold, so the
   *  diagnostic and the fold agree (`NARRATION_OVERLAP`, `@seanhogg/builderforce-memory/working`). */
  narrationOverlap: NARRATION_OVERLAP,
  /** Longest excerpt an evidence row quotes. */
  excerptChars: 160,
});

/** Tools that CHECK the workspace: language-server diagnostics, typecheck, tests, lint, the verifier. */
export const CHECK_TOOL = /diagnostic|typecheck|type[_-]check|(^|[_.-])tests?($|[_.-])|lint|(^|[_.-])verify($|[_.-])/i;

/** A shell command that checks the workspace: a compiler, a test runner, a linter or a package check script. */
export const CHECK_COMMAND =
  /\b(?:tsc|tsgo|vitest|jest|mocha|playwright|eslint|biome|oxlint|pytest|cargo\s+(?:check|test|clippy)|go\s+(?:test|vet))\b|\b(?:npm|pnpm|yarn|bun|npx)\b[^|;&\n]*?\b(?:test|lint|check|typecheck|type-check)\b/i;

/** The shell tools whose `command` is read for {@link CHECK_COMMAND}. */
export const SHELL_TOOLS: ReadonlySet<string> = new Set(['run_command', 'shell', 'bash', 'exec']);
