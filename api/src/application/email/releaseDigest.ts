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
 *   1. Resolve the note set. Empty → a no-op (a quiet week sends no mail); the
 *      weekly set is capped (see `MAX_NOTES_PER_DIGEST`) so a bulk publish is
 *      announced over several digests rather than in one unreadable email.
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
 *
 * -- HOW THE AUDIENCE IS WALKED (1061) --------------------------------------
 * The audience is NOT read in one query any more. It is paged by KEYSET
 * (`users.id > cursor ORDER BY id`), and the cursor is persisted on a
 * `release_digest_runs` row after every batch. Three things follow from that:
 *
 *   - memory and query cost are bounded by the page size, not the user base;
 *   - a Worker eviction mid-send RESUMES: the next invocation carrying the same
 *     notes finds the open run, reads its cursor, and continues. Before this,
 *     the notes were stamped only at the end, so a retry re-mailed everyone who
 *     had already received the digest;
 *   - a run stops at `MAX_SENDS_PER_RUN` and stays `running`, so a large
 *     audience is drained across invocations instead of blowing the Resend rate
 *     window and the Worker's CPU budget in one burst.
 *
 * Only a run that reaches the END of the audience stamps `emailed_at`. A partial
 * run leaves the notes unsent, which is what keeps "resume" and "at-least-once"
 * from contradicting each other.
 */

