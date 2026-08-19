/**
 * The reminder job — the second of the three call sites `isTerminalPartyStatus`
 * was written for, and the one that could not exist until now.
 *
 * ── WHY A SWEEP AND NOT A NUDGE FROM THE UI ──────────────────────────────────
 * Because the whole problem with an unsigned document is that nobody is looking
 * at it. A "remind" button is a control that works exactly when it is not needed;
 * the case it must cover is the request that has been quiet for four days on a
 * board nobody has opened. That is a scheduled read or it is nothing.
 *
 * ── WHY THE PLATFORM TRANSPORT AND NOT `campaignTransports` ──────────────────
 * A signature reminder is TRANSACTIONAL: it goes to one named person who is
 * already party to a document, it must not be suppressed by a marketing
 * unsubscribe, and it carries no unsubscribe of its own because declining is
 * done on the document. `campaignTransports` exists for the opposite case — bulk
 * mail to an audience, from the tenant's own identity, honouring suppression —
 * and routing a countersignature request through it would let a marketing opt-out
 * silently stop a contract. The investor update goes the other way, through
 * `campaignTransports`, for exactly the mirror-image reason.
 *
 * ── THE LINK IS THE SIGNER'S OWN, NOW ────────────────────────────────────────
 * This job used to point every party at `/sign` — the landing page — and ask them
 * to use the link they were sent, because only the HASH of their token is stored.
 * Telling somebody who has already ignored one email to go and find it is not a
 * reminder. The fix is a short-lived RE-ISSUE: `reissuePartyToken` mints a fresh
 * credential on the party row at reminder time and returns the plaintext for the
 * length of this send. Nothing plaintext is ever stored, so the one-way property
 * is unchanged; the previous link stops working, which is the price of a link
 * that opens.
 *
 * ── ORDER OF OPERATIONS ──────────────────────────────────────────────────────
 * Expire first, then chase. A request whose date passed overnight must not be
 * reminded about on the same tick — chasing somebody for a document they can no
 * longer sign is worse than silence.
 *
 * Re-issue, then deliver, then mark. `markReminded` is called AFTER delivery, so
 * a transport failure means the request is tried again next tick rather than
 * being silently skipped for a cycle. A party whose re-issue fails is skipped
 * rather than sent a dead link: the row and the message must agree, and where
 * they cannot, silence is the honest outcome.
 */

import type { Env } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { deliverSignatureReminders } from './signatureInvitations';
import type { ShareInvitation } from '../security/shareInvitationMailer';
import {
  expireSignatureRequests,
  markReminded,
  reissuePartyToken,
  signatureRemindersDue,
} from './signatureEngine';

export interface SignatureSweepResult {
  expired: number;
  reminded: number;
  failed: number;
}

export async function runSignatureReminderSweep(env: Env, now = new Date()): Promise<SignatureSweepResult> {
  const db = buildDatabase(env);
  const expired = await expireSignatureRequests(db, now);
  const due = await signatureRemindersDue(db, now);

  let reminded = 0;
  let failed = 0;

  for (const request of due) {
    const invitations: ShareInvitation[] = [];
    for (const party of request.pending) {
      const token = await reissuePartyToken(db, request.tenantId, party.partyId);
      // Null means the party decided between the read and the write — the right
      // answer is to leave them alone, not to chase a closed decision.
      if (!token) { failed += 1; continue; }
      invitations.push({ email: party.email, name: party.name, token });
    }
    if (!invitations.length) continue;

    const delivery = await deliverSignatureReminders(env, {
      subject: request.subject,
      documentTitle: request.documentTitle,
      intent: request.intent,
    }, invitations);

    reminded += delivery.sent;
    failed += delivery.failed;
    if (delivery.sent > 0) await markReminded(db, request.tenantId, request.requestId, now);
  }

  return { expired, reminded, failed };
}
