/**
 * The CAREER vocabulary — the job search, as objects rather than as prose.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Twenty-five career tools ship in `careerToolCatalog.ts` and every one of them
 * COMPUTES an answer: `hr.runway` returns weeks-to-zero with the month-by-month
 * projection behind it, `recruiter.tailor_resume` returns an anchored move list against
 * one posting, `recruiter.interview_questions` returns a rubric per question,
 * `proposals.mine` returns the whole application pipeline. Measured 2026-08-19, the
 * canvas had nowhere to put a single one of them: no `job`, no `jobApplication`, no
 * `applicationPipeline`, no `runway`, no `coverLetter`, no `interviewPrep` — and no
 * `timecard`, so the one seat where REAL means money arriving could not bill for work.
 *
 * So every one of those answers landed as prose inside a `document` and stopped being
 * an object the next turn could reason over. That is precisely the defect the founder
 * object set was created to fix one seat across — a `kpi` whose value was authorable
 * and unreadable — reproduced for the seat with the largest number of visitors and the
 * least amount of company behind them.
 *
 * ── WHY THIS IS NOT `HIRING_OBJECT_KINDS` ────────────────────────────────────────
 * The hiring vocabulary is the EMPLOYER's funnel: `candidate`, `talentPool`,
 * `jobPosting`, `shortlist`, `interviewLoop`, `scorecard`, `offer`, `placement`. Every
 * one of those is authored by somebody deciding about somebody else, and `candidate`
 * carries regulated data with two opposite retention clocks — which is why it is the
 * only kind on the canvas that declares a `restricted` field.
 *
 * This vocabulary is the SAME TRANSACTION FROM THE OTHER SIDE, and the two are not
 * interchangeable in either direction:
 *
 *   • A `jobPosting` is a requisition WE opened. A `job` is a posting SOMEONE ELSE
 *     opened that a person is deciding whether to chase — it is research, it is not
 *     ours to edit, and its most important fields (why it is a fit, what is missing,
 *     the compensation actually advertised) have no home on a requisition.
 *   • A `shortlist` ranks N people against ONE posting. An `applicationPipeline` ranks
 *     ONE person's N applications — the transpose, and the only object that answers
 *     "which nine of these am I still waiting on".
 *   • `HIRING_OBJECT_KINDS.offer` is the offer WE extended, with the approval chain and
 *     the budget behind it. The offer a seeker RECEIVES is read through
 *     `jobApplication.offerTerms` and compared with `hr.compare_offers`; it is the same
 *     noun and a different object, so the seeker side does not take the word.
 *
 * ── `jobApplication` PROJECTS, IT DOES NOT COPY ──────────────────────────────────
 * `job_postings.postingType` already accepts `'fte'` and `job_proposals` already runs
 * submitted → shortlisted → accepted → declined → withdrawn, so a job application on
 * this platform IS a proposal on an FTE posting — the argument `application/career/
 * listing.ts` makes in full. `jobApplication.proposalRef` names that row and
 * `stage`/`submittedAt`/`lastResponseAt` are hydrated from it by `proposals.mine`.
 * Storing a second copy of a lifecycle the marketplace already owns is the 3NF
 * violation that produces two answers to "did I hear back".
 *
 * ── `interviewPrep`, AND THE WORD THAT WAS NOT AVAILABLE ─────────────────────────
 * `interview` is reserved: the hiring domain registers a JOB interview under
 * `kind: 'interview'` in the kernel `objects` table, which is why the founder set gave
 * up the bare noun and renamed itself `customerInterview`. A third claimant would
 * re-open exactly the collision that rename closed. `interviewPrep` is not a
 * compromise spelling — it names the right thing: this object is the REHEARSAL that
 * persists between sessions, not the event, and it is authored before the event exists.
 *
 * ── WHY `runway` IS A CAREER KIND AND NOT A FINANCE ONE ──────────────────────────
 * `FOUNDER_OBJECT_KINDS` has `budget` and `forecast`, which model a COMPANY's money:
 * approved once a year, compared against, owned by somebody with a finance seat. A
 * personal runway is one number — weeks until the balance reaches zero — and it is the
 * number that governs every other decision in a job search, because under about
 * thirteen weeks taking contract work while interviewing beats holding out. Modelling
 * it as a one-line `budget` would put a person's savings under an object designed for
 * departmental approval, and the field that matters (`weeksRemaining`) would be
 * derivable from nothing on the card.
 */

