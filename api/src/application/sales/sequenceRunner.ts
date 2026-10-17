/**
 * The cadence runner — the thing that makes a `sequence` object actually send.
 *
 * ── WHY THIS IS A SWEEP AND NOT A SCHEDULER ─────────────────────────────────────
 * A cadence is "day 0 email, day 2 social, day 4 call, day 7 breakup". The tempting
 * implementation is a timer per enrolled person. This platform already refused that shape
 * twice — `question_sets.remind_after_days` (0479) and `signature_requests` both store the
 * INTENT and let one sweep ask "who is due", for the reason 0479's own comment gives: a
 * per-person timer is state that has to survive a redeploy, and a sweep is a predicate
 * over rows that already exist.
 *
 * So the cadence lives entirely on the canvas object (steps + enrolments), and this reads
 * it. `sequenceDueSteps` in the shared contract is the whole rule — the same function the
 * card's progress bar reads, so what the seller SEES about to happen is what happens.
 *
 * ── WHY THE CURSOR IS `stepsSent` AND NOT A PER-STEP LOG ────────────────────────
 * An enrolment carries a count, not a list of sends. The count is enough to answer both
 * questions the runner asks (what is next; are they finished) and it is the only shape
 * that cannot get into a state where a person is simultaneously "sent step 3" and "not
 * sent step 2". A send LOG is not lost — every send writes an `activity_log` row, which is
 * the audit store and the right place for "what actually went out".
 *
 * ── WHY A FAILED SEND DOES NOT ADVANCE THE CURSOR ───────────────────────────────
 * `retryable` decides. A transient provider error leaves `stepsSent` alone so the next
 * tick tries again; a permanent one (a revoked mailbox, a bad address) STOPS that person
 * rather than retrying forever against a wall. That is the same contract the campaign
 * engine already documents for `sendFromMailbox`, applied here rather than re-invented.
 */

import { asJsonRecord } from '../../domain/shared/json';
import { eq, isNull, lte, or, sql } from 'drizzle-orm';
import {
  readSequenceEnrolments, readSequenceSteps, sequenceDueSteps, sequenceNextDueAt,
  type SequenceChannel, type SequenceDueStep, type SequenceEnrolment,
} from '@builderforce/creation-canvas-contract';
import type { Env } from '../../env';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import {
  creationSessionObjects, creationSessions, mailboxConnections,
} from '../../infrastructure/database/schema';
import { sendFromMailbox } from '../mailbox/mailboxService';
import { publishSocialPost, resolvePublishableAccounts } from '../social/socialService';
import { recordActivity, SYSTEM_ACTOR } from '../activity/activityLog';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';

const SOURCE = 'application/sales/sequenceRunner.ts';

/** How many cadences one tick will drive. A bound, not a guess: the sweep runs every
 *  fifteen minutes and a cadence step is a day apart, so nothing is starved by a cap that
 *  keeps one tick inside a Worker's budget. Only DUE (or never-evaluated) cadences count
 *  toward it — see `next_due_at` (1234). */
const MAX_SEQUENCES_PER_TICK = 40;
/** `next_due_at` for a cadence nobody will ever be due on (not running, everyone done). A
 *  real timestamp rather than NULL, because NULL means "unknown, evaluate me". An edit that
 *  restarts it clears the stamp through the 1234 trigger. */
const NEVER_DUE = new Date('9999-12-31T00:00:00.000Z');

/** The stamp to store after a cadence's content is `content`. */
function nextDueStamp(content: Record<string, unknown>): Date {
  return sequenceNextDueAt({ state: content.sequenceState, steps: content.steps, enrolments: content.enrolments }) ?? NEVER_DUE;
}
/** And how many people inside one cadence. A 2,000-person cadence sends in batches over
 *  successive ticks rather than trying to send 2,000 emails in one invocation — which is
 *  also the only behaviour a provider's rate limit will tolerate. */
const MAX_SENDS_PER_SEQUENCE = 25;

