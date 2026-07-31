/**
 * Release digest — the marketing email for new features. ONE runner backs three
 * triggers, differing only in WHICH notes it carries:
 *
 *   - the Friday cron (`0 16 * * 5`) and the "send all unsent now" admin button
 *     → every PUBLISHED note not yet emailed (`opts.noteIds` omitted);
 *   - the per-note "Send now" admin action → exactly that note (`opts.noteIds`),
 *     which lets a superadmin push a single announcement off-cycle.
 *
 * Whatever the trigger, one run:
 *
 *   1. Resolve the note set. Empty → a no-op (a quiet week sends no mail).
 *   2. Mail each verified, non-suspended account through `sendLifecycleEmail`
 *      (product_updates category) — consent is checked per recipient and every
 *      mail carries a working unsubscribe link; opted-out users are counted as
 *      suppressed, never mailed.
 *   3. Stamp the notes emailed AFTER the delivery pass, so a run that dies
 *      mid-way re-sends (at-least-once) instead of losing notes — AND so a note
 *      sent here is excluded from the next weekly digest (the "sent" flag is
 *      `release_notes.emailed_at`, which the weekly query filters on).
 *
 * Recipients are mailed in small parallel batches: the per-recipient consent
 * read is cached (email-prefs read-through), so the dominant cost is the Resend
 * call, and a bounded batch keeps us inside Worker subrequest limits without
 * serializing the whole audience.
 */

import { and, eq, isNotNull } from 'drizzle-orm';
import { resolveAppBaseUrl, type Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { users } from '../../infrastructure/database/schema';
import { sendReleaseDigestEmail, type ReleaseDigestItem } from '../../infrastructure/email/EmailService';
import { sendLifecycleEmail } from './sendEmail';
import {
  listUnsentPublishedReleaseNotes,
  listPublishedReleaseNotesByIds,
  markReleaseNotesEmailed,
} from '../product/releaseNotes';

const SEND_BATCH_SIZE = 10;

export interface ReleaseDigestRunResult {
  /** Release notes included in this digest (0 → nothing was sent). */
  notes: number;
  recipients: number;
  sent: number;
  suppressed: number;
  failed: number;
}

export interface ReleaseDigestOptions {
  /** Restrict the send to these published notes (manual per-note trigger). Omit
   *  for the full "every unsent published note" digest (cron + send-all). */
  noteIds?: string[];
}

export async function runReleaseDigest(
  env: Env,
  dbOverride?: Db,
  opts: ReleaseDigestOptions = {},
): Promise<ReleaseDigestRunResult> {
  const db = dbOverride ?? buildDatabase(env);

  const notes = opts.noteIds
    ? await listPublishedReleaseNotesByIds(db, opts.noteIds)
    : await listUnsentPublishedReleaseNotes(db);
  if (notes.length === 0) {
    return { notes: 0, recipients: 0, sent: 0, suppressed: 0, failed: 0 };
  }

  const items: ReleaseDigestItem[] = notes.map((n) => ({
    version: n.version,
    title: n.title,
    body: n.body,
    category: n.category,
  }));

  // Verified accounts only (an unverified address was never proven owned), and
  // never a suspended one. Per-recipient CONSENT is not filtered here — that is
  // sendLifecycleEmail's job, against the cached email_preferences record.
  const audience = await db
    .select({
      email: users.email,
      displayName: users.displayName,
      username: users.username,
      locale: users.locale,
    })
    .from(users)
    .where(and(isNotNull(users.emailVerifiedAt), eq(users.isSuspended, false)));

  const appBaseUrl = resolveAppBaseUrl(env);

  let sent = 0;
  let suppressed = 0;
  let failed = 0;

  for (let i = 0; i < audience.length; i += SEND_BATCH_SIZE) {
    const batch = audience.slice(i, i + SEND_BATCH_SIZE);
    const outcomes = await Promise.allSettled(batch.map((recipient) =>
      sendLifecycleEmail(
        env,
        db,
        recipient.email,
        'product_updates',
        (ctx) => sendReleaseDigestEmail(
          env,
          recipient.email,
          recipient.displayName ?? recipient.username,
          items,
          appBaseUrl,
          ctx.unsubscribeUrl,
          ctx.locale,
        ),
        { storedLocale: recipient.locale },
      ),
    ));
    for (const outcome of outcomes) {
      if (outcome.status === 'rejected') failed += 1;
      else if (outcome.value === 'suppressed') suppressed += 1;
      else sent += 1;
    }
  }

  // The digest went out (or was attempted for everyone) — flag the notes "sent"
  // so next week's run only carries what ships between now and then.
  await markReleaseNotesEmailed(env, db, notes.map((n) => n.id));

  const result = { notes: notes.length, recipients: audience.length, sent, suppressed, failed };
  console.log(`[release-digest] notes=${result.notes} recipients=${result.recipients} sent=${sent} suppressed=${suppressed} failed=${failed}`);
  return result;
}