/**
 * The seeker's objects, in the order a job search actually runs.
 *
 * Seven kinds. The first six are bound to the tool that fills them; `timecard`
 * projects a row the platform already keeps. One more was considered and refused: a `reference` kind for the people who will vouch. `references.ts` returns a
 * brief rather than a record, the platform stores nothing about a referee, and a card
 * holding a private individual's name and phone number on a guest board with no access
 * control is the argument `creationPaletteGroupsFor` already makes about restricted
 * kinds. It stays inside `coverLetter.referees` as authored text until there is a
 * lawful home for it.
 */
export const CAREER_OBJECT_KINDS = [
  // A POSTING SOMEONE ELSE OPENED. The research object: what the role is, what it pays
  // as ADVERTISED (never as guessed), the requirements as stated, and the honest read
  // on fit. Bound to `recruiter.match_job` and `jobs.get`.
  'job',
  // ONE APPLICATION, WITH ITS LIFECYCLE. A projection of a `job_proposals` row, not a
  // second copy of it — see the header. This is the object that makes a follow-up date
  // a thing the board can warn about rather than a thing somebody remembers.
  'jobApplication',
  // ALL OF THEM AT ONCE. The transpose of a `shortlist`: one person's applications with
  // their stages, their ages and the one that has gone quiet longest. Bound to
  // `proposals.mine`.
  'applicationPipeline',
  // THE LETTER. Its own kind rather than a `document` because it is written AGAINST a
  // posting and re-written per application, and because the openings a person reuses are
  // the part worth keeping — a `document` cannot say which posting it answered.
  'coverLetter',
  // THE REHEARSAL, PERSISTED. Questions with the rubric each is scored against, the
  // gaps the posting exposes, and the answers the person has actually drafted. Bound to
  // `recruiter.interview_questions` and `hr.interview_coaching`.
  'interviewPrep',
  // THE CLOCK EVERY OTHER DECISION IS PACED AGAINST. Bound to `hr.runway` and
  // `hr.compare_work_options`.
  'runway',
  // THE HOURS, AND WHAT THEY ARE WORTH. A projection of a `timecards` row, which has had
  // routes, a lifecycle (draft → submitted → approved → rejected → paid) and a
  // freelancer dashboard the whole time and no canvas surface at all — so the one seat
  // where "idea → REAL" ends in money arriving could draft the agreement on the board
  // and had to leave it to bill for the work.
  //
  // IN THIS VOCABULARY AND NOT THE FOUNDER ONE, though it is unambiguously money: an
  // `invoice` is what a COMPANY sends and it already exists over `freelancer_invoices`.
  // A timecard is the hours ONE PERSON worked, submitted for somebody else's approval —
  // the same side of the transaction as `jobApplication`, and the same relationship to
  // its row: the lifecycle lives in the table, and the card projects it.
  'timecard',
] as const;

export type CareerObjectKind = typeof CAREER_OBJECT_KINDS[number];

const CAREER_KIND_SET: ReadonlySet<string> = new Set<string>(CAREER_OBJECT_KINDS);

/** True for the career objects declared above — the set `careerObjects.ts` specs. */
export function isCareerObjectKind(value: unknown): value is CareerObjectKind {
  return typeof value === 'string' && CAREER_KIND_SET.has(value);
}

/**
 * The application stages, in lifecycle order.
 *
 * These are `job_proposals`' own states plus the two a SEEKER lives through that the
 * employer-side row has no reason to record: `drafting` (composed, not sent — the
 * single most common state on any real job board) and `interviewing` (shortlisted and
 * scheduled, which on the employer side is an `interviewLoop` and on the seeker side is
 * just where you are). Ordered so a pipeline can sort by progress without a lookup
 * table somewhere else.
 */
