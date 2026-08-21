/**
 * THE facilitation primitive — a question put to a ROOM, and the answers coming back
 * from phones that have no account.
 *
 * ── WHAT THIS CLOSES ─────────────────────────────────────────────────────────
 * The canvas's entire facilitation surface was `timer` and `comment`. A board could be
 * BUILT collaboratively and never RUN: no way to ask twelve people a question, no way
 * for them to answer without signing up, and no way for the answer to land on the board
 * everyone is looking at. That is the meeting use case, which is the whole funnel the
 * competitor built its 2026 headline feature around.
 *
 * ── WHY NO NEW STORE, AGAIN ──────────────────────────────────────────────────
 * `question_sets` + `responses` already absorbed twelve survey tables and thirteen
 * answer tables, and migration 0469 gave a set a public address, an anonymity switch and
 * an enforceable audience. A poll is a question set whose `kind` is 'poll'. What did not
 * exist is one column (`show_results_live`) and one constraint (one vote per
 * participant) — migration 1103. A `polls`/`poll_votes` pair would have been the third
 * response store the kernel's own note warns about, and a second answer to "what did
 * this person answer".
 *
 * ── WHY IT IS NOT `formPublishing.ts` ────────────────────────────────────────
 * They share the store and deliberately not the rules. A form is answered on somebody's
 * own time by an audience that may be named and chased, and is read afterwards. A poll
 * is answered by a room at once, anonymously, from a device that must be able to CHANGE
 * its answer, and is read WHILE it is being answered. Those are different rules about
 * who may answer, how often, and what a reader is allowed to see — and folding them into
 * one function with a mode flag is how a retro would come to email people.
 *
 * What IS shared is shared: the slug alphabet (`mintPublicSlug`), the error-to-status
 * translation (`FormError`) and the store itself.
 *
 * ── THE LAYER ────────────────────────────────────────────────────────────────
 * Application layer: takes a `Db`, returns values, knows nothing about Hono or status
 * codes. Every rule that protects a participant — a closed poll takes nothing, a hidden
 * tally is not sent to a phone, a quiz answer is not revealed early — is enforced HERE,
 * so a second caller cannot reach the store through a path that forgot one.
 */