export interface SequenceSweepResult {
  sequences: number;
  sent: number;
  stopped: number;
  failed: number;
}

/** What one channel's dispatch reports back. Mirrors `MailboxSendResult`'s contract
 *  deliberately: `retryable` is the only field the cursor logic reads. */
interface DispatchResult {
  ok: boolean;
  retryable: boolean;
  detail: string;
}

/** Substitute the two placeholders a cadence step may carry. Deliberately two and not a
 *  template language: `{{name}}` and `{{company}}` are what a first-touch email actually
 *  personalises, and a full expression evaluator in an outbound send path is a way to leak
 *  whatever the evaluator can reach. */
function render(template: string, enrolment: SequenceEnrolment): string {
  const firstName = enrolment.name.split(/\s+/)[0] ?? '';
  return template
    .replaceAll('{{name}}', enrolment.name)
    .replaceAll('{{firstName}}', firstName)
    .replaceAll('{{contact}}', enrolment.contactRef);
}

/** A cadence body is authored as plain text. Escaped before it becomes HTML, because a
 *  seller typing `<3` into a step must not produce a broken tag in a real buyer's inbox. */
function toHtml(body: string): string {
  const escaped = body
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return escaped.split(/\n{2,}/).map((para) => `<p>${para.replaceAll('\n', '<br>')}</p>`).join('');
}

/**
 * Send one step to one person.
 *
 * Every channel resolves to a port that already exists. `call`, `sms` and `task` land as a
 * task CARD rather than pretending to dial: a runner that silently did nothing for three of
 * five channels would be worse than one that says "somebody has to make this call", and a
 * card on the board is exactly that statement, in the place the seller already is.
 */
async function dispatch(
  db: Db,
  env: Env,
  context: {
    tenantId: number; sessionId: string; sequenceTitle: string;
    mailboxId: number | null; socialConnectionIds: string[];
    taskX: number; taskY: number;
  },
  step: { channel: SequenceChannel; subject: string; body: string },
  enrolment: SequenceEnrolment,
): Promise<DispatchResult> {
  const subject = render(step.subject, enrolment);
  const body = render(step.body, enrolment);

  if (step.channel === 'email') {
    if (!context.mailboxId) {
      return { ok: false, retryable: false, detail: 'No mailbox is connected to send from.' };
    }
    const result = await sendFromMailbox(db, env, context.tenantId, context.mailboxId, {
      to: enrolment.contactRef,
      subject: subject || context.sequenceTitle,
      html: toHtml(body),
      text: body,
    });
    return result.ok
      ? { ok: true, retryable: false, detail: result.id ?? '' }
      : { ok: false, retryable: result.retryable, detail: result.error };
  }

  if (step.channel === 'social') {
    const accounts = await resolvePublishableAccounts(db, env, context.tenantId, context.socialConnectionIds);
    if (accounts.length === 0) {
      return { ok: false, retryable: false, detail: 'No publishable social account is connected.' };
    }
    const outcome = await publishSocialPost(db, env, context.tenantId, accounts[0]!, { text: body }, 'agent');
    return outcome.ok
      ? { ok: true, retryable: false, detail: '' }
      : { ok: false, retryable: outcome.retryable, detail: outcome.error };
  }

  // call | sms | task — a person still has to do it, so it becomes a `task` CARD on the
  // same board.
  //
  // Not a `tasks` row in the delivery domain, and the reason is a bounded-context one
  // rather than a convenience: `tasks` belongs to a PROJECT and is the unit a sprint,
  // a burndown and an agent dispatch are computed over. "Ring this prospect on Thursday"
  // is not delivery work, has no project, and would distort every one of those readings.
  // The board the cadence lives on is where the seller already is, and a card there is
  // visible, assignable and connectable to the deal — which is what the request actually
  // needs.
  try {
    const objectId = crypto.randomUUID();
    const title = `${step.channel === 'call' ? 'Call' : step.channel === 'sms' ? 'Text' : 'Follow up with'} ${enrolment.name || enrolment.contactRef}`;
    await db.insert(creationSessionObjects).values({
      id: objectId,
      sessionId: context.sessionId,
      kind: 'task',
      // Placed below the cadence card rather than at the origin, so a week of manual steps
      // does not stack every card on top of the first one.
      canvasData: { x: context.taskX, y: context.taskY, w: 280, h: 180 },
      content: {
        kind: 'task',
        title,
        status: 'To do',
        subtitle: context.sequenceTitle,
        description: [subject, body, `Contact: ${enrolment.contactRef}`].filter(Boolean).join('\n\n'),
        priority: 'medium',
      },
      searchText: `${title} ${enrolment.contactRef}`.slice(0, 2000),
    });
    return { ok: true, retryable: false, detail: objectId };
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: `dispatch:${step.channel}` });
    return { ok: false, retryable: true, detail: 'Could not create the follow-up card.' };
  }
}

