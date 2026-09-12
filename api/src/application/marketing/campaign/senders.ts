/**
 * Verified sender identities — the DNS-proven From addresses a platform-email
 * campaign may send as. Split out of `../campaignEngine.ts`, which re-exports it.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import { marketingSenderIdentities } from '../../../infrastructure/database/schema';
import { excluded } from '../../../infrastructure/database/upsert';
import {
  emailDomain,
  isSendableEmail,
  newChallengeToken,
  normalizeEmail,
  verifyChallengeToken,
  type DnsLookupDeps,
} from '../../shared/dnsVerification';

// ---------------------------------------------------------------------------
// Sender identities
// ---------------------------------------------------------------------------

export interface SenderView {
  id: number;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  status: string;
  verifyToken: string;
  verifiedAt: Date | null;
  lastError: string | null;
  /** The exact TXT record to publish — computed, never stored twice. */
  recordName: string;
}

function senderView(row: {
  id: number; fromEmail: string; fromName: string; replyTo: string | null;
  status: string; verifyToken: string; verifiedAt: Date | null; lastError: string | null;
}): SenderView {
  const domain = emailDomain(row.fromEmail) ?? row.fromEmail;
  return { ...row, recordName: `_builderforce-sender.${domain}` };
}

const SENDER_COLUMNS = {
  id: marketingSenderIdentities.id,
  fromEmail: marketingSenderIdentities.fromEmail,
  fromName: marketingSenderIdentities.fromName,
  replyTo: marketingSenderIdentities.replyTo,
  status: marketingSenderIdentities.status,
  verifyToken: marketingSenderIdentities.verifyToken,
  verifiedAt: marketingSenderIdentities.verifiedAt,
  lastError: marketingSenderIdentities.lastError,
} as const;

export async function listSenders(db: Db, tenantId: number): Promise<SenderView[]> {
  const rows = await db
    .select(SENDER_COLUMNS)
    .from(marketingSenderIdentities)
    .where(eq(marketingSenderIdentities.tenantId, tenantId))
    .orderBy(asc(marketingSenderIdentities.id));
  return rows.map(senderView);
}

export type SenderResult =
  | { ok: true; sender: SenderView }
  | { ok: false; status: 400 | 404; error: string };

export async function createSender(
  db: Db,
  tenantId: number,
  input: { fromEmail: string; fromName?: string; replyTo?: string },
): Promise<SenderResult> {
  if (!isSendableEmail(input.fromEmail)) {
    return { ok: false, status: 400, error: 'Enter a valid From address.' };
  }
  const fromEmail = normalizeEmail(input.fromEmail);
  const [row] = await db
    .insert(marketingSenderIdentities)
    .values({
      tenantId,
      fromEmail,
      fromName: (input.fromName ?? '').slice(0, 255),
      replyTo: input.replyTo && isSendableEmail(input.replyTo) ? normalizeEmail(input.replyTo) : null,
      verifyToken: newChallengeToken(),
      status: 'pending',
    })
    .onConflictDoUpdate({
      target: [marketingSenderIdentities.tenantId, marketingSenderIdentities.fromEmail],
      set: { fromName: excluded(marketingSenderIdentities.fromName), replyTo: excluded(marketingSenderIdentities.replyTo), updatedAt: sql`NOW()` },
    })
    .returning(SENDER_COLUMNS);
  return { ok: true, sender: senderView(row!) };
}

/**
 * Resolve the sender's DNS proof and flip it to `verified` when it holds.
 * The proof lives on the address's DOMAIN, so verifying `hi@acme.com` also
 * establishes control of `sales@acme.com` — each address still gets its own row
 * and its own explicit verification, which is the auditable behaviour.
 */
export async function verifySender(
  db: Db,
  tenantId: number,
  senderId: number,
  deps: DnsLookupDeps = {},
): Promise<SenderResult> {
  const [row] = await db
    .select(SENDER_COLUMNS)
    .from(marketingSenderIdentities)
    .where(and(eq(marketingSenderIdentities.id, senderId), eq(marketingSenderIdentities.tenantId, tenantId)))
    .limit(1);
  if (!row) return { ok: false, status: 404, error: 'Sender not found.' };

  const domain = emailDomain(row.fromEmail);
  if (!domain) return { ok: false, status: 400, error: 'That From address has no resolvable domain.' };

  const proof = await verifyChallengeToken('sender', domain, row.verifyToken, deps);
  const [updated] = await db
    .update(marketingSenderIdentities)
    .set(
      proof.verified
        ? { status: 'verified', verifiedAt: sql`NOW()`, lastError: null, updatedAt: sql`NOW()` }
        : {
            status: 'pending',
            lastError: proof.found.length
              ? `Found TXT records at ${proof.recordName}, none matching the token.`
              : `No TXT record at ${proof.recordName} yet.`,
            updatedAt: sql`NOW()`,
          },
    )
    .where(and(eq(marketingSenderIdentities.id, senderId), eq(marketingSenderIdentities.tenantId, tenantId)))
    .returning(SENDER_COLUMNS);
  return { ok: true, sender: senderView(updated!) };
}