import { and, asc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { resolveAppBaseUrl, type Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { releaseDigestRuns, users } from '../../infrastructure/database/schema';
import { sendReleaseDigestEmail, type ReleaseDigestItem } from '../../infrastructure/email/EmailService';
import { sendLifecycleEmail } from './sendEmail';
import {
  listUnsentPublishedReleaseNotes,
  listPublishedReleaseNotesByIds,
  markReleaseNotesEmailed,
} from '../product/releaseNotes';

const SEND_BATCH_SIZE = 10;

/**
 * Recipients read per keyset page. Ten batches of `SEND_BATCH_SIZE`, so a page
 * is a bounded read whatever the user base does.
 */
const AUDIENCE_PAGE_SIZE = 100;

/**
 * The Resend ceiling, expressed where it is actually spent.
 *
 * Resend rate-limits by requests per second and every recipient is one request,
 * so a run both (a) paces itself, no more than `SENDS_PER_SECOND` messages
 * leaving per second, and (b) stops entirely after `MAX_SENDS_PER_RUN`. The stop
 * is the important half: pacing alone would just make one invocation run for
 * hours and hit the Worker's wall clock instead of Resend's rate window.
 *
 * A run that stops on the ceiling stays `running`; the next invocation resumes
 * at the cursor, so a large audience is drained over consecutive runs rather
 * than refused.
 */
const SENDS_PER_SECOND = 8;
const MAX_SENDS_PER_RUN = 2_000;

/** Milliseconds one batch of `SEND_BATCH_SIZE` must not finish faster than. */
const MIN_BATCH_INTERVAL_MS = Math.ceil((SEND_BATCH_SIZE / SENDS_PER_SECOND) * 1_000);

/**
 * The identity of a run: its note ids, ordered. Two invocations carrying the
 * same notes are the same send, which is what `uq_release_digest_run_open`
 * enforces and what makes resuming, rather than duplicating, the default.
 */
function digestNoteKey(noteIds: string[]): string {
  return [...noteIds].sort().join(',').slice(0, 64);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Upper bound on the notes ONE weekly digest carries. The email inlines every
 * note's full body, so a batch published in bulk — migration 0474 published 23
 * at once — would go out as a single unreadable mail, heavy enough to hurt
 * deliverability on the one message the product uses to announce itself.
 *
 * The overflow is NOT dropped: only the notes this run mailed are stamped
 * `emailed_at`, so the remainder are simply the front of the next digest. The
 * unsent query is oldest-published first, so a backlog is announced in the order
 * it shipped rather than newest-first with the tail arriving weeks later.
 *
 * The per-note admin trigger (`opts.noteIds`) is deliberately NOT capped: naming
 * ids is an explicit instruction, not a backlog being drained.
 */
const MAX_NOTES_PER_DIGEST = 8;

export interface ReleaseDigestRunResult {
  /** Release notes included in this digest (0 → nothing was sent). */
  notes: number;
  recipients: number;
  sent: number;
  suppressed: number;
  failed: number;
  /** False -> the audience was not drained; the next invocation resumes here. */
  complete: boolean;
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
    : (await listUnsentPublishedReleaseNotes(db)).slice(0, MAX_NOTES_PER_DIGEST);
  if (notes.length === 0) {
    return { notes: 0, recipients: 0, sent: 0, suppressed: 0, failed: 0, complete: true };
  }

  const items: ReleaseDigestItem[] = notes.map((n) => ({
    version: n.version,
    title: n.title,
    body: n.body,
    category: n.category,
  }));

  const appBaseUrl = resolveAppBaseUrl(env);
  const noteIds = notes.map((n) => n.id);
  const run = await openOrResumeRun(db, noteIds);

  let sent = run.sent;
  let suppressed = run.suppressed;
  let failed = run.failed;
  let recipients = run.recipients;
  let cursor = run.cursorUserId;
  let sentThisRun = 0;
  let drained = false;

  while (!drained && sentThisRun < MAX_SENDS_PER_RUN) {
    // Verified accounts only (an unverified address was never proven owned), and
    // never a suspended one. Per-recipient CONSENT is not filtered here — that is
    // sendLifecycleEmail's job, against the cached email_preferences record.
    //
    // Keyset, not OFFSET: an offset re-reads and re-skips everything already
    // mailed, and shifts under a concurrent signup — which for a mail send means
    // a recipient silently skipped, not merely a slow page.
    const page = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        username: users.username,
        locale: users.locale,
      })
      .from(users)
      .where(and(
        isNotNull(users.emailVerifiedAt),
        eq(users.isSuspended, false),
        ...(cursor ? [gt(users.id, cursor)] : []),
      ))
      .orderBy(asc(users.id))
      .limit(AUDIENCE_PAGE_SIZE);

    if (page.length === 0) { drained = true; break; }

    for (let i = 0; i < page.length && sentThisRun < MAX_SENDS_PER_RUN; i += SEND_BATCH_SIZE) {
      const batch = page.slice(i, i + SEND_BATCH_SIZE);
      const startedAt = Date.now();
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
      recipients += batch.length;
      sentThisRun += batch.length;
      cursor = batch[batch.length - 1]!.id;
      // Written per BATCH, not per page: the cursor is the only thing standing
      // between an eviction and a duplicate send, so it is never further behind
      // than one batch.
      await saveRunProgress(db, run.id, { cursor, recipients, sent, suppressed, failed });

      // Hold the Resend rate window.
      const elapsed = Date.now() - startedAt;
      if (elapsed < MIN_BATCH_INTERVAL_MS && sentThisRun < MAX_SENDS_PER_RUN) {
        await sleep(MIN_BATCH_INTERVAL_MS - elapsed);
      }
    }

    if (page.length < AUDIENCE_PAGE_SIZE) drained = true;
  }

  if (drained) {
    // The digest reached the end of the audience: flag the notes "sent" so next
    // week's run only carries what ships between now and then, and close the run
    // so a later invocation starts a fresh one.
    await markReleaseNotesEmailed(env, db, noteIds);
    await completeRun(db, run.id);
  }

  const result = { notes: notes.length, recipients, sent, suppressed, failed, complete: drained };
  console.log(`[release-digest] notes=${result.notes} recipients=${result.recipients} sent=${sent} suppressed=${suppressed} failed=${failed} complete=${drained}`);
  return result;
}

// -- run progress -----------------------------------------------------------
// Split out so the send loop above reads as the send loop, and so the failure it
// guards against (an eviction re-sending the whole audience) is stated once.

interface DigestRunState {
  id: string;
  cursorUserId: string | null;
  recipients: number;
  sent: number;
  suppressed: number;
  failed: number;
}

/** The open run for this note set, or a new one. Never two. */
async function openOrResumeRun(db: Db, noteIds: string[]): Promise<DigestRunState> {
  const noteKey = digestNoteKey(noteIds);
  const [existing] = await db
    .select({
      id: releaseDigestRuns.id,
      cursorUserId: releaseDigestRuns.cursorUserId,
      recipients: releaseDigestRuns.recipients,
      sent: releaseDigestRuns.sent,
      suppressed: releaseDigestRuns.suppressed,
      failed: releaseDigestRuns.failed,
    })
    .from(releaseDigestRuns)
    .where(and(eq(releaseDigestRuns.noteKey, noteKey), eq(releaseDigestRuns.status, 'running')))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(releaseDigestRuns)
    .values({ noteKey, noteIds, status: 'running' })
    .returning({ id: releaseDigestRuns.id });
  return { id: created!.id, cursorUserId: null, recipients: 0, sent: 0, suppressed: 0, failed: 0 };
}

async function saveRunProgress(
  db: Db,
  id: string,
  progress: { cursor: string; recipients: number; sent: number; suppressed: number; failed: number },
): Promise<void> {
  await db.update(releaseDigestRuns)
    .set({
      cursorUserId: progress.cursor,
      recipients: progress.recipients,
      sent: progress.sent,
      suppressed: progress.suppressed,
      failed: progress.failed,
      updatedAt: sql`NOW()`,
    })
    .where(eq(releaseDigestRuns.id, id));
}

async function completeRun(db: Db, id: string): Promise<void> {
  await db.update(releaseDigestRuns)
    .set({ status: 'completed', completedAt: sql`NOW()`, updatedAt: sql`NOW()` })
    .where(eq(releaseDigestRuns.id, id));
}