export const CAREER_APPLICATION_STAGES = [
  'drafting', 'submitted', 'shortlisted', 'interviewing', 'offered', 'accepted', 'declined', 'withdrawn', 'noReply',
] as const;

export type CareerApplicationStage = typeof CAREER_APPLICATION_STAGES[number];

/**
 * The timecard lifecycle, exactly as `timecards.status` stores it.
 *
 * Restated here rather than imported because the canvas must be able to READ a card
 * authored offline, and duplicated deliberately in the one direction that is safe: this
 * list may lag the table by a value and still work (an unknown status renders as itself),
 * whereas a canvas that could not name the statuses at all would have to treat the field
 * as free text and lose the ordering that makes "what is still waiting on approval"
 * answerable.
 */
export const TIMECARD_STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'paid'] as const;

export type TimecardStatus = typeof TIMECARD_STATUSES[number];

/** Statuses where the money has NOT yet arrived. Exported so the card's own derivation
 *  and any consumer counting "outstanding" cannot disagree about the word. */
const UNPAID_TIMECARD_STATUSES: ReadonlySet<string> = new Set<string>(['draft', 'submitted', 'approved']);

/** True while this timecard is still owed. `rejected` is NOT outstanding — nothing is
 *  owed on work that was refused, and counting it would inflate the one number a
 *  freelancer checks. */
export function isTimecardOutstanding(status: unknown): boolean {
  return UNPAID_TIMECARD_STATUSES.has(String(status ?? '').trim());
}

/** Stages after which nothing more will happen. Read by the pipeline's derivations, so
 *  "still waiting on" means the same thing everywhere it is counted. */
const CLOSED_STAGES: ReadonlySet<string> = new Set<string>(['accepted', 'declined', 'withdrawn', 'noReply']);

/** True when an application is still live — i.e. worth chasing. Exported because BOTH
 *  the pipeline card's derivations and any consumer counting "open applications" must
 *  agree, and two spellings of "is this still alive" is how a dashboard comes to
 *  disagree with the list printed under it. */
export function isOpenApplicationStage(value: unknown): boolean {
  const stage = String(value ?? '').trim();
  return stage.length > 0 && !CLOSED_STAGES.has(stage);
}

/**
 * The runway pressure bands, and the boundary each one starts at, in WEEKS.
 *
 * Copied from nothing — `application/career/runway.ts` computes the same bands
 * server-side, and this is the one place the canvas may restate them so a `runway` card
 * authored offline (a guest, with no tenant and no API call) lands in the same band the
 * tool would have put it in. The alternative was a card that says "critical" until a
 * tool call re-grades it, which is a card that lies to the person it is most urgent for.
 *
 * `null` weeks — income covers expenses — is `none`, and is deliberately not zero: a
 * runway that never runs out and a runway that ran out this morning are the two answers
 * a single number cannot tell apart.
 */
export const CAREER_RUNWAY_BANDS = [
  { band: 'critical', maxWeeks: 4 },
  { band: 'urgent', maxWeeks: 13 },
  { band: 'planning', maxWeeks: 26 },
  { band: 'comfortable', maxWeeks: 52 },
] as const;

export type CareerRunwayBand = 'none' | typeof CAREER_RUNWAY_BANDS[number]['band'];

/** The band a number of weeks falls in. `null`/absent weeks means income covers the
 *  outgoings, which is `none` rather than the best-graded band — nothing is burning. */
export function careerRunwayBand(weeks: unknown): CareerRunwayBand | undefined {
  if (weeks == null || weeks === '') return 'none';
  const value = typeof weeks === 'number' ? weeks : Number(String(weeks).replace(/[^0-9.-]/g, ''));
  if (!Number.isFinite(value)) return undefined;
  for (const entry of CAREER_RUNWAY_BANDS) if (value < entry.maxWeeks) return entry.band;
  return 'comfortable';
}
