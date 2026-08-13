/**
 * The PEOPLE vocabulary's specs — HR operations, and the collection primitive.
 *
 * ── WHAT THIS SET IS FOR ─────────────────────────────────────────────────────────
 * `packages/creation-canvas-contract/src/people.ts` argues why the kinds exist. This is
 * the half that says what each one HOLDS: the fields the node body draws, the fields the
 * model is taught to author, and the fields the empty-shell rule counts as work.
 *
 * ── THE RULE THAT SHAPED EVERY HINT HERE ────────────────────────────────────────
 * Every other vocabulary on this canvas describes things: a competitor, a rubric, a test
 * case. This one describes PEOPLE, and a field that is merely inaccurate elsewhere is a
 * different category of wrong here. A guessed revenue figure on a `competitor` misleads a
 * strategy; a guessed rating on a `performanceReview`, a guessed band on a `compBand` or
 * an invented allegation on a `case` is a statement about a named human being that the
 * company may later have to defend.
 *
 * So the hints are unusually insistent about provenance and about refusal. Where the
 * founder set says "never invent a figure", this set says who is entitled to author the
 * field at all, and several fields are `derived` — unwritable by any model — for the same
 * reason the academic set marks `marks` derived: a model that CAN write an outcome will
 * eventually write one nobody reached.
 *
 * ── WHY SO MANY FIELDS ARE `rows` ───────────────────────────────────────────────
 * Because HR work is register work. An acknowledgement roster, a lifecycle checklist, an
 * absence calendar and a headcount plan are all "one row per person or per step, with an
 * owner and a date", and rendering them as tables is what makes the gap visible — the
 * six people who have NOT acknowledged are the answer, and a prose summary hides them.
 */

import {
  PEOPLE_OBJECT_KINDS,
  type PeopleObjectKind,
} from '@builderforce/creation-canvas-contract';
import {
  registerSpecObjectSet, SUMMARY_FIELD,
  type SpecField, type SpecObjectSpec,
} from './specObjects';

/** i18n namespace for every people label, status, field and column. */
export const PEOPLE_NAMESPACE = 'creationCanvas.people';

// ---------------------------------------------------------------------------
// Shared hints — written once because the same instruction is load-bearing repeatedly
// ---------------------------------------------------------------------------

/**
 * Money in this vocabulary, and why it is not the founder set's money hint.
 *
 * The founder hint permits a qualifier ("~$2–4M ARR (estimate)") because a competitor's
 * revenue genuinely is an estimate. A salary is not an estimate — it is a number somebody
 * is paid, or a band somebody approved — and permitting a qualifier here is how "around
 * £60k" ends up in an offer. So: a figure and its currency, or the field stays empty.
 */
const PAY_HINT = 'An exact figure with its currency and period, e.g. "£62,000 / year" or "$45 / hour". Never a range in this field, never "competitive", and never a guess: if the real number is not known, leave it empty and say so in `summary`. A pay figure a person can read is a figure the company has to honour.';

/** A person, referred to in the way the object's confidentiality allows. */
const PERSON_REF_HINT = 'The person this concerns. Use the employee reference or work email that already identifies them elsewhere on this board, so the object joins up. Never invent an identifier.';

const OWNER_HINT = 'Who is accountable for this — a named person or role, not a team. A step whose owner is "HR" is a step nobody has.';

/**
 * The evidence field, and why it is not the founder set's `sources`.
 *
 * `SOURCES_FIELD` documents where a CLAIM ABOUT THE WORLD came from — a URL, a report.
 * The equivalent question here is where a claim about a PERSON came from, and the honest
 * answers are different in kind: a signed acknowledgement, a completed form response, a
 * document reference. Reusing the shared field would have invited the model to cite a web
 * page as the basis for a fact about an employee, which is precisely wrong.
 */
const EVIDENCE_FIELD: SpecField = {
  name: 'evidence',
  render: 'rows',
  label: 'evidence',
  columns: ['item', 'reference', 'collectedAt'],
  hint: 'What proves each claim on this card: {item, reference, collectedAt}. `reference` names a signature request, a form response, or a document already on this board — never a description of one. An HR record whose evidence column is empty is an assertion, and an assertion is what an appeal overturns.',
  bookkeeping: true,
};

