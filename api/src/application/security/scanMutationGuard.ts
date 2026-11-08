/**
 * scanMutationGuard - which `vulnerability_scans` rows the generic `/vuln-scans` tracker may change.
 *
 * The merge gate trusts scan rows: a completed, untruncated scan at the PR's head commit is what lets a
 * PR through. The tracker is a plain CRUD surface, so without this a manager could PATCH a skipped or
 * failed scan to `completed`, or DELETE a scan that found something, and the gate would read the lie.
 * Rows the PLATFORM recorded (linked to a PR, keyed to a commit, or triggered by an agent / the system /
 * the Run-scan action) are therefore read-only here: no delete, no `status` change. A row a person typed
 * into the tracker by hand stays fully editable. The sanctioned human override is the audited
 * accept-risk action (`prSecurityOverride`), which leaves the scan itself untouched.
 */
const PLATFORM_TRIGGER = /^(agent:|system|user:)/;

export const isPlatformRecordedScan = (row: Record<string, unknown>): boolean =>
  row.pullRequestId != null || row.headSha != null || PLATFORM_TRIGGER.test(String(row.triggeredBy ?? ''));

/** The `guardMutation` of the `/vuln-scans` tracker: a refusal reason, or null to allow. */
export function guardScanMutation(
  op: 'create' | 'update' | 'delete', row: Record<string, unknown>, patch: Record<string, unknown> | null,
): string | null {
  if (op === 'create' || !isPlatformRecordedScan(row)) return null;
  if (op === 'delete') return 'A scan recorded by the platform cannot be deleted. Accept the risk on the pull request instead.';
  if (patch && 'status' in patch) return 'The status of a scan recorded by the platform cannot be changed by hand.';
  return null;
}
