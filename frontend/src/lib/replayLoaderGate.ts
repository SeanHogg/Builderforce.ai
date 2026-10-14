/**
 * May builderforce.ai's own recorder run for this visitor? (PRD 33 D7, D9.)
 *
 * Pure, so every rule is a test rather than a reading of a component:
 *   - no site key configured                → never (nothing is rendered)
 *   - no analytics consent                  → not yet
 *   - session not read off the device yet   → not yet (a signed-in member must
 *                                             never be recorded as "anonymous")
 *   - signed out                            → yes
 *   - signed in                             → only when the platform setting
 *     `replay.recordSignedIn` is on AND the workspace is known NOT to be
 *     excluded (`tenants.settings.replayExcluded === false`; unknown = excluded)
 */
export interface ReplayLoaderGateInput {
  siteKey: string | null | undefined;
  consent: boolean;
  authReady: boolean;
  signedIn: boolean;
  recordSignedIn: boolean;
  /** null = the workspace's setting is not known on this client. */
  workspaceExcluded: boolean | null;
}

export function replayLoaderMayRecord(input: ReplayLoaderGateInput): boolean {
  if (!input.siteKey || !input.consent || !input.authReady) return false;
  if (!input.signedIn) return true;
  return input.recordSignedIn && input.workspaceExcluded === false;
}

/**
 * `replay.recordSignedIn` (D9): a deploy-time switch, `NEXT_PUBLIC_REPLAY_RECORD_SIGNED_IN`.
 * Off unless it is exactly `"true"`. The operator turns it on only after publishing
 * the legal disclosure (Admin ▸ Compliance ▸ Legal holds the draft); until then
 * signed-in members are never recorded.
 */
export const REPLAY_RECORD_SIGNED_IN = process.env.NEXT_PUBLIC_REPLAY_RECORD_SIGNED_IN === 'true';