/** Confidentiality is authored per object; the field documents the rule to the model. */
const CONFIDENTIALITY_FIELD: SpecField = {
  name: 'confidentiality',
  render: 'stat',
  label: 'confidentiality',
  hint: 'public | internal | restricted. Governs whether this card may be exported, shared by link, or read by a guest — see canvasConfidentiality. Objects in this vocabulary start at the safest level their kind allows; RAISE it when the content is more sensitive than the kind implies, and lower it only when the user explicitly asks. Never lower it to publish something more easily.',
  bookkeeping: true,
};

// ---------------------------------------------------------------------------
// The specs
// ---------------------------------------------------------------------------

export const PEOPLE_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ── THE PERSON AND THE ORGANISATION ───────────────────────────────────────────
  {
    kind: 'employee',
    icon: '☖',
    group: 'People',
    defaultStatus: 'active',
    actions: ['sync', 'lifecycle'],
    fields: [
      { name: 'personRef', render: 'stat', label: 'personRef', hint: PERSON_REF_HINT },
      { name: 'jobTitle', render: 'stat', label: 'jobTitle', hint: 'The title on the contract, not the aspirational one.' },
      { name: 'department', render: 'stat', label: 'department', hint: 'The team this person is budgeted to. Must match the team names used by the headcountPlan on this board or the plan cannot reconcile.' },
      {
        name: 'managerRef', render: 'stat', label: 'managerRef',
        hint: 'The `personRef` of this person\'s manager. THIS IS THE EDGE AN ORG CHART IS DRAWN FROM — canvas_build_org_chart reads it and nothing else. An employee with no manager is treated as a root, so leaving it blank on someone who has a manager silently creates a second top of the organisation.',
      },
      { name: 'employment', render: 'stat', label: 'employment', hint: 'full_time | part_time | contract | intern. Mirrors people_employees.employment so a synced object and an authored one are the same shape.' },
      { name: 'location', render: 'stat', label: 'location', hint: 'Work location, specific enough to decide which employment law applies — "Austin, TX", not "remote".' },
      { name: 'startedAt', render: 'stat', label: 'startedAt', hint: 'ISO start date. The anchor an onboarding employeeLifecycle counts its steps from.' },
      { name: 'endedAt', render: 'stat', label: 'endedAt', hint: 'ISO leaving date, when there is one. The anchor an offboarding lifecycle counts BACKWARDS from, which is why an empty value here on a known leaver leaves access revocation undated.' },
      { name: 'band', render: 'stat', label: 'band', hint: 'The title of the compBand object this role sits in. This is what makes pay equity computable — an employee with no band cannot be compared to anyone.' },
      { name: 'competencies', render: 'chips', label: 'competencies', hint: 'Capabilities this person actually has, in the same words the skillsMatrix uses. Different words for the same skill is how a matrix reports a gap that is not there.' },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
      EVIDENCE_FIELD,
    ],
  },
  {
    kind: 'orgChart',
    icon: '⑃',
    group: 'People',
    defaultStatus: 'buildChart',
    actions: ['build', 'compare'],
    fields: [
      { name: 'scope', render: 'stat', label: 'scope', hint: 'What this chart covers — the whole company, or one department. A chart whose scope is unstated reads as the whole org and is usually a slice.' },
      { name: 'asOf', render: 'stat', label: 'asOf', hint: 'ISO date this structure represents. A reorg scenario and today\'s org are the same shape, and the date is the only thing that distinguishes them.' },
      { name: 'scenario', render: 'stat', label: 'scenario', hint: 'current | proposed. A `proposed` chart may be edited freely; a `current` one is a claim about how the company is actually structured today and must match the employee objects.' },
      { name: 'headcount', render: 'stat', label: 'headcount', hint: 'People in scope.', derived: true },
      { name: 'layers', render: 'stat', label: 'layers', hint: 'Depth from the root to the deepest report.', derived: true },
      { name: 'averageSpan', render: 'stat', label: 'averageSpan', hint: 'Mean direct reports per manager.', derived: true },
      {
        name: 'nodes', render: 'rows', label: 'nodes', columns: ['person', 'title', 'manager', 'department', 'directReports'],
        hint: 'One row per person in the chart, computed by canvas_build_org_chart from the `employee` objects on this board: {person, title, manager, department, directReports}. Do not hand-author this — a typed hierarchy disagrees with the employee cards the moment either changes.',
        derived: true,
      },
      {
        name: 'findings', render: 'list', label: 'findings', columns: undefined,
        hint: 'What the structure shows: [{title, detail}]. Say the uncomfortable ones — a manager with eleven reports, a layer with one person in it, an employee whose manager is not on the board. These are the reason to draw a chart rather than to look at a list.',
        derived: true,
      },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
    ],
  },
  {
    /**
     * ONE headcount plan, read by two seats.
     *
     * HR asks "how many are approved, how many are filled, where is the gap". Finance
     * asks "what does that establishment cost this year, and does it agree with what we
     * raised against". Those are two questions about ONE object, so the fields below are
     * one spec rather than an HR `headcountPlan` and a finance one — a second spec would
     * mean two answers to "how many people are we planning", which is exactly the
     * ubiquitous-language collision `customerInterview` was renamed to avoid.
     *
     * The finance half is the `currency`/`annualCost`/`loadingRate`/`roles` block. It is
     * here and not on a founder object because a role's cost and a role's establishment
     * are the same fact, and [[no-technical-debt-rule]] says the primitive gets extended,
     * not copied.
     */
    kind: 'headcountPlan',
    icon: '⊞',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['plan', 'reconcile', 'cost', 'approve'],
    fields: [
      { name: 'period', render: 'stat', label: 'period', hint: 'The budget period this plan covers, e.g. "FY26" or "Q3 2026".' },
      { name: 'approvedTotal', render: 'stat', label: 'approvedTotal', hint: 'Approved headcount across every team, as an integer. The number finance signed off, not the number the plan adds up to — if they differ, that IS the finding.' },
      { name: 'actualTotal', render: 'stat', label: 'actualTotal', hint: 'People actually employed today, as an integer.', derived: true },
      { name: 'budgetTotal', render: 'stat', label: 'budgetTotal', hint: PAY_HINT },
      // ── The finance half ────────────────────────────────────────────────────────
      { name: 'currency', render: 'stat', label: 'currency', hint: 'ISO-4217 code for every cost figure on this plan, e.g. "USD". One currency per plan — a mixed-currency total is refused rather than silently added.' },
      {
        name: 'annualCost', render: 'stat', label: 'annualCost',
        hint: 'Fully-loaded cost of the whole plan for the period, as a plain number in the plan currency (no symbols, no "k"/"M"). Computed from `roles` with their start dates — this is the line that consumes most of what a round is raised for, so `fundingRound.useOfFunds` should agree with it.',
        derived: true,
      },
      {
        name: 'loadingRate', render: 'stat', label: 'loadingRate',
        hint: 'The multiplier from salary to fully-loaded cost — employer taxes, benefits, equipment — e.g. 1.25. State it once here rather than burying it in every row, so a reviewer can challenge the one assumption instead of twenty numbers.',
      },
      {
        name: 'teams', render: 'rows', label: 'teams', columns: ['team', 'approved', 'actual', 'open', 'budget'],
        hint: 'One row per team: {team, approved, actual, open, budget}. `open` is approved minus actual and is the row a requisition is granted from. Team names must match the `department` on the employee objects, or nothing reconciles.',
      },
      {
        name: 'roles', render: 'rows', label: 'roles', columns: ['role', 'team', 'level', 'startAt', 'salary', 'loadedCost', 'status'],
        hint: 'One row per PLANNED HIRE: {role, team, level, startAt, salary, loadedCost, status}. `startAt` is an ISO date and it is the field that makes the cost correct — a hire starting in month 11 costs a twelfth of one starting in month 1, and a plan that ignores start dates overstates the year by roughly a third. `salary` and `loadedCost` are plain numbers in the plan currency; `status` is planned | approved | open | offered | filled.',
      },
      { name: 'assumptions', render: 'list', label: 'assumptions', hint: 'What this plan takes for granted: [{title, detail}] — attrition rate, time to hire, ramp. A headcount plan is an assumption stack, and the assumption is what turns out to be wrong.' },
      { name: 'risks', render: 'chips', label: 'risks', hint: 'What would break the plan — a key departure, a hiring freeze, a slipped funding round.' },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
    ],
  },
  {
    kind: 'compBand',
    icon: '⇅',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['benchmark', 'checkEquity'],
    fields: [
      { name: 'roleFamily', render: 'stat', label: 'roleFamily', hint: 'The job family this band governs, e.g. "Software Engineering" or "Customer Support".' },
      { name: 'level', render: 'stat', label: 'level', hint: 'The level within the family, in the company\'s own scale, e.g. "L4" or "Senior".' },
      { name: 'minimum', render: 'stat', label: 'minimum', hint: PAY_HINT },
      { name: 'midpoint', render: 'stat', label: 'midpoint', hint: `${PAY_HINT} The midpoint is what comparatio is measured against, so an invented one silently invents every comparatio computed from it.` },
      { name: 'maximum', render: 'stat', label: 'maximum', hint: PAY_HINT },
      { name: 'currency', render: 'stat', label: 'currency', hint: 'ISO currency code. Its own field because a band compared across currencies without one is arithmetic on incomparable numbers.' },
      { name: 'geoDifferential', render: 'text', label: 'geoDifferential', hint: 'How this band moves by location, if it does. Say "one global band" when it does not — an unstated differential is read as none and then contradicted by the first offer.' },
      { name: 'benchmarkSource', render: 'stat', label: 'benchmarkSource', hint: 'Which survey or dataset the band was set from, with its date. A band with no benchmark is a preference.' },
      {
        name: 'placement', render: 'rows', label: 'placement', columns: ['person', 'pay', 'comparatio', 'flag'],
        hint: 'Where people actually sit in this band: {person, pay, comparatio, flag}. `comparatio` is pay ÷ midpoint. Written by canvas_check_pay_equity from the employee objects on the board, because a hand-typed comparatio is the one number in HR nobody re-checks.',
        derived: true,
      },
      {
        name: 'equityFindings', render: 'list', label: 'equityFindings',
        hint: 'What the placement shows: [{title, detail}] — who is below the minimum, who is above the maximum, and where comparatio clusters differ between groups. Report the DISPERSION, never an individual\'s protected characteristic, and never infer one.',
        derived: true,
      },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
    ],
  },
  // ── THE PAPER AND THE PROCESS ─────────────────────────────────────────────────
  {
    kind: 'policy',
    icon: '§',
    group: 'Knowledge',
    defaultStatus: 'draft',
    actions: ['publish', 'acknowledge'],
    fields: [
      { name: 'policyType', render: 'stat', label: 'policyType', hint: 'handbook | code-of-conduct | leave | expenses | remote-work | security | health-safety | equal-opportunity | whistleblowing | other.' },
      { name: 'jurisdictions', render: 'chips', label: 'jurisdictions', hint: 'Every jurisdiction this policy is written for, e.g. ["California", "Ontario"]. THE field that makes a policy library auditable: the same policy is lawful in one place and not in another, and a policy with no jurisdiction is applied everywhere by default.' },
      { name: 'owner', render: 'stat', label: 'owner', hint: OWNER_HINT },
      { name: 'version', render: 'stat', label: 'version', hint: 'The version people acknowledged. An acknowledgement of v1 is not an acknowledgement of v2, which is the whole reason this field is not decoration.' },
      { name: 'effectiveAt', render: 'stat', label: 'effectiveAt', hint: 'ISO date this version takes effect.' },
      { name: 'reviewAt', render: 'stat', label: 'reviewAt', hint: 'ISO date this must be reviewed by. Bind a `trigger` to it — the failure mode of a policy library is not a bad policy, it is a stale one nobody re-read.' },
      { name: 'appliesTo', render: 'chips', label: 'appliesTo', hint: 'Which populations it binds — departments, employment types, locations. "Everyone" is a legitimate answer and must be written rather than left blank.' },
      { name: 'body', render: 'text', label: 'body', hint: 'The policy itself, in plain language a person can follow. Say what someone must DO, not what the company values.' },
      { name: 'acknowledgementRate', render: 'meter', label: 'acknowledgementRate', hint: 'Percentage of the required roster who have acknowledged this version.', derived: true },
      {
        name: 'roster', render: 'rows', label: 'roster', columns: ['person', 'requiredBy', 'status', 'acknowledgedAt'],
        hint: 'Who must acknowledge and who has: {person, requiredBy, status, acknowledgedAt}. Written by the signature subsystem, never by hand — an acknowledgement typed by the person chasing it is exactly the record that proves nothing.',
        derived: true,
      },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
      EVIDENCE_FIELD,
    ],
  },
  {
    kind: 'employeeLifecycle',
    icon: '⇄',
    group: 'Work',
    defaultStatus: 'planning',
    actions: ['plan', 'progress'],
    fields: [
      {
        name: 'direction', render: 'stat', label: 'direction',
        hint: 'onboarding | offboarding. Decides which way the steps count from `anchorDate`, and which half is compliance-critical: onboarding owes right-to-work evidence before day one, offboarding owes access revocation on the last day.',
      },
      { name: 'personRef', render: 'stat', label: 'personRef', hint: PERSON_REF_HINT },
      { name: 'anchorDate', render: 'stat', label: 'anchorDate', hint: 'ISO start date (onboarding) or last working day (offboarding). Every step is dated relative to this, so a plan with no anchor has no due dates at all.' },
      { name: 'completion', render: 'meter', label: 'completion', hint: 'Percentage of steps done.', derived: true },
      {
        name: 'steps', render: 'rows', label: 'steps', columns: ['step', 'owner', 'dueOffset', 'status', 'evidence'],
        hint: 'One row per step: {step, owner, dueOffset, status, evidence}. `dueOffset` is days relative to the anchor and may be negative ("-3" = three days before start). Cover the four categories that actually get missed: equipment, system access, payroll/benefits, and statutory checks. `evidence` names what proves the step happened — for access revocation, the system it was revoked in.',
      },
      {
        name: 'accessRevocation', render: 'rows', label: 'accessRevocation', columns: ['system', 'owner', 'revokedAt', 'confirmedBy'],
        hint: 'Offboarding only, and its own field rather than a step category because it is the one with real risk: {system, owner, revokedAt, confirmedBy}. List EVERY system the person could reach, including the ones granted informally. An empty row here on a completed offboarding is an open account.',
      },
      { name: 'blockers', render: 'chips', label: 'blockers', hint: 'What is stopping a step — an unreturned laptop, a missing document, an unsigned form.' },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
      EVIDENCE_FIELD,
    ],
  },
  {
    kind: 'absencePlan',
    icon: '◷',
    group: 'Work',
    defaultStatus: 'draft',
    actions: ['plan', 'checkCoverage'],
    fields: [
      { name: 'period', render: 'stat', label: 'period', hint: 'The window this covers, e.g. "December 2026".' },
      { name: 'team', render: 'stat', label: 'team', hint: 'Whose coverage is being planned. Must match a `department` used by the employee objects.' },
      { name: 'minimumCover', render: 'stat', label: 'minimumCover', hint: 'The fewest people who must be available on any working day, as an integer. Without it "is it covered?" has no answer and every absence looks acceptable.' },
      { name: 'coverageRisk', render: 'meter', label: 'coverageRisk', hint: '0-100, higher is worse: how close the worst-covered day comes to breaching `minimumCover`.', derived: true },
      {
        name: 'absences', render: 'rows', label: 'absences', columns: ['person', 'type', 'from', 'to', 'status'],
        hint: 'One row per absence: {person, type, from, to, status}. `type` is annual | sick | parental | unpaid | public-holiday | other. Record the TYPE but never a medical reason — the reason is health data and belongs in a restricted `case`, not on a rota.',
      },
      {
        name: 'gaps', render: 'rows', label: 'gaps', columns: ['date', 'available', 'required', 'shortfall'],
        hint: 'Days that breach minimum cover: {date, available, required, shortfall}. Computed, and the actual output of the object — a calendar that shows absences without showing which days break is a calendar you still have to read manually.',
        derived: true,
      },
      { name: 'accruedLiability', render: 'stat', label: 'accruedLiability', hint: `Untaken leave carried as a cost. ${PAY_HINT}` },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
    ],
  },
  // ── PERFORMANCE, CAPABILITY AND RELATIONS ─────────────────────────────────────
  {
    kind: 'performanceReview',
    icon: '◎',
    group: 'People',
    defaultStatus: 'draft',
    actions: ['draft', 'calibrate'],
    fields: [
      { name: 'personRef', render: 'stat', label: 'personRef', hint: PERSON_REF_HINT },
      { name: 'reviewType', render: 'stat', label: 'reviewType', hint: 'annual | mid-year | probation | one-on-one | 360. A one-to-one is this kind at this cadence, not a kind of its own.' },
      { name: 'period', render: 'stat', label: 'period', hint: 'The period being assessed, e.g. "H1 2026".' },
      { name: 'reviewer', render: 'stat', label: 'reviewer', hint: 'Who is writing it. A review with no named reviewer cannot be appealed, which is the same as saying it cannot be relied on.' },
      { name: 'overallRating', render: 'stat', label: 'overallRating', hint: 'The rating in the company\'s own scale. NEVER author or alter this from an AI turn: a rating is a judgement a manager makes and owns. Draft the evidence, propose wording, and leave this to the human.', derived: true },
      {
        name: 'ratings', render: 'matrix', label: 'ratings',
        hint: 'The per-dimension picture: `columns` are the rating scale points and each row is {label, ref, cells} for one competency. Draw what the reviewer recorded; never fill a cell that was left blank.',
        derived: true,
      },
      { name: 'achievements', render: 'list', label: 'achievements', hint: 'What was actually delivered: [{title, detail}] with an outcome in each detail. "Worked hard" is not an achievement; "cut onboarding from 9 days to 3" is.' },
      { name: 'developmentAreas', render: 'list', label: 'developmentAreas', hint: 'Where growth is needed: [{title, detail}] where detail is a specific, observable behaviour and not a personality trait. The line between the two is the line between a development plan and a discrimination claim.' },
      { name: 'goals', render: 'rows', label: 'goals', columns: ['goal', 'measure', 'due'], hint: 'What comes next: {goal, measure, due}. A goal with no measure is a hope.' },
      { name: 'calibrationNote', render: 'text', label: 'calibrationNote', hint: 'What changed in calibration and why. This is the field that makes a distribution defensible — a rating moved without a recorded reason is the one an appeal wins.' },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
      EVIDENCE_FIELD,
    ],
  },
  {
    kind: 'skillsMatrix',
    icon: '⊟',
    group: 'Insights',
    defaultStatus: 'buildMatrix',
    actions: ['build', 'planGaps'],
    fields: [
      { name: 'scope', render: 'stat', label: 'scope', hint: 'Which team or capability area this covers.' },
      { name: 'criticalGaps', render: 'stat', label: 'criticalGaps', hint: 'Count of competencies with no proficient holder.', derived: true },
      { name: 'busFactor', render: 'stat', label: 'busFactor', hint: 'The smallest number of departures that would leave a required competency with nobody. This is the number a leadership team acts on and it is almost always lower than anyone expects.', derived: true },
      {
        name: 'matrix', render: 'matrix', label: 'matrix',
        hint: 'The grid: `columns` are competency names and each row is {label, ref, cells} for one person, cells holding a proficiency 0-4. Built by canvas_build_skills_matrix from the `competencies` on the employee objects — do not hand-author it, or it disagrees with the people it claims to describe.',
        derived: true,
      },
      {
        name: 'gaps', render: 'rows', label: 'gaps', columns: ['competency', 'required', 'proficient', 'shortfall', 'action'],
        hint: 'One row per shortfall: {competency, required, proficient, shortfall, action}. `action` is the build-vs-buy answer and must be one of: train | hire | contract | accept. THIS is what the rest of the company acts on, and an "action" of "monitor" is what a matrix produces when nobody has decided.',
        derived: true,
      },
      { name: 'requiredCompetencies', render: 'chips', label: 'requiredCompetencies', hint: 'The capabilities this scope must have, in the same words the employee objects use. Author these — they are a judgement about what the work needs, not something computable from who happens to be here.' },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
    ],
  },
  {
    kind: 'case',
    icon: '⚖',
    group: 'People',
    defaultStatus: 'open',
    actions: ['record', 'close'],
    fields: [
      { name: 'caseType', render: 'stat', label: 'caseType', hint: 'grievance | investigation | accommodation | disciplinary | performance-plan. A PIP is this kind with `performance-plan`, which is why there is no separate pip kind.' },
      { name: 'reference', render: 'stat', label: 'reference', hint: 'The case reference used in correspondence. Use the reference and NOT the person\'s name in the object title wherever the process allows it.' },
      { name: 'raisedAt', render: 'stat', label: 'raisedAt', hint: 'ISO date the matter was raised. Statutory clocks run from this, not from when it was opened here.' },
      { name: 'handler', render: 'stat', label: 'handler', hint: `${OWNER_HINT} The handler must not be in the reporting line of anyone involved, and if they are, say so in \`summary\`.` },
      { name: 'stage', render: 'stat', label: 'stage', hint: 'Where it has reached in the company\'s own procedure — informal | formal | hearing | appeal | closed. Following the published procedure is most of what makes an outcome stand.' },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: 'ISO date of the next procedural deadline. Bind a `trigger` to it: missed timescales are the single most common reason a well-handled case is lost.' },
      {
        name: 'timeline', render: 'rows', label: 'timeline', columns: ['date', 'event', 'actor', 'record'],
        hint: 'What happened and when: {date, event, actor, record}. Contemporaneous and factual. Record what was SAID and DONE, never what was inferred about anyone\'s motive — an inference in a case file is read out at a tribunal in the company\'s own words.',
      },
      { name: 'outcome', render: 'verdict', label: 'outcome', hint: 'What was decided and on what basis. NEVER author this from an AI turn: an outcome is a human decision with legal effect. Draft the chronology, summarise the evidence, and leave the finding to the handler.', derived: true },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
      EVIDENCE_FIELD,
    ],
  },
  {
    kind: 'obligation',
    icon: '⌛',
    group: 'Knowledge',
    defaultStatus: 'tracking',
    actions: ['research', 'schedule'],
    fields: [
      { name: 'jurisdiction', render: 'stat', label: 'jurisdiction', hint: 'The authority that imposes this, e.g. "California", "Ontario", "US Federal". The whole point of the kind: an obligation with no jurisdiction cannot be triggered by hiring somewhere new.' },
      { name: 'authority', render: 'stat', label: 'authority', hint: 'The body that enforces it — EEOC, OSHA, WSIB, HMRC, a state labour department.' },
      { name: 'obligationType', render: 'stat', label: 'obligationType', hint: 'filing | posting | training | record-keeping | insurance | registration.' },
      { name: 'triggeredBy', render: 'text', label: 'triggeredBy', hint: 'What makes this apply to us — a headcount threshold, a first hire in a state, a contract type. Write the threshold, because "applies to larger employers" is not something anyone can check against the board.' },
      { name: 'dueAt', render: 'stat', label: 'dueAt', hint: 'ISO date of the next deadline. Bind a `trigger` to it so the board warns before rather than reporting after.' },
      { name: 'cadence', render: 'stat', label: 'cadence', hint: 'once | annual | quarterly | monthly | on-event. Decides whether meeting it once is the end of it.' },
      { name: 'owner', render: 'stat', label: 'owner', hint: OWNER_HINT },
      { name: 'penalty', render: 'text', label: 'penalty', hint: 'What happens if it is missed, with the figure where one is published. This is what makes a compliance calendar get read.' },
      { name: 'status', render: 'verdict', label: 'obligationStatus', hint: 'met | due | overdue | not-applicable, and the reason. "Not applicable" is a real and useful answer, and recording WHY is what stops it being re-researched every quarter.' },
      SUMMARY_FIELD,
      EVIDENCE_FIELD,
    ],
  },
  // ── THE COLLECTION PRIMITIVE ──────────────────────────────────────────────────
  {
    kind: 'form',
    icon: '▣',
    group: 'Collaborate',
    defaultStatus: 'draft',
    actions: ['publish', 'collect'],
    fields: [
      { name: 'purpose', render: 'text', label: 'purpose', hint: 'What this form is for, in the words the RESPONDENT will read. It is shown to them above the questions, and a form that does not say why it is asking gets answered badly or not at all.' },
      { name: 'audience', render: 'stat', label: 'audience', hint: 'anyoneWithLink | workspace | namedRecipients. Who may submit. `workspace` requires the responder to be signed in to this workspace; `namedRecipients` additionally requires them to be on `recipients`.' },
      { name: 'anonymous', render: 'stat', label: 'anonymous', hint: 'true | false. An IDENTITY setting, not a privacy one: when true the response is stored with no respondent reference AT ALL, even for a signed-in responder. Use it for engagement pulses and exit feedback; it makes a policy acknowledgement worthless, so never set it on one.' },
      {
        name: 'questions', render: 'rows', label: 'questions', columns: ['id', 'type', 'label', 'required', 'options'],
        hint: 'The questions, in order: {id, type, label, required, options}. `type` is one of shortText, longText, email, number, date, select, multiSelect, scale, boolean. `id` is a stable slug — responses are keyed by it, so renaming an id after responses exist orphans every answer already collected.',
      },
      { name: 'opensAt', render: 'stat', label: 'opensAt', hint: 'ISO date submissions open. Leave empty to open on publish.' },
      { name: 'closesAt', render: 'stat', label: 'closesAt', hint: 'ISO date submissions close. A form with no close date is one nobody ever chases, because there is no moment at which it is late.' },
      { name: 'recipients', render: 'chips', label: 'recipients', hint: 'Who is expected to respond, when `audience` is namedRecipients. THE field that makes chasing possible: without the expected list, a response count cannot become "these six have not answered".' },
      { name: 'confirmationMessage', render: 'text', label: 'confirmationMessage', hint: 'Shown after a successful submit. Say what happens NEXT and by when — "thanks" is the least useful thing a respondent can be told.' },
      { name: 'shareUrl', render: 'stat', label: 'shareUrl', hint: 'The public URL, written by canvas_publish_form.', derived: true },
      { name: 'responseCount', render: 'stat', label: 'responseCount', hint: 'Submissions received.', derived: true },
      { name: 'completionRate', render: 'meter', label: 'completionRate', hint: 'Responses as a percentage of `recipients`. Absent when the audience is open, because a rate with no denominator is a number pretending to be one.', derived: true },
      { name: 'distribution', render: 'bars', label: 'distribution', hint: 'Answer counts for the summarised question: [{label, value}].', derived: true },
      {
        name: 'responses', render: 'rows', label: 'responses', columns: ['respondent', 'submittedAt', 'summary'],
        hint: 'Responses pulled onto the board: {respondent, submittedAt, summary}. `respondent` is empty on an anonymous form and MUST stay empty — a respondent inferred from timing or wording defeats the guarantee the form made.',
        derived: true,
      },
      SUMMARY_FIELD,
      CONFIDENTIALITY_FIELD,
    ],
  },
];

