/**
 * THE hiring-object specification — one declaration per kind, read by everything.
 *
 * The second family to use the spec machinery `founderObjects.ts` proved out, and the
 * reason the types moved into `@builderforce/creation-canvas-contract`. Everything a
 * hiring kind needs — the node body, the model-facing field documentation, the
 * registry's `createData`/`MUTABLE_FIELDS`/`CONTEXT_FIELDS` rows, and the empty-shell
 * rule — is DERIVED from the entries below. Adding a hiring kind is adding one entry.
 *
 * ── THE BACKEND THIS IS THE FRONT OF ─────────────────────────────────────────────
 * Every kind here has real tables behind it in `schema/hiring.ts`, registered by
 * `domains/hiring/entities.ts`. The canvas was the only missing layer, which is why the
 * fields below use the domain's own vocabulary — `candidateRef`, `pipelineRef`, `stage`,
 * `source` — rather than inventing a parallel one. Where a field names a row in another
 * domain it is an ID (`postingRef`, `interviewerRef`), never an imported table: the
 * cross-domain rule of PRD 20 §3 applies to canvas objects exactly as it does to
 * services.
 *
 * ── THE RESTRICTED FIELDS, AND WHY THEY ARE MARKED RATHER THAN OMITTED ───────────
 * `candidate.selfIdentification` holds self-identified EEO/diversity data. It is collected
 * because statutory reporting requires it and it is unlawful to use in an evaluation —
 * two rules that a single unmarked JSON field cannot satisfy at once. Marking it
 * `restricted` is what keeps it out of the AI context that ranks the shortlist, out of
 * `canvasExports`, and out of the guest/share surface, enforced by one predicate rather
 * than by every consumer remembering. The field EXISTS so the data has a lawful home;
 * it is restricted so having a home is not the same as being usable.
 *
 * `consentBasis` / `consentAt` / `retainUntil` are bookkeeping rather than restricted:
 * a recruiter must be able to SEE that a record is held lawfully and when it expires,
 * and an agent must be able to reason about "this pool is about to age out". They are
 * excluded from the empty-shell check because a candidate card whose only populated
 * field is its own consent basis is still a card with no candidate on it.
 */

import { HIRING_OBJECT_KINDS, type HiringObjectKind } from '@builderforce/creation-canvas-contract';
import {
  registerSpecObjectSet, SOURCES_FIELD, SUMMARY_FIELD,
  type SpecField, type SpecObjectSpec,
} from './specObjects';

/** i18n namespace for every hiring label, status, field and column. */
export const HIRING_NAMESPACE = 'creationCanvas.hiring';

/**
 * Compensation is stored as a STRING with its currency inline, for the same reason the
 * founder objects store money that way: a real offer is routinely a range, a band, or
 * "DOE", and forcing those into an integer either loses the qualifier or invents a
 * precision the source never had. An invented salary figure in an offer is a worse
 * error than an absent one.
 */
const MONEY_HINT = 'A human-readable amount including its currency and any qualifier the source actually carried, e.g. "£85,000–95,000" or "$180k base, DOE". Never invent a precise figure.';

/**
 * The consent block, declared once and shared by every kind that holds candidate data.
 *
 * Three fields rather than a boolean because "do we have consent" is not the question a
 * regulator asks. They ask on what lawful basis, from when, and until when — and the
 * answer has to survive the person who collected it leaving.
 */
const CONSENT_FIELDS: readonly SpecField[] = [
  { name: 'consentBasis', render: 'stat', label: 'consentBasis', hint: 'The lawful basis this record is held under: consent | legitimate-interest | contract | legal-obligation. Never guess one — if it is unknown, leave it empty so the gap is visible.', bookkeeping: true },
  { name: 'consentAt', render: 'stat', label: 'consentAt', hint: 'ISO instant the basis was established (consent given, or the legitimate-interest assessment dated).', bookkeeping: true },
  { name: 'retainUntil', render: 'stat', label: 'retainUntil', hint: 'ISO date this record must be erased by. A rejected candidate has a MAXIMUM retention — the opposite clock to an employment record — so this is a deadline, not an expiry to ignore.', bookkeeping: true },
];

