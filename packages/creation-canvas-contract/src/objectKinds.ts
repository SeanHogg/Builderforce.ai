/**
 * THE OBJECT VOCABULARY — every kind a board can hold, the named families it is made
 * of, the legacy renames a read path still accepts, and the connection and command
 * vocabularies the transport carries.
 *
 * ── WHY THIS IS ITS OWN MODULE ─────────────────────────────────────────────────
 * It used to be the body of `index.ts`, which made the package entry point a barrel
 * AND ~1,000 lines of declarations at once: reading what the package exports meant
 * scrolling past every kind comment, and a consumer that wanted only the kind list
 * had no narrower door than the whole package. `index.ts` is now only re-exports;
 * this file is also reachable directly as
 * `@builderforce/creation-canvas-contract/objectKinds`.
 *
 * The creative output capabilities that used to sit between the kind list and the
 * connection kinds are a different concern (what a kind can be EXPORTED as) and
 * live in `creativeCapabilities.ts`.
 */

import { PEOPLE_OBJECT_KINDS } from './people';
import { ACADEMIC_OBJECT_KINDS } from './academic';
import { DATA_SCIENCE_OBJECT_KINDS } from './dataScience';
import { OPERATIONS_OBJECT_KINDS } from './operations';
import { SELL_MOTION_OBJECT_KINDS } from './sellMotion';
import { CAREER_OBJECT_KINDS } from './career';
import { MARKETING_OBJECT_KINDS } from './marketing';

/**
 * The FOUNDER objects — the half of "idea to real" that is not a made artifact.
 *
 * ── WHY THESE ARE A NAMED SET ────────────────────────────────────────────────────
 * The canvas could already MAKE almost anything: seventy-nine kinds covering video,
 * decks, code, games, models, campaigns. What it could not hold was the company doing
 * the making. Asked "analyse my competitors in Florida, size the customers my GTM can
 * reach, and tell me how to win them", the board had nowhere to put a competitor, a
 * segment, a go-to-market, or the decision that came out of it — so the answer landed
 * as prose in a `document` and stopped being an object the next turn could reason over.
 *
 * These kinds are declared together because they share one property that none of the
 * creative kinds have: THEY ARE THE INPUTS TO EACH OTHER. A `battlecard` is only
 * truthful if it was written against a real `competitor` and a real `company`; a
 * `customerSegment` is only sized if a `gtmPlan` said which motion reaches it. Keeping
 * them one declared set is what lets `founderObjects.ts` hold ONE spec per kind that
 * the node body, the AI field documentation, and the empty-shell rule all read — rather
 * than seventeen render branches and seventeen prompt paragraphs drifting apart.
 *
 * ── THE LIVE / PINNED SPLIT, FINALLY APPLIED TO THE NUMBERS ──────────────────────
 * `inbox`/`email` and `socialFeed`/`socialPost` already draw the distinction that
 * matters on a board someone comes back to: a LIVE view that re-reads, and a PINNED
 * artifact that stops changing so it can be annotated and connected. Every finance and
 * investor answer the canvas gave was the pinned half only — a `dashboard` stamped with
 * an as-of date, wrong by the next morning and with no way to ask again.
 *
 * `liveMetric` is the live half for numbers: it stores the DOMAIN BINDING it was created
 * from (`finance.runway_months`, `revenue.pipeline`) and re-reads it, exactly as an
 * inbox re-reads a mailbox. `trigger` is what makes the board speak first — a bound
 * threshold that is evaluated rather than watched by a person who has to remember to
 * look.
 *
 * ── WHY `liveMetric` AND NOT `metric` ───────────────────────────────────────────
 * `metric` is taken, by the data-architecture set above, for the SEMANTIC-LAYER
 * DEFINITION of a number — its formula, grain and dimensions, the answer to "how is ARR
 * calculated here". This is the other half: one bound READING of such a number, with its
 * value, its series and the instant it was fetched. Collapsing the two would make "the
 * definition of revenue" and "revenue right now" the same object, and a board could no
 * longer hold a definition that several live readings agree to follow.
 */