/**
 * English fallbacks the object palette shows before its i18n key resolves, matching how
 * every other vocabulary reads. The palette localizes through
 * `creationCanvas.people.label.*`.
 */
export const PEOPLE_LABELS: Record<PeopleObjectKind, string> = {
  employee: 'Employee',
  orgChart: 'Org chart',
  headcountPlan: 'Headcount plan',
  compBand: 'Compensation band',
  policy: 'Policy',
  employeeLifecycle: 'Onboarding / offboarding',
  absencePlan: 'Absence & coverage',
  performanceReview: 'Performance review',
  skillsMatrix: 'Skills matrix',
  case: 'ER case',
  obligation: 'Statutory obligation',
  form: 'Form',
};

/**
 * Blank-object status, as the English fallback matching every other vocabulary.
 *
 * None of these reads as finished. `buildChart` and `buildMatrix` say what the card is
 * waiting FOR rather than describing it as empty, because the two kinds they belong to
 * are computed from other objects and "Draft" would suggest somebody should type into
 * them — the empty-card-that-reads-as-configured defect, in its opposite form.
 */
export const PEOPLE_STATUSES: Record<string, string> = {
  active: 'Active',
  buildChart: 'Build from employees',
  buildMatrix: 'Build from employees',
  draft: 'Draft',
  planning: 'Planning',
  open: 'Open',
  tracking: 'Tracking',
};

/** The kinds this module actually specs, for the test that proves it matches the contract. */
export const PEOPLE_SPEC_KINDS: readonly PeopleObjectKind[] =
  PEOPLE_OBJECT_SPECS.map((spec) => spec.kind as PeopleObjectKind);

/** Kinds the contract declares, for the test that proves the two lists agree. */
export const PEOPLE_CONTRACT_KINDS = PEOPLE_OBJECT_KINDS;

registerSpecObjectSet({
  id: 'people',
  namespace: PEOPLE_NAMESPACE,
  specs: PEOPLE_OBJECT_SPECS,
});