import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import {
  POLL_MAX_OPTIONS,
  POLL_QUESTION_KEY,
  POLL_SCALE_DEFAULT,
  POLL_SCALE_MAX,
  POLL_SCALE_MIN,
  emptyPollTally,
  isPollFormat,
  pollAnswerIsEmpty,
  pollNeedsOptions,
  tallyPollVotes,
  type FormStatus,
  type PollFormat,
  type PollOption,
  type PollTally,
  type PollVote,
  type PublishedPoll,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { questionSets, responses } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { FormError, mintPublicSlug } from './formPublishing';

/** The `question_sets.kind` a canvas `poll` object projects to. A kind is a column
 *  value — see the table's own note. */
export const POLL_QUESTION_SET_KIND = 'poll';

/**
 * How many votes one tally reads.
 *
 * A poll is put to a room, and a room is tens of people — not tens of thousands. The
 * cap exists because the read is unauthenticated and the alternative is an unbounded
 * result set behind a public URL, not because a real poll is expected to reach it. When
 * it IS reached the tally says so (`truncated`), rather than drawing a shape from the
 * first slice and letting a reader assume it is all of them.
 */
const POLL_TALLY_CAP = 5000;

const MAX_TEXT_ANSWER_CHARS = 500;

/** One vote may not carry more than this — an unbounded JSON body from an
 *  unauthenticated surface is a denial-of-service with extra steps. */
const MAX_RANKING_ITEMS = POLL_MAX_OPTIONS;

// ---------------------------------------------------------------------------
// The stored shape
// ---------------------------------------------------------------------------

/**
 * The poll's own configuration, as it sits in `question_sets.questions`.
 *
 * Stored in the JSONB column the table already has rather than in new columns: a poll's
 * instrument, its options and its axes are exactly what that column holds for every
 * other kind of question set, and adding `poll_format`/`poll_options`/`poll_axes`
 * columns would be per-feature DDL for a shape the table already models.
 *
 * A poll is ONE question by construction — that is what makes it a poll rather than a
 * form — so the array holds exactly one entry.
 */
interface StoredPoll {
  format: PollFormat;
  options: PollOption[];
  scaleMax: number | null;
  grid: { xLabel: string; yLabel: string } | null;
}

/**
 * Read the stored configuration back.
 *
 * Defensive by construction, for the same reason `readQuestions` is: the column is
 * JSONB, it can hold whatever an older writer put there, and what comes out of here is
 * rendered to a stranger's phone. A format the contract does not declare falls back to
 * `choice` rather than rendering a control nobody can answer.
 */
function readStoredPoll(raw: unknown): StoredPoll {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const row = (first && typeof first === 'object' ? first : {}) as Record<string, unknown>;
  const format: PollFormat = isPollFormat(row.format) ? row.format : 'choice';
  const options = Array.isArray(row.options)
    ? row.options.flatMap((item, index): PollOption[] => {
        if (!item || typeof item !== 'object') return [];
        const option = item as Record<string, unknown>;
        const label = typeof option.label === 'string' ? option.label.trim() : '';
        if (!label) return [];
        return [{
          id: typeof option.id === 'string' && option.id.trim() ? option.id.trim().slice(0, 64) : `o${index + 1}`,
          label: label.slice(0, 200),
          ...(option.correct === true ? { correct: true } : {}),
        }];
      }).slice(0, POLL_MAX_OPTIONS)
    : [];
  const scaleMax = Number(row.scaleMax);
  const grid = row.grid && typeof row.grid === 'object'
    ? {
        xLabel: String((row.grid as Record<string, unknown>).xLabel ?? '').slice(0, 80),
        yLabel: String((row.grid as Record<string, unknown>).yLabel ?? '').slice(0, 80),
      }
    : null;
  return {
    format,
    options,
    scaleMax: Number.isFinite(scaleMax) ? Math.min(POLL_SCALE_MAX, Math.max(POLL_SCALE_MIN, Math.round(scaleMax))) : null,
    grid,
  };
}

function asPollStatus(value: string, closesAt: Date | null): FormStatus {
  // A poll past its close instant reads as CLOSED even if nobody has swept it. The
  // instant is the promise; a sweep is an implementation detail, and "voting closes at
  // 14:30" must be true at 14:31 without one.
  if (closesAt != null && closesAt.getTime() <= Date.now()) return 'closed';
  return value === 'open' || value === 'closed' ? value : 'draft';
}

// ---------------------------------------------------------------------------
// Publishing and steering
// ---------------------------------------------------------------------------

export interface PublishPollInput {
  /** Present when re-publishing an edited poll. */
  questionSetId?: string;
  title: string;
  prompt?: string | null;
  format?: string;
  options?: unknown;
  scaleMax?: number | null;
  gridXLabel?: string | null;
  gridYLabel?: string | null;
  anonymous?: boolean;
  showResultsLive?: boolean;
  closesAt?: string | null;
  /** The canvas object this poll is the projection of. */
  objectId?: string | null;
  createdBy?: string | null;
}

export interface PublishPollResult {
  questionSetId: string;
  slug: string;
  status: FormStatus;
}

/**
 * Publish a poll: mint its address and OPEN voting.
 *
 * Opening is part of publishing, unlike a form, and that is the point of the primitive:
 * a facilitator presses one thing and the room can answer. A published-but-closed poll
 * would need a second press before anybody could vote, in front of the room, which is
 * exactly the moment a product must not ask for one.
 *
 * Idempotent on the slug for the same reason `publishForm` is: an address that changed
 * when the facilitator fixed a typo would break the link already on the screen.
 */
export async function publishPoll(db: Db, tenantId: number, input: PublishPollInput): Promise<PublishPollResult> {
  const title = String(input.title ?? '').trim().slice(0, 200);
  if (!title) throw new FormError('A poll needs a title — it is what the facilitator sees on the board.', 400);

  const format: PollFormat = isPollFormat(input.format) ? input.format : 'choice';
  const stored = readStoredPoll([{
    format,
    options: input.options,
    scaleMax: input.scaleMax,
    grid: input.gridXLabel != null || input.gridYLabel != null
      ? { xLabel: input.gridXLabel ?? '', yLabel: input.gridYLabel ?? '' }
      : null,
  }]);

  if (pollNeedsOptions(format) && stored.options.length < 2) {
    throw new FormError('A poll with fewer than two answerable options is not a question. Add the options the room chooses between.', 400);
  }
  if (format === 'quiz' && !stored.options.some((option) => option.correct)) {
    throw new FormError('A quiz needs a right answer — mark the correct option, or use a plain choice poll instead.', 400);
  }
  if (format === 'grid' && !(stored.grid?.xLabel && stored.grid.yLabel)) {
    throw new FormError('A 2x2 needs both axes named. An unlabelled grid is a scatter plot nobody can act on.', 400);
  }

  const closesAt = input.closesAt ? new Date(input.closesAt) : null;
  if (closesAt && Number.isNaN(closesAt.getTime())) throw new FormError('closesAt is not a date.', 400);

  const shared = {
    kind: POLL_QUESTION_SET_KIND,
    name: title,
    description: input.prompt?.trim().slice(0, 2000) ?? null,
    questions: [{
      id: POLL_QUESTION_KEY,
      format: stored.format,
      options: stored.options,
      scaleMax: stored.format === 'scale' ? stored.scaleMax ?? POLL_SCALE_DEFAULT : null,
      grid: stored.grid,
    }],
    status: 'open',
    // Defaults to ANONYMOUS, unlike a form. A room asked to vote where each other can
    // see votes differently, and the instrument exists to get the answer people would
    // give privately.
    anonymous: input.anonymous !== false,
    // Always the open audience: a poll is joined from a phone by whoever is in the room,
    // and the two other audiences (`workspace`, `namedRecipients`) both require an
    // identity the participant does not have. Fixed here rather than accepted from the
    // caller so a poll cannot be published into an audience that can never answer it.
    audienceKind: 'anyoneWithLink',
    showResultsLive: input.showResultsLive !== false,
    closesAt,
    objectId: input.objectId ?? null,
    updatedAt: new Date(),
  } as const;

  let row: { id: string; slug: string | null } | undefined;
  if (input.questionSetId) {
    [row] = await db
      .update(questionSets)
      .set(shared)
      .where(scopedToTenant(questionSets, tenantId, eq(questionSets.id, input.questionSetId)))
      .returning({ id: questionSets.id, slug: questionSets.slug });
    if (!row) throw new FormError('That poll does not exist in this workspace.', 404);
  } else {
    [row] = await db
      .insert(questionSets)
      .values({ tenantId, createdBy: input.createdBy ?? null, ...shared })
      .returning({ id: questionSets.id, slug: questionSets.slug });
  }
  if (!row) throw new FormError('The poll could not be published.', 500);

  let slug = row.slug;
  if (!slug) {
    slug = mintPublicSlug();
    await db
      .update(questionSets)
      .set({ slug })
      .where(scopedToTenant(questionSets, tenantId, eq(questionSets.id, row.id)));
  }

  return { questionSetId: row.id, slug, status: 'open' };
}

export interface PollStateInput {
  /** `open` resumes voting, `closed` stops it. A closed poll keeps its address so a
   *  late phone is told it closed rather than shown a broken link. */
  status?: 'open' | 'closed';
  /** Whether the room sees the running count. Independent of `status` — see the
   *  column's own note. */
  showResultsLive?: boolean;
}

/**
 * Steer a live poll.
 *
 * ONE function for both controls rather than `openPoll`/`closePoll`/`revealResults`,
 * because they are one write to one row and three functions would be three places to
 * forget the tenant scope. Which of them a caller is exercising is legible from the
 * body, and the route names them separately for the person pressing the button.
 */
export async function setPollState(
  db: Db,
  tenantId: number,
  questionSetId: string,
  input: PollStateInput,
): Promise<{ status: FormStatus; showResultsLive: boolean }> {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.status) patch.status = input.status;
  if (typeof input.showResultsLive === 'boolean') patch.showResultsLive = input.showResultsLive;
  // Re-opening clears a close instant that has already passed. Without this, pressing
  // "open" on a poll that timed out would write `status = 'open'` onto a row every
  // reader still resolves as closed — a control that reports success and changes
  // nothing, which is worse than one that refuses.
  if (input.status === 'open') patch.closesAt = null;

  const [row] = await db
    .update(questionSets)
    .set(patch)
    .where(scopedToTenant(questionSets, tenantId, eq(questionSets.id, questionSetId)))
    .returning({ status: questionSets.status, showResultsLive: questionSets.showResultsLive, closesAt: questionSets.closesAt });
  if (!row) throw new FormError('That poll does not exist in this workspace.', 404);
  return { status: asPollStatus(row.status, row.closesAt), showResultsLive: row.showResultsLive };
}