export const HIRING_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ── Who we are hiring ─────────────────────────────────────────────────────────
  {
    kind: 'candidate',
    icon: '◐',
    group: 'Hiring',
    defaultStatus: 'sourced',
    actions: ['screen', 'advance', 'reject', 'erase'],
    fields: [
      { name: 'headline', render: 'stat', label: 'headline', hint: 'Current title and employer, as the person states it — "Senior React Engineer, Zalando". Not your summary of them.' },
      { name: 'location', render: 'stat', label: 'location', hint: 'Where they are, and their work authorisation if it is known and relevant to the role.' },
      { name: 'source', render: 'stat', label: 'source', hint: 'Where this person came from: inbound | referral | sourced | agency | rehire | silver-medallist. Matches `job_applications.source` so source-of-hire is computable.' },
      { name: 'stage', render: 'stat', label: 'stage', hint: 'Their current pipeline stage, in the pipeline\'s own words. Free-form on purpose: every tenant renames these.' },
      { name: 'yearsExperience', render: 'stat', label: 'yearsExperience', hint: 'Total relevant years, as a number. Relevant to THIS role, not total working life.' },
      { name: 'fitScore', render: 'meter', label: 'fitScore', hint: '0-100 fit against the bound posting. Only set this from a scored shortlist — a fit score with no ranking behind it is a number that looks like evidence.' },
      { name: 'skills', render: 'chips', label: 'skills', hint: 'Skills the résumé actually evidences. Never add a skill because the job description wanted it.' },
      { name: 'links', render: 'list', label: 'links', hint: 'Public profiles and work: [{title, url}] — LinkedIn, GitHub, portfolio, published writing.' },
      { name: 'postingRef', render: 'stat', label: 'postingRef', hint: 'The job posting this candidate is being considered for, by id.', bookkeeping: true },
      { name: 'lastTouchAt', render: 'stat', label: 'lastTouchAt', hint: 'ISO instant of the last interaction, from `candidate_interactions`. The field that makes "who have I gone quiet on" answerable.', bookkeeping: true },
      ...CONSENT_FIELDS,
      {
        // NOT `demographics`. The academic vocabulary declares a field of that name for
        // the AGGREGATE composition of a research sample — "never individual records",
        // its own hint says — and it is legitimately readable. Restriction is keyed on
        // the field NAME across the whole canvas (see `specRestrictedFields`), so
        // sharing the word would have forced one of two wrong outcomes: restrict a
        // benign aggregate everywhere, or leave a protected characteristic readable
        // here. The same lesson the `interview` rename records, caught by its test.
        name: 'selfIdentification',
        render: 'rows',
        label: 'selfIdentification',
        columns: ['category', 'response'],
        hint: 'Self-identified EEO/diversity responses, captured directly from the candidate for statutory reporting.',
        restricted: true,
        bookkeeping: true,
      },
      { name: 'notes', render: 'text', label: 'notes', hint: 'What you learned that the structured fields cannot hold. Job-related only — this is a record the candidate can request a copy of.' },
      SUMMARY_FIELD,
    ],
  },
  // ── Where they came from ──────────────────────────────────────────────────────
  {
    kind: 'talentPool',
    icon: '◫',
    group: 'Hiring',
    defaultStatus: 'defining',
    actions: ['search', 'refresh', 'shortlist'],
    fields: [
      { name: 'criteria', render: 'text', label: 'criteria', hint: 'The search itself, written so someone else could run it: titles, seniority, skills, geography, exclusions. This is what makes the pool reproducible rather than a snapshot of one afternoon.' },
      { name: 'channels', render: 'chips', label: 'channels', hint: 'Where this pool was sourced from: linkedin, github, referrals, past-applicants, community, agency.' },
      { name: 'poolSize', render: 'stat', label: 'poolSize', hint: 'How many people the criteria matched. The number that says whether the search is too narrow before anyone is contacted.' },
      { name: 'members', render: 'rows', label: 'members', columns: ['name', 'headline', 'location', 'source', 'status'], hint: 'The people found: {name, headline, location, source, status}. Only people actually returned by the search — never illustrative rows.' },
      { name: 'exclusions', render: 'chips', label: 'exclusions', hint: 'Who was deliberately left out and why: current employees, off-limits accounts, opted-out, already-rejected-for-this-req.' },
      { name: 'refreshedAt', render: 'stat', label: 'refreshedAt', hint: 'ISO instant the search last ran.', bookkeeping: true },
      SOURCES_FIELD,
      SUMMARY_FIELD,
    ],
  },
  // ── What we are hiring for, and where it was advertised ───────────────────────
  {
    kind: 'jobPosting',
    icon: '▤',
    group: 'Hiring',
    defaultStatus: 'draft',
    actions: ['draft', 'distribute', 'refresh'],
    fields: [
      { name: 'level', render: 'stat', label: 'level', hint: 'Seniority as this company words it — "Senior (L5)", "Staff", "Graduate".' },
      { name: 'location', render: 'stat', label: 'location', hint: 'Location and working pattern: "Berlin — hybrid, 2 days" or "Remote (EU timezones)". Both, because the second is what candidates filter on.' },
      { name: 'employmentType', render: 'stat', label: 'employmentType', hint: 'permanent | fixed-term | contract | part-time | internship.' },
      { name: 'headcount', render: 'stat', label: 'headcount', hint: 'How many people this requisition is approved for. One posting can be several hires.' },
      { name: 'compBand', render: 'stat', label: 'compBand', hint: MONEY_HINT },
      { name: 'hiringManager', render: 'stat', label: 'hiringManager', hint: 'Who decides. Named, because a requisition with no decision-maker is the single most common cause of a stalled search.' },
      { name: 'targetStartDate', render: 'stat', label: 'targetStartDate', hint: 'ISO date the person is needed by. What makes a time-to-hire target real rather than aspirational.' },
      { name: 'mustHaves', render: 'chips', label: 'mustHaves', hint: 'Requirements a candidate is rejected for lacking. Keep this list short and be able to defend every entry — each one narrows the pool and, if it is not truly required, narrows it discriminatorily.' },
      { name: 'niceToHaves', render: 'chips', label: 'niceToHaves', hint: 'Genuinely optional. If you would still hire someone without it, it belongs here and not above.' },
      { name: 'responsibilities', render: 'list', label: 'responsibilities', hint: 'What the person will actually do: [{title, detail}]. Written from the work, not from the last job description for a similar title.' },
      {
        name: 'distribution',
        render: 'rows',
        label: 'distribution',
        columns: ['board', 'status', 'postedAt', 'url'],
        hint: 'Where this posting was published: {board, status, postedAt, url}. Rows are written by the distribute action against a connected job board — never author a posted row the connector did not confirm.',
        bookkeeping: true,
      },
      { name: 'postingUrl', render: 'stat', label: 'postingUrl', hint: 'The canonical public URL of the posting on the careers site.', bookkeeping: true },
      { name: 'applicantCount', render: 'stat', label: 'applicantCount', hint: 'Applications received, read from the hiring domain.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── How we reach them ─────────────────────────────────────────────────────────
  {
    kind: 'outreachSequence',
    icon: '↝',
    group: 'Hiring',
    defaultStatus: 'draft',
    actions: ['draft', 'enroll', 'start', 'pause'],
    fields: [
      {
        name: 'steps',
        render: 'rows',
        label: 'steps',
        columns: ['step', 'channel', 'delayDays', 'subject'],
        hint: 'The cadence: {step, channel, delayDays, subject}. Write the actual subject lines — a sequence with placeholder subjects is a plan, not a sequence. Three to five steps is the useful range; more reads as spam to the person receiving it.',
      },
      { name: 'audience', render: 'stat', label: 'audience', hint: 'The talent pool this sequence enrols from, by id or title.' },
      { name: 'enrolled', render: 'stat', label: 'enrolled', hint: 'People currently enrolled.', bookkeeping: true },
      { name: 'replied', render: 'stat', label: 'replied', hint: 'People who replied and were therefore removed from the cadence.', bookkeeping: true },
      { name: 'replyRate', render: 'meter', label: 'replyRate', hint: '0-100 reply rate. Under 10 on a sourced pool means the message is wrong, not the list.', bookkeeping: true },
      {
        name: 'stopOnReply',
        render: 'stat',
        label: 'stopOnReply',
        hint: 'Whether a reply removes the person from the remaining steps. Defaults to true and should stay true: continuing to mail someone who already answered is the failure candidates screenshot.',
        bookkeeping: true,
      },
      { name: 'lastSentAt', render: 'stat', label: 'lastSentAt', hint: 'ISO instant the most recent step went out.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── Who made the cut ──────────────────────────────────────────────────────────
  {
    kind: 'shortlist',
    icon: '⇅',
    group: 'Hiring',
    defaultStatus: 'notRanked',
    actions: ['rank', 'advance', 'reject'],
    fields: [
      { name: 'postingRef', render: 'stat', label: 'postingRef', hint: 'The job posting every candidate here was ranked against, by id. A ranking with no posting behind it is an opinion.', bookkeeping: true },
      { name: 'method', render: 'text', label: 'method', hint: 'How the ranking was produced, in one paragraph a rejected candidate could be shown. Name the signals used and the ones deliberately ignored.' },
      {
        name: 'ranked',
        render: 'rows',
        label: 'ranked',
        columns: ['rank', 'candidate', 'score', 'evidence', 'gaps'],
        hint: 'The ranking: {rank, candidate, score, evidence, gaps}. `evidence` cites what in the résumé earned the score and `gaps` names what is missing — both required, because a score with no evidence cannot be defended and a gap left unstated becomes an unexplained rejection.',
      },
      {
        name: 'knockouts',
        render: 'rows',
        label: 'knockouts',
        columns: ['candidate', 'question', 'answer'],
        hint: 'Screening-question answers that removed someone: {candidate, question, answer}. Only genuine requirements belong here.',
      },
      { name: 'reviewedCount', render: 'stat', label: 'reviewedCount', hint: 'How many applications were assessed to produce this list. The denominator that makes the shortlist meaningful.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── What they will be put through ─────────────────────────────────────────────
  {
    kind: 'interviewLoop',
    icon: '◷',
    group: 'Hiring',
    defaultStatus: 'notScheduled',
    actions: ['schedule', 'invite', 'reschedule'],
    fields: [
      {
        name: 'stages',
        render: 'rows',
        label: 'stages',
        columns: ['stage', 'interviewer', 'durationMinutes', 'focus'],
        hint: 'The loop: {stage, interviewer, durationMinutes, focus}. `focus` names the ONE competency that stage exists to assess — two interviewers assessing the same thing is the most common waste in a loop.',
      },
      { name: 'panel', render: 'chips', label: 'panel', hint: 'Everyone who will meet the candidate. Check this list for who is missing as much as for who is on it.' },
      { name: 'candidateTimezone', render: 'stat', label: 'candidateTimezone', hint: 'IANA timezone of the candidate, e.g. "Europe/Berlin". Required before a slot is proposed: an offer of 9am in your timezone is 3am in theirs.' },
      { name: 'kit', render: 'list', label: 'kit', hint: 'The questions each stage asks: [{title, detail}]. A structured kit asked of every candidate is the single highest-impact bias control available, and the only one that also improves signal.' },
      { name: 'bookingUrl', render: 'stat', label: 'bookingUrl', hint: 'The candidate self-schedule link. Written by the schedule action against the availability solver — never author a URL, it will not resolve.', bookkeeping: true },
      { name: 'bookingExpiresAt', render: 'stat', label: 'bookingExpiresAt', hint: 'ISO instant the self-schedule link stops working.', bookkeeping: true },
      { name: 'scheduledAt', render: 'stat', label: 'scheduledAt', hint: 'ISO instant the candidate booked, once they have.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── What one interviewer thought ──────────────────────────────────────────────
  {
    kind: 'scorecard',
    icon: '★',
    group: 'Hiring',
    defaultStatus: 'notSubmitted',
    actions: ['score', 'submit'],
    fields: [
      { name: 'interviewerRef', render: 'stat', label: 'interviewerRef', hint: 'Who filled this in, by id. One scorecard is one interviewer — a shared one is a debrief, and a debrief written before everyone has submitted is the anchoring this object exists to prevent.', bookkeeping: true },
      { name: 'stage', render: 'stat', label: 'stage', hint: 'Which stage of the loop this scores.' },
      {
        name: 'attributes',
        render: 'rows',
        label: 'attributes',
        columns: ['attribute', 'rating', 'evidence'],
        hint: 'Per-competency assessment: {attribute, rating, evidence}. `evidence` must quote what the candidate actually said or did — a rating with no evidence is a feeling, and feelings are where bias lives.',
      },
      { name: 'overall', render: 'meter', label: 'overall', hint: '0-100 overall. Derived from the attributes above, not decided first and justified after.' },
      { name: 'recommendation', render: 'verdict', label: 'recommendation', hint: 'strong-hire | hire | no-hire | strong-no-hire, with one sentence of reasoning. Take a position — "maybe" moves the decision to someone with less information than you.' },
      { name: 'submittedAt', render: 'stat', label: 'submittedAt', hint: 'ISO instant this was submitted and became visible to the rest of the panel.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── What we offered ───────────────────────────────────────────────────────────
  {
    kind: 'offer',
    icon: '✎',
    group: 'Hiring',
    defaultStatus: 'draft',
    actions: ['draft', 'approve', 'send', 'sign'],
    fields: [
      { name: 'baseSalary', render: 'stat', label: 'baseSalary', hint: MONEY_HINT },
      { name: 'bonus', render: 'stat', label: 'bonus', hint: 'Variable compensation, with the basis it is earned on.' },
      { name: 'equity', render: 'stat', label: 'equity', hint: 'Grant size and vesting, in the words the offer letter will use.' },
      { name: 'startDate', render: 'stat', label: 'startDate', hint: 'ISO proposed start date.' },
      { name: 'expiresAt', render: 'stat', label: 'expiresAt', hint: 'ISO instant the offer lapses. Exploding offers damage acceptance rates — set this generously or leave it empty.' },
      {
        name: 'approvals',
        render: 'rows',
        label: 'approvals',
        columns: ['approver', 'role', 'status', 'at'],
        hint: 'Who must sign off before this is sent: {approver, role, status, at}. Rows are written by the approve action — never mark an approval the approver did not give.',
        bookkeeping: true,
      },
      { name: 'terms', render: 'list', label: 'terms', hint: 'Everything else that was agreed: [{title, detail}] — notice period, relocation, remote allowance, probation, contingencies.' },
      { name: 'signatureState', render: 'stat', label: 'signatureState', hint: 'unsigned | sent | signed | declined | expired. Written by the sign flow; a signature is a recorded event with an audit trail, never an asserted field.', bookkeeping: true },
      { name: 'signedAt', render: 'stat', label: 'signedAt', hint: 'ISO instant the candidate signed.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── The fee ───────────────────────────────────────────────────────────────────
  {
    kind: 'placement',
    icon: '◆',
    group: 'Hiring',
    defaultStatus: 'pending',
    actions: ['record', 'invoice'],
    fields: [
      { name: 'candidateRef', render: 'stat', label: 'candidateRef', hint: 'Who was placed, by id.', bookkeeping: true },
      { name: 'postingRef', render: 'stat', label: 'postingRef', hint: 'What they were placed into, by id.', bookkeeping: true },
      { name: 'startedAt', render: 'stat', label: 'startedAt', hint: 'ISO date they actually started. The event the fee and the guarantee both run from.' },
      { name: 'feeAmount', render: 'stat', label: 'feeAmount', hint: MONEY_HINT },
      { name: 'feeBasis', render: 'stat', label: 'feeBasis', hint: 'How the fee was calculated: "20% of first-year base" or "fixed retainer, 3 instalments".' },
      {
        name: 'splits',
        render: 'rows',
        label: 'splits',
        columns: ['party', 'share', 'amount', 'status'],
        hint: 'How the fee divides: {party, share, amount, status}. READ-ONLY on the board — `placement_splits` is corrected by the service that owns the payout, never by an authored patch, because it is money.',
        bookkeeping: true,
      },
      { name: 'guaranteeDays', render: 'stat', label: 'guaranteeDays', hint: 'The rebate/replacement period in days. The number that decides whether this revenue is actually yours yet.' },
      { name: 'guaranteeEndsAt', render: 'stat', label: 'guaranteeEndsAt', hint: 'ISO date the guarantee expires and the fee is finally earned.', bookkeeping: true },
      { name: 'invoiceState', render: 'stat', label: 'invoiceState', hint: 'pending | invoiced | paid | rebated.', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
];

/**
 * English fallbacks the object palette shows before its i18n key resolves, matching how
 * the founder and academic sets read. The palette localizes through
 * `creationCanvas.hiring.label.*`; these are never the translated string.
 */
export const HIRING_LABELS: Record<HiringObjectKind, string> = {
  candidate: 'Candidate',
  talentPool: 'Talent pool',
  jobPosting: 'Job posting',
  outreachSequence: 'Outreach sequence',
  shortlist: 'Shortlist',
  interviewLoop: 'Interview loop',
  scorecard: 'Interview scorecard',
  offer: 'Offer',
  placement: 'Placement',
};

/** Blank-object status, as the English fallback matching every set above. */
export const HIRING_STATUSES: Record<string, string> = {
  sourced: 'Sourced',
  defining: 'Defining the search',
  draft: 'Draft',
  notRanked: 'Not ranked',
  notScheduled: 'Not scheduled',
  notSubmitted: 'Not submitted',
  pending: 'Pending',
};

/** Kinds the contract declares, for the test that proves the two lists agree. */
export const HIRING_CONTRACT_KINDS: readonly HiringObjectKind[] = HIRING_OBJECT_KINDS;

registerSpecObjectSet({
  id: 'hiring',
  namespace: HIRING_NAMESPACE,
  specs: HIRING_OBJECT_SPECS,
});
