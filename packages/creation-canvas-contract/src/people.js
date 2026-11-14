/**
 * The PEOPLE vocabulary — HR operations, and the three primitives HR exposed as missing.
 *
 * ── WHY THIS SET EXISTS, IN THE SAME TERMS THE FOUNDER SET USED ──────────────────
 * The founder block in `index.ts` argues that a board with nowhere to put a competitor
 * answers a market question with prose, and that prose cannot be reasoned over by the
 * next turn. The identical argument had gone unmade for the seat that is entirely an HR
 * generalist's. `api/src/application/domains/people/entities.ts` declares twenty-two live
 * entities — employees, employment records, emergency contacts, headcount plans and their
 * impacts, competencies, badges, the whole LMS stack — every one registered in the kernel
 * and readable TODAY through `canvas_read_domain`. The canvas's entire People group was
 * four cards, of which `staff` held a job title, a focus line and an accent colour.
 *
 * So the gap was never "the data does not exist". It was that a domain the product had
 * already modelled had no shape on the surface that runs the company — precisely the
 * asymmetry `canvas_sync_company_profile` was added to close for the investor seat, left
 * open for the seat where the rows are about PEOPLE.
 *
 * ── WHY HIRING IS NOT HERE ───────────────────────────────────────────────────────
 * `HIRING_OBJECT_KINDS` in `index.ts` owns the funnel: `candidate`, `jobPosting`,
 * `shortlist`, `interviewLoop`, `scorecard`, `offer`, `placement`. Recruiting and people
 * operations are two bounded contexts with two owners — the Recruiter agent and the HR
 * agent, which `provisionBuiltinAgents.ts` already ships as separate seats — and the
 * handover between them is an `offer` becoming an `employee`. Declaring a second
 * `candidate` here would have been the same object under two owners, which is the one
 * thing a bounded context exists to refuse.
 *
 * That handover is PERFORMED, not merely described: `handover.ts` declares the mapping
 * and `offer.hire` runs it, producing the `employee` and the onboarding
 * `employeeLifecycle` below with an `offerRef` back to the offer they came from. This
 * paragraph used to be the only place the transition existed, which is how the product
 * came to ship two funnels that stopped next to each other.
 *
 * ── THESE ARE INPUTS TO EACH OTHER ──────────────────────────────────────────────
 * An `orgChart` is only true if the `employee` objects under it carry a manager. An
 * `offer` is only defensible if its number sits inside a `compBand`. A `headcountPlan`
 * is what a `jobPosting` is approved against, and an `employeeLifecycle` is what an
 * accepted offer becomes on day one. Declaring them as one set is what lets ONE spec per
 * kind drive the node body, the model-facing field contract and the empty-shell rule —
 * the reason the founder set is one declaration and not seventeen render branches.
 *
 * ── WHAT IS DELIBERATELY *NOT* A KIND ───────────────────────────────────────────
 * A PIP is a `case` with `caseType: 'performance-plan'`. A one-to-one is a
 * `performanceReview` with `reviewType: 'one-on-one'`. Both were named as their own kinds
 * in the review that produced this set and are column values instead: "a new kind is a
 * column value, not a new table" governs canvas kinds for the same reason it governs
 * schema, and a `pip` kind would have needed its own copy of every restricted-access rule
 * `case` already carries — which is how two objects come to disagree about who may read
 * the more sensitive one.
 */
// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------
export const PEOPLE_OBJECT_KINDS = [
    // ── THE PERSON, AND THE SHAPE OF THE ORGANISATION ─────────────────────────────
    // `staff` stays what it always was — a card for somebody on this board. `employee` is
    // the employment RELATIONSHIP: department, manager, employment basis, status, dates.
    // `people_employees.managerRef` has always carried the edge an org chart is drawn from
    // and nothing on the canvas could hold it, so the board could not draw an org even from
    // data it could already read.
    'employee',
    // Derived from those manager references and editable as a SCENARIO — which is the half
    // a read-only directory cannot do and the half a reorg is entirely made of. Span of
    // control and the layers under a manager are computed, never typed, because a typed
    // span is wrong the first time somebody moves.
    'orgChart',
    // Approved vs actual vs budget, per team. The object a requisition is approved against
    // and the one that makes "can we afford this hire" answerable on the board rather than
    // in a thread nobody can find in March.
    'headcountPlan',
    // Range, midpoint, comparatio. The object that makes an offer checkable and pay equity
    // answerable — the highest-value question in the whole set, and the one the data model
    // could already answer while the canvas could not ask it.
    'compBand',
    // ── THE PAPER AND THE PROCESS ─────────────────────────────────────────────────
    // A policy with a LIFECYCLE: effective date, jurisdiction, owner, review cadence and an
    // acknowledgement roster. Drafting one was always possible with `document`; publishing
    // it, collecting acknowledgements and chasing the people who have not signed were the
    // three steps with no home — which is four-fifths of the actual job.
    'policy',
    // Onboarding and offboarding as ONE kind with a `direction`, because they are the same
    // shape — dated steps against an anchor date, an owner per step, evidence per step —
    // and their compliance-critical halves (right-to-work checked; access revoked) are
    // mirror images. Two kinds would be one shape maintained twice, and the leaver half is
    // the one that carries real risk.
    'employeeLifecycle',
    // Who is away, and whether the rota survives it. Every delivery forecast on this board
    // models capacity as though headcount were always available; this is the subtrahend.
    'absencePlan',
    // ── PERFORMANCE, CAPABILITY AND RELATIONS ─────────────────────────────────────
    // One review cycle for one person, at whatever cadence `reviewType` names.
    'performanceReview',
    // competencies × people, with the gap named. The one HR artifact the rest of the
    // company acts on, because it is what answers build-vs-buy for a capability — which is
    // the sentence that turns a skills gap into either a `course` or a `jobPosting`.
    'skillsMatrix',
    // Employee-relations casework: grievance, investigation, accommodation, disciplinary,
    // performance plan. RESTRICTED by construction — see `RESTRICTED_BY_DEFAULT_KINDS`.
    // This kind is why confidentiality is a declared part of the contract rather than
    // something the export seam remembers to check.
    'case',
    // A STATUTORY commitment, as against `contract.obligations`, which are commitments to a
    // counterparty. "We just hired in California and Ontario — what changes?" had no object
    // at all.
    //
    // NOT YET WATCHABLE. This comment used to claim `trigger` binds to this object's `dueAt`
    // and warns before the deadline. It does not: `canvasTriggers.ts` parses a NUMBER out of
    // a `liveMetric` on the same board and compares it with below/above/equals/changes-by,
    // so there is no date comparator and no binding to a non-metric object — and
    // `canvas_evaluate_triggers` is a frontend tool with no server sweep, so nothing
    // evaluates while the board is closed. A statutory deadline is therefore recorded here
    // and noticed by a person. See the Gap Register entry "date-bearing triggers".
    'obligation',
    // ── THE COLLECTION PRIMITIVE ──────────────────────────────────────────────────
    // A structured question set that a REAL HUMAN answers, and the responses that come back.
    //
    // It is declared in this vocabulary because HR is the domain that exposed its absence —
    // applications, acknowledgements, 360s, exit interviews, pulses and accommodation
    // requests are all one shape — but every field it declares is deliberately domain
    // NEUTRAL. Support intake, a research screener and a satisfaction round are the same
    // object, and handing the domain that asked first a private copy is how a product ends
    // up with three response stores. `pulse_surveys` becomes its first binding rather than
    // its competitor.
    //
    // This is the single largest "idea to REAL" break the canvas had: it could author
    // anything and collect nothing, so every flow that needed an answer from a person
    // terminated in a document and finished its real work somewhere else.
    'form',
];
// ---------------------------------------------------------------------------
// Confidentiality — the precondition, not a feature
// ---------------------------------------------------------------------------
/**
 * How far an object may travel.
 *
 * ── WHY THIS IS IN THE CONTRACT AND NOT AT THE EXPORT SEAM ──────────────────────
 * Because the seam is not one place. A board leaves through document export, a public
 * share link, the guest surface, a Drive push, and the AI context a model may quote into
 * a chat transcript. A rule stated at any one of those is a rule the other four do not
 * apply, and the objects this vocabulary adds are exactly the ones where that gap is a
 * disclosure rather than an inconvenience: salary, ratings, health and accommodation,
 * grievances, right-to-work evidence.
 *
 * ── WHY IT IS AN OBJECT LEVEL AND NOT ONLY A FIELD FLAG ─────────────────────────
 * `CanvasObjectField.restricted` in `objectSpec.ts` marks a FIELD the model may not read
 * — self-identified demographics on a candidate, which exist so the data has a lawful
 * home and must never reach a ranking prompt. That is a different question from this one.
 * A `case` has no single restricted field: its title is "Grievance — <name>", and the
 * whole object is the disclosure. Field marking answers "may the model read this cell";
 * this answers "may this card leave the board at all". Both are needed and neither
 * subsumes the other.
 *
 * The ordering is load-bearing. The list is ranked least to most restricted, so
 * "may this object cross this boundary" is ONE index comparison
 * ({@link confidentialityAtMost}) rather than a switch each caller writes its own version
 * of — which is how three surfaces come to disagree about what "internal" means.
 *
 *  • `public`      may leave the workspace: a job posting, a published policy, a form.
 *  • `internal`    workspace-only. The default for anything unlabelled, because
 *                  defaulting to `public` makes an unlabelled object a leak and
 *                  defaulting to `restricted` makes the product stop working.
 *  • `restricted`  named audience only, and never leaves the board.
 */
