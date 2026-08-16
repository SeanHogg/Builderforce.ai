/**
 * THE SANDBOX SEVERITY TABLE — one function, one place a caller reads what a
 * sandbox run's STATE means as a `StageCheck`.
 *
 * ── WHY THIS IS ITS OWN MODULE ────────────────────────────────────────────────
 * `stageChecks.ts` is deliberately pure (no database, no clock). A sandbox run's
 * STATE lives in `stage_sandbox_runs`, so something outside the pure module has
 * to translate "queued" / "passed" / "capped" into the same `StageCheck` shape
 * every other finding uses — and it has to do it in exactly one place, because a
 * second translation is how the Stage panel and the publish gate come to
 * disagree about what a `capped` run means.
 *
 * ── WHY THERE IS NO `mode: 'panel' | 'gate'` PARAMETER ────────────────────────
 * The distinction between "still verifying" and "verified" is carried by the
 * STATE itself, not by who is asking. Stage press writes `queued`; publish reads
 * back whatever is actually there. Two verdicts for one input is the exact
 * defect `runStageChecks`'s own header rules out.
 */

import { STAGE_SANDBOX_LIMIT_CODE, type ListingHarness, type StageCheck } from '@builderforce/creation-canvas-contract';

export type StageSandboxStatus =
  | 'not_applicable'
  | 'missing'
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'capped';

export interface StageSandboxState {
  status: StageSandboxStatus;
  runId: string | null;
  /** The container's own findings — only populated for `passed`/`failed`. */
  findings: readonly StageCheck[];
  summary: string | null;
  errorMessage: string | null;
  /** When a same-`snapshot_id`, different-hash run exists — lets `missing` say
   *  "edited since" rather than just "never checked". Never affects severity. */
  lastVerifiedAt: string | null;
}

function check(code: string, severity: StageCheck['severity'], label: string, detail?: string): StageCheck {
  return detail ? { code, group: 'runs', severity, label, detail } : { code, group: 'runs', severity, label };
}

/** Reworded per harness — see `isSandboxApplicable`. The CODE is unchanged
 *  because it already rides `declared` on published listings; only the sentence
 *  a seller and a buyer read has to stop claiming a limit that no longer exists
 *  for `runtime`/`media`. */
function notApplicableCheck(harness: ListingHarness): StageCheck {
  const detail: Partial<Record<ListingHarness, string>> = {
    paged: 'Read, reflowed and proofed from the exact copy a buyer receives. There is nothing here to boot: a document\'s behaviour IS its content.',
    geometry: 'Measured from the model a buyer receives. What remains untested is the buyer\'s own printer and material, which no sandbox on this platform can stand in for.',
    instrument: 'Every question, branch and scoring rule checked against the copy a buyer receives. What it cannot know is how your respondents answer.',
    system: 'Where the automation is a real workflow graph, it is dry-run with every outbound step captured rather than fired, so nothing left this workspace. What it cannot prove is that the buyer\'s own connected accounts behave the same way.',
    deployment: 'The live address was asked whether it is serving. Nothing here installed the product into a clean workspace and drove it, so behaviour that only appears in use is not covered.',
  };
  return check(
    STAGE_SANDBOX_LIMIT_CODE, 'warn', 'Checked without being run in a sandbox',
    detail[harness] ?? 'Every finding above is read from the exact copy a buyer receives.',
  );
}

/**
 * Translate a sandbox run's state into the `StageCheck[]` that fold into
 * `runStageChecks`'s output. `harness` decides whether a sandbox applies at
 * all; `state` is null exactly when it does not (caller never dispatched one).
 */
export function sandboxChecks(harness: ListingHarness, state: StageSandboxState | null): StageCheck[] {
  if (!state || state.status === 'not_applicable') return [notApplicableCheck(harness)];

  switch (state.status) {
    case 'missing':
      return [check(
        'sandbox.missing', 'block', 'Not yet verified in a sandbox',
        state.lastVerifiedAt
          ? `This build was edited since it was last verified (${state.lastVerifiedAt}). Press Stage and wait for the sandbox to finish before publishing.`
          : 'Press Stage and wait for the sandbox to finish before publishing — nothing has installed this build into a throwaway workspace and driven it yet.',
      )];
    case 'queued':
    case 'running':
      return [check(
        'sandbox.pending', 'block', 'Sandbox still verifying',
        'A disposable workspace is booting this build now. This usually takes under a minute — check back shortly.',
      )];
    case 'passed':
      return [
        check('sandbox.verified', 'pass', state.summary ?? 'Verified in a sandbox'),
        ...state.findings,
      ];
    case 'failed':
      // The container's own findings carry their own codes/severities — a real
      // finding from a real run, not a second opinion layered on top of it.
      return state.findings.length
        ? [...state.findings]
        : [check('sandbox.failed', 'block', state.summary ?? 'The sandbox found a defect', state.errorMessage ?? undefined)];
    case 'error':
      // Fails OPEN — an infrastructure failure (unbound container, timeout,
      // crash) is not the seller's product failing. Matches
      // `enforceMonthlyTenantCap`'s "metering must never block the operation
      // it measures", applied to the runner rather than to a cap.
      return [check(
        'sandbox.unavailable', 'warn', 'The sandbox could not finish',
        state.errorMessage ?? 'The runner did not report back in time. This does not reflect on the build — try Stage again.',
      )];
    case 'capped':
      // Fails OPEN by design (locked decision) — a metering ceiling stays a
      // metering concern, not a new revenue gate on the seller's own product.
      return [check(
        'sandbox.capped', 'warn', 'Monthly sandbox quota reached',
        'This build has not been run in a sandbox because this month\'s allowance is used up. Upgrade or wait for it to reset — this does not block publishing.',
      )];
    default:
      return [];
  }
}
