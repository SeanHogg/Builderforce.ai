/**
 * Getting a named-recipient form to the people it is for.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `publishForm` minted a credential per recipient and handed the plaintext back
 * to its caller exactly once — correctly, since only the hash is stored — and
 * there was NO SENDER behind it. So `audience: 'namedRecipients'` worked only if
 * the publisher copied each link out of the API response by hand, which means the
 * enforceable audience the whole `form_recipients` table exists to make real was
 * unusable without a person relaying links.
 *
 * Two halves, both here because they are one flow:
 *   · at publish — one transactional send per recipient;
 *   · on a schedule — chase whoever has not answered, with a link that works.
 *
 * ── WHY THE REMINDER RE-ISSUES THE TOKEN ─────────────────────────────────────
 * Only the HASH of a recipient's credential is stored, so a reminder cannot quote
 * the address they were originally sent. The signature engine hit this first and
 * settled it the same way: mint a FRESH token at reminder time, which keeps the
 * one-way property intact and still produces a working link. The old link dies —
 * that is the cost, and it is charged only when a message carrying the new one is
 * about to go out.
 *
 * ── LAYER ────────────────────────────────────────────────────────────────────
 * Application. It composes and delegates: the store rules are in
 * `formPublishing.ts`, the transport and the template are in
 * `shareInvitationMailer.ts`, the words are in `shareInvitationCopy.ts`, and none
 * of them knows about the others.
 *
 * ── LANGUAGE ─────────────────────────────────────────────────────────────────
 * A named recipient is usually not a user, so the message is written in the
 * PUBLISHER's language — `question_sets.created_by` resolved through the one
 * locale chain. That is why both halves take a `Db`: the sweep already had one,
 * and the publish route now hands over the one it is already holding rather than
 * building a second.
 */

import type { Env } from '../../env';
import { resolveAppBaseUrl } from '../../env';
import { buildDatabase } from '../../infrastructure/database/connection';
import type { Db } from '../../infrastructure/database/connection';
import { deliverShareInvitations, type ShareInvitation } from '../security/shareInvitationMailer';
import {
  publisherEmailLocale,
  shareInvitationMessage,
  type InvitationPublisher,
} from '../security/shareInvitationCopy';
import { formRemindersDue, markFormReminded, reissueRecipientToken } from './formPublishing';

const SOURCE = 'application/collection/formInvitations.ts';

/** The public address of one named recipient's copy of a form. The token rides
 *  `?t=` because that is the parameter the public responder route reads — one
 *  spelling, asserted by construction rather than by two modules agreeing. */
export function formRecipientUrl(baseUrl: string, slug: string, token: string): string {
  return `${baseUrl}/f/${encodeURIComponent(slug)}?t=${encodeURIComponent(token)}`;
}

export interface FormForInvitation {
  slug: string;
  title: string;
  closesAt?: Date | string | null;
}

/**
 * Send each named recipient their own link, at publish time.
 *
 * Called with the plaintext tokens `publishForm` returned, which is the only
 * moment they exist. Never throws — see the mailer's failure policy.
 */
export async function deliverFormInvitations(
  env: Env,
  db: Db,
  form: FormForInvitation,
  invitations: readonly ShareInvitation[],
  publisher: InvitationPublisher = {},
): Promise<{ sent: number; failed: number }> {
  if (!invitations.length) return { sent: 0, failed: 0 };
  const base = resolveAppBaseUrl(env);
  const locale = await publisherEmailLocale(env, db, publisher);
  return deliverShareInvitations(env, invitations, shareInvitationMessage(
    locale,
    { kind: 'formInvitation', title: form.title, closesAt: form.closesAt ?? null },
    (token) => formRecipientUrl(base, form.slug, token),
  ), SOURCE);
}

export interface FormSweepResult {
  chased: number;
  reminded: number;
  failed: number;
}

/**
 * The chase pass.
 *
 * Order of operations mirrors the signature sweep: read what is due, re-issue,
 * deliver, and only THEN stamp — so a transport outage means the next tick tries
 * again rather than marking a form chased that nobody heard from.
 *
 * A recipient whose re-issue fails is skipped rather than emailed a dead link:
 * the row update and the message must agree, and if they cannot, silence is the
 * honest outcome.
 */
export async function runFormReminderSweep(env: Env, now = new Date()): Promise<FormSweepResult> {
  const db: Db = buildDatabase(env);
  const base = resolveAppBaseUrl(env);
  const due = await formRemindersDue(db, now);

  let chased = 0;
  let reminded = 0;
  let failed = 0;

  for (const form of due) {
    const invitations: ShareInvitation[] = [];
    for (const recipient of form.pending) {
      const token = await reissueRecipientToken(db, form.tenantId, recipient.recipientId);
      if (!token) { failed += 1; continue; }
      invitations.push({ email: recipient.email, name: recipient.name, token });
    }
    if (!invitations.length) continue;

    // The chase is written in the same language the invitation was, because it is
    // the same publisher writing to the same person about the same form.
    const locale = await publisherEmailLocale(env, db, { userId: form.createdBy });
    const delivery = await deliverShareInvitations(env, invitations, shareInvitationMessage(
      locale,
      { kind: 'formReminder', title: form.title, closesAt: form.closesAt },
      (token) => formRecipientUrl(base, form.slug, token),
    ), SOURCE);

    reminded += delivery.sent;
    failed += delivery.failed;
    if (delivery.sent > 0) {
      chased += 1;
      await markFormReminded(db, form.tenantId, form.questionSetId, now);
    }
  }

  return { chased, reminded, failed };
}
