/**
 * The model's trailing `| tail -N`: the REAL command runs without it, and the caller reads the
 * retained output's head + tail instead (chat #60338: `pnpm install 2>&1 | tail -20` hid the
 * error at the TOP of a long install log, and wasted a step re-running it to see the head).
 *
 * Conservative on purpose, and deliberately narrower than {@link withPipefail}'s exclusions —
 * this one REWRITES the command:
 *   - only `| tail -N` is stripped. A trailing `| head -N` is a real limit (`yes | head`,
 *     `git log | head -20`): it cuts the work, so it runs as written.
 *   - only when the tail is the FINAL stage of the command's LAST pipeline, so every earlier
 *     stage ran to completion under pipefail and its exit code is the true one. A tail feeding
 *     a later stage (`git log | tail -20 | wc -l`) is untouched.
 *   - a `2>&1` merge right before the pipe rides along (its redirect survives on the producer).
 *
 * Pure (no `node:*`): the Worker imports the package root.
 */

/** A trailing `| tail -N` (optionally preceded by `2>&1`), at the end of the last pipeline. */
const TRAILING_TAIL = /\s*\|\s*(?:2>&1\s*\|\s*)?tail\s+(?:-\s*(?:n\s+)?)?(\d+)\s*$/;

export interface TailStripped {
  /** The command without its trailing tail — what actually runs. */
  command: string;
  /** The N the model asked for, when a strip happened (else undefined). */
  tail?: number;
  stripped: boolean;
}

/**
 * `command` with its trailing `| tail -N` removed. `stripped` false ⇒ `command` returned
 * unchanged (no trailing tail, or one that feeds a later stage).
 */
export function stripTailLimit(command: string): TailStripped {
  const m = TRAILING_TAIL.exec(command);
  if (!m) return { command, stripped: false };
  const n = Number.parseInt(m[1] ?? "", 10);
  return { command: command.slice(0, m.index).trimEnd(), tail: Number.isFinite(n) ? n : undefined, stripped: true };
}
