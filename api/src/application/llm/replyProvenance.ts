/**
 * Per-reply account provenance — the server side of the "which account served this
 * turn" signal that surfaces as a chip under an assistant message in the Brain UI.
 *
 * A SUCCESSFUL turn used to reveal nothing about how it was served, so "why didn't
 * it use my paid Claude?" was invisible unless the turn came back empty. This maps
 * the two facts the gateway already knows — did the tenant's OWN credential serve
 * the call (`ProxyResult.byoFunded`), and does the tenant have a connected account
 * at all — to a single tri-state the client renders verbatim.
 *
 * The string values are the WIRE CONTRACT with brain-embedded's
 * `MessageProvenance.account`; they must stay identical. Two writers consume this:
 * the streaming gateway route (emits it as the `x-builderforce-account` header) and
 * `BrainService.agentReply` (persists it on the assistant message metadata).
 */

/** Which account served a completed turn — see brain-embedded `ProvenanceAccount`. */
export type ReplyAccount = 'own' | 'shared' | 'shared_byo_unused';

/**
 * Classify a served turn:
 * - `byoFunded` true                       → `own` (the tenant's connected account paid).
 * - shared pool AND a connected account exists → `shared_byo_unused` (flag it: they
 *   have a paid account but this turn didn't use it — the exact confusion to surface).
 * - shared pool AND no connected account    → `shared` (nothing else was possible).
 */
export function classifyReplyAccount(byoFunded: boolean, hasConnectedAccount: boolean): ReplyAccount {
  if (byoFunded) return 'own';
  return hasConnectedAccount ? 'shared_byo_unused' : 'shared';
}

/** Provenance persisted on an assistant message (JSON under the `provenance` key). */
export interface ReplyProvenance {
  model: string;
  account: ReplyAccount;
  vendor?: string;
}

/** Build the provenance object attached to a persisted assistant turn. */
export function buildReplyProvenance(args: {
  model: string;
  vendor?: string;
  byoFunded: boolean;
  hasConnectedAccount: boolean;
}): ReplyProvenance {
  return {
    model: args.model,
    account: classifyReplyAccount(args.byoFunded, args.hasConnectedAccount),
    ...(args.vendor ? { vendor: args.vendor } : {}),
  };
}
