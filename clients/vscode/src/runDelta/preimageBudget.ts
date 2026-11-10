/**
 * The pre-image caps of a run's baseline (PRD 41 §C1.3): at most {@link PREIMAGE_MAX_FILE_BYTES} per file and
 * {@link PREIMAGE_MAX_RUN_BYTES} per run, across every repository the baseline covers. A file over either cap is recorded as
 * `preimage-too-large` and its before side is `not_comparable` unless git still holds it.
 *
 * Allocation is in the baseline's own order (repositories, then their sorted changes), decided from sizes alone BEFORE any
 * read, so the same dirty tree always captures the same files.
 */

export const PREIMAGE_MAX_FILE_BYTES = 1024 * 1024;
export const PREIMAGE_MAX_RUN_BYTES = 50 * 1024 * 1024;

export type PreimageDecision = "capture" | "too-large" | "absent";

/** The run's remaining pre-image bytes, shared by every repository of one baseline. */
export class PreimageBudget {
  private left: number;

  constructor(runBytes: number = PREIMAGE_MAX_RUN_BYTES, private readonly fileBytes: number = PREIMAGE_MAX_FILE_BYTES) {
    this.left = runBytes;
  }

  /** One file, in order: `absent` when it does not exist (nothing to keep), else whether its bytes fit. */
  decide(size: number | undefined): PreimageDecision {
    if (size === undefined) return "absent";
    if (size > this.fileBytes || size > this.left) return "too-large";
    this.left -= size;
    return "capture";
  }
}
