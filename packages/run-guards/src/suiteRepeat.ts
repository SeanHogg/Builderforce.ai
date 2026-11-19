/**
 * The REPEATED FULL SUITE: a run that re-runs a whole-suite command it already ran (`fullSuiteKey`) to confirm a fix —
 * VS Code chat #275 ran `pnpm run check` twice (3m24s, 4m58s) when four guards had failed. It is `reverifying`'s
 * suite-scale twin (`reverifyTracker.ts`, whose bounded sets it shares), and earns ONE advisory per suite: re-run only
 * the checks that failed. Advisory only — never a trip, never a block.
 *
 * The note is marked shown only when the detector actually returns it ({@link SuiteRepeat.take}): a turn that ends in
 * a trip or another advisory keeps it pending for the next signal-free turn.
 *
 * Pure; the state is plain JSON and bounded.
 */

import { fullSuiteKey } from "./checkCommand.js";
import { addBounded, restoreBounded } from "./reverifyTracker.js";

export interface SuiteRepeatState {
  /** Full-suite commands this run has run (bounded). */
  run?: string[];
  /** Suites whose repeat advisory was shown (once per suite). */
  shown?: string[];
  /** A repeated suite whose advisory is still owed. */
  pending?: string;
}

/** The advisory for a repeated full suite. */
export function targetedReverifyNote(command: string): string {
  return (
    `You have now run the full suite \`${command}\` more than once. Do not re-run the whole suite to confirm a fix: ` +
    "re-run ONLY the checks that failed (the specific guard script, test file or package typecheck), and leave the full sweep to CI."
  );
}

export class SuiteRepeat {
  private readonly run: Set<string>;
  private readonly shownSuites: Set<string>;
  private pending: string | undefined;

  constructor(state: SuiteRepeatState = {}) {
    this.run = restoreBounded(state.run);
    this.shownSuites = restoreBounded(state.shown);
    this.pending = state.pending;
  }

  /** A shell command ran. */
  ranCommand(command: string): void {
    const key = fullSuiteKey(command);
    if (!key) return;
    if (this.run.has(key) && !this.shownSuites.has(key)) this.pending ??= key;
    addBounded(this.run, key);
  }

  /**
   * The owed advisory ("" when none), marked shown — never again for that suite. The detector calls this only where
   * the note becomes the turn's returned action; a turn that ends in a trip or another advisory leaves it owed.
   */
  take(): string {
    const key = this.pending;
    if (!key) return "";
    addBounded(this.shownSuites, key);
    this.pending = undefined;
    return targetedReverifyNote(key);
  }

  snapshot(): SuiteRepeatState {
    return {
      ...(this.run.size ? { run: [...this.run] } : {}),
      ...(this.shownSuites.size ? { shown: [...this.shownSuites] } : {}),
      ...(this.pending ? { pending: this.pending } : {}),
    };
  }

  /** The detector's snapshot field: `{ suites }`, or nothing when empty. */
  snapshotField(): { suites?: SuiteRepeatState } {
    const s = this.snapshot();
    return Object.keys(s).length > 0 ? { suites: s } : {};
  }
}
