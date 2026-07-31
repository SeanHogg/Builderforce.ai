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

/**
 * How a connected account is NAMED to its owner — `anthropic` → "Claude".
 *
 * One map, because the empty-reply diagnostic had two: one for the account that SERVED
 * the turn and a separate inline ternary for the account that FAILED, covering different
 * vendors. So the same sentence could call one connected account "Claude" and another
 * "provider", and every BYO vendor added since (Meta, Moonshot, Qwen, MiniMax, xAI) fell
 * through to the generic word in one branch and to the raw id in the other.
 *
 * Falls back to the gateway vendor id rather than "provider": a user reading "your
 * connected meta account" can act on it; "your connected provider account" — the literal
 * text of a shipped support ticket — tells them nothing about which one to check.
 * `''` (nothing resolved) is the only case that stays generic.
 */
export function vendorAccountLabel(vendor: string | null | undefined): string {
  const v = (vendor ?? '').trim();
  if (!v) return 'provider';
  const labels: Record<string, string> = {
    anthropic: 'Claude',
    openai: 'OpenAI',
    'openai-codex': 'OpenAI',
    googleai: 'Google',
    google: 'Google',
    xai: 'xAI',
    'xai-oauth': 'xAI',
    meta: 'Meta',
    moonshot: 'Moonshot',
    'kimi-code': 'Kimi Code',
    qwen: 'Qwen',
    minimax: 'MiniMax',
    openrouter: 'OpenRouter',
  };
  return labels[v] ?? v;
}

/** Provenance persisted on an assistant message (JSON under the `provenance` key). */
export interface ReplyProvenance {
  model: string;
  account: ReplyAccount;
  vendor?: string;
  /** Set when the project's own Evermind generated the reply's final prose (opt-in
   *  inference). Mirrors brain-embedded `MessageProvenance.evermind` — drives the
   *  "🧠 Evermind vN" chip. Absent for frontier/pool-served turns. */
  evermind?: { version: number };
}

/** Build the provenance object attached to a persisted assistant turn. */
export function buildReplyProvenance(args: {
  model: string;
  vendor?: string;
  byoFunded: boolean;
  hasConnectedAccount: boolean;
  evermind?: { version: number };
}): ReplyProvenance {
  return {
    model: args.model,
    account: classifyReplyAccount(args.byoFunded, args.hasConnectedAccount),
    ...(args.vendor ? { vendor: args.vendor } : {}),
    ...(args.evermind ? { evermind: args.evermind } : {}),
  };
}
