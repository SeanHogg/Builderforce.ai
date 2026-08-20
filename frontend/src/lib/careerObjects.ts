/**
 * THE career-object specification — the job search as objects, one declaration per kind.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────────
 * Twenty-five career tools ship in `careerToolCatalog.ts` and every one of them COMPUTES
 * an answer: weeks-to-zero with the projection behind it, an anchored tailoring plan
 * against one posting, a question set with the rubric each is scored against, the whole
 * application pipeline. Measured 2026-08-19, the canvas had nowhere to put a single one
 * of them, so every answer landed as prose in a `document` and stopped being an object
 * the next turn could reason over — the exact defect `founderObjects.ts` was written to
 * fix one seat across, reproduced for the seat with the most visitors and the least
 * company behind them.
 *
 * `career.ts` in the contract argues why these six are their own vocabulary and not
 * additions to `HIRING_OBJECT_KINDS`; that argument is not repeated here. What this file
 * owns is the SHAPE of each card and, more importantly, which numbers are DERIVED.
 *
 * ── WHY SO MUCH OF THIS IS `derive` AND SO LITTLE IS AUTHORED ────────────────────
 * A job search is the one domain where the person reading the board is also the person
 * whose morale is at stake, and every stored total is an invitation to a number that
 * disagrees with the rows beneath it. "Nine applications, three still open" computed
 * from the list is a fact; typed beside the list it is a fact until somebody edits one
 * row. So `applicationPipeline` stores its applications and computes every count,
 * `interviewPrep` computes its own rehearsal coverage, and `runway` computes the weeks
 * AND the pressure band from the money — because a card that says "critical" while the
 * projection under it shows eleven months is worse than a card that says nothing.
 *
 * ── THE ONE THING THAT IS NOT COMPUTED, AND WHY ──────────────────────────────────
 * `job.compensation` is a STRING with its currency and qualifier inline, for the reason
 * `hiringObjects.ts` gives for the employer side: a real posting says "£85,000–95,000",
 * "$180k base, DOE", or nothing at all, and forcing that into a number either loses the
 * qualifier or invents a precision the posting never had. An invented salary is the one
 * error on this card a person would carry into a negotiation.
 */

import {
  CAREER_APPLICATION_STAGES, careerRunwayBand, isOpenApplicationStage,
  type CareerObjectKind,
} from '@builderforce/creation-canvas-contract';
import {
  deriveDaysBetween, deriveNumber, deriveRows, derivePercent,
  registerSpecObjectSet, SOURCES_FIELD, SUMMARY_FIELD, specRefKey,
  type SpecDeriveBoard, type SpecField, type SpecObjectSpec,
} from './specObjects';

/** i18n namespace for every career label, status, field and column. */
export const CAREER_NAMESPACE = 'creationCanvas.career';

const ISO_DATE = 'An ISO date (YYYY-MM-DD) or full instant.';

/**
 * Money, as the source actually stated it.
 *
 * Deliberately identical in spirit to `hiringObjects.ts`'s `MONEY_HINT`, and deliberately
 * not imported from it: that constant documents what an EMPLOYER may offer, this one
 * documents what a POSTING advertised, and the day one of them gains a rule about bands
 * or approval the other must not inherit it.
 */
const ADVERTISED_MONEY_HINT = 'The compensation exactly as the posting states it, including currency and any qualifier — "£85,000–95,000", "$180k base + equity, DOE", or empty when the posting does not say. Never infer a figure from the title, the company or a salary guide: a number nobody advertised is one the person will quote back in a negotiation.';

/** The stage vocabulary, restated for the model in the order it happens. */
const STAGE_HINT = `Where this application actually is: ${CAREER_APPLICATION_STAGES.join(' | ')}. \`drafting\` means composed and NOT sent — the most common state on any real job board and the one a pipeline must be able to show. \`noReply\` is a decision the seeker makes after chasing, not a state the employer sets.`;

/** Rows of an application list, from wherever they were read. */
const applications = (data: Record<string, unknown>): Record<string, unknown>[] => deriveRows(data.applications);

/**
 * Every `jobApplication` card on the board, plus the rows authored directly on this
 * pipeline.
 *
 * BOTH, because the two arrive by different routes and a pipeline that counted only one
 * would be wrong for whichever route the person happened to use: `proposals.mine`
 * hydrates the `applications` rows in one call, while a person working card-by-card
 * makes a `jobApplication` per posting and never fills the table. Deduplicated on the
 * posting reference so a board with both does not double-count — first row wins, matching
 * `makeSpecDeriveBoard`'s own rule for two cards claiming one name.
 */