export const CONFIDENTIALITY_LEVELS = ['public', 'internal', 'restricted'];
/** The level assumed for an object that does not declare one. */
export const DEFAULT_CONFIDENTIALITY = 'internal';
export function isConfidentialityLevel(value) {
    return typeof value === 'string' && CONFIDENTIALITY_LEVELS.includes(value);
}
/**
 * Kinds that start `restricted` unless their author says otherwise.
 *
 * A default is the only protection that survives an author who did not think about it,
 * and these are the kinds where not thinking about it IS the disclosure. The hiring kinds
 * are on this list even though they are declared in the other vocabulary: confidentiality
 * is a property of what an object HOLDS, not of which set declared it, and an unsuccessful
 * applicant never consented to their assessment being visible to a whole workspace.
 */
export const RESTRICTED_BY_DEFAULT_KINDS = [
    // People operations.
    'case', 'compBand', 'performanceReview', 'employee',
    // Hiring (declared in HIRING_OBJECT_KINDS; classified here, where the rule lives).
    'candidate', 'scorecard', 'offer', 'shortlist', 'placement',
    // Operations (declared in OPERATIONS_OBJECT_KINDS; classified here for the same
    // reason the hiring kinds are — confidentiality is a property of what an object
    // HOLDS, not of which set declared it). An `incident` is an injury, a near miss or a
    // service failure: it names the person it happened to, records their harm, and is
    // routinely the subject of a claim. Sharing a board must not share it by default.
    'incident',
];
/**
 * Kinds that start `public` because being published IS the object.
 *
 * A job posting nobody outside the company can read is not a job posting, and a form that
 * cannot be sent to the person answering it collects nothing. Declaring these rather than
 * letting an author downgrade each one is what keeps the default safe everywhere else:
 * the exceptions stay a short reviewable list instead of becoming a habit of overriding.
 */
export const PUBLIC_BY_DEFAULT_KINDS = ['jobPosting', 'form'];
/** The confidentiality an object of this kind starts at. */
export function defaultConfidentialityForKind(kind) {
    if (RESTRICTED_BY_DEFAULT_KINDS.includes(kind))
        return 'restricted';
    if (PUBLIC_BY_DEFAULT_KINDS.includes(kind))
        return 'public';
    return DEFAULT_CONFIDENTIALITY;
}
/**
 * True when `level` is no more restricted than `ceiling` — i.e. an object at `level` may
 * cross a boundary that admits everything up to `ceiling`.
 *
 * THE one comparison. Every caller (export, share, guest advertise, AI context, Drive
 * push) asks this question and none of them re-derives the ranking.
 */