export const FOUNDER_OBJECT_KINDS = [
  // WHO WE ARE. The anchor every other founder object is authored against, and the
  // reason "use my existing business details" can be a real instruction rather than a
  // request for the user to paste their own company into the prompt. Hydrates from the
  // investor seat's `companies` entity when there is a tenant, and is authored directly
  // when there is not — a guest evaluating the product still has a company.
  'company',
  // WHO WE ARE AGAINST. One rival, with the geography that makes a market analysis
  // spatial rather than a list: `locations` carry lat/lng, so the same competitors that
  // answer "who is in Florida" also answer "where are they NOT".
  'competitor',
  // WHO WE SELL TO, and the plan that reaches them. A segment is sized and sourced;
  // a GTM plan names the motion, the channels and the economics that make the segment
  // reachable — which is what turns "potential customers" into a list with a route.
  'customerSegment', 'gtmPlan',
  // HOW WE WIN A NAMED RIVAL'S CUSTOMER. Deliberately its own kind rather than a field
  // on `competitor`: the analysis of a rival and the plan to take their customers have
  // different authors, different review cycles, and different lifetimes.
  'battlecard',
  // THE EVIDENCE UNDER ALL OF IT. A customer conversation and a run experiment are the
  // two things that turn an assumption into a fact, and the canvas had neither.
  //
  // Named `customerInterview` and not `interview` because the hiring domain registers a
  // JOB interview under `kind: 'interview'` in the kernel `objects` table
  // (`api/src/application/domains/hiring/entities.ts`). Two different things under one
  // word in the ubiquitous language is how `canvas_read_domain('hiring')` comes to hand
  // the model rows it maps onto a discovery card with `painsHeard` and `segment` — the
  // same collision class the FinOps `soc_controls` rename exists to record. The founder
  // kind carries the qualifier because it is the one with an adjective available; the
  // hiring kind keeps the bare noun a recruiter actually says.
  'customerInterview', 'experiment',
  // WHAT WE CHOSE AND WHY. The canvas recorded what HAPPENED in five places (timeline,
  // activity, checkpoints, branches, the action journal) and why we CHOSE in none.
  'decision',
  // WHAT COULD GO WRONG, TRACKED RATHER THAN BURIED IN A NOTE. `decision`'s sibling
  // durable artifact: a decision is chosen and reasoned about once, a risk is watched
  // and re-scored over the life of a project. Before this it degraded to a free-text
  // `note`, which meant it could not roll up (how many open risks, what is the highest
  // exposure) or be reported on — the same gap `decision` closed for the choices.
  'risk',
  // WHAT WE ARE AIMING AT, on the board rather than only in the PMO spine.
  'objective',
  // THE LIVE HALF. See the block comment above.
  'liveMetric', 'trigger',
  // THE MONEY. A canvas that can design and market a product but cannot price it,
  // raise against it, or say who owns it is a canvas for a project, not a company.
  'pricing', 'capTable', 'fundingRound', 'investorUpdate', 'dataRoom',
  // ── OWNERSHIP, AS EVENTS RATHER THAN A TYPED TABLE ──────────────────────────────
  // `capTable` above is now a PROJECTION — it computes its own totals from the real
  // ledger and nothing writes a percentage onto it. These two are what the ledger is
  // made of, and each is its own kind for a reason the other cannot carry:
  //
  //  • `equityGrant` is an award with a VESTING SCHEDULE, which is a set of terms with
  //    a date attached — so it is the only ownership object a `trigger` can watch, and
  //    `cliffAt` is a declared deadline for exactly that. Folding it into `capTable`
  //    would mean one card per company holding N schedules with N cliff dates, of which
  //    a deadline binding could watch precisely one.
  //  • `convertible` is a SAFE or a note: money that is NOT yet equity and converts on
  //    terms (cap, discount, pre/post-money) that decide what everybody else ends up
  //    owning. `fundingRound.roundType: 'safe'` was a label over nothing, and a priced
  //    round modelled without the stack in front of it is modelled against a fiction.
  'equityGrant', 'convertible',
  // ── THE MONEY, OPERATED ─────────────────────────────────────────────────────────
  // The five kinds above hold the money a company RAISES and CHARGES. These five hold
  // the money it PLANS, COLLECTS, OWES and SPENDS ON PEOPLE — the difference between a
  // board that can run a fundraise and one that can run a month.
  //
  // WHY EACH IS ITS OWN KIND, and not a status on one `finance` object:
  //  • `budget` is the PLAN. It is authored once a year, approved, and then compared
  //    against — so it must stop changing while actuals move. Budget-vs-actual is the
  //    single most-performed operation in the role and had nowhere to live.
  //  • `forecast` is the MODEL. It re-computes from drivers and scenarios and is
  //    expected to change weekly, which is the exact opposite lifetime to a budget's.
  //    Collapsing the two would make "what we committed to" and "what we now expect"
  //    the same object, and the variance between them is the entire report.
  //  • `invoice` / `bill` are RECEIVABLE and PAYABLE. Two kinds rather than one signed
  //    number because they have different counterparties, different owners, different
  //    ageing rules, and because "who owes us" and "who we owe" are asked separately.
  //
  // All four carry structured money (`canvasMoney.ts`) rather than the prose the five
  // above were designed around, which is what makes them summable.
  //
  // NOT HERE, DELIBERATELY: `headcountPlan`. The largest line in any budget is people,
  // and the canvas could draw them as an org (`team`/`role`/`staff`) and never as a
  // cost — so the CFO review asked for a cost-bearing headcount object. `PEOPLE_OBJECT_
  // KINDS` already declares one, from the HR seat, holding approved-vs-actual headcount
  // per team. Declaring a second would be two specs for one noun and two answers to
  // "how many people are we planning", which is the collision `customerInterview` is
  // renamed to avoid. The single spec in `peopleObjects.ts` carries BOTH halves instead:
  // HR owns the establishment, finance owns what it costs, and a role's loaded cost is
  // one fact in one place.
  'budget', 'forecast', 'invoice', 'bill',
  // ── WHAT PAYROLL ACTUALLY COST ──────────────────────────────────────────────────
  // The fifth of the operated-money kinds, and the one that makes the largest line on
  // a forecast a FACT rather than a figure somebody typed.
  //
  // WHY IT IS ITS OWN KIND AND NOT A `bill`. A pay run has no counterparty to approve,
  // dispute or schedule: the money has already left, through a provider that calculated
  // it. Modelling it as a payable would put a vendor's demand and a completed
  // disbursement under one lifecycle, and `bill.approve` — the one act on this platform
  // that can cause real financial harm — would become available on a row nobody can
  // authorise because it is already done.
  //
  // WHY IT IS READ-ONLY IN PRACTICE. Every figure on it is one a payroll provider
  // returned, hydrated by `canvas_sync_pay_run`. The platform must never CALCULATE a
  // salary or a tax — see `connectors/defaults/payroll.ts` for the full argument — so
  // this card reports and never computes.
  'payRun',
  // THE PAPER. Formation, customer and vendor agreements — the first ninety days of a
  // company, which the governance vocabulary (SOC 2 controls, vendor registers) covers
  // for an enterprise and not at all for a new one.
  'contract',
  // ── THE COUNTERPARTY ────────────────────────────────────────────────────────────
  // An account you have WON, or a vendor you buy from — the ONE object every
  // commercial reference on this board points at.
  //
  // WHY IT WAS MISSING, AND WHY THAT COST SOMETHING. `company` is US. `competitor` is
  // THEM. `salesContact` is a person and `customerSegment` is a cohort; none of the
  // four is an account. So `invoice.customer`, `bill.vendor`, `contract.counterparty`
  // and `placement.client` were each told to "match it to a company, salesContact or
  // contract on the board where one exists" — four fields matching four different
  // typed strings, which means joining a contract to its invoices, its tickets and its
  // renewal was a string comparison that a trailing "Ltd" broke.
  //
  // WHY IT IS NOT A NEW TABLE. `party_roles` in the kernel already holds exactly one
  // row per (tenant, party kind, party ref, role) with a unique index proving it — the
  // counterparty EXISTS and the canvas simply could not see it. A second customer store
  // is the collision `finance_soc_controls` exists to record. So the kind carries a
  // `partyRef`, and `parties.ts` declares the ref format and the role vocabulary that
  // both sides resolve through.
  'account',
] as const;