// ---------------------------------------------------------------------------
// Reading a poll
// ---------------------------------------------------------------------------

export interface ResolvedPoll {
  tenantId: number;
  questionSetId: string;
  poll: PublishedPoll;
  /** The stored configuration, INCLUDING the quiz answers `poll.options` withholds.
   *  Never sent anywhere; it is what the tally is counted against. */
  stored: StoredPoll;
}

/** The projection, with the quiz answers stripped unless they may be shown.
 *
 *  A quiz whose correct option is in the payload is a quiz with the answers printed on
 *  the back of the card — and the payload is what a participant's browser receives, so
 *  "the UI does not display it" is not a control. */
function project(
  row: {
    slug: string | null; name: string; description: string | null; status: string;
    anonymous: boolean; showResultsLive: boolean; closesAt: Date | null;
  },
  stored: StoredPoll,
  revealCorrect: boolean,
): PublishedPoll {
  const status = asPollStatus(row.status, row.closesAt);
  return {
    slug: row.slug ?? '',
    title: row.name,
    prompt: row.description,
    format: stored.format,
    options: stored.options.map(({ id, label, correct }) => ({
      id, label, ...(revealCorrect && correct ? { correct: true } : {}),
    })),
    scaleMax: stored.format === 'scale' ? stored.scaleMax ?? POLL_SCALE_DEFAULT : null,
    grid: stored.grid,
    status,
    anonymous: row.anonymous,
    showResultsLive: row.showResultsLive,
    closesAt: row.closesAt ? row.closesAt.toISOString() : null,
  };
}