export function confidentialityAtMost(level, ceiling) {
    return CONFIDENTIALITY_LEVELS.indexOf(level) <= CONFIDENTIALITY_LEVELS.indexOf(ceiling);
}
// ---------------------------------------------------------------------------
// The boundaries — where the level is actually ASKED
// ---------------------------------------------------------------------------
/**
 * The five places a canvas object can leave the board.
 *
 * A level nobody reads is a comment. `confidentialityAtMost` was written as THE one
 * comparison and had no callers, so the vocabulary classified objects that then crossed
 * every boundary unchallenged. Naming the boundaries here — rather than letting each
 * caller decide privately what it is — is what makes "do these five agree" a question
 * with an answer.
 *
 *  • `export`      a file written to a workspace member's own disk (docx/pdf/xlsx/csv…).
 *  • `share`       a public link handed to somebody with no account.
 *  • `guest`       the object set a signed-out visitor's board advertises.
 *  • `publicMedia` a card's picture or clip re-hosted at a URL a social network fetches
 *                  with no session and no headers of ours — the most irreversible of the
 *                  five, because a network that has fetched it has a copy.
 *  • `aiContext`   the snapshot a model may quote back into a transcript.
 *
 * A connected cloud Drive is deliberately NOT on this list. The Drive integration reads
 * INTO the canvas and has no write path (`driveRoutes` exposes list and download only), so
 * a `drive` boundary would be a ceiling with nothing to stop — the same declared-contract-
 * with-no-caller this whole module exists to stop being. When a push is built, it is added
 * here first.
 */
export const CANVAS_BOUNDARIES = ['export', 'share', 'guest', 'publicMedia', 'aiContext'];
/**
 * The most confidential thing each boundary admits.
 *
 * ── THE LINE THIS TABLE DRAWS ───────────────────────────────────────────────────
 * The deciding question is NOT "does this leave the workspace" — it is "does a member
 * DECIDE, object by object, that it should". Four of the five boundaries are a deliberate
 * act by a signed-in member against a card they picked: they export it, they mint a link
 * for it, they push it to their Drive. A member exercising that authority may publish
 * something `internal`; that is what the authority is for, and a ceiling of `public` would
 * mean the sell-motion share link could carry almost nothing, since `internal` is the
 * default for everything unlabelled. What none of them may ever move is `restricted`,
 * which was defined as "named audience only, and never leaves the board" — so those four
 * sit at `internal` and `restricted` crosses nothing, anywhere.
 *
 * `guest` is the one boundary that is not a decision. A signed-out visitor's board
 * advertises its object set with nobody choosing card by card, so it admits `public`
 * only — which is exactly the distinction `public` exists to draw, and the reason the
 * level is not merely a two-value flag.
 *
 * `publicMedia` sits at `internal` with the other deliberate acts, but it is the one to
 * revisit first if this table is ever loosened: the others produce a link that can be
 * revoked or a file whose holder is known, and this one hands a permanent copy to a
 * third party.
 *
 * `aiContext` is `internal` for a subtler reason than the others: the model runs inside
 * the workspace's own turn, so nothing has left. What it must not do is quote a grievance
 * or a comp band into a transcript that a different reader of the board later scrolls —
 * a re-disclosure INSIDE the workspace, to an audience the restricted object never named.
 */
export const BOUNDARY_CEILING = {
    export: 'internal',
    share: 'internal',
    guest: 'public',
    publicMedia: 'internal',
    aiContext: 'internal',
};
/** True when an object at `level` may cross `boundary`. THE question, asked once. */
export function boundaryAdmits(level, boundary) {
    return confidentialityAtMost(level, BOUNDARY_CEILING[boundary]);
}
const HIRING_RETENTION = {
    // One year from the decision covers the longest ordinary discrimination-claim window;
    // two years is the point at which keeping a rejected applicant's assessment stops being
    // defensible as anything but a habit.
    erasable: true, minimumRetentionDays: 365, maximumRetentionDays: 730, clock: 'created',
};
const EMPLOYMENT_RETENTION = {
    // Six years past the end of the relationship is the common floor once payroll, pension
    // and tax obligations are taken together. Not erasable while that obligation runs.
    erasable: false, minimumRetentionDays: 2190, maximumRetentionDays: 0, clock: 'relationshipEnded',
};
const CASE_RETENTION = {
    // A grievance or a performance plan is the record that is produced in a dispute. It
    // outlives the relationship it describes and cannot be erased on request.
    erasable: false, minimumRetentionDays: 2190, maximumRetentionDays: 0, clock: 'relationshipEnded',
};
/** Per-kind overrides. Anything absent uses {@link DEFAULT_RETENTION}. */
export const RETENTION_RULES = {
    candidate: HIRING_RETENTION,
    scorecard: HIRING_RETENTION,
    shortlist: HIRING_RETENTION,
    offer: HIRING_RETENTION,
    placement: HIRING_RETENTION,
    employee: EMPLOYMENT_RETENTION,
    employeeLifecycle: EMPLOYMENT_RETENTION,
    performanceReview: CASE_RETENTION,
    case: CASE_RETENTION,
};
/**
 * The rule for a kind with no special obligation: keep it while it is useful, and honour
 * an erasure request immediately, because there is nothing requiring otherwise.
 */
