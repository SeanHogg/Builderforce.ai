/**
 * Per-reply model/account provenance — the durable "which LLM, and whose account,
 * produced this turn" signal shown as a small chip under an assistant message.
 *
 * Motivation: a SUCCESSFUL Brain turn used to reveal nothing about how it was
 * served, so "why didn't it use my paid Claude?" was invisible until a turn came
 * back empty (the only case the diagnostic note fired). This attaches the resolved
 * model + whether the tenant's OWN connected frontier account served it — or the
 * shared pool did despite a connected account existing — to every assistant turn,
 * so the confirmation is always on screen.
 *
 * Single source of truth for the convention, shared by the writers (server-side
 * `agentReply` metadata + the streaming gateway's `x-builderforce-account` header,
 * captured client-side and persisted) and the renderer (the BrainTimeline chip).
 * The `account` string values are the wire contract with the server — the api's
 * `classifyReplyAccount()` MUST emit these exact literals.
 */

/** The metadata key under which a message's provenance rides. */
export const PROVENANCE_META_KEY = 'provenance';

/**
 * Which account served a completed turn:
 * - `own`               — the tenant's OWN connected frontier account (a Claude
 *                         subscription or a BYO vendor key) served it; the platform
 *                         paid nothing and the user is on the model they connected.
 * - `shared`            — the shared model pool served it AND the tenant has no
 *                         connected account (nothing else was possible).
 * - `shared_byo_unused` — the shared pool served it EVEN THOUGH the tenant has a
 *                         connected account — the case worth flagging inline
 *                         ("your connected account wasn't used for this turn").
 */
export type ProvenanceAccount = 'own' | 'shared' | 'shared_byo_unused';

/** Durable provenance for one assistant turn. */
export interface MessageProvenance {
  /** The model the gateway ACTUALLY used (resolved, post-failover). */
  model: string;
  /** Which account served it — see {@link ProvenanceAccount}. */
  account: ProvenanceAccount;
  /** Vendor that owns `model` (e.g. `anthropic`), when known — names the account
   *  in tooltips ("your connected Claude account"). */
  vendor?: string;
}

/** True when a turn ran on the shared pool despite a connected account existing —
 *  the only state the chip flags inline. Shared by the chip and any host that
 *  wants to nudge the user to check their connection. */
export function isConnectedAccountUnused(prov: MessageProvenance | null | undefined): boolean {
  return prov?.account === 'shared_byo_unused';
}

/** Parse a message's persisted provenance, or `null` when it carries none (older
 *  turns, or turns whose gateway didn't report an account). Defensive: a malformed
 *  or partial blob yields `null` rather than throwing. */
export function parseMessageProvenance(msg: { metadata?: string | null }): MessageProvenance | null {
  if (!msg.metadata) return null;
  try {
    const p = (JSON.parse(msg.metadata) as { provenance?: Partial<MessageProvenance> }).provenance;
    if (
      p &&
      typeof p.model === 'string' &&
      p.model.length > 0 &&
      (p.account === 'own' || p.account === 'shared' || p.account === 'shared_byo_unused')
    ) {
      return { model: p.model, account: p.account, ...(typeof p.vendor === 'string' ? { vendor: p.vendor } : {}) };
    }
  } catch {
    /* not a provenance-bearing message */
  }
  return null;
}

/**
 * Merge a provenance object into a message's metadata (preserving any other keys,
 * e.g. `authoredBy` on an agent's reply). Returns a serialized string, or
 * `undefined` when there is nothing to store — ready to hand to
 * `persistence.sendMessages`. Mirrors `withDirectedMetadata`.
 */
export function withProvenanceMetadata(
  provenance: MessageProvenance | null | undefined,
  base?: Record<string, unknown>,
): string | undefined {
  const meta: Record<string, unknown> = { ...(base ?? {}) };
  if (provenance) meta[PROVENANCE_META_KEY] = provenance;
  return Object.keys(meta).length > 0 ? JSON.stringify(meta) : undefined;
}