const POLL_COLUMNS = {
  id: questionSets.id,
  tenantId: questionSets.tenantId,
  slug: questionSets.slug,
  name: questionSets.name,
  description: questionSets.description,
  questions: questionSets.questions,
  status: questionSets.status,
  anonymous: questionSets.anonymous,
  showResultsLive: questionSets.showResultsLive,
  closesAt: questionSets.closesAt,
} as const;

/**
 * Resolve a public poll address.
 *
 * A DECLARED cross-tenant read, exactly as `resolvePublicForm` is: a participant's phone
 * has no session and no tenant, so the slug is the credential and the ROW reports whose
 * it is. The correct answers are revealed only once voting has stopped.
 */
export async function resolvePublicPoll(db: Db, slug: string): Promise<ResolvedPoll | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean || clean.length > 64) return null;

  const [row] = await db
    .select(POLL_COLUMNS)
    .from(questionSets)
    .where(acrossTenants(
      questionSets,
      'share_token',
      eq(questionSets.slug, clean),
      eq(questionSets.kind, POLL_QUESTION_SET_KIND),
    ))
    .limit(1);
  if (!row) return null;

  const stored = readStoredPoll(row.questions);
  const status = asPollStatus(row.status, row.closesAt);
  return {
    tenantId: row.tenantId,
    questionSetId: row.id,
    stored,
    poll: project(row, stored, status === 'closed'),
  };
}

/** The same poll, read by somebody INSIDE the workspace — the facilitator's board.
 *  Tenant-scoped rather than slug-addressed, and the quiz answers are always visible:
 *  the person running the room is the person who wrote them. */
export async function readPoll(db: Db, tenantId: number, questionSetId: string): Promise<ResolvedPoll | null> {
  const [row] = await db
    .select(POLL_COLUMNS)
    .from(questionSets)
    .where(scopedToTenant(
      questionSets,
      tenantId,
      eq(questionSets.id, questionSetId),
      eq(questionSets.kind, POLL_QUESTION_SET_KIND),
    ))
    .limit(1);
  if (!row) return null;
  const stored = readStoredPoll(row.questions);
  return { tenantId: row.tenantId, questionSetId: row.id, stored, poll: project(row, stored, true) };
}