export type FounderObjectKind = typeof FOUNDER_OBJECT_KINDS[number];

const FOUNDER_KIND_SET: ReadonlySet<string> = new Set<string>(FOUNDER_OBJECT_KINDS);

/** True for the founder objects declared above — the set `founderObjects.ts` specs. */
export function isFounderObjectKind(value: unknown): value is FounderObjectKind {
  return typeof value === 'string' && FOUNDER_KIND_SET.has(value);
}

/**
 * The HIRING objects — the recruiter's funnel, from sourcing to the fee.
 *
 * ── WHY THIS SET EXISTS ──────────────────────────────────────────────────────────
 * `api/src/application/domains/hiring/entities.ts` registers twenty-three tables and
 * three navigable kernel objects; `provisionBuiltinAgents.ts` ships a `recruiter` agent
 * titled "owns hiring: postings, screening, interviews and offers"; `lib/seats.ts`
 * reserves a Recruiter seat and its colour token. The canvas had ninety-plus kinds and
 * not one of them was a hiring object, so every one of those rows was reachable only as
 * an anonymous `table` and the Recruiter agent had nothing to put on a board.
 *
 * The shape is not invented here — it is the SALES funnel, which the canvas already
 * models with six first-class kinds (`salesPipeline`, `salesContact`, `salesCampaign`,
 * `targetMarket`, `salesGoal`, `salesMeeting`). Recruiting is the same motion pointed at
 * people, and the deliberate parallel is why `candidate` reads like `salesContact` and
 * `talentPool` reads like `targetMarket`: two funnels that behave the same should look
 * the same, and the reviewer of one should already know how to read the other.
 *
 * ── THE ONE PLACE IT IS NOT LIKE SALES ───────────────────────────────────────────
 * A sales contact is a business contact. A CANDIDATE is a private individual whose
 * record carries regulated data with two opposite clocks — a rejected applicant has a
 * maximum retention, an employment record has a statutory minimum — and whose
 * self-identified demographic data is collected for statutory reporting and is unlawful
 * to use in an evaluation. That is why `CanvasObjectField.restricted` exists and why
 * `candidate` is the only kind in the canvas that declares it: the fields exist so the
 * data has a lawful home, and they are unreadable by the model that ranks the shortlist
 * because they are marked, not because a prompt asks nicely.
 *
 * ── WHY `funnel` IS NOT IN THIS SET ──────────────────────────────────────────────
 * Conversion-through-stages is not a hiring idea. The marketing review asked for the
 * same object on the same day for the same reason, so `funnel` is declared with the
 * generic kinds and carries the domain it is bound to as a VALUE. One kind, two
 * consumers — the open/closed answer the connector platform already gives for vendors.
 */
export const HIRING_OBJECT_KINDS = [
  // WHO WE ARE HIRING. One person in one search, with the stage they are at and the
  // consent under which we hold them. The `salesContact` of this funnel.
  'candidate',
  // WHERE THEY CAME FROM. A reproducible sourcing search plus the people it found —
  // the object that makes silver-medallist re-engagement possible at all, because the
  // list survives the search that produced it.
  'talentPool',
  // WHAT WE ARE HIRING FOR, and WHERE IT WAS ADVERTISED. Requisition and distribution
  // are one object because a posting nobody can see is not a posting: the board list is
  // the field that makes "post this role" end in something real.
  'jobPosting',
  // WHO MADE THE CUT. N résumés ranked against ONE posting, with the reason each rank
  // was given. The screening half the ATS scorer could not express when it took one
  // résumé and one job description.
  'shortlist',
  // WHAT THEY WILL BE PUT THROUGH, and the link that lets them book it themselves.
  'interviewLoop',
  // WHAT ONE INTERVIEWER THOUGHT, per attribute, submitted independently. Its own kind
  // rather than a field on the loop because independence is the whole point: a
  // scorecard that can be read before it is submitted is a scorecard that anchors.
  'scorecard',
  // WHAT WE OFFERED, what it is worth, who approved it, and whether it is signed.
  'offer',
  // THE FEE. For an agency or embedded recruiter this is the revenue event, and the
  // split is the business — `placement_splits` is registered read-only in the domain
  // precisely because it is money.
  'placement',
] as const;

