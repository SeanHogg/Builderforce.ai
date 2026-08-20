/**
 * ONE sender for every "here is your personal link" message.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * Two subsystems mint a share credential per named person and hand the plaintext
 * back to their caller exactly once — `publishForm` (`form_recipients`) and
 * `createSignatureRequest` (`signature_parties`) — and NEITHER had anything
 * behind it. The token was returned in an API response and then it was somebody's
 * job to copy each link into an email by hand. A named-recipient form and a
 * countersignature request were therefore both features that only worked if a
 * person relayed links, which is the definition of a flow that terminates in a
 * document.
 *
 * ── WHY ONE MODULE AND NOT ONE PER SUBSYSTEM ─────────────────────────────────
 * The message is the same message: one named person, one one-time address, one
 * sentence of context, one button. Written twice it becomes two templates that
 * drift, two failure policies, and two answers to "does a bounce stop the batch".
 * So the composition, the escaping, the per-recipient isolation and the counters
 * live here, and a caller supplies only the words and the URL builder.
 *
 * ── WHY THE PLATFORM TRANSPORT AND NOT `campaignTransports` ──────────────────
 * Identical reasoning to `runSignatureReminderSweep`, and it applies to the form
 * half for the same reason: this is TRANSACTIONAL mail to one named person who is
 * already party to the thing being sent. It must not be suppressed by a marketing
 * unsubscribe — an opt-out silently stopping a contract, or a mandatory policy
 * acknowledgement, is the failure mode `campaignTransports` exists on the other
 * side of.
 *
 * ── FAILURE POLICY ───────────────────────────────────────────────────────────
 * Per recipient, never per batch. One unreachable address must not stop the other
 * nine, and the caller is told how many of each so it can report honestly rather
 * than claim a send it did not make.
 *
 * ── LANGUAGE ─────────────────────────────────────────────────────────────────
 * This module holds NO COPY. It renders the chrome — greeting and the "do not
 * forward this" trailer — from the platform catalog in the locale it is handed,
 * and every word the recipient reads about the THING being sent arrives already
 * written, from `shareInvitationCopy.ts`. Keeping the transport free of copy is
 * what stopped the template from being English-only: a hardcoded greeting is a
 * hardcoded language no caller can override.
 *
 * Which locale that is, is the caller's problem and has one answer — a named
 * recipient of a form or a contract usually has no account here, so the only
 * signal available is the PUBLISHER's stored language. See
 * `publisherEmailLocale`.
 */

import type { Env } from '../../env';
import { sendRawEmail } from '../../infrastructure/email/EmailService';
import { emailCopy, fillCopy } from '../../infrastructure/email/emailMessages';
import { DEFAULT_EMAIL_LOCALE, type EmailLocale } from '../../infrastructure/email/emailLocale';
import { reportCaughtError } from '../observability/caughtErrorReporter';

/** One person and the credential minted for them. `token` exists only in the
 *  memory of the request that minted it — see `shareToken.ts`. */
export interface ShareInvitation {
  email: string;
  name?: string | null;
  token: string;
}

/**
 * The words around the link. The CALLER owns them because only it knows whether
 * the recipient is being asked to answer, to sign, or to acknowledge — and a
 * generic "you have a link" email is one nobody opens.
 */
export interface ShareInvitationMessage {
  /** Subject line. Already human — no template markers. */
  subject: string;
  /** One sentence saying what they are being asked to do and by whom. */
  body: string;
  /** The button. Four words at most: "Open the form", "Review and sign". */
  actionLabel: string;
  /** Optional second line, e.g. a deadline stated in the words the sender used. */
  footnote?: string;
  /** Plaintext token → the absolute URL that resolves it. */
  linkFor: (token: string) => string;
  /**
   * The language the words above are written in, so the chrome around them
   * matches. Optional only so an un-migrated caller degrades to English rather
   * than failing to compile — a message whose body is French and whose greeting
   * is English is the exact defect this closes.
   */
  locale?: EmailLocale;
}

export interface ShareInvitationDelivery {
  sent: number;
  failed: number;
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (character) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] as string
  ));

/**
 * The one template.
 *
 * Inline styles and a table-free single column, because this is read in Outlook
 * as often as anywhere else. The URL is rendered as text BELOW the button as well
 * as behind it: a recipient whose client strips the anchor still has something
 * they can copy, and that is the whole point of the message.
 */
function composeHtml(recipientName: string, url: string, message: ShareInvitationMessage): string {
  const copy = emailCopy(message.locale ?? DEFAULT_EMAIL_LOCALE);
  // The name is escaped, then filled into a CATALOG template that is trusted —
  // the reverse order would escape the translation's own punctuation.
  const name = recipientName.trim();
  const greeting = name
    ? fillCopy(copy.common.greeting, { RecipientName: escapeHtml(name) })
    : copy.common.greetingAnonymous;
  return [
    '<div style="max-width:560px;margin:0 auto;padding:24px;font:400 15px/1.6 system-ui,sans-serif;color:#111">',
    `<p>${greeting}</p>`,
    `<p>${escapeHtml(message.body)}</p>`,
    `<p style="margin:24px 0"><a href="${escapeHtml(url)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600">${escapeHtml(message.actionLabel)}</a></p>`,
    `<p style="color:#666;font-size:13px;word-break:break-all">${escapeHtml(url)}</p>`,
    message.footnote ? `<p style="color:#666;font-size:13px">${escapeHtml(message.footnote)}</p>` : '',
    `<p style="color:#999;font-size:12px">${copy.shareInvitation.personalLink}</p>`,
    '</div>',
  ].join('');
}

/**
 * Send one invitation per recipient and report what actually happened.
 *
 * Never throws. A publish or a reminder sweep that fails because a mail provider
 * is down would leave the credential minted and the row written with the caller
 * believing neither happened, which is strictly worse than a delivery the caller
 * can see failed and retry.
 */
export async function deliverShareInvitations(
  env: Env,
  invitations: readonly ShareInvitation[],
  message: ShareInvitationMessage,
  source: string,
): Promise<ShareInvitationDelivery> {
  let sent = 0;
  let failed = 0;
  for (const invitation of invitations) {
    try {
      await sendRawEmail(env, {
        to: invitation.email,
        subject: message.subject,
        html: composeHtml(invitation.name ?? '', message.linkFor(invitation.token), message),
      });
      sent += 1;
    } catch (error) {
      failed += 1;
      // Counted AND reported: an invitation nobody received is invisible from the
      // author's side — the row exists, the token was minted, and the only trace
      // that the person was never reached is this report.
      reportCaughtError(error, {
        source,
        operation: 'deliverShareInvitations',
        context: { recipients: invitations.length },
      });
    }
  }
  return { sent, failed };
}
