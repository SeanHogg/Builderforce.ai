/**
 * Spec-driven kinds that belong to NO single family.
 *
 * ── WHY THIS MODULE EXISTS AT ALL ────────────────────────────────────────────────
 * Two canvas reviews on the same day asked for the same object from opposite ends of
 * the company. Marketing: "sends, clicks and pipeline never join, so ROI is unanswerable
 * on the board." Recruiting: "nothing measures the funnel — no source-of-hire, no stage
 * conversion, no time-to-hire." Those are one object. Building `marketingFunnel` and
 * `hiringFunnel` would have been the twenty-fourth intra-product duplicate the data-model
 * analysis found, created knowingly, on the day it was pointed out.
 *
 * So there is ONE `funnel`, and which funnel a card is bound to is a VALUE
 * (`funnelDomain`) rather than a kind. That is the same open/closed answer migration
 * 0410 gave for connector vendors and `CREATION_OBJECT_KINDS` gives for media types: a
 * new funnel is data, not DDL and not a render branch.
 *
 * A kind belongs here when it is genuinely cross-domain. A kind that only looks generic
 * because nobody has written the second consumer yet belongs to its family.
 */

import { registerSpecObjectSet, SUMMARY_FIELD, type SpecObjectSpec } from './specObjects';
// The cadence arithmetic — enrolled, replied, per-state progress — computed in the
// contract because the runner on the server and the card on the board must not disagree
// about how far through a sequence somebody is.
import { sequenceProgress } from '@builderforce/creation-canvas-contract';

/**
 * Rows out of a `rows` field, whatever the model wrote there.
 *
 * A `rows` value arrives as an array of objects when the model behaves and as
 * anything at all when it does not, and a `derive` that throws takes the whole card
 * down. So every derivation below reads through this rather than trusting the shape.
 */
function rowsOf(value: unknown): ReadonlyArray<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    : [];
}

/** Words in a cell. Whitespace-split, which is close enough for a manuscript figure
 *  and honest about being an estimate rather than a typesetter's count. */
function wordsIn(value: unknown): number {
  return typeof value === 'string' ? value.trim().split(/\s+/).filter(Boolean).length : 0;
}