// ---------------------------------------------------------------------------
// Voting
// ---------------------------------------------------------------------------

export interface CastPollVoteInput {
  /**
   * The participant's own submission id, kept by their device.
   *
   * This is what makes one-vote-per-participant enforceable WITHOUT storing an
   * identity: it groups a person's answer to itself and to nothing else, and it is why
   * re-voting replaces rather than adds. A device that sends a new id every time can
   * vote twice — which is a limit worth naming rather than papering over with a
   * fingerprint, because a fingerprint is a column somebody eventually joins and the
   * promise an anonymous poll makes is that there is nothing to join.
   */
  submissionId: string;
  /** Raw from the participant's browser, shaped by the poll's format. */
  answer: unknown;
  /** The signed-in participant, when there is one. DISCARDED on an anonymous poll —
   *  the caller does not get to decide that, the poll does. */
  respondentRef?: string | null;
  submittedAt?: Date;
}

/** A vote is a uuid or nothing. Rejected rather than coerced, because a submission id
 *  the client invented in a different shape is the one that would collide. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Accept one vote, replacing this participant's previous one.
 *
 * Every rule that protects the promise the poll made is enforced here:
 *
 *  · a draft or closed poll takes nothing;
 *  · a blank answer is refused, per the format's own reading of blank;
 *  · a chosen option that is not on the ballot is refused, so a hand-rolled POST
 *    cannot invent a candidate the room never saw;
 *  · an ANONYMOUS poll discards the respondent even when the caller supplied one.
 */
export async function castPollVote(
  db: Db,
  resolved: ResolvedPoll,
  input: CastPollVoteInput,
): Promise<{ submissionId: string }> {
  const { poll, stored } = resolved;
  if (poll.status !== 'open') {
    throw new FormError(poll.status === 'closed' ? 'Voting has closed.' : 'This poll is not open yet.', 409);
  }
  if (!UUID.test(input.submissionId)) throw new FormError('Malformed participant id.', 400);
  if (pollAnswerIsEmpty(stored.format, input.answer)) throw new FormError('Choose an answer before sending it.', 400);

  const columns = voteColumns(stored, input.answer);
  const submittedAt = input.submittedAt ?? new Date();
  const respondentRef = poll.anonymous ? null : (input.respondentRef ?? null);

  await db
    .insert(responses)
    .values({
      tenantId: resolved.tenantId,
      questionSetId: resolved.questionSetId,
      submissionId: input.submissionId,
      respondentKind: respondentRef ? 'user' : 'anonymous',
      respondentRef,
      questionKey: POLL_QUESTION_KEY,
      ...columns,
      submittedAt,
    })
    // Changing your mind REPLACES your vote. The unique index this targets is partial
    // (`submission_id is not null`), so the same statement cannot collide with the
    // scorecard rows in this table that carry no submission — see migration 1103.
    .onConflictDoUpdate({
      target: [responses.questionSetId, responses.submissionId, responses.questionKey],
      targetWhere: isNotNull(responses.submissionId),
      set: { ...columns, respondentKind: respondentRef ? 'user' : 'anonymous', respondentRef, submittedAt },
    });

  return { submissionId: input.submissionId };
}

/**
 * One answer → the right typed column.
 *
 * By the poll's DECLARED format and never by what the value looks like, which is the
 * same rule `answerColumns` follows for a form and for the same reason: `responses`
 * carries a column per type so an aggregate is an aggregate, and inferring the column
 * from the value is how a scale ends up averaging strings.
 */