/**
 * Drive every running cadence one tick.
 *
 * One indexed read (`idx_creation_objects_sequence_due`, migration 1234) of only the
 * cadences with a step due now or never evaluated since their last edit — so an idle tick
 * is one statement that returns nothing, instead of 40 JSON blobs evaluated in JS.
 */
export async function runSequenceSweep(env: Env, now = new Date(), db: Db = buildDatabase(env)): Promise<SequenceSweepResult> {
  const rows = await db.select({
    id: creationSessionObjects.id,
    content: creationSessionObjects.content,
    geometry: creationSessionObjects.canvasData,
    sessionId: creationSessionObjects.sessionId,
    tenantId: creationSessions.tenantId,
    sessionTitle: creationSessions.title,
  }).from(creationSessionObjects)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionObjects.sessionId))
    // The platform acting on its own schedule over every tenant's cadences — which is
    // what a sweep IS. It still names what it acts ON: RUNNING cadences on ACTIVE boards,
    // never "every canvas object".
    .where(acrossTenants(
      creationSessions,
      'scheduled_sweep',
      eq(creationSessionObjects.kind, 'sequence'),
      eq(creationSessions.status, 'active'),
      or(isNull(creationSessionObjects.nextDueAt), lte(creationSessionObjects.nextDueAt, now)),
    ))
    // Unknown (just edited) first, then the longest-overdue.
    .orderBy(sql`${creationSessionObjects.nextDueAt} asc nulls first`)
    .limit(MAX_SEQUENCES_PER_TICK);

  const result: SequenceSweepResult = { sequences: 0, sent: 0, stopped: 0, failed: 0 };
  /** Cadences evaluated with nothing to send: only their due stamp is written. */
  const stamps: Array<{ id: string; at: Date }> = [];

  for (const row of rows) {
    const content = asJsonRecord(row.content);
    const due: SequenceDueStep[] = sequenceDueSteps(
      { state: content.sequenceState, steps: content.steps, enrolments: content.enrolments },
      now,
    ).slice(0, MAX_SENDS_PER_SEQUENCE);
    if (due.length === 0) {
      stamps.push({ id: row.id, at: nextDueStamp(content) });
      continue;
    }

    result.sequences += 1;

    // Resolved once per cadence, not once per person: a forty-recipient step would
    // otherwise be forty identical connection lookups, which is the N+1 the performance
    // rule names by name.
    const [mailbox] = await db.select({ id: mailboxConnections.id })
      .from(mailboxConnections)
      .where(eq(mailboxConnections.tenantId, row.tenantId))
      .limit(1);
    const socialConnectionIds = Array.isArray(content.socialConnectionIds)
      ? content.socialConnectionIds.map((value) => String(value)).slice(0, 8)
      : [];

    // Where a manual step's card lands: below the cadence, in a column. Read off the
    // cadence's own geometry so the cards it spawns appear beside it rather than at the
    // origin of a board the seller may have panned away from.
    const geometry = asJsonRecord(row.geometry);
    const baseX = Number(geometry.x ?? 0);
    const baseY = Number(geometry.y ?? 0) + Number(geometry.h ?? 220) + 40;

    const context = {
      tenantId: row.tenantId,
      sessionId: row.sessionId,
      sequenceTitle: String(content.title ?? row.sessionTitle ?? 'Sequence'),
      mailboxId: mailbox?.id ?? null,
      socialConnectionIds,
      taskX: baseX,
      taskY: baseY,
    };
    let spawned = 0;

    // The enrolment list is rewritten as a whole, so the cursor moves for exactly the
    // people who were actually sent to. Matched by `contactRef`, which is the identity a
    // cadence has — an index would be wrong the moment somebody is removed mid-tick.
    const enrolments = readSequenceEnrolments(content.enrolments);
    const byRef = new Map(enrolments.map((row_) => [row_.contactRef, { ...row_ }]));
    const nowISO = now.toISOString();

    for (const item of due) {
      const target = byRef.get(item.enrolment.contactRef);
      if (!target) continue;
      const outcome = await dispatch(
        db, env,
        { ...context, taskY: context.taskY + spawned * 200 },
        item.step, item.enrolment,
      );
      if (outcome.ok && item.step.channel !== 'email' && item.step.channel !== 'social') spawned += 1;

      if (outcome.ok) {
        target.stepsSent = item.stepIndex + 1;
        target.lastSentAtISO = nowISO;
        result.sent += 1;
      } else if (outcome.retryable) {
        // Cursor untouched: the next tick tries this same step again.
        result.failed += 1;
      } else {
        target.stoppedAtISO = nowISO;
        result.stopped += 1;
      }

      await recordActivity(env, db, {
        tenantId: row.tenantId,
        actor: SYSTEM_ACTOR,
        verb: outcome.ok ? 'sequence.sent' : 'sequence.send_failed',
        targetType: 'canvas_object',
        targetId: row.id,
        targetLabel: context.sequenceTitle,
        summary: `${item.step.channel} step ${item.stepIndex + 1} → ${item.enrolment.contactRef}${outcome.ok ? '' : `: ${outcome.detail}`}`,
        metadata: { channel: item.step.channel, stepIndex: item.stepIndex, retryable: outcome.retryable },
      });
    }

    const nextEnrolments = enrolments.map((row_) => byRef.get(row_.contactRef) ?? row_);
    const steps = readSequenceSteps(content.steps);
    // A cadence whose every enrolment is finished, replied or stopped is COMPLETED —
    // stated on the object rather than inferred by each reader, so a seller's board shows a
    // cadence that has run its course instead of one that looks perpetually live.
    const allDone = nextEnrolments.length > 0 && nextEnrolments.every((row_) =>
      row_.repliedAtISO || row_.stoppedAtISO || (steps.length > 0 && row_.stepsSent >= steps.length));

    const nextContent = {
      ...content,
      enrolments: nextEnrolments,
      lastRunAt: nowISO,
      ...(allDone ? { sequenceState: 'completed', status: 'Completed' } : {}),
    };
    await db.update(creationSessionObjects)
      // Content and its due stamp together, so the 1234 trigger keeps the stamp. A step
      // left unsent (retryable failure, per-tick send cap) keeps it due — retried next tick.
      .set({ content: nextContent, nextDueAt: nextDueStamp(nextContent), updatedAt: now })
      .where(eq(creationSessionObjects.id, row.id));
    await db.update(creationSessions)
      .set({ canvasRevision: sql`${creationSessions.canvasRevision} + 1`, lastActivityAt: now })
      .where(scopedToTenant(creationSessions, row.tenantId, eq(creationSessions.id, row.sessionId)));
  }

  // Every nothing-due cadence's stamp in ONE round trip. Content is untouched, so the
  // trigger keeps these, and `updated_at` is left alone — this is bookkeeping, not an edit.
  const [first, ...rest] = stamps.map((s) => db.update(creationSessionObjects)
    .set({ nextDueAt: s.at })
    .where(eq(creationSessionObjects.id, s.id)));
  if (first) await db.batch([first, ...rest]);

  return result;
}