/** A finite number out of a cell, or nothing. An empty cell is NOT zero. */
function numberIn(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * `poll.correctRate` — share of the room that answered a quiz correctly, 0-100.
 *
 * THE ONE THING THE TEACHING `poll` HAD THAT THIS ONE DID NOT. When the two declarations
 * of `poll` were folded into this kind, everything else the lecture version held had an
 * equivalent here — `question`→`prompt`, `choices`→`options`, `anonymity`→`anonymous`,
 * `responses`→`results` — except the number a lecturer actually acts on. Its old hint
 * said it: under about 30% means re-teach now, not next week. Dropping it in the fold
 * would have made "one kind for every room" cost the teaching room its only metric.
 *
 * Matched on the option LABEL rather than on an index, because `results` is a labelled
 * distribution here and not a positional array — an index into a bar chart whose order
 * the surface owns is exactly the kind of join that silently reports the wrong number.
 * `undefined` on an opinion poll, which has no right answer to be right about.
 */
function derivePollCorrectRate(data: Record<string, unknown>): number | undefined {
  const correct = new Set(rowsOf(data.options)
    .filter((option) => option.correct === true || String(option.correct ?? '').toLowerCase() === 'true')
    .map((option) => String(option.label ?? '').trim().toLowerCase()));
  if (!correct.size) return undefined;
  const bars = rowsOf(data.results);
  let hit = 0;
  let total = 0;
  for (const bar of bars) {
    const value = numberIn(bar.value);
    if (value === undefined) continue;
    total += value;
    if (correct.has(String(bar.label ?? '').trim().toLowerCase())) hit += value;
  }
  return total > 0 ? Math.round((hit / total) * 100) : undefined;
}

/** i18n namespace for every cross-domain label, status, field and column. */
export const SHARED_NAMESPACE = 'creationCanvas.shared';

export const SHARED_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ── THE ONE MULTI-TOUCH CADENCE ─────────────────────────────────────────────
  // Two of these shipped independently — a seller's `sequence` and a recruiter's
  // `outreachSequence` — and a third was about to be written for a job seeker. Same
  // object all three times: ordered steps with a channel and a delay, an audience,
  // stop-on-reply, a reply rate. `direction` is what collapses them, exactly as
  // `funnelDomain` collapses the marketing and hiring funnels below.
  //
  // Filed under `Integrations` rather than `Revenue` (where the seller's version lived)
  // or `Hiring` (where the recruiter's did): a kind can only be in one palette section,
  // and the section holding `inbox`, `emailCampaign` and `socialCampaign` is the one
  // every seat already opens when the question is "reach somebody", which is the only
  // section all three of its audiences have a reason to look in.
  {
    kind: 'sequence',
    icon: '⇉',
    group: 'Integrations',
    defaultStatus: 'draft',
    // `start`/`pause` change whether the runner sends, and `enrol` adds real people to a
    // real send list — all three reach outside the tenant, so all three are gated. The
    // deliberate asymmetry: STOPPING is never gated, because a control that needs
    // approval to stop is not a safety control.
    actions: ['start', 'pause', 'stop', 'enrol'],
    fields: [
      {
        name: 'direction', render: 'stat', label: 'direction',
        hint: 'Which conversation this cadence belongs to: sales | hiring | seeking | support. It decides whose list `enrol` draws from and what the copy is allowed to promise, and it is the field that lets ONE cadence object serve a seller chasing a prospect, a recruiter chasing a candidate and a person chasing their own applications. Defaults to `sales` when absent; a board migrated from the old `outreachSequence` kind is `hiring`.',
      },
      {
        name: 'sequenceState', render: 'stat', label: 'sequenceState',
        hint: 'draft | running | paused | stopped | completed. Only `running` causes the runner to send anything — a paused cadence keeps its cursor so resuming does not re-send day 0.',
        bookkeeping: true,
      },
      {
        name: 'audience', render: 'stat', label: 'audience',
        hint: 'Who this cadence is for, in one line — "Series-A founders who opened the pricing page". What makes the copy specific enough to answer.',
      },
      {
        name: 'steps', render: 'rows', label: 'steps',
        columns: ['dayOffset', 'channel', 'subject'],
        hint: 'The cadence: {dayOffset, channel, subject, body}. `dayOffset` is days after ENROLMENT (0 = immediately), so a missed runner tick catches up instead of sliding the whole cadence. `channel` is email | social | call | sms | task — each one a port this workspace already has connected. Four to six steps ending in a breakup is the shape that works; twelve is the shape that gets you blocked.',
      },
      {
        name: 'stopOnReply', render: 'stat', label: 'stopOnReply',
        hint: 'Whether a reply on ANY channel halts the cadence for that person. Default true, and turning it off should be a decision somebody defends — this is the property that separates a sequence from a mail blast.',
      },
      {
        name: 'enrolments', render: 'rows', label: 'enrolments',
        columns: ['name', 'contactRef', 'stepsSent', 'repliedAtISO'],
        hint: 'Who is in it and how far they have got. READ-ONLY: this is the runner\'s CURSOR, and a model editing it could re-send a breakup email to somebody who already replied — the one outreach failure that loses a deal outright. Use the enrol action to add people.',
        derived: true,
      },
      {
        name: 'enrolled', render: 'stat', label: 'enrolled',
        hint: 'How many people are in the cadence. Computed from the enrolments.',
        derive: (data) => {
          const progress = sequenceProgress({ steps: data.steps, enrolments: data.enrolments });
          return progress.enrolled > 0 ? progress.enrolled : undefined;
        },
      },
      {
        name: 'replyRate', render: 'meter', label: 'replyRate',
        hint: 'Replies as a share of enrolments, 0-100. Computed — and `undefined` rather than 0 when nobody is enrolled, because a 0% reply rate on an empty sequence reads as a catastrophe and is an absence of data.',
        derive: (data) => sequenceProgress({ steps: data.steps, enrolments: data.enrolments }).replyRatePercent,
      },
      {
        name: 'sequenceProgress', render: 'bars', label: 'sequenceProgress',
        hint: 'Where everybody is: replied, stopped, completed, still running. Computed from the enrolments and the step list.',
        derive: (data) => {
          const progress = sequenceProgress({ steps: data.steps, enrolments: data.enrolments });
          if (progress.enrolled === 0) return undefined;
          const inFlight = progress.enrolled - progress.replied - progress.stopped - progress.completed;
          return [
            { label: 'replied', value: progress.replied },
            { label: 'completed', value: progress.completed },
            { label: 'stopped', value: progress.stopped },
            { label: 'inFlight', value: Math.max(0, inFlight) },
          ].filter((bar) => bar.value > 0);
        },
      },
      {
        name: 'lastRunAt', render: 'stat', label: 'lastRunAt',
        hint: 'ISO instant the runner last swept this cadence. Written by the sweep — a cadence whose last run is days old is one nothing is driving, and that is worth seeing on the card.',
        derived: true,
      },
      SUMMARY_FIELD,
    ],
  },

  // ── THE FACILITATION PRIMITIVE ──────────────────────────────────────────────
  // A question put to a ROOM. Cross-domain in the strongest sense on this list: a
  // retro, a planning estimate, a class check-for-understanding, a customer workshop
  // and an all-hands Q&A are ONE object put to five rooms. Which INSTRUMENT it is —
  // ballot, word cloud, ranking, 1-to-5, 2x2, quiz — is `pollFormat`, for the same
  // reason `funnelDomain` is a value below.
  //
  // It is NOT a `form`, and the distinction is the whole feature: a form is answered
  // on somebody's own time and read later; a poll is answered by a room at once and
  // read WHILE it is being answered. Same store (`question_sets` + `responses` with
  // kind='poll' — the collection primitive's, not a second one), different object.
  {
    kind: 'poll',
    icon: '▁▄█',
    group: 'Collaborate',
    defaultStatus: 'draft',
    // `publish` mints the join address and opens voting — it puts a live URL in front
    // of a room, so it is the one gated act. `open`/`close` steer voting and `reveal`
    // shows the room the count; none of the three reaches outside the workspace, and a
    // control that needs approval to CLOSE a poll is not a control.
    actions: ['publish', 'open', 'close', 'reveal'],
    // A fresh poll is a BALLOT with two blank options, because that is the instrument
    // nine rooms out of ten want and an option list is the one thing a facilitator
    // cannot start without. `anonymous` and `showResultsLive` are seeded to their
    // defaults rather than left absent so the card states what it will do BEFORE it is
    // published — an unstated anonymity setting is one nobody checks until afterwards.
    seed: {
      pollFormat: 'choice',
      anonymous: true,
      showResultsLive: true,
      options: [{ id: 'a', label: '' }, { id: 'b', label: '' }],
    },
    fields: [
      {
        name: 'prompt', render: 'text', label: 'prompt',
        hint: 'What the room is being asked, in the words THEY read. It is the only text on a participant\'s phone above the answer control, so a prompt that assumes the slide behind you gets answered by the people who can see it and nobody else.',
      },
      {
        name: 'pollFormat', render: 'stat', label: 'pollFormat',
        hint: 'The instrument: choice | multiChoice | scale | ranking | wordCloud | openText | quiz | grid. It decides what a participant is asked to DO and how the answers are COUNTED, and it is the field that lets one object be a ballot, a word cloud and a 2x2. Defaults to `choice`.',
      },
      {
        name: 'options', render: 'rows', label: 'pollOptions', columns: ['id', 'label', 'correct'],
        hint: 'The answerable options: {id, label, correct}. Required for choice, multiChoice, ranking and quiz; ignored by the others. `id` is stable — votes are stored against it, so renaming an id after voting starts orphans every vote already cast. `correct` is quiz-only and is NEVER sent to a phone before the poll closes.',
      },
      {
        name: 'scaleMax', render: 'stat', label: 'scaleMax',
        hint: 'Scale polls only: the top of the 1..N range, 2-10. Defaults to 5. A scale of 11 is a slider no two people read the same way.',
      },
      {
        name: 'gridXLabel', render: 'stat', label: 'gridXLabel',
        hint: 'Grid (2x2) polls only: what the horizontal axis means, e.g. "Effort". An unlabelled 2x2 is a scatter plot nobody can act on.',
      },
      {
        name: 'gridYLabel', render: 'stat', label: 'gridYLabel',
        hint: 'Grid (2x2) polls only: what the vertical axis means, e.g. "Impact".',
      },
      {
        name: 'anonymous', render: 'stat', label: 'pollAnonymous',
        hint: 'true | false. An IDENTITY setting, not a privacy one — the same distinction `form` draws. When true the vote is stored with NO respondent reference at all, even for a signed-in participant. A retro is anonymous; a team estimate usually is not. Defaults to true, because a room asked to vote in front of each other votes differently.',
      },
      {
        name: 'showResultsLive', render: 'stat', label: 'showResultsLive',
        hint: 'true | false. Whether the ROOM sees the running count on their own phones. Independent of whether voting is open, deliberately: a facilitator hides the count while people vote so the first three answers do not decide the rest, then reveals it with voting still open. Defaults to true.',
      },
      {
        name: 'closesAt', render: 'stat', label: 'closesAt',
        hint: 'ISO instant voting closes on its own. Optional — most polls are closed by the person running the room, and a poll with no close date is not late, it is live.',
      },
      {
        name: 'joinUrl', render: 'stat', label: 'joinUrl',
        hint: 'The public address a phone joins at. Written by the publish action; read it out or put it on the slide.',
        derived: true,
      },
      {
        name: 'responseCount', render: 'stat', label: 'pollResponseCount',
        hint: 'How many people have answered. Counted per SUBMISSION, which is what makes it countable on an anonymous poll.',
        derived: true,
      },
      {
        name: 'results', render: 'bars', label: 'pollResults',
        hint: 'The counted answers: [{label, value}]. Written by the facilitation surface from the live tally — never authored, because a result somebody typed is not a result.',
        derived: true,
      },
      {
        name: 'answers', render: 'list', label: 'pollAnswers',
        hint: 'Open-text and Q&A answers, newest first. Empty for every counted format — a ballot has a count, not a transcript.',
        derived: true,
      },
      {
        name: 'correctRate', render: 'meter', label: 'pollCorrectRate',
        hint: 'Quiz polls only: the share of the room that answered correctly, 0-100, computed from the results against the options marked `correct`. Under about 30% means re-teach now, not next week. Absent on every other format, which has no right answer to be right about.',
        derive: derivePollCorrectRate,
      },
      SUMMARY_FIELD,
    ],
  },

  {
    kind: 'funnel',
    icon: '⧗',
    group: 'Insights',
    defaultStatus: 'notMeasured',
    actions: ['measure', 'refresh', 'drill'],
    fields: [
      {
        name: 'funnelDomain',
        render: 'stat',
        label: 'funnelDomain',
        hint: 'Which funnel this measures: hiring | growth | revenue | support. Decides which domain the refresh action reads its stage counts from, so it is required before the card can be anything but authored numbers.',
      },
      {
        name: 'stages',
        render: 'rows',
        label: 'stages',
        columns: ['stage', 'entered', 'exited', 'conversion', 'medianDays'],
        hint: 'One row per stage, in funnel order: {stage, entered, exited, conversion, medianDays}. `conversion` is the percentage of THIS stage that reached the NEXT one — the number that localises a loss, which a cumulative percentage cannot. `medianDays` is time-in-stage and is where a stall shows up before the conversion does.',
      },
      {
        name: 'sourceBreakdown',
        render: 'rows',
        label: 'sourceBreakdown',
        columns: ['source', 'entered', 'converted', 'rate'],
        hint: 'Conversion split by where the entry came from: {source, entered, converted, rate}. This is the row that answers "which channel actually works", and it is the reason budget stops going to the channel someone remembers.',
      },
      { name: 'totalEntered', render: 'stat', label: 'totalEntered', hint: 'Everyone who entered the funnel in the window.', bookkeeping: true },
      { name: 'totalConverted', render: 'stat', label: 'totalConverted', hint: 'Everyone who reached the terminal stage in the window.', bookkeeping: true },
      { name: 'overallConversion', render: 'meter', label: 'overallConversion', hint: '0-100 end-to-end conversion.', bookkeeping: true },
      { name: 'medianCycleDays', render: 'stat', label: 'medianCycleDays', hint: 'Median days from entry to terminal stage — time-to-hire for a hiring funnel, sales-cycle length for a revenue one.', bookkeeping: true },
      { name: 'dateRange', render: 'stat', label: 'dateRange', hint: 'The window measured, e.g. "last 90 days". A funnel with no window is a funnel nobody can reproduce.', bookkeeping: true },
      { name: 'bottleneck', render: 'verdict', label: 'bottleneck', hint: 'The single stage losing the most, named, with the number behind it. One stage — a list of three is a report, and this field is a decision.' },
      { name: 'fetchedAt', render: 'stat', label: 'fetchedAt', hint: 'ISO instant the counts were read.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  {
    // ── THE PUBLICATION PRIMITIVE ────────────────────────────────────────────────
    // A book is not a longer `document`. A document is read on a screen and is done;
    // a book carries a cover, an ordered page list, numbered figures and a print
    // edition, and each of those is a thing the paged harness asks a question about
    // before it may be sold. Adding it as a `document` variant would have meant the
    // print checks either ran on every document or on none.
    kind: 'book',
    icon: '📖',
    // `Knowledge`, beside `document`, because that is where a reader looks for the
    // longer form of the thing they already know how to make. It declared `Create`,
    // which is not a palette section — see the note on `SpecObjectSpec.group`, which is
    // typed now so the next one is a compile error rather than a hidden object.
    group: 'Knowledge',
    defaultStatus: 'manuscript',
    actions: ['read', 'proof', 'export'],
    fields: [
      { name: 'author', render: 'stat', label: 'author', hint: 'Whose name goes on the cover, as it should be printed. Not the account that made it — a ghostwritten book has two different answers and only one of them belongs here.' },
      { name: 'coverImageUrl', render: 'reference', label: 'coverImageUrl', hint: 'The cover artwork. For a print edition it must be 300 dpi at trim size (2480 x 3508 for A4) — the paged harness measures it and refuses the print output below that, because a 72 dpi cover is only discovered after somebody has paid for a parcel.' },
      { name: 'coverDpi', render: 'stat', label: 'coverDpi', hint: 'Effective resolution of the cover at trim size. Write the measured number, not the intent.' },
      {
        name: 'pages', render: 'rows', label: 'pages', columns: ['page', 'heading', 'body', 'figure'],
        hint: 'The book, in order: {page, heading, body, figure}. `page` is the printed folio and must be unique and contiguous — a gap is a page nobody wrote. `figure` names a figure from `figures` by its ref, or is empty. An entry with no body and no figure is an empty page and blocks publication.',
      },
      {
        name: 'figures', render: 'rows', label: 'figures', columns: ['ref', 'caption', 'altText', 'url'],
        hint: 'Illustrations: {ref, caption, altText, url}. `altText` is required by both the EPUB validator and every screen reader, and is the single most-skipped field in a finished manuscript — the harness warns per missing entry rather than once, so the number is visible.',
      },
      { name: 'contents', render: 'rows', label: 'contents', columns: ['chapter', 'title', 'page'], hint: 'Table of contents: {chapter, title, page}. Every `page` must exist in `pages`; a contents entry pointing past the end is a link that 404s inside a paid product.' },
      { name: 'samplePages', render: 'stat', label: 'samplePages', hint: 'How many pages a non-buyer may read. This IS the sales pitch — zero means the listing sells a cover.' },
      { name: 'formats', render: 'chips', label: 'formats', hint: 'Which editions ship: reader | epub | pdf | print. Print is a fulfilment rather than a download and carries its own checks, so listing it commits to the 300 dpi cover.' },
      { name: 'trimSize', render: 'stat', label: 'trimSize', hint: 'Finished page size for the print edition, e.g. "A4" or "6x9in". Absent means digital-only.' },
      // Counted from the rows rather than stored beside them: a page count that can
      // disagree with the page list is the one number a reader will notice is wrong.
      { name: 'pageCount', render: 'stat', label: 'pageCount', hint: 'Pages written. Counted from `pages`, never typed.', derive: (data) => rowsOf(data.pages).length || undefined },
      { name: 'figureCount', render: 'stat', label: 'figureCount', hint: 'Figures placed. Counted from `figures`, never typed.', derive: (data) => rowsOf(data.figures).length || undefined },
      {
        name: 'wordCount', render: 'stat', label: 'wordCount',
        hint: 'Words across every page body. Counted, never typed.',
        derive: (data) => {
          const total = rowsOf(data.pages).reduce((sum, row) => sum + wordsIn(row.body), 0);
          return total || undefined;
        },
      },
      SUMMARY_FIELD,
    ],
  },
];

/** English fallbacks the palette shows before `creationCanvas.shared.label.*` resolves. */
export const SHARED_LABELS: Record<string, string> = {
  funnel: 'Funnel',
  book: 'Book',
  sequence: 'Sequence',
  poll: 'Poll',
};

/** Blank-object status fallbacks under `creationCanvas.shared.status.*`. */
export const SHARED_STATUSES: Record<string, string> = {
  notMeasured: 'Not measured',
  manuscript: 'Manuscript',
  // A blank cadence is a DRAFT and never `running`: only `running` makes the runner
  // send, so a default claiming it would put a card that looks live in front of
  // somebody who has written no steps.
  draft: 'Draft',
};

registerSpecObjectSet({
  id: 'shared',
  namespace: SHARED_NAMESPACE,
  specs: SHARED_OBJECT_SPECS,
});
