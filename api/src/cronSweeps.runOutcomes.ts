/**
 * The run-outcomes sweeps of CRON_SWEEPS (PRD 41 §D1, WS16) — one concern, declared here.
 *
 * Spread into `CRON_SWEEPS` (cronSweeps.ts), which stays the one registry both the
 * `scheduled()` handler and the superadmin force-run read. Position means nothing —
 * sweeps run concurrently; see the ORDER note in cronSweeps.ts.
 */
import type { CronSweepDef } from './application/runtime/cronSweepRunner';
import { runRunOutcomeLabelSweep } from './application/runOutcomes/runOutcomeLabelSweep';

export const RUN_OUTCOME_SWEEPS: readonly CronSweepDef[] = [
  {
    key: 'run-outcome-labels',
    cadence: 'daily',
    description: 'PRD 41 §D1: finalize censored run-outcome labels whose window ended, and label recent runs ci-red-after-merge / review-rejected from their pull requests.',
    run: async ({ db }) => {
      const r = await runRunOutcomeLabelSweep(db);
      return r.finalized > 0 || r.labelled > 0 ? `finalized=${r.finalized} tenants=${r.tenants} runs=${r.runs} labelled=${r.labelled}` : null;
    },
  },
];
