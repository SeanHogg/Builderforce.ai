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
 * ── ORDER OF OPERATIONS ──────────────────────────────────────────────────────
 * Expire first, then chase. A request whose date passed overnight must not be
 * reminded about on the same tick — chasing somebody for a document they can no
 * longer sign is worse than silence.
 *
 * `markReminded` is called AFTER delivery, so a transport failure means the
 * request is tried again next tick rather than being silently skipped for a cycle.
 */

import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import { sendRawEmail } from '../../infrastructure/email/EmailService';
import { expireSignatureRequests, markReminded, signatureRemindersDue } from './signatureEngine';

export interface SignatureSweepResult {
  expired: number;
  reminded: number;
  failed: number;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export async function runSignatureReminderSweep(env: Env, now = new Date()): Promise<SignatureSweepResult> {
  const db = buildDatabase(env);
  const expired = await expireSignatureRequests(db, now);
  const due = await signatureRemindersDue(db, now);
  const base = resolveAppBaseUrl(env);

  let reminded = 0;
  let failed = 0;

  for (const request of due) {
    const verb = request.intent === 'acknowledge' ? 'acknowledge' : 'sign';
    let sentAny = false;
    for (const party of request.pending) {
      // The signer's own address is NOT reconstructible from here: only the hash
      // of their token is stored, deliberately. So the reminder links to the
      // request's landing page, which asks for the link they were sent — the
      // alternative is storing a credential in plaintext so a reminder can quote
      // it, which is the trade nobody should make.
      const html = [
        `<div style="max-width:560px;margin:0 auto;padding:24px;font:400 15px/1.6 system-ui,sans-serif;color:#111">`,
        `<p>${escapeHtml(party.name)},</p>`,
        `<p>You have not yet ${verb}d <strong>${escapeHtml(request.documentTitle)}</strong>.</p>`,
        `<p>Open the link you were sent to ${verb} it, or reply to this message if you no longer have it.</p>`,
        `<p style="color:#666;font-size:13px">${escapeHtml(request.subject)} — <a href="${base}/sign">${base}/sign</a></p>`,
        `</div>`,
      ].join('');
      try {
        await sendRawEmail(env, {
          to: party.email,
          subject: `Reminder: ${request.documentTitle}`,
          html,
        });
        sentAny = true;
        reminded += 1;
      } catch {
        // Counted, not thrown: one unreachable address must not stop the rest of
        // the batch, and the request stays unmarked so the next tick retries it.
        failed += 1;
      }
    }
    if (sentAny) await markReminded(db, request.tenantId, request.requestId, now);
  }

  return { expired, reminded, failed };
}