export type HiringObjectKind = typeof HIRING_OBJECT_KINDS[number];

const HIRING_KIND_SET: ReadonlySet<string> = new Set<string>(HIRING_OBJECT_KINDS);

/** True for the hiring objects declared above — the set `hiringObjects.ts` specs. */
export function isHiringObjectKind(value: unknown): value is HiringObjectKind {
  return typeof value === 'string' && HIRING_KIND_SET.has(value);
}

/**
 * The LEGAL objects — secure files held against the legal seat's own record tables
 * (`legal_entities`, `legal_matters`, `intellectual_property`), rather than described
 * in a hand-authored `document` or `file` object with nowhere to keep a checksum, a
 * category, or the fact that a signature was ever requested for it.
 *
 * ── WHY ONE KIND, AND WHY IT IS NOT `contract` ───────────────────────────────────
 * `contract` (`founderObjects.ts`) is AUTHORED prose the model writes and reasons
 * over — a counterparty, obligations, a renewal date. `legalDocument` is the opposite
 * shape: a real uploaded FILE, sealed with per-tenant encryption before it reaches R2,
 * whose card is written entirely by the upload/share/sign flow and never by a human or
 * a model typing into it. Collapsing the two would make an authored deal memo and an
 * encrypted, checksummed NDA scan the same object, and a board could no longer tell
 * "what we agreed" from "the file that proves it".
 *
 * One FILE kind, because the legal seat has one file SHAPE — formation certificates,
 * NDAs, IP assignments and registrations all travel through the same
 * `legal_document_files` table, distinguished by `category`, not by a second kind per
 * document type.
 *
 * ── THE THREE RECORD KINDS BESIDE IT ─────────────────────────────────────────────
 * `legalDocument.entityId`, `.matterId` and `.ipId` are foreign keys into
 * `legal_entities`, `legal_matters` and `intellectual_property`, and until now the row
 * each id named had NO card. A board could hold the executed IP assignment and could
 * not hold the mark it assigns, the entity that owns it, or the opposition being argued
 * over it — so "when does anything we own lapse" was a question the canvas could store
 * the evidence for and never answer.
 *
 * They are declared HERE and not in `FOUNDER_OBJECT_KINDS` because they are projections
 * of the legal seat's own tables — the three this vocabulary's header already names as
 * the records the files are held against — and because a founder kind is authored prose
 * while these are rows. Splitting one seat across two i18n namespaces, two label maps
 * and two guidance blocks to file three cards next to `contract` would buy nothing and
 * cost the property that makes `legalDocument.entityId` legible: the card its id names
 * is in the same vocabulary as the document that points at it.
 *
 * ── WHY `legalMatter` AND NOT `matter` ───────────────────────────────────────────
 * `api/src/application/domains/legal/entities.ts` registers `legal_matters` in the
 * kernel `objects` table under `kind: 'matter'`. A canvas kind spelled the same way is
 * the `interview` collision exactly — `canvas_read_domain('legal')` would hand the model
 * domain rows it maps onto a canvas card, two different things under one word in the
 * ubiquitous language. The founder set gave up the bare noun for `customerInterview` on
 * that argument; this set gives it up for the same one. `legalEntity` and `ipAsset` need
 * no such qualifier: their domain kinds are `legal_entity` and `ip_asset`, which no
 * camelCase canvas kind can collide with.
 */
export const LEGAL_OBJECT_KINDS = [
  'legalDocument',
  // THE COMPANY ITSELF, and every subsidiary. `renewsAt` is the agent appointment or the
  // entity's own standing lapsing — the first date on this board a founder is penalised
  // for missing rather than merely embarrassed by.
  'legalEntity',
  // WHAT WE OWN THAT IS NOT A THING. A mark, a patent, a design, a domain — one shape,
  // because each is "a right, in a jurisdiction, in a class, with a filing date and a
  // renewal date", and `assignedFrom` is the founder-IP question a raise discovers.
  'ipAsset',
  // WHAT IS BEING ARGUED, with a cost and an adverse party. `nextActionAt` is a filing
  // deadline or a hearing — a date somebody is judged against, not a date noted.
  'legalMatter',
] as const;

export type LegalObjectKind = typeof LEGAL_OBJECT_KINDS[number];

const LEGAL_KIND_SET: ReadonlySet<string> = new Set<string>(LEGAL_OBJECT_KINDS);

/** True for the legal objects declared above — the set `legalObjects.ts` specs. */
export function isLegalObjectKind(value: unknown): value is LegalObjectKind {
  return typeof value === 'string' && LEGAL_KIND_SET.has(value);
}

/**
 * Kinds that belong to NO single vocabulary.
 *
 * Two canvas reviews on the same day asked for the same object from opposite ends of the
 * company — marketing cannot join sends to pipeline, recruiting cannot say where
 * candidates are lost — and they are ONE object. Building `marketingFunnel` beside
 * `hiringFunnel` would have been the twenty-fourth intra-product duplicate the data-model
 * analysis found, created knowingly on the day it was pointed out. So which funnel a card
 * measures is a VALUE (`funnelDomain`), not a kind.
 *
 * A kind belongs here when it is genuinely cross-domain. A kind that only looks generic
 * because nobody has written the second consumer yet belongs to its vocabulary.
 */
