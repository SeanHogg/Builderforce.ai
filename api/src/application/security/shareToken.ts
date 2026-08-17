/**
 * The share-token primitive — mint a credential for someone with no session.
 *
 * The same three steps were hand-written twice, byte for byte: mint a random
 * token with `crypto.randomUUID().replace(/-/g, '')`, hash it with `sha256Hex`,
 * store only the hash (`signatureParties.tokenHash` in `signatureEngine.ts`,
 * `formRecipients.tokenHash` in `formPublishing.ts`). Both are security
 * boundaries — the stored hash is what makes a leaked database row unable to
 * mint a working link — and a third hand-rolled copy for legal-document sharing
 * would be the fourth `sha256Hex` re-implementation `domain/shared/hash.ts`
 * already exists to prevent, one level up.
 *
 * The plaintext token is returned ONLY by {@link mintShareToken}, exactly once,
 * for the caller to hand to its recipient — nothing can read it back afterward,
 * by construction: only the hash is ever stored.
 */

import { sha256Hex } from '../../domain/shared/hash';

export interface MintedShareToken {
  /** The plaintext credential. Exists only in memory for this one response. */
  token: string;
  /** What actually gets stored, in a `token_hash` column. */
  tokenHash: string;
}

/** Mint a new random token and its hash. Store `tokenHash`; hand `token` to the
 *  recipient exactly once — it cannot be recovered from the stored hash. */
export async function mintShareToken(): Promise<MintedShareToken> {
  const token = crypto.randomUUID().replace(/-/g, '');
  return { token, tokenHash: await sha256Hex(token) };
}

/** Hash a PRESENTED token the same way, for the `eq(table.tokenHash, ...)` half
 *  of an `acrossTenants(table, 'share_token', ...)` lookup. Trims first so a
 *  token copy-pasted with surrounding whitespace still resolves. */
export async function hashShareToken(token: string): Promise<string> {
  return sha256Hex(token.trim());
}