function pipelineRows(data: Record<string, unknown>, board: SpecDeriveBoard): Record<string, unknown>[] {
  const rows = [...applications(data)];
  const seen = new Set(rows.map((row) => specRefKey(row.jobRef ?? row.job ?? row.title)).filter(Boolean));
  for (const card of board.ofKind('jobApplication')) {
    const key = specRefKey(card.jobRef ?? card.title);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    rows.push(card);
  }
  return rows;
}

/** The shared "how many of these are still alive" count, so the pipeline's headline and
 *  its response rate cannot disagree about what "open" means. */
const openCount = (rows: readonly Record<string, unknown>[]): number =>
  rows.filter((row) => isOpenApplicationStage(row.stage)).length;

export const CAREER_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ── The posting somebody else opened ───────────────────────────────────────────
  {
    kind: 'job',
    icon: '⌖',
    group: 'Career',
    defaultStatus: 'researching',
    actions: ['research', 'match', 'apply'],
    fields: [
      { name: 'employer', render: 'stat', label: 'employer', hint: 'The company hiring, as they name themselves. If the posting is through an agency, name the AGENCY here and the end client in `summary` — applying to the same role twice through two agencies is how a candidate gets withdrawn from both.' },
      { name: 'location', render: 'stat', label: 'location', hint: 'Where the work happens, plus the arrangement: "London, hybrid 3 days" or "Remote (EU timezones)". "Remote" alone is the field most often wrong by the time of the offer, so record the qualifier the posting used.' },
      { name: 'compensation', render: 'stat', label: 'compensation', hint: ADVERTISED_MONEY_HINT },
      { name: 'postingUrl', render: 'reference', label: 'postingUrl', hint: 'Where the posting lives. Postings are taken down mid-search, so this is also the field that says whether the role still exists.' },
      { name: 'postedAt', render: 'stat', label: 'postedAt', hint: `When it was advertised. ${ISO_DATE} A posting over about six weeks old is usually either filled or stalled, which changes whether it is worth an afternoon.` },
      { name: 'closesAt', render: 'stat', label: 'closesAt', hint: `The stated closing date, if there is one. ${ISO_DATE}`, deadline: true },
      { name: 'requirements', render: 'list', label: 'requirements', hint: 'What the posting actually asks for, one entry per requirement, in ITS words rather than a paraphrase. `recruiter.extract_skills` with source="job" produces this, and the wording matters: the phrase the posting repeats is the phrase a screen searches for.' },
      { name: 'matchScore', render: 'meter', label: 'matchScore', hint: '0-100 from `recruiter.match_job` — how much of what this posting names the résumé already evidences. A measurement over two documents, not an opinion, so it is stable across calls and the person can check it.' },
      { name: 'matchedSkills', render: 'chips', label: 'matchedSkills', hint: 'Skills the posting names that the résumé evidences. From `recruiter.match_job`.' },
      { name: 'missingSkills', render: 'chips', label: 'missingSkills', hint: 'Skills the posting names that the résumé does NOT evidence. Report these honestly: a gap somebody genuinely has is information they need before spending an afternoon, not something to talk them out of.' },
      { name: 'verdict', render: 'verdict', label: 'verdict', hint: 'strong | worth applying | stretch | poor fit, with the one sentence that justifies it. From `recruiter.match_job`. One verdict — a list of three is a report, and this field is a decision about how to spend an evening.' },
      SOURCES_FIELD,
      SUMMARY_FIELD,
    ],
  },

  // ── One application, and the lifecycle it borrows ──────────────────────────────
  {
    kind: 'jobApplication',
    icon: '➤',
    group: 'Career',
    defaultStatus: 'drafting',
    actions: ['submit', 'follow-up', 'withdraw'],
    fields: [
      { name: 'jobRef', render: 'stat', label: 'jobRef', hint: 'The `job` card this application answers, by its title. Everything about the ROLE lives there and is never copied here — one fact in one place, so correcting the salary on the posting does not leave nine applications quoting the old one.' },
      {
        name: 'proposalRef', render: 'stat', label: 'proposalRef', hint: 'The `job_proposals` row this projects, by id. THE LIFECYCLE LIVES THERE: `stage`, `submittedAt` and `lastResponseAt` below are hydrated from it by `proposals.mine` and are not the seeker\'s to assert. Empty for an application made off-platform, which is most of them.',
        bookkeeping: true,
      },
      { name: 'stage', render: 'stat', label: 'stage', hint: STAGE_HINT },
      { name: 'submittedAt', render: 'stat', label: 'submittedAt', hint: `When it actually went. ${ISO_DATE} Empty while drafting — a submission date on an unsent application is the one field that makes a pipeline lie.` },
      { name: 'lastResponseAt', render: 'stat', label: 'lastResponseAt', hint: `The last time THEY replied — not the last time you chased. ${ISO_DATE} This is what the silence is measured from.` },
      { name: 'followUpAt', render: 'stat', label: 'followUpAt', hint: `When to chase next. ${ISO_DATE} Bind a \`trigger\` to it and the board warns before the week goes by; this is the single most-missed date in any job search.`, deadline: true },
      { name: 'channel', render: 'stat', label: 'channel', hint: 'How it was sent: platform | company site | email | referral | agency | job board. `referral` converts at several times the rate of the rest, which is why it is worth recording rather than remembering.' },
      { name: 'contact', render: 'stat', label: 'contact', hint: 'The named human on the other end, and their role, if there is one. A person is who follows up; a careers@ address is who does not.' },
      { name: 'resumeRef', render: 'stat', label: 'resumeRef', hint: 'Which `resume` variant went — by its title. This is the answer to the question every seeker asks in week three and almost nobody can answer: which version did they see?' },
      { name: 'coverLetterRef', render: 'stat', label: 'coverLetterRef', hint: 'Which `coverLetter` went, by its title. Empty when none was sent, which is itself worth knowing when comparing what got replies.' },
      { name: 'offerTerms', render: 'rows', label: 'offerTerms', columns: ['component', 'amount', 'notes'], hint: 'What they actually offered, once they do: {component, amount, notes} — base, bonus, equity, pension, signing, notice, start date. Rows rather than one number because an offer is compared component by component; `hr.compare_offers` reads exactly this shape.' },
      {
        name: 'daysSinceResponse', render: 'stat', label: 'daysSinceResponse',
        hint: 'Days of silence since they last replied — or since submission when they never have. Counted, never typed.',
        derive: (data) => {
          const from = data.lastResponseAt || data.submittedAt;
          if (!from) return undefined;
          const days = deriveDaysBetween(from, new Date().toISOString());
          return days == null || days < 0 ? undefined : days;
        },
      },
      SUMMARY_FIELD,
    ],
  },

  // ── The shortlist, transposed ──────────────────────────────────────────────────
  {
    kind: 'applicationPipeline',
    icon: '☰',
    group: 'Career',
    defaultStatus: 'notTracked',
    actions: ['refresh', 'review', 'chase'],
    fields: [
      { name: 'seeking', render: 'stat', label: 'seeking', hint: 'What this search is for: employment | contract | either, plus the role in a few words. A pipeline mixing two searches cannot tell you the response rate of either.' },
      { name: 'weeklyTarget', render: 'stat', label: 'weeklyTarget', hint: 'Applications a week this search is paced at. Paired with `runway`: the number is a consequence of the weeks remaining, not an ambition set independently of them.' },
      {
        name: 'applications', render: 'rows', label: 'applications',
        columns: ['role', 'employer', 'stage', 'submittedAt', 'lastResponseAt', 'jobRef'],
        hint: 'One row per application: {role, employer, stage, submittedAt, lastResponseAt, jobRef}. `proposals.mine` returns exactly this. A row here and a `jobApplication` card naming the same `jobRef` are ONE application — the counts below deduplicate, so working either way is safe.',
      },
      {
        name: 'total', render: 'stat', label: 'total',
        hint: 'Applications in this search, counting the cards on the board as well as the rows above. Counted, never typed.',
        derive: (data, board) => pipelineRows(data, board).length || undefined,
      },
      {
        name: 'open', render: 'stat', label: 'open',
        hint: 'Still live — anything not accepted, declined, withdrawn or written off. Counted from the same deduplicated set as `total`.',
        derive: (data, board) => {
          const rows = pipelineRows(data, board);
          return rows.length ? openCount(rows) : undefined;
        },
      },
      {
        name: 'responseRate', render: 'meter', label: 'responseRate',
        hint: 'Share of SUBMITTED applications that got any reply at all, 0-100. Drafts are excluded from the denominator — counting unsent applications against yourself is the arithmetic that makes a search feel worse than it is. Under about 10% is a document problem, not a volume problem.',
        derive: (data, board) => {
          const rows = pipelineRows(data, board).filter((row) => String(row.stage ?? '') !== 'drafting');
          const replied = rows.filter((row) => row.lastResponseAt || ['shortlisted', 'interviewing', 'offered', 'accepted'].includes(String(row.stage ?? ''))).length;
          return derivePercent(replied, rows.length || undefined);
        },
      },
      {
        name: 'interviewRate', render: 'meter', label: 'interviewRate',
        hint: 'Share of submitted applications that reached an interview, 0-100. The number that separates "my CV is not landing" from "my interviews are not converting" — two completely different weeks of work.',
        derive: (data, board) => {
          const rows = pipelineRows(data, board).filter((row) => String(row.stage ?? '') !== 'drafting');
          const reached = rows.filter((row) => ['interviewing', 'offered', 'accepted'].includes(String(row.stage ?? ''))).length;
          return derivePercent(reached, rows.length || undefined);
        },
      },
      {
        name: 'longestSilence', render: 'stat', label: 'longestSilence',
        hint: 'Days since the quietest OPEN application last heard anything. The one number that says who to chase this morning. Counted, never typed.',
        derive: (data, board) => {
          const now = new Date().toISOString();
          let worst: number | undefined;
          for (const row of pipelineRows(data, board)) {
            if (!isOpenApplicationStage(row.stage)) continue;
            const days = deriveDaysBetween(row.lastResponseAt || row.submittedAt, now);
            if (days == null || days < 0) continue;
            if (worst === undefined || days > worst) worst = days;
          }
          return worst;
        },
      },
      { name: 'bottleneck', render: 'verdict', label: 'bottleneck', hint: 'Where this search is losing, named, with the number behind it: not enough applications, applications not converting to replies, or interviews not converting to offers. One of the three — they need different work, and treating a conversion problem as a volume problem is how somebody sends four hundred applications.' },
      SUMMARY_FIELD,
    ],
  },

  // ── The letter ─────────────────────────────────────────────────────────────────
  {
    kind: 'coverLetter',
    icon: '✉',
    group: 'Career',
    defaultStatus: 'draft',
    actions: ['draft', 'tailor', 'export'],
    fields: [
      { name: 'jobRef', render: 'stat', label: 'jobRef', hint: 'The `job` this letter answers, by title. A letter with no posting behind it is a template, and a template is what a reader recognises in the first line.' },
      { name: 'addressedTo', render: 'stat', label: 'addressedTo', hint: 'The named person, if one can be found, and their role. "Dear Hiring Manager" is what you write when the research failed — record that it failed rather than writing it as though it were the plan.' },
      { name: 'hook', render: 'text', label: 'hook', hint: 'The opening sentence, which is the only one guaranteed to be read. It must say something true about THIS employer that could not be said about any other — the test is whether swapping the company name would break it.' },
      { name: 'body', render: 'text', label: 'body', hint: 'The letter itself. Three short paragraphs: what they need, the specific thing you did that maps to it (with the number), and what you want next. Never restate the résumé — the reader has it.' },
      { name: 'evidence', render: 'rows', label: 'evidence', columns: ['requirement', 'claim', 'proof'], hint: 'The mapping the letter is built from: {requirement, claim, proof}. `requirement` is the posting\'s words, `proof` is the specific thing that happened. A claim with no proof is the row to cut, not to soften.' },
      { name: 'referees', render: 'list', label: 'referees', hint: 'Who has agreed to vouch, and for what: {title, detail}. AUTHORED TEXT, deliberately — the platform holds no record of a referee, and a private individual\'s contact details do not belong on a board that may have no access control at all. Ask before naming anybody.' },
      {
        name: 'wordCount', render: 'stat', label: 'wordCount',
        hint: 'Words in the body. Counted, never typed. Over about 350 and it stops being read; this is the field that says so before somebody sends it.',
        derive: (data) => {
          const text = typeof data.body === 'string' ? data.body : '';
          return text.trim().split(/\s+/).filter(Boolean).length || undefined;
        },
      },
      SUMMARY_FIELD,
    ],
  },

  // ── The rehearsal, persisted ───────────────────────────────────────────────────
  {
    kind: 'interviewPrep',
    icon: '❍',
    group: 'Career',
    defaultStatus: 'notPrepared',
    actions: ['generate', 'rehearse', 'export'],
    fields: [
      { name: 'jobRef', render: 'stat', label: 'jobRef', hint: 'The `job` this rehearses for, by title. A generic question set is a podcast; the value here is that the questions come from what THIS posting emphasises.' },
      { name: 'interviewType', render: 'stat', label: 'interviewType', hint: 'behavioral | technical | situational | leadership | screening. Decides which question set `recruiter.interview_questions` builds — a screening call and a system-design round need nothing in common.' },
      { name: 'scheduledAt', render: 'stat', label: 'scheduledAt', hint: `When the interview is. ${ISO_DATE} A deadline: the rehearsal is worth nothing the day after.`, deadline: true },
      { name: 'panel', render: 'rows', label: 'panel', columns: ['name', 'role', 'focus'], hint: 'Who is in the room: {name, role, focus}. Knowing that one of the three is the person you would report to changes which answer you lead with.' },
      {
        name: 'questions', render: 'rows', label: 'questions',
        columns: ['question', 'category', 'difficulty', 'lookFor', 'answer'],
        hint: 'The set, from `recruiter.interview_questions`: {question, category, difficulty, lookFor, answer}. `lookFor` is the rubric a strong answer must satisfy and is the tool\'s, not yours. `answer` is the person\'s OWN drafted answer and starts empty — writing it for them produces something they cannot deliver.',
      },
      { name: 'riskAreas', render: 'chips', label: 'riskAreas', hint: 'Skills the posting names that the résumé does not evidence — the exposed flank, and where the hard questions will land. From the same call that builds the questions.' },
      { name: 'questionsToAsk', render: 'list', label: 'questionsToAsk', hint: 'What to ask THEM: {title, detail}. Six questions that change whether you would accept, not six that perform interest. `hr.employer_research` returns the ones worth answering first.' },
      { name: 'stories', render: 'rows', label: 'stories', columns: ['label', 'situation', 'action', 'result'], hint: 'The rehearsed set: {label, situation, action, result}. Four or five stories cover most behavioural rounds, which is why they are prepared once here rather than re-invented per interview.' },
      {
        name: 'rehearsed', render: 'meter', label: 'rehearsed',
        hint: 'Share of questions with an answer drafted, 0-100. Counted from the rows, never typed — the whole point of the card is that it says how far through the preparation actually is.',
        derive: (data) => {
          const rows = deriveRows(data.questions);
          const answered = rows.filter((row) => String(row.answer ?? '').trim().length > 0).length;
          return derivePercent(answered, rows.length || undefined);
        },
      },
      SUMMARY_FIELD,
    ],
  },

  // ── The clock ──────────────────────────────────────────────────────────────────
  {
    kind: 'runway',
    icon: '◔',
    group: 'Career',
    defaultStatus: 'notCalculated',
    actions: ['calculate', 'compare', 'refresh'],
    fields: [
      { name: 'currency', render: 'stat', label: 'currency', hint: 'ISO code for every amount on this card. One currency per card: a runway mixing two is a number nobody can check.', bookkeeping: true },
      { name: 'savings', render: 'stat', label: 'savings', hint: 'Cash available NOW — savings, notice pay, anything already banked. Not an investment that takes three weeks to sell, unless the plan is genuinely to sell it.' },
      { name: 'monthlyExpenses', render: 'stat', label: 'monthlyExpenses', hint: 'Everything that leaves the account in a normal month, including the annual bills divided by twelve. This is the number people under-state, and it is the denominator of everything below.' },
      { name: 'monthlyIncome', render: 'stat', label: 'monthlyIncome', hint: 'Money still arriving monthly — benefits, a partner\'s contribution, residual income, a retainer. Empty means none, which is different from zero being unknown.' },
      { name: 'expectedInflows', render: 'rows', label: 'expectedInflows', columns: ['label', 'amount', 'inMonths'], hint: 'One-off amounts landing on a known month: {label, amount, inMonths}. A final invoice or a tax refund moves the cliff, and moving the cliff is the whole point of recording it.' },
      { name: 'expectedOutflows', render: 'rows', label: 'expectedOutflows', columns: ['label', 'amount', 'inMonths'], hint: 'Known one-off costs: {label, amount, inMonths} — an insurance renewal, a tax bill. The ones people forget are the ones that arrive in month four.' },
      { name: 'projection', render: 'rows', label: 'projection', columns: ['month', 'balance', 'note'], hint: 'Month-by-month balance from `hr.runway`: {month, balance, note}. Held so the cliff is VISIBLE rather than implied by a single number — the shape is what makes the decision obvious.', derived: true },
      {
        name: 'netMonthlyBurn', render: 'stat', label: 'netMonthlyBurn',
        hint: 'Expenses minus income. Computed from the two fields above, never typed — a stored burn that disagrees with the two numbers printed beside it is the drift this card exists to avoid.',
        derive: (data) => {
          const out = deriveNumber(data.monthlyExpenses);
          if (out === undefined) return undefined;
          const inbound = deriveNumber(data.monthlyIncome) ?? 0;
          return Math.round((out - inbound) * 100) / 100;
        },
      },
      {
        name: 'weeksRemaining', render: 'stat', label: 'weeksRemaining',
        hint: 'Whole weeks until the balance reaches zero. LEAD WITH THIS, not the currency — it is the number that governs every other career decision, and under about 13 weeks taking contract work while interviewing usually beats holding out. Empty when income covers the outgoings, which is not the same as zero.',
        derive: (data) => {
          const savings = deriveNumber(data.savings);
          const out = deriveNumber(data.monthlyExpenses);
          if (savings === undefined || out === undefined) return undefined;
          const burn = out - (deriveNumber(data.monthlyIncome) ?? 0);
          if (burn <= 0) return undefined;
          const inflow = deriveRows(data.expectedInflows).reduce((sum, row) => sum + (deriveNumber(row.amount) ?? 0), 0);
          const outflow = deriveRows(data.expectedOutflows).reduce((sum, row) => sum + (deriveNumber(row.amount) ?? 0), 0);
          const available = savings + inflow - outflow;
          return Math.max(0, Math.floor((available / burn) * 4.345));
        },
      },
      {
        name: 'pressure', render: 'verdict', label: 'pressure',
        hint: 'The urgency band the rest of the search is paced against: none | comfortable | planning | urgent | critical. Graded from the weeks by the SAME thresholds `application/career/runway.ts` uses, so a card authored offline lands where the tool would have put it.',
        derive: (data, board) => careerRunwayBand(specCareerWeeks(data, board)),
      },
      { name: 'assumptions', render: 'list', label: 'assumptions', hint: 'What this projection takes for granted: {title, detail}. Every runway is wrong in a way its owner knows about, and writing it down is what stops the number being quoted as certainty.' },
      SUMMARY_FIELD,
    ],
  },
];

