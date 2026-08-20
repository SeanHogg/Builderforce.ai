/**
 * The WORDS of a "here is your personal link" message, and the language they are
 * written in.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * `shareInvitationMailer` was one template with the sentences supplied by its
 * callers, and every caller supplied English string literals. So a workspace
 * whose whole product is localized — five locales, a stored `users.locale`, a
 * resolver every other transactional mail goes through — sent the two messages
 * that leave the platform to people who are NOT users (a form's named recipient,
 * a counterparty on a contract) in English only. Those are the messages most
 * likely to reach somebody outside the sending company, which is the worst
 * possible place for the one hardcoded language.
 *
 * ── WHY THE COPY IS HERE AND NOT IN THE MAILER ───────────────────────────────
 * The mailer is a transport: recipients, escaping, per-recipient failure
 * isolation. Copy in a transport is copy in the one module that must not know
 * what it is sending. So the transport takes a message that is already written,
 * and this module is the only thing that turns "a form invitation, in French"
 * into that message — from the platform catalog, never from a literal.
 *
 * ── WHOSE LANGUAGE ───────────────────────────────────────────────────────────
 * The PUBLISHER's. A named recipient of a form or a signature request usually has
 * no account here at all — no `users.locale`, no request of their own to read a
 * header from — so there is exactly one signal about what language they are
 * likely to read, and it is the stored language of the person who sent it. That
 * still runs through `resolveEmailLocale` (as `stored`) rather than beside it, so
 * there stays ONE locale chain on the platform.
 */

import type { SignatureIntent } from '@builderforce/creation-canvas-contract';
import { eq } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { users } from '../../infrastructure/database/schema';
import { emailCopy, fillCopy } from '../../infrastructure/email/emailMessages';
import type { EmailLocale } from '../../infrastructure/email/emailLocale';
import {
  resolveEmailLocale,
  type LocaleHeaderHints,
} from '../email/emailLocaleResolver';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import type { ShareInvitationMessage } from './shareInvitationMailer';

const SOURCE = 'application/security/shareInvitationCopy.ts';

/** Who is sending, as much of it as the caller knows. */
export interface InvitationPublisher {
  /** `created_by` on the form or the signature request — a `users.id`. */
  userId?: string | null;
  /** The publishing request's own header hints, when there IS a request. Used
   *  only when the publisher has no stored language of their own. */
  headers?: LocaleHeaderHints;
}

/**
 * The language to write an invitation in.
 *
 * Never throws and never returns null: the worst case is English, because a
 * contract that failed to send over a locale lookup would be a strictly worse
 * outcome than one sent in the wrong language.
 */
export async function publisherEmailLocale(
  env: Env,
  db: Db,
  publisher: InvitationPublisher = {},
): Promise<EmailLocale> {
  const stored = publisher.userId ? await lookupPublisherLocale(db, publisher.userId) : undefined;
  return resolveEmailLocale(env, db, {
    // `undefined` means "not loaded, keep looking"; `null` means "loaded, unset" —
    // the distinction the resolver already documents, preserved rather than
    // flattened to null, so a failed lookup still falls through to the headers.
    ...(stored !== undefined ? { stored } : {}),
    ...(publisher.headers ? { headers: publisher.headers } : {}),
  });
}

/** The publisher's row, read once. Returns `undefined` when there is nothing to
 *  read — a deleted author, or a lookup that failed. */
async function lookupPublisherLocale(db: Db, userId: string): Promise<string | null | undefined> {
  try {
    const [row] = await db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row ? row.locale : undefined;
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'lookupPublisherLocale' });
    return undefined;
  }
}

/**
 * What is being asked of the recipient.
 *
 * The signature half splits on `intent` rather than interpolating a verb: the
 * English original built `${verb}d` for its reminder, a past tense no translator
 * can be handed, and "sign"/"acknowledge" inflect differently in all four other
 * locales. A separate catalog key per act is the only shape that translates.
 */
export type ShareInvitationSpec =
  | { kind: 'formInvitation'; title: string; closesAt?: Date | string | null }
  | { kind: 'formReminder'; title: string; closesAt?: Date | string | null }
  | {
      kind: 'signatureInvitation';
      subject: string;
      documentTitle: string;
      intent: SignatureIntent;
      expiresAt?: Date | string | null;
    }
  | { kind: 'signatureReminder'; subject: string; documentTitle: string; intent: SignatureIntent }
  | {
      kind: 'invoiceIssued';
      reference: string;
      /** Minor units. Formatted for the RECIPIENT's locale by the composer. */
      amountCents: number;
      currency: string;
      dueAt: Date | string;
      /** The issuer's own covering words, when they wrote any. Their sentence
       *  wins over the catalog's — it is the one thing on this message a human
       *  deliberately authored — and it is sent as written, in whatever language
       *  they wrote it. */
      message?: string | null;
      payable: boolean;
    }
  | {
      kind: 'invoiceChase';
      reference: string;
      outstandingCents: number;
      currency: string;
      /** Present only when the invoice was already due — the sentence differs. */
      dueAt?: Date | string | null;
      subject?: string | null;
      body?: string | null;
      payable: boolean;
    };

/**
 * Compose the message for one kind of invitation, in one locale.
 *
 * Titles are interpolated RAW: `composeHtml` escapes the whole composed sentence,
 * so escaping here would double-escape a recipient-visible title. Nothing in
 * `shareInvitation` copy carries markup, precisely so that stays true.
 */
