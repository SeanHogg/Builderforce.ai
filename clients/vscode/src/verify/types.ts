/**
 * The host port every deterministic run gate reads: WHICH checks ran for a set of
 * files, WHAT each returned, and WHEN (PRD 45 §4.4). Evidence is a host fact, keyed
 * by file content — never parsed from the model's own shell output.
 *
 * CheckKind / CheckRecord are re-exported from `@builderforce/run-guards` (§4.2
 * evidence ledger, A1) — this file re-exports them so the VSIX verifier builds
 * against the one canonical contract instead of a mirror.
 */
import type { CheckRecord } from "@builderforce/run-guards";
export type { CheckKind, CheckRecord } from "@builderforce/run-guards";

/** The verifier port the VSIX binds (PRD 45 §4.4). */
export interface VerifierPort {
  /** Fast tier, ≤ 3 s: language-server diagnostics for exactly these files. */
  diagnostics(paths: readonly string[]): Promise<CheckRecord | null>; // null = unavailable here
  /** Full tier: the owning package's scripts + targeted tests + the repo guards. */
  full(paths: readonly string[]): Promise<readonly CheckRecord[]>;
}