export const SHARED_OBJECT_KINDS = [
  'funnel', 'book', 'sequence',
  /**
   * A question put to a ROOM — the facilitation primitive.
   *
   * Cross-domain in the strongest sense on this list: a retro, a planning estimate, a
   * class check-for-understanding, a customer workshop and an all-hands Q&A are one
   * object put to five different rooms. Which INSTRUMENT it is — a ballot, a word
   * cloud, a ranking, a 1-to-5, a 2×2, a quiz — is a value (`pollFormat`), for the
   * same reason `funnelDomain` and `direction` are values one entry up.
   *
   * Its answers live in `question_sets` + `responses` with `kind = 'poll'`, which is
   * the store the collection primitive already collapsed twelve survey tables into.
   * A poll is NOT a `form`: a form is answered on somebody's own time and read later,
   * a poll is answered by a room at once and read WHILE it is being answered. Same
   * store, different object, and the difference is the whole feature — see
   * `facilitation.ts`.
   */
  'poll',
  /**
   * A DATE WITH A SUBJECT, and any number of them — the calendar primitive.
   *
   * Cross-domain by construction, and it is the kind that ended a MODALITY. The month
   * used to be a board-scoped surface in the canvas rail: one grid, one hardcoded
   * reading (this board's dated cards), no way to have two, and no way to point it at
   * the deployments, meetings, holidays or connected accounts whose dates already
   * existed elsewhere. A release calendar, a send calendar, a leave calendar and an
   * on-call rotation are one object bound to four SOURCES — which is a value on the
   * card, exactly as `funnelDomain` and `pollFormat` are values one entry up.
   *
   * It owns no dates it did not author. A bound calendar PROJECTS its source and writes
   * an edit back through it, because a second copy of a send's date is how a card and a
   * calendar come to disagree about when something ships. See `calendar.ts`.
   */
  'calendar',
] as const;

/**
 * Which side of a conversation a `sequence` is run from.
 *
 * ── THE DUPLICATE THIS ENDED ─────────────────────────────────────────────────────
 * Two multi-touch cadences shipped independently and neither knew about the other:
 * `SELL_MOTION_OBJECT_KINDS.sequence` (a seller following up a prospect) and
 * `HIRING_OBJECT_KINDS.outreachSequence` (a recruiter following up a candidate). Same
 * object, both times: ordered steps, a channel and a delay per step, an audience,
 * stop-on-reply, a reply rate. Two specs, two i18n namespaces, two node bodies, and two
 * places to fix the day the send runner changes.
 *
 * A THIRD was about to be written for the job seeker, who needs exactly the same thing
 * pointed the other way — which is the moment this stopped being tolerable duplication
 * and became the twenty-fifth intra-product copy the data-model analysis warned about.
 *
 * So there is ONE `sequence`, and which conversation it belongs to is a VALUE. That is
 * the same open/closed answer `funnel` gives one entry up, for the same reason: a new
 * cadence is data, not a kind, not DDL and not a render branch. `seeking` is the entry
 * that did not exist before and is the whole point — a person chasing their own
 * applications now has the object a recruiter chasing them has always had.
 */
export const SEQUENCE_DIRECTIONS = ['sales', 'hiring', 'seeking', 'support'] as const;

export type SequenceDirection = typeof SEQUENCE_DIRECTIONS[number];

export type SharedObjectKind = typeof SHARED_OBJECT_KINDS[number];

/**
 * Object kinds renamed after boards were already saved with the old name.
 *
 * A saved canvas is durable data: `creation_session_objects` rows hold whatever kind
 * string was current when they were written, and a kind the registry no longer knows
 * renders as nothing. So a rename needs a migration, and a JSON column's migration is a
 * read-time map rather than a DDL statement.
 *
 * `interview` → `customerInterview` is the first entry and the reason this exists: the
 * founder kind gave up the bare noun so the hiring domain's `interviews` could keep it.
 * Boards authored in the days the founder set shipped still hold `interview`.
 */
export const RENAMED_OBJECT_KINDS: Readonly<Record<string, string>> = {
  interview: 'customerInterview',
  // The hiring cadence folded into the ONE `sequence` — see `SEQUENCE_DIRECTIONS`.
  // Boards saved by a recruiter still hold `outreachSequence`, and a kind the registry
  // no longer knows renders as nothing, so the rename is a read-time map exactly as the
  // header describes. The direction those rows should carry is `hiring`, which
  // `sequence`'s own spec defaults to when the field is absent rather than leaving a
  // migrated card unlabelled.
  outreachSequence: 'sequence',
};

/** The current name for a possibly-legacy kind. Identity for everything else, so it is
 *  safe to call on every object read without knowing whether it needs it. */
export function renameLegacyKind(kind: string): string {
  return RENAMED_OBJECT_KINDS[kind] ?? kind;
}

export const CREATION_OBJECT_KINDS = [
  /**
   * ONE EXECUTABLE STEP, ON THE BOARD.
   *
   * `workflow` is the old shape: a card standing in for a graph that lived somewhere
   * else, edited in a modal that opened a second canvas on top of the first. A
   * `flowStep` is that graph said once — one step is one object, connected with the
   * board's own connections, grouped with the board's own frames, and compiled from
   * what is actually drawn (`compileBoardFlow.ts`). The canvas IS the workflow.
   *
   * There is exactly ONE kind for ~60 step kinds: which step it is, is a VALUE
   * (`stepKind`, from the step catalog), not a kind — the same rule that makes a new
   * industry a `discipline` value rather than a new vocabulary. `workflow` remains for
   * boards authored before this and for a card that points at a saved definition.
   */
  'flowStep',
  'workflow', 'project', 'website', 'build', 'dashboard', 'chat', 'agent', 'staff', 'evaluation', 'dataset',
  'table', 'spreadsheet', 'chart', 'map', 'report', 'kpi', 'prototype', 'code', 'browser', 'llm', 'voice', 'video',
  'image', 'animation', 'podcast', 'comic', 'game', 'cad', 'model3d', 'resume', 'template',
  // A place, not a picture: a walkable 3D scene with placed props and a real camera.
  // Distinct from `model3d` (one generated mesh, previewed on a card) and from the
  // room's session (a temporary reading of the flat board) — `world` is authored
  // object state of its own, opened full-size the same way `game`/`website` are.
  'world',
  // AI VIDEO/3D GENERATION, as a canvas object. Opens into the `scene3d` SURFACE
  // (`creationObjectSurfaces.ts`) bound to itself — the product decision that AI
  // video/3D generation lives under the 3D surface rather than under `timeline`
  // (which stays the real multi-track editor for imported/screen/camera clips,
  // untouched by this kind) or under a bolted-on legacy project modality (retired).
  // Distinct from `world`: a `world` is hand-authored prop-by-prop; a `scene` is one
  // prompt handed to the studio engine. See `scene.ts`.
  'scene',
  'document', 'slides', 'diagram', 'knowledge', 'file', 'url', 'note', 'drawing', 'frame', 'comment', 'timer',
  /**
   * COUNTING UP, which a countdown cannot do.
   *
   * `timer` runs a clock DOWN from a length somebody chose — a timebox. A stopwatch has
   * no length: it answers "how long did that actually take", which is the question a
   * facilitator asks about a demo, a discussion or a round nobody boxed. The two share
   * a shape (`startedAt` + `baseElapsedMs`, so every viewer derives the same elapsed
   * value from the shared model rather than a private local clock) and answer opposite
   * questions, which is why one kind with a `countsDown` flag would need a branch at
   * every place either is read.
   *
   * It came from the knowledge board, which had it while the canvas that is actually
   * the front door did not — the seam that entry was logged against.
   */
  'stopwatch',
  /**
   * ANOTHER OBJECT, SHOWN HERE — the transclusion.
   *
   * Not a copy and not a link: the card renders the referenced object's own current
   * content, so a board can put the same document in two contexts without either of
   * them going stale. `url` points AWAY from the workspace and `knowledge` IS a
   * knowledge item; neither says "show me that one, live, over there".
   *
   * The other half of the knowledge board's fold: its `embed` block transcluded a
   * knowledge document by id, and the Creation Canvas had no equivalent.
   */
  'transclusion',
  /**
   * A PLATFORM COMPONENT, MOUNTED ON THE BOARD.
   *
   * Not a picture of one and not a link to one: the card renders the same live,
   * tenant-scoped surface the app renders — the kanban, the roadmap, the vendor
   * register, the workforce directory — from the one component registry
   * (`lib/components/registry.ts`), addressed by `componentId`.
   *
   * This is the kind that makes the board a place a business is RUN rather than
   * only described. A CRM or a marketing pipeline is not a new object type here;
   * it is a board somebody composed out of these, which is why there is one kind
   * and not one per surface. `transclusion` shows another CANVAS object; this
   * shows a domain the platform owns.
   *
   * The same id addresses the same component at `/embed/<id>` inside the app a
   * customer publishes, so a card on the board and the surface in their product
   * are one declaration rather than two implementations.
   */
  'component',
  // The UNTYPED escape hatch, and the only one on this list.
  //
  // Every other kind here is a claim about what a thing IS, which is the whole
  // argument for a typed canvas: a `task` has an assignee, a `testRun` has a verdict,
  // and the board can compute over both. A sticky claims nothing. It is a coloured
  // rectangle with words on it.
  //
  // It exists for two reasons that are really one reason. First, a workshop starts
  // before anyone knows what the objects are — forcing a person to pick from 180 kinds
  // to write down "customers hate the onboarding" is asking them to model a problem
  // they are still discovering. Second, it is what a Miro board is MADE of, and an
  // import that has nowhere to put a sticky note cannot claim to have imported the
  // board. `miroImport` maps `sticky_note`, `text` and `shape` here.
  //
  // The knowledge board (`components/canvas/canvasModel.ts`) has had stickies since it
  // shipped; this is the same object arriving on the canvas that is actually the front
  // door, and it deliberately shares that board's pigment palette rather than choosing
  // a second one.
  'sticky',
  'roadmap', 'prd', 'release', 'task', 'mockup', 'mockupSet', 'featureSummary', 'team', 'role', 'mcp',
  'evermind', 'projectComparison', 'standup',
  'pitch', 'pitchScorecard', 'pitchQa', 'pitchApplication',
  'repository', 'selection', 'diagnostics', 'terminal', 'service',
  // THE DELIVERY LIFECYCLE. `repository`/`terminal`/`diagnostics`/`service`/`release`
  // covered the workspace and the plan; nothing covered what actually SHIPS — a pull
  // request, the CI run that gated it, the deployment it produced, an incident against
  // that deployment, or the environment it landed in. `deployment_events` already feeds
  // DORA without a canvas object to show for it, and the PR loop is a core runtime with
  // no board presence at all.
  //
  // Named `productionIncident`, not `incident`: the Operations vocabulary already owns
  // `incident` for a field-service/safety report (injury, near-miss, property damage —
  // `operationsObjects.ts`), a different noun that happens to share the English word,
  // exactly the collision `customerInterview` above was renamed to avoid. A botched
  // deployment rollback and a warehouse near-miss are not the same shape of thing.
  'pullRequest', 'ciRun', 'deployment', 'productionIncident', 'environment',
  // THE PMO ROLLUP, AS A BOARD OBJECT. `pmoApi.rollup()`/`pmoApi.valueStream()` already
  // compute delivery/DORA/spend/OKR for a portfolio, initiative, project or the whole
  // workspace — nothing on the canvas read them, so a board could plan work and never
  // see its own measurement. Named `deliveryRollup`, not `delivery`: a connection already
  // uses `delivery` as an EDGE kind (`CREATION_CONNECTION_KINDS` above) and an object
  // named identically to an edge in the same vocabulary reads as one thing having two
  // meanings at a glance, the exact ambiguity `productionIncident` was renamed to avoid.
  'deliveryRollup',
  'salesPipeline', 'salesContact', 'salesCampaign', 'targetMarket', 'salesGoal', 'salesMeeting',
  // A connected mailbox and one message out of it. Two kinds rather than one
  // because they answer different questions: an `inbox` is a LIVE, filtered view
  // that re-reads, while an `email` is a single message pinned to the board so it
  // can be annotated, connected to a task, and still be there tomorrow after it
  // has scrolled out of the live view.
  'inbox', 'email',
  // A marketing campaign and the template it renders — the canvas half of
  // "draft this, then send it to that list".
  'emailCampaign', 'emailTemplate',
  // The social half of the same story, and the same two-kind split as inbox/email
  // for the same reason: a `socialFeed` is a LIVE merged view across every connected
  // network that re-reads, while a `socialPost` is one post pinned to the board so it
  // can be annotated and connected to work and is still there tomorrow. A
  // `socialCampaign` is one announcement published to every connected account.
  'socialFeed', 'socialPost', 'socialCampaign',
  // ── The data-architecture objects ────────────────────────────────────────
  // A `dataset` is a SNAPSHOT (rows uploaded once); a `datasource` is a LIVE
  // connection to a warehouse the workspace has connected — the same two-kind
  // split as inbox/email, for the same reason: one re-reads, one does not.
  'datasource',
  // The model itself: entities, attributes, keys, relationships. Not a picture —
  // it validates, generates DDL, and diffs against a live schema, which is what
  // makes "create me an ERD" end in something real.
  'erd',
  // What a dataset is ALLOWED to be (declared schema + governance tags), what it
  // is CHECKED against (a quality suite), how a number is DEFINED (the semantic
  // layer), and where a value CAME FROM (lineage + impact).
  //
  // `metric` here is the DEFINITION — formula, grain, dimensions, unit, target:
  // the answer to "how is ARR calculated here". `liveMetric` below is one bound
  // READING of such a definition. See the split argued in the founder block.
  'dataContract', 'dataQuality', 'metric', 'lineage',
  // A standards-based learning experience authored and completed on the canvas,
  // and the practice set that makes studying it a loop rather than a read: a
  // `practice` object holds the questions AND the record of every attempt, so
  // the board can say what is still weak instead of only what was opened.
  'course', 'practice',
  // A reusable, target-aware product onboarding design. It stays provider-neutral:
  // the Canvas authors the contract and each delivery surface supplies its anchors.
  'guidedTour',
  // ── The QA objects ───────────────────────────────────────────────────────
  // The canvas could MAKE a website, a game, a campaign and a data model, and had
  // no object for the one question asked of every one of them: does it work?
  //
  // Four kinds rather than one, and the split is the same one `inbox`/`email` and
  // `metric`/`liveMetric` already draw — an INTENT that persists, an ARTIFACT that
  // runs, an EVENT that happened, and a DEFECT that outlives all three:
  //
  //  • `testPlan`  — what we intend to prove, against which target, with which exit
  //    criteria. It is the object a release gate is read off, which is why the
  //    criteria live here and not in a hand-edited evidence file.
  //  • `testCase`  — one runnable scenario: ordered `QaStep`s AND the generated
  //    Playwright source. Both, deliberately: the steps are what a person edits and
  //    what the heatmap planner speaks, the spec is what CI executes. `qa.ts` lowers
  //    one to the other so they cannot drift.
  //  • `testRun`   — one execution, with per-case outcomes. Pinned, not live: it is
  //    evidence, and evidence that re-reads is not evidence.
  //  • `defect`    — what broke, with the repro, the expected/actual, the severity
  //    and the journal of what the person was doing. Its own kind rather than a
  //    `task` because a defect is REPRODUCED and VERIFIED, and a task is only done.
  //
  // A `testPlan` is also the suite: a "test suite" is a plan whose cases are the
  // suite's members, so it is a connection, not a fifth kind.
  'testPlan', 'testCase', 'testRun', 'defect',
  // Cross-domain kinds — `funnel` today. See SHARED_OBJECT_KINDS for why conversion
  // through stages is one object with a domain VALUE rather than one kind per funnel.
  ...SHARED_OBJECT_KINDS,
  ...HIRING_OBJECT_KINDS,
  // HR operations, plus `form` — the collection primitive declared alongside the domain
  // that exposed its absence. See `people.ts` for why hiring and people operations are
  // two vocabularies with two owning agents rather than one set called "HR".
  ...PEOPLE_OBJECT_KINDS,
  ...FOUNDER_OBJECT_KINDS,
  // The teaching and research vocabulary: the assessment loop (a cohort, an assignment,
  // a rubric, ONE SUBMISSION PER LEARNER, a gradebook), the research lifecycle in the
  // order it is gated (grant → ethics → pre-registration → protocol → consent →
  // participants → manuscript → peer review), and the three scholarly primitives no
  // business object covers — a citation, a bibliography and an equation. `academic.ts`
  // argues each one, including why a submission is a kind and not an array.
  ...ACADEMIC_OBJECT_KINDS,
  // The stages after the data: analysis that computes, a model, the run that trained
  // it, the comparison that chose between runs, the labelled set an evaluation is
  // legitimately built from, and the versioned prompt. See `dataScience.ts`.
  ...DATA_SCIENCE_OBJECT_KINDS,
  // The work a vertical company SELLS: an asset, the order against it, the visit that
  // executes it, the evidence, the certificate that permits it, the parts it consumes,
  // and the incident when it goes wrong. Every other vocabulary on this list models how
  // a company runs ITSELF; this is the first that models what it does for a customer.
  // See `operations.ts` for why it is one vocabulary and not one pack per industry.
  ...OPERATIONS_OBJECT_KINDS,
  // The secure legal FILE — an uploaded, encrypted document with a checksum, a
  // signature history and a share history, distinct from the AUTHORED `contract` in
  // `FOUNDER_OBJECT_KINDS` — and the three RECORD kinds it is held against: the entity,
  // the IP asset and the matter. See the kind's own comment above for why they are two
  // shapes in one vocabulary, and why the matter carries a qualifier.
  ...LEGAL_OBJECT_KINDS,
  // The commercial half of the motion: a priced `quote` a buyer accepts, the `sequence`
  // that follows up across channels and stops on reply, the `call` that carries what they
  // actually said, the `trial` the demo board becomes, the `trustPacket` procurement asks
  // for, and the `mutualActionPlan` both sides own. Every other vocabulary on this list
  // models how the company BUILDS; this is the first that models how it SELLS. See
  // `sellMotion.ts` for why each of the six is not one of the six sales kinds above.
  ...SELL_MOTION_OBJECT_KINDS,
  // The job search, as objects. Every other vocabulary on this list is authored by a
  // company; this is the first authored by ONE PERSON about their own working life —
  // which is why `job` is research rather than a requisition, `applicationPipeline` is a
  // `shortlist` transposed, and `runway` is a personal clock rather than a budget. See
  // `career.ts` for why none of the six folds into `HIRING_OBJECT_KINDS`.
  ...CAREER_OBJECT_KINDS,
  // The brand a generative board composes against, and the audience a send is allowed
  // to reach. Two kinds over tables (`brand_kits`, `marketing_audiences`,
  // `marketing_suppressions`) that had existed since the growth domain landed with
  // nothing on the board able to read them — which is why every creative object composed
  // unbranded and a campaign could be fired with no visible consent state. See
  // `marketing.ts` for why the brand is a bindable OBJECT rather than a canvas setting,
  // and why there is no `campaignCalendar` kind to go with the calendar surface.
  ...MARKETING_OBJECT_KINDS,
] as const;

export type CreationObjectKind = typeof CREATION_OBJECT_KINDS[number];

export const CREATION_CONNECTION_KINDS = [
  'data', 'control', 'reference', 'presentation', 'delivery', 'membership',
  /**
   * `fromId` BLOCKS `toId` — the arrow points the way work flows, same convention
   * `dependencyGraph.ts#DependencyEdge` documents. It is what lets a board of tasks
   * answer "what is in the way" the same way the PMO initiative layer already does
   * (`portfolioRollup.ts#computeDependencyAnalysis`, which the shared primitive in
   * `dependencyGraph.ts` was extracted FROM): `analyzeDependencies` takes this edge
   * kind and a board's own task nodes and returns blocked-by, blocks, is-blocked and
   * the weighted critical path — see `CreationCanvas.tsx`'s `taskDependencyAnalysis`.
   */
  'blocks',
  /**
   * WHAT PROVES WHAT.
   *
   * The six kinds above all say how work FLOWS — a value moves, a step triggers, a
   * thing is mentioned, shown, delivered, or belongs to a group. None of them says
   * that one object VERIFIES another, so a board holding a requirement, the work
   * that implements it and the test that covers it could not answer either question
   * a tester is paid to answer: what is untested, and what breaks when this goes red.
   *
   * `reference` was the closest and is wrong for it — everything references
   * everything, so a coverage rollup computed over `reference` would report a board
   * as fully covered because its objects are merely connected. Coverage has to be
   * an ASSERTED edge or it means nothing.
   */
  'verifies',
] as const;

export type CreationConnectionKind = typeof CREATION_CONNECTION_KINDS[number];

export const CREATION_COMMAND_TYPES = [
  'graph.replace', 'object.add', 'object.update', 'object.move', 'object.delete',
  'connection.add', 'connection.delete', 'viewport.set',
] as const;

export type CreationCommandType = typeof CREATION_COMMAND_TYPES[number];

export function isCreationObjectKind(value: unknown): value is CreationObjectKind {
  return typeof value === 'string' && (CREATION_OBJECT_KINDS as readonly string[]).includes(value);
}

export function isCreationCommandType(value: unknown): value is CreationCommandType {
  return typeof value === 'string' && (CREATION_COMMAND_TYPES as readonly string[]).includes(value);
}

export function isCreationConnectionKind(value: unknown): value is CreationConnectionKind {
  return typeof value === 'string' && (CREATION_CONNECTION_KINDS as readonly string[]).includes(value);
}