export function shareInvitationMessage(
  locale: EmailLocale,
  spec: ShareInvitationSpec,
  linkFor: (token: string) => string,
): ShareInvitationMessage {
  const copy = emailCopy(locale).shareInvitation;
  const base = { locale, linkFor };

  switch (spec.kind) {
    case 'formInvitation': {
      const footnote = deadlineNote(copy.formClosesNote, spec.closesAt);
      return {
        ...base,
        // The form's own title IS the subject at invitation time — a recipient
        // scanning an inbox recognises the thing, not the fact that it is a form.
        subject: spec.title,
        body: fillCopy(copy.formInvitationBody, { Title: spec.title }),
        actionLabel: copy.openForm,
        ...(footnote ? { footnote } : {}),
      };
    }
    case 'formReminder': {
      const footnote = deadlineNote(copy.formClosesNote, spec.closesAt);
      return {
        ...base,
        subject: fillCopy(copy.reminderSubject, { Title: spec.title }),
        body: fillCopy(copy.formReminderBody, { Title: spec.title }),
        actionLabel: copy.openForm,
        ...(footnote ? { footnote } : {}),
      };
    }
    case 'signatureInvitation': {
      const acknowledging = spec.intent === 'acknowledge';
      const footnote = deadlineNote(copy.requestExpiresNote, spec.expiresAt);
      return {
        ...base,
        subject: spec.subject,
        body: fillCopy(
          acknowledging ? copy.acknowledgeInvitationBody : copy.signInvitationBody,
          { Title: spec.documentTitle },
        ),
        actionLabel: acknowledging ? copy.reviewAndAcknowledge : copy.reviewAndSign,
        ...(footnote ? { footnote } : {}),
      };
    }
    case 'signatureReminder': {
      const acknowledging = spec.intent === 'acknowledge';
      return {
        ...base,
        subject: fillCopy(copy.reminderSubject, { Title: spec.documentTitle }),
        body: fillCopy(
          acknowledging ? copy.acknowledgeReminderBody : copy.signReminderBody,
          { Title: spec.documentTitle },
        ),
        actionLabel: acknowledging ? copy.reviewAndAcknowledge : copy.reviewAndSign,
        // The request's own subject, so a chase still says WHICH document without
        // repeating the title twice in one message.
        footnote: spec.subject,
      };
    }
    case 'invoiceIssued': {
      const due = isoDay(spec.dueAt);
      return {
        ...base,
        subject: fillCopy(copy.invoiceSubject, { Reference: spec.reference }),
        // The issuer's own words win. They are the one sentence on this message a
        // human deliberately wrote, and rewriting them from a catalog would be
        // discarding the only part that is actually about this invoice.
        body: spec.message?.trim() || fillCopy(copy.invoiceIssuedBody, {
          Reference: spec.reference,
          Amount: formatMoney(spec.amountCents, spec.currency, locale),
          Date: due ?? '',
        }),
        actionLabel: spec.payable ? copy.payInvoice : copy.viewInvoice,
        ...(due ? { footnote: fillCopy(copy.invoiceDueNote, { Date: due }) } : {}),
      };
    }
    case 'invoiceChase': {
      const due = isoDay(spec.dueAt);
      return {
        ...base,
        subject: (spec.subject?.trim() || fillCopy(copy.invoiceSubject, { Reference: spec.reference })).slice(0, 120),
        body: spec.body?.trim() || fillCopy(
          due ? copy.invoiceOverdueChaseBody : copy.invoiceChaseBody,
          {
            Reference: spec.reference,
            Amount: formatMoney(spec.outstandingCents, spec.currency, locale),
            Date: due ?? '',
          },
        ),
        actionLabel: spec.payable ? copy.payInvoice : copy.viewInvoice,
      };
    }
  }
}

/**
 * An amount, written the way the RECIPIENT would write it.
 *
 * Money was previously formatted once, in the sender's convention, and pasted into
 * every language — so a German recipient read `$1,234.50` where their own locale
 * writes `1.234,50 $`. `Intl.NumberFormat` already knows where a currency symbol
 * belongs in each of the five locales, so the catalog carries the sentence and the
 * formatter carries the number. An unknown currency code degrades to the code plus
 * the figure rather than throwing: a mail that fails to send over a typo in a
 * currency field is worse than a mail that says `XYZ 1234.50`.
 */
function formatMoney(minorUnits: number, currency: string, locale: EmailLocale): string {
  const major = minorUnits / 100;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(major);
  } catch (error) {
    reportCaughtError(error, {
      source: SOURCE,
      operation: 'formatMoney',
      context: { currency, locale },
    });
    return `${currency} ${major.toFixed(2)}`;
  }
}

/** The unambiguous day, or nothing. Shared by both invoice sentences. */
function isoDay(at: Date | string | null | undefined): string | undefined {
  if (!at) return undefined;
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString().slice(0, 10);
}

/**
 * A deadline the recipient can act on, or nothing.
 *
 * One implementation for both halves: "this form closes on" and "this request
 * expires on" differed only in their sentence, which is now a catalog key, so the
 * date handling — a `Date` or a string, an unparseable value dropped rather than
 * printed as `Invalid Date` — has one definition. The ISO day is deliberately not
 * locale-formatted: `yyyy-mm-dd` is unambiguous in every locale, which is more
 * than can be said for any of the numeric alternatives.
 */
function deadlineNote(template: string, at: Date | string | null | undefined): string | undefined {
  const day = isoDay(at);
  return day ? fillCopy(template, { Date: day }) : undefined;
}