function voteColumns(stored: StoredPoll, raw: unknown): {
  valueText: string | null; valueNumber: string | null; valueJson: unknown;
} {
  const optionIds = new Set(stored.options.map((option) => option.id));
  const onBallot = (id: string): string => {
    if (!optionIds.has(id)) throw new FormError('That option is not on this poll.', 400);
    return id;
  };

  switch (stored.format) {
    case 'choice':
    case 'quiz':
      return { valueText: onBallot(String(raw)), valueNumber: null, valueJson: null };
    case 'multiChoice':
    case 'ranking': {
      const list = (Array.isArray(raw) ? raw : []).map((item) => onBallot(String(item))).slice(0, MAX_RANKING_ITEMS);
      // De-duplicated for `multiChoice` (one participant, one count per option) and
      // for `ranking` (an option cannot be both third and fifth). Same statement,
      // because both readings of a repeated id are "they meant it once".
      return { valueText: null, valueNumber: null, valueJson: [...new Set(list)] };
    }
    case 'scale': {
      const max = stored.scaleMax ?? POLL_SCALE_DEFAULT;
      const value = Math.round(Number(raw));
      if (!Number.isFinite(value) || value < 1 || value > max) {
        throw new FormError('That answer is outside the scale.', 400);
      }
      return { valueText: null, valueNumber: String(value), valueJson: null };
    }
    case 'grid': {
      const point = (raw && typeof raw === 'object' ? raw : {}) as { x?: unknown; y?: unknown };
      const x = Number(point.x);
      const y = Number(point.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new FormError('That placement is not a point.', 400);
      return {
        valueText: null,
        valueNumber: null,
        valueJson: { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) },
      };
    }
    default:
      return { valueText: String(raw ?? '').trim().slice(0, MAX_TEXT_ANSWER_CHARS), valueNumber: null, valueJson: null };
  }
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

/**
 * Count a poll's votes.
 *
 * ── WHY THIS IS NOT CACHED ───────────────────────────────────────────────────
 * Every other read-heavy path on this platform serves through `getOrSetCached`, and this
 * one deliberately does not: a poll's tally is being projected onto a wall while people
 * are voting, and a cached tally is not a stale number, it is a WRONG one — the room
 * watches the count not move and concludes the product is broken. The read is bounded
 * (`POLL_TALLY_CAP`), indexed (`idx_responses_set_submitted`), and lives for the minutes
 * a poll is open. Caching it would trade the only property it has for nothing.
 *
 * The COUNTING itself is the contract's `tallyPollVotes` rather than SQL aggregates: the
 * board, the phone and this function must not disagree about what share chose B, and
 * three implementations of one rule is three answers to it.
 */
export async function tallyPoll(db: Db, resolved: ResolvedPoll, options: { revealCorrect?: boolean } = {}): Promise<PollTally> {
  const rows = await db
    .select({
      valueText: responses.valueText,
      valueNumber: responses.valueNumber,
      valueJson: responses.valueJson,
    })
    .from(responses)
    .where(scopedToTenant(
      responses,
      resolved.tenantId,
      and(eq(responses.questionSetId, resolved.questionSetId), eq(responses.questionKey, POLL_QUESTION_KEY)),
    ))
    .orderBy(desc(responses.submittedAt))
    .limit(POLL_TALLY_CAP + 1);

  const truncated = rows.length > POLL_TALLY_CAP;
  const votes: PollVote[] = rows.slice(0, POLL_TALLY_CAP).map((row) => ({
    text: row.valueText,
    number: row.valueNumber == null ? null : Number(row.valueNumber),
    json: row.valueJson,
  }));

  return tallyPollVotes(
    { format: resolved.stored.format, options: resolved.stored.options, scaleMax: resolved.stored.scaleMax },
    votes,
    { ...(options.revealCorrect ? { revealCorrect: true } : {}), truncated },
  );
}

/** How many people have answered, without reading their answers.
 *
 *  A separate aggregate rather than `tally.responseCount` because the board's card shows
 *  the number far more often than it shows the shape, and loading every vote to produce
 *  one integer is the unbounded-result-set anti-pattern the platform rejects. */
export async function pollResponseCount(db: Db, tenantId: number, questionSetId: string): Promise<number> {
  const [row] = await db
    .select({ value: sql<number>`count(distinct ${responses.submissionId})` })
    .from(responses)
    .where(scopedToTenant(responses, tenantId, eq(responses.questionSetId, questionSetId)));
  return Number(row?.value ?? 0);
}

/** The empty tally for a poll nobody has answered — exported so a caller with no votes
 *  to read still draws the instrument waiting rather than a blank card. */
export { emptyPollTally };