/**
 * The weeks a `runway` card is currently showing.
 *
 * Declared as a function so the `pressure` derivation reads the SAME arithmetic
 * `weeksRemaining` publishes rather than a second copy of it — a band computed from a
 * different sum than the number printed above it is the one inconsistency this card
 * cannot survive. Kept below the specs because it reads one of them.
 */
function specCareerWeeks(data: Record<string, unknown>, board: SpecDeriveBoard): unknown {
  const spec = CAREER_OBJECT_SPECS.find((entry) => entry.kind === 'runway');
  const field = spec?.fields.find((entry) => entry.name === 'weeksRemaining');
  return field?.derive?.(data, board);
}

/** English fallbacks the palette shows before `creationCanvas.career.label.*` resolves. */
export const CAREER_LABELS: Record<CareerObjectKind, string> = {
  job: 'Job',
  jobApplication: 'Application',
  applicationPipeline: 'Application pipeline',
  coverLetter: 'Cover letter',
  interviewPrep: 'Interview prep',
  runway: 'Runway',
};

/**
 * Blank-object status fallbacks under `creationCanvas.career.status.*`.
 *
 * Every one of them asserts the LEAST, for the reason the founder set's `drafting`
 * comment gives one layer up: a blank `jobApplication` that reads "Submitted" would make
 * the card lie about the single fact it exists to carry, and on this seat that lie is
 * somebody believing they applied.
 */
export const CAREER_STATUSES: Record<string, string> = {
  researching: 'Researching',
  drafting: 'Drafting',
  draft: 'Draft',
  notTracked: 'Not tracked',
  notPrepared: 'Not prepared',
  notCalculated: 'Not calculated',
};

/** Fields that carry the seeker's own money or their own drafted answers, for the test
 *  that proves none of them is silently derived away from the person who owns them. */
export const CAREER_AUTHORED_MONEY_FIELDS: readonly SpecField['name'][] = ['savings', 'monthlyExpenses', 'monthlyIncome'];

registerSpecObjectSet({
  id: 'career',
  namespace: CAREER_NAMESPACE,
  specs: CAREER_OBJECT_SPECS,
});