export const DEFAULT_RETENTION = {
    erasable: true, minimumRetentionDays: 0, maximumRetentionDays: 0, clock: 'created',
};
/** The retention rule a kind is held to. */
export function retentionForKind(kind) {
    return RETENTION_RULES[kind] ?? DEFAULT_RETENTION;
}
/**
 * Whether an object of this kind may be erased today, given how long its clock has run.
 *
 * `daysElapsed` is measured from whichever event the rule's `clock` names — the caller
 * owns that date because only the caller knows when the relationship ended.
 */
export function mayErase(kind, daysElapsed) {
    const rule = retentionForKind(kind);
    if (!rule.erasable)
        return false;
    return daysElapsed >= rule.minimumRetentionDays;
}
// ---------------------------------------------------------------------------
// Forms — the shape a response is collected in
// ---------------------------------------------------------------------------
/**
 * The answer types a form question may ask for.
 *
 * Closed deliberately and kept small. Every type here renders as one accessible control
 * and validates with one rule; a free-form "custom" escape hatch would put validation in
 * the author's prose, where nothing can check it and a required field silently is not.
 */
export const FORM_FIELD_TYPES = [
    'shortText', 'longText', 'email', 'number', 'date',
    'select', 'multiSelect', 'scale', 'boolean',
];
export function isFormFieldType(value) {
    return typeof value === 'string' && FORM_FIELD_TYPES.includes(value);
}
/**
 * Who may answer a published form.
 *
 * `anonymous` is deliberately NOT one of these values, because it is not an audience — it
 * is an identity setting, and the distinction is load-bearing: an anonymous engagement
 * pulse must not record who answered even though the responder is signed in, while a
 * policy acknowledgement is worthless unless it does. Conflating them is how an
 * "anonymous" survey comes to carry a user id. `anonymous` is its own boolean on the form.
 */
export const FORM_AUDIENCES = ['anyoneWithLink', 'workspace', 'namedRecipients'];
export function isFormAudience(value) {
    return typeof value === 'string' && FORM_AUDIENCES.includes(value);
}
export const FORM_STATUSES = ['draft', 'open', 'closed'];
export function isFormStatus(value) {
    return typeof value === 'string' && FORM_STATUSES.includes(value);
}
// ---------------------------------------------------------------------------
// Signature — what turns a draft into a record
// ---------------------------------------------------------------------------
/**
 * The state of one party's signature.
 *
 * `acknowledged` is distinct from `signed` on purpose. Acknowledging a handbook and
 * signing an offer are different acts with different evidentiary weight, and a product
 * that records both as "signed" cannot later tell an auditor which one happened. Same
 * table, same audit trail, different word — the 3NF answer (a kind is a column value)
 * applied to a distinction that genuinely matters.
 */
export const SIGNATURE_PARTY_STATUSES = ['pending', 'viewed', 'signed', 'acknowledged', 'declined'];
export const SIGNATURE_REQUEST_STATUSES = ['draft', 'sent', 'completed', 'declined', 'cancelled', 'expired'];
/**
 * What is being asked of the signer. Drives the wording the party sees and the retention
 * rule that applies to the completed record; the engine treats both identically.
 */
export const SIGNATURE_INTENTS = ['sign', 'acknowledge'];
export function isSignatureIntent(value) {
    return typeof value === 'string' && SIGNATURE_INTENTS.includes(value);
}
/**
 * A terminal party status — one that will not change again without a new request.
 *
 * Declared here rather than tested inline because THREE places need the same answer (the
 * request's own completion check, the reminder job's "who still owes us", and the canvas
 * object's progress meter) and a fourth would have got it subtly wrong: `declined` is
 * terminal and is NOT completion, which an `=== 'signed'` test in each caller gets right
 * and a `!== 'pending'` test does not.
 */
export function isTerminalPartyStatus(status) {
    return status === 'signed' || status === 'acknowledged' || status === 'declined';
}
/** Whether this party has actually agreed, as opposed to merely finished. */
export function isAgreedPartyStatus(status) {
    return status === 'signed' || status === 'acknowledged';
}
//# sourceMappingURL=people.js.map