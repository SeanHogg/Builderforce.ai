/**
 * THE sell-motion specification — the commercial half of "idea → real".
 *
 * `sellMotion.ts` in the contract argues WHY this vocabulary exists, why each of its six
 * kinds is not one of the six sales kinds the canvas already had, and why a prospect
 * SHARE is a `share_links` row rather than a seventh kind. This is its declaration: one
 * entry per kind, from which the node body, the model-facing field documentation, the
 * registry's `createData`/`MUTABLE_FIELDS`/`CONTEXT_FIELDS` rows and the empty-shell rule
 * are all derived.
 *
 * ── WHAT THE MODEL MAY NOT WRITE, AND WHY IT MATTERS MORE HERE ───────────────────
 * Every vocabulary uses `derived` for "a mechanism writes this". In a sales vocabulary
 * that flag is load-bearing in a way it is not elsewhere, because the things a mechanism
 * writes here are the things a deal is FORECAST from:
 *
 *  · `quote.acceptedAt` / `acceptedBy` — written only by the buyer-facing accept route.
 *    A model that could assert an acceptance could close a deal nobody agreed to, and it
 *    would show up in the weighted pipeline before anybody noticed.
 *  · `sequence.enrolments` — the cadence CURSOR (the kind moved to `sharedCanvasObjects.ts`
 *    when the seller's and recruiter's cadences merged; the RUNNER contract below stayed
 *    here, because the sweep that sends is still the sell motion's). A model that could edit it could re-send
 *    a breakup email to somebody who already replied, which is the one outreach failure
 *    that costs a deal outright.
 *  · `call.transcript` — evidence of what a person actually said. An LLM-authored
 *    transcript is a fabricated quotation attributed to a named human being.
 *  · `trial.*` provisioning fields — a workspace either exists or it does not.
 *  · Every engagement figure on every kind — see `PROSPECT_*` below.
 *
 * The COMPUTED fields (`derive`) are the arithmetic: a quote's total, a cadence's reply
 * rate, a plan's completion, a packet's readiness. Every one of them is a number the card
 * shows and nobody may type, for the reason `SpecField.derive` states — an authored total
 * that disagrees with the rows printed beneath it is the drift the flag exists to make
 * impossible. All of them are computed by the CONTRACT's functions, not by private copies
 * here, because the same numbers are rendered again on a page served to a buyer who has
 * no account and again in the Worker route that turns an acceptance into a checkout.
 */

import {
  SELL_MOTION_OBJECT_KINDS,
  mutualPlanHealth,
  quoteTotals,
  readMapMilestones,
  readQuoteLines,
  readSequenceEnrolments,
  readSequenceSteps,
  readTrustAnswers,
  trustPacketReadiness,
  type SellMotionObjectKind,
} from '@builderforce/creation-canvas-contract';
import { formatCents } from './canvasMoney';
import {
  deriveDaysBetween, deriveNumber, registerSpecObjectSet, SUMMARY_FIELD,
  type SpecField, type SpecObjectSpec,
} from './specObjects';

/** i18n namespace for every sell-motion label, field, column and status. */
export const SELL_MOTION_NAMESPACE = 'creationCanvas.sellMotion';

/**
 * The prospect-engagement fields, shared by every kind a buyer can be SENT.
 *
 * ── WHY THEY ARE FIELDS AND NOT A SEPARATE OBJECT ────────────────────────────────
 * "Did they look at what I sent, and at which part" is a question about the ARTIFACT, not
 * about a separate analytics record. Putting it beside the thing that was sent is what
 * makes the pipeline readable at a glance — a quote card that says "opened 4×, 6m on the
 * pricing lines, no reply" is a follow-up you can write; a separate engagement object you
 * have to go and find is one nobody opens.
 *
 * All four are `derived`: they are projected from `activity_log` by the share-engagement
 * read (`prospect.*` verbs — see `sellMotion.ts#PROSPECT_EVENTS`) and refreshed by
 * `canvas_refresh_prospect_engagement`. A model that could WRITE them could report a
 * buyer's interest that never happened, which is the single easiest way to corrupt a
 * forecast — and the forecast is the thing this whole vocabulary exists to make honest.
 */
const ENGAGEMENT_FIELDS: readonly SpecField[] = [
  {
    name: 'shareUrl', render: 'stat', label: 'shareUrl',
    hint: 'The prospect-facing link, once one has been minted. Written by canvas_share_with_prospect — never typed, because a link that is not backed by a real share_links row grants nothing and fails silently in the buyer\'s browser.',
    derived: true,
  },
  {
    name: 'shareOpens', render: 'stat', label: 'shareOpens',
    hint: 'How many times the prospect link was opened. Projected from the activity log; refresh it with canvas_refresh_prospect_engagement rather than guessing at it from what the card showed last.',
    derived: true,
  },
  {
    name: 'shareLastSeenAt', render: 'stat', label: 'shareLastSeenAt',
    hint: 'ISO instant of the most recent prospect activity on this artifact. Empty means they have never opened it — which is a different fact from "opened it and did nothing", and the card says so.',
    derived: true,
  },
  {
    name: 'engagementHotspots', render: 'rows', label: 'engagementHotspots',
    columns: ['objectLabel', 'seconds', 'views'],
    hint: 'Where the attention actually went: {objectLabel, seconds, views}, most-watched first. The half of the signal nothing else can give you — four minutes on the security card and four minutes on pricing are different conversations.',
    derived: true,
  },
];

/** Where the money in this vocabulary is stated. Every amount is integer CENTS on the
 *  wire and a formatted string on the card, so a total is never re-parsed out of prose. */
const CENTS_HINT = 'An integer number of CENTS, never a formatted string — the card formats it. 129900 is $1,299.00.';

/** Read the currency an object states, defaulting to the platform's. Declared once so a
 *  quote, a trial and a plan all render the same deal in the same currency. */
const currencyOf = (data: Record<string, unknown>): string => {
  const code = String(data.currency ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
};

export const SELL_MOTION_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // -------------------------------------------------------------------------
  {
    kind: 'quote',
    icon: '⌸',
    group: 'Revenue',
    defaultStatus: 'draft',
    // `send` and `share` are OUTBOUND — both put a priced offer in front of somebody
    // outside the tenant — so both are gated (`canvasApprovalGate.GATED_ACTIONS.quote`).
    // `price` only re-seeds list prices from the public pricing contract and exposes
    // nothing, so it stays open. There is deliberately no `accept` action: a seller
    // accepting their own quote is the one thing this object must make impossible, and
    // acceptance therefore exists ONLY on the buyer-facing route.
    actions: ['price', 'send', 'share'],
    fields: [
      {
        name: 'presentation', render: 'stat', label: 'presentation',
        hint: 'quote | proposal | orderForm. How the same priced deal is presented — a VALUE, not three kinds. An order form is a quote a buyer signs; a proposal is a quote with the narrative around it.',
        bookkeeping: true,
      },
      {
        name: 'buyer', render: 'stat', label: 'buyer',
        hint: 'The company being quoted. One name — a quote to two entities is two quotes, because only one of them can sign it.',
      },
      {
        name: 'buyerContact', render: 'stat', label: 'buyerContact',
        hint: 'The named person who can accept, and their email. The accept link is sent to THIS person; a quote addressed to a company and nobody is one that sits unopened.',
      },
      {
        name: 'currency', render: 'stat', label: 'currency',
        hint: 'ISO-4217, e.g. USD or GBP. Applies to every line — a quote mixing currencies is one nobody can total.',
        bookkeeping: true,
      },
      {
        name: 'lines', render: 'rows', label: 'lines',
        columns: ['description', 'plan', 'seats', 'unitPriceCents', 'discountPercent'],
        hint: `The priced deal: {description, plan, billingCycle, seats, unitPriceCents, discountPercent}. \`plan\` is 'pro'/'teams' for a subscription line and empty for services. ${CENTS_HINT} \`unitPriceCents\` is the LIST price — the discount is stated separately so the buyer can see what they were given, which is the entire persuasive content of a quote.`,
      },
      {
        name: 'termMonths', render: 'stat', label: 'termMonths',
        hint: 'The committed length in months, 1-120. NOT the billing period: a 24-month deal billed monthly is twenty-four payments and one billed yearly is two.',
      },
      {
        name: 'subtotalCents', render: 'stat', label: 'subtotalCents',
        hint: 'List price before discount, computed from the lines. Never typed.',
        derive: (data) => {
          const totals = quoteTotals(readQuoteLines(data.lines), deriveNumber(data.termMonths) ?? 12);
          return totals.subtotalCents > 0 ? formatCents(totals.subtotalCents, { currency: currencyOf(data) }) : undefined;
        },
      },
      {
        name: 'discountCents', render: 'stat', label: 'discountCents',
        hint: 'What they are being given, computed per line and summed. The number a buyer looks for first and the number a discount policy is audited against.',
        derive: (data) => {
          const totals = quoteTotals(readQuoteLines(data.lines), deriveNumber(data.termMonths) ?? 12);
          return totals.discountCents > 0
            ? `${formatCents(totals.discountCents, { currency: currencyOf(data) })} (${totals.effectiveDiscountPercent}%)`
            : undefined;
        },
      },
      {
        name: 'totalCents', render: 'stat', label: 'totalCents',
        hint: 'What they pay per billing period, discount applied. Computed — see SpecField.derive for why an authored total that disagrees with the lines beneath it is the defect this makes impossible.',
        derive: (data) => {
          const lines = readQuoteLines(data.lines);
          if (lines.length === 0) return undefined;
          const totals = quoteTotals(lines, deriveNumber(data.termMonths) ?? 12);
          return formatCents(totals.totalCents, { currency: currencyOf(data) });
        },
      },
      {
        name: 'contractValueCents', render: 'stat', label: 'contractValueCents',
        hint: 'Total across the whole term. The figure a forecast uses, because a monthly and an annual deal at the same monthly price are not the same deal.',
        derive: (data) => {
          const lines = readQuoteLines(data.lines);
          if (lines.length === 0) return undefined;
          const totals = quoteTotals(lines, deriveNumber(data.termMonths) ?? 12);
          return formatCents(totals.contractValueCents, { currency: currencyOf(data) });
        },
      },
      {
        name: 'expiresAt', render: 'stat', label: 'expiresAt',
        hint: 'ISO date the offer lapses. The field that makes a discount a decision rather than a standing entitlement — and the reason "expired" is computed rather than stored.',
        deadline: true,
      },
      {
        name: 'quoteState', render: 'stat', label: 'quoteState',
        hint: 'draft | sent | viewed | accepted | declined. `expired` is NEVER stored — it is derived from expiresAt, so a lapsed offer stops being acceptable the instant it lapses rather than the next time a sweep runs. Written by the send and accept flows.',
        derived: true,
      },
      {
        name: 'acceptedAt', render: 'stat', label: 'acceptedAt',
        hint: 'ISO instant the buyer accepted. Written ONLY by the buyer-facing accept route — a seller asserting their own acceptance is the one thing this object exists to make impossible.',
        derived: true,
      },
      {
        name: 'acceptedBy', render: 'stat', label: 'acceptedBy',
        hint: 'Who accepted, as they identified themselves on the accept page. Written by that route, never authored.',
        derived: true,
      },
      {
        name: 'terms', render: 'text', label: 'terms',
        hint: 'The non-price terms a buyer is agreeing to: payment days, notice, what is included. Short and specific — this is what a procurement team reads before the number.',
      },
      ...ENGAGEMENT_FIELDS,
      SUMMARY_FIELD,
    ],
  },

  // -------------------------------------------------------------------------
  {
    kind: 'call',
    icon: '☏',
    group: 'Revenue',
    defaultStatus: 'notLogged',
    // `summarize` reads a transcript already on the card and writes back objections and
    // the next step — it sends nothing outside the tenant, so it is not gated. `log`
    // attaches a recording/transcript; `share` puts the recap in front of the buyer and
    // IS gated.
    actions: ['log', 'summarize', 'share'],
    fields: [
      {
        name: 'counterparty', render: 'stat', label: 'counterparty',
        hint: 'Who was on the call, on their side. Names, not "the client" — the whole value of this object is that a coach can see who says what.',
      },
      {
        name: 'heldAt', render: 'stat', label: 'heldAt',
        hint: 'ISO instant the call happened. A past instant: this object records what DID happen, which is what separates it from salesMeeting.',
      },
      {
        name: 'durationMinutes', render: 'stat', label: 'durationMinutes',
        hint: 'How long it ran. Read together with the talk ratio below, this is the whole diagnostic for a discovery call.',
      },
      {
        name: 'recordingUrl', render: 'stat', label: 'recordingUrl',
        hint: 'Where the recording lives, when there is one. Written by the telephony webhook or pasted by the person who recorded it — never invented.',
        bookkeeping: true,
      },
      {
        name: 'transcript', render: 'text', label: 'transcript',
        hint: 'The transcript, one "Speaker: line" per row. READ-ONLY: an LLM-authored transcript is a fabricated quotation attributed to a named human being. It arrives from the dialer\'s speech-to-text or is pasted in by a person; the summarize action READS it and never writes it.',
        derived: true,
      },
      {
        name: 'talkRatioPercent', render: 'meter', label: 'talkRatioPercent',
        hint: 'How much of the call WE talked, 0-100. Computed from the transcript when it carries speakers. The single most coachable number in discovery, and one no rep will ever type honestly about themselves.',
        derived: true,
      },
      {
        name: 'objections', render: 'list', label: 'objections',
        hint: 'What they pushed back on: [{title, detail}]. Lifted from the transcript by the summarize action, or written by the person who was there. This is the field the CRO coach reads — "activity was high and every call died on price" is an answer no activity count can give.',
      },
      {
        name: 'commitment', render: 'verdict', label: 'commitment',
        hint: 'What they actually agreed to do, and by when — with the sentence that says it. A call with no commitment is a call that did not advance, and saying so plainly is more useful than a polite summary.',
      },
      {
        name: 'nextStep', render: 'stat', label: 'nextStep',
        hint: 'The next dated action and who owns it. If this is empty after a call, the deal is drifting whatever the pipeline stage says.',
        deadline: true,
      },
      {
        name: 'sentiment', render: 'stat', label: 'sentiment',
        hint: 'positive | neutral | negative, with a short reason. From the transcript, not from how the call felt afterwards.',
      },
      ...ENGAGEMENT_FIELDS,
      SUMMARY_FIELD,
    ],
  },

  // -------------------------------------------------------------------------
  {
    kind: 'trial',
    icon: '◔',
    group: 'Revenue',
    defaultStatus: 'notProvisioned',
    // `provision` creates a real workspace for somebody outside the tenant and `invite`
    // emails them — both gated. `extend` moves an expiry the buyer is relying on, so it
    // is gated too; `convert` hands off to checkout, which the buyer must do themselves.
    actions: ['provision', 'invite', 'extend'],
    fields: [
      {
        name: 'prospect', render: 'stat', label: 'prospect',
        hint: 'The company trying it, and the named person who will actually log in. A trial provisioned for a company and nobody is one nothing happens in.',
      },
      {
        name: 'sourceSessionId', render: 'stat', label: 'sourceSessionId',
        hint: 'The canvas session this trial was built FROM — the board you demoed with. This is the whole point of the object: the demo artifact becomes the trial rather than the buyer starting from an empty workspace. Written by the provision action.',
        bookkeeping: true,
      },
      {
        name: 'workspaceId', render: 'stat', label: 'workspaceId',
        hint: 'The provisioned tenant. READ-ONLY: a workspace either exists or it does not, and a card asserting one that was never created sends a buyer to a dead link.',
        derived: true,
      },
      {
        name: 'startsAt', render: 'stat', label: 'startsAt',
        hint: 'ISO instant the clock starts. Provisioning time, normally — a trial that starts before anybody logs in is one the buyer loses days of.',
        derived: true,
      },
      {
        name: 'expiresAt', render: 'stat', label: 'expiresAt',
        hint: 'ISO instant the trial ends. The field the whole object is judged against, and the one a conversion conversation is scheduled from.',
        deadline: true,
      },
      {
        name: 'daysRemaining', render: 'stat', label: 'daysRemaining',
        hint: 'Days left, computed from the expiry. Negative means it has already lapsed — which the card says rather than hiding, because a lapsed trial nobody noticed is a lost deal nobody explained.',
        derive: (data) => {
          const days = deriveDaysBetween(new Date().toISOString(), data.expiresAt);
          return days === undefined ? undefined : days;
        },
      },
      {
        name: 'activationCriteria', render: 'list', label: 'activationCriteria',
        hint: 'What "they got value" means, agreed BEFORE the trial starts: [{title, detail}]. Three to five, specific and observable. Without these a trial ends in an opinion.',
      },
      {
        name: 'activation', render: 'rows', label: 'activation',
        columns: ['criterion', 'met', 'observedAt'],
        hint: 'Which criteria have actually been met: {criterion, met, observedAt}. READ-ONLY — written from the trial workspace\'s own usage, because a seller marking their own activation criteria met is how every trial converts on paper and none in reality.',
        derived: true,
      },
      {
        name: 'activationPercent', render: 'meter', label: 'activationPercent',
        hint: 'Criteria met as a share of criteria agreed, 0-100. Computed.',
        derive: (data) => {
          const rows = Array.isArray(data.activation) ? data.activation : [];
          if (rows.length === 0) return undefined;
          const met = rows.filter((row) => (row as Record<string, unknown>)?.met === true).length;
          return Math.round((met / rows.length) * 100);
        },
      },
      {
        name: 'outcome', render: 'verdict', label: 'outcome',
        hint: 'converted | lapsed | extended | cancelled, with the reason in one sentence. "Lapsed" is not "lost" — a trial nobody used and a trial that was used and rejected are different failures and must not be recorded as the same one.',
      },
      ...ENGAGEMENT_FIELDS,
      SUMMARY_FIELD,
    ],
  },

  // -------------------------------------------------------------------------
  {
    kind: 'trustPacket',
    icon: '⛨',
    group: 'Revenue',
    defaultStatus: 'assembling',
    // `assemble` reads this workspace's OWN controls, documents and diagnostics — nothing
    // leaves, so it is open. `answer` runs the compliance agent over an uploaded
    // questionnaire, also internal. `share` publishes the packet to a buyer and IS gated:
    // it is the one act here that puts a security posture in somebody else's hands.
    actions: ['assemble', 'answer', 'share'],
    fields: [
      {
        name: 'buyer', render: 'stat', label: 'buyer',
        hint: 'Whose review this packet answers. Packets are per-buyer because questionnaires are — a generic packet is a website page, and this object exists for the bespoke half.',
      },
      {
        name: 'frameworks', render: 'chips', label: 'frameworks',
        hint: 'What they are assessing against: SOC 2, ISO 27001, GDPR, HIPAA, DORA. Drives which evidence the assemble action pulls, so an inaccurate list produces an inaccurate packet.',
      },
      {
        name: 'controls', render: 'rows', label: 'controls',
        columns: ['controlRef', 'objective', 'status', 'lastReviewed'],
        hint: 'The control register, as it actually stands: {controlRef, objective, status, lastReviewed}. READ-ONLY — pulled from this workspace\'s own SOC control register by the assemble action. A control asserted here that the register calls a gap is a misrepresentation in a document a buyer relies on.',
        derived: true,
      },
      {
        name: 'documents', render: 'list', label: 'documents',
        hint: 'The paper: [{title, url}] — DPA, subprocessor list, penetration-test summary, insurance. Pulled from the legal document store by the assemble action, plus anything added by hand.',
        bookkeeping: true,
      },
      {
        name: 'subprocessors', render: 'rows', label: 'subprocessors',
        columns: ['name', 'purpose', 'region'],
        hint: 'Who else touches their data: {name, purpose, region}. The list procurement checks first, and the one that must match the published page — assemble pulls it rather than letting a packet state its own version.',
        derived: true,
      },
      {
        name: 'questionnaire', render: 'rows', label: 'questionnaire',
        columns: ['question', 'answer', 'evidence', 'state'],
        hint: 'Their spreadsheet, row by row: {question, answer, evidence, state}. `state` is unanswered | answered | notApplicable | gap. An answer with no `evidence` is an assertion — procurement teams are paid to notice, and the readiness meter counts them separately.',
      },
      {
        name: 'readyPercent', render: 'meter', label: 'readyPercent',
        hint: 'Answered rows as a share of rows that need an answer, 0-100. Computed. Rows the buyer struck out as not-applicable count toward neither half, so the percentage cannot be improved by striking rows out.',
        derive: (data) => trustPacketReadiness(readTrustAnswers(data.questionnaire)).readyPercent,
      },
      {
        name: 'openGaps', render: 'stat', label: 'openGaps',
        hint: 'Rows we answered honestly as a gap, plus answered rows carrying no evidence. Computed — the number that decides whether this packet survives a real review or merely looks complete.',
        derive: (data) => {
          const readiness = trustPacketReadiness(readTrustAnswers(data.questionnaire));
          const open = readiness.gaps + readiness.unevidenced;
          return open > 0 ? `${open} (${readiness.gaps} gaps, ${readiness.unevidenced} unevidenced)` : undefined;
        },
      },
      {
        name: 'assembledAt', render: 'stat', label: 'assembledAt',
        hint: 'ISO instant the evidence was last pulled. A packet assembled two quarters ago is one whose control statuses are fiction, and the card shows the age so nobody sends it without noticing.',
        derived: true,
      },
      ...ENGAGEMENT_FIELDS,
      SUMMARY_FIELD,
    ],
  },

  // -------------------------------------------------------------------------
  {
    kind: 'mutualActionPlan',
    icon: '⇌',
    group: 'Revenue',
    defaultStatus: 'drafting',
    // `share` puts the plan in front of the buyer — the whole mechanism, and gated for
    // the same reason every outbound act is. `handoff` moves the demo board into the
    // customer's real workspace on close, which creates real state outside this tenant.
    actions: ['share', 'handoff'],
    fields: [
      {
        name: 'buyer', render: 'stat', label: 'buyer',
        hint: 'The company on the other side of the plan.',
      },
      {
        name: 'targetGoLiveAt', render: 'stat', label: 'targetGoLiveAt',
        hint: 'The date both sides are working back from. A plan with no date is a wish list.',
        deadline: true,
      },
      {
        name: 'milestones', render: 'rows', label: 'milestones',
        columns: ['title', 'dueAtISO', 'sellerOwner', 'buyerOwner', 'state'],
        hint: 'The plan: {title, dueAtISO, sellerOwner, buyerOwner, state}. `state` is pending | inProgress | done | blocked. `buyerOwner` is the field that makes this object different from a roadmap — a milestone we own alone is a task we assigned ourselves and called mutual. Leave it blank when nobody on their side has taken it, and the card will count it.',
      },
      {
        name: 'completionPercent', render: 'meter', label: 'completionPercent',
        hint: 'Milestones done as a share of milestones agreed, 0-100. Computed.',
        derive: (data) => mutualPlanHealth(readMapMilestones(data.milestones), new Date()).completionPercent,
      },
      {
        name: 'nextDue', render: 'stat', label: 'nextDue',
        hint: 'The next thing owed, whoever owes it. Computed from the milestones — the one line a weekly check-in starts from.',
        derive: (data) => {
          const health = mutualPlanHealth(readMapMilestones(data.milestones), new Date());
          return health.nextDueTitle ? `${health.nextDueTitle} — ${health.nextDueAtISO}` : undefined;
        },
      },
      {
        name: 'planRisk', render: 'verdict', label: 'planRisk',
        hint: 'What is actually wrong with this plan: overdue milestones, and milestones nobody on the buyer\'s side owns. Computed, and deliberately blunt — a mutual plan the buyer has not taken a single item on is not a mutual plan, and the object should say so rather than showing a healthy percentage.',
        // A STRING, not an object: `verdict` renders through `statText`, so a returned
        // record would draw "[object Object]" — the failure mode a typed render style is
        // supposed to prevent and does not, because the style is closed and the value is
        // not. Every other `verdict` in every vocabulary is a sentence; so is this one.
        derive: (data) => {
          const health = mutualPlanHealth(readMapMilestones(data.milestones), new Date());
          if (health.total === 0) return undefined;
          const problems: string[] = [];
          if (health.overdue > 0) problems.push(`${health.overdue} overdue`);
          if (health.unownedByBuyer > 0) problems.push(`${health.unownedByBuyer} with no owner on the buyer's side`);
          return problems.length > 0
            ? `At risk — ${problems.join('; ')}.`
            : `On track — ${health.done} of ${health.total} done, nothing overdue.`;
        },
      },
      {
        name: 'handoffSessionId', render: 'stat', label: 'handoffSessionId',
        hint: 'The session carried into the customer\'s own workspace on close. Written by the handoff action — the thing built during the sale not being stranded on the seller\'s canvas is the whole reason this field exists.',
        derived: true,
      },
      ...ENGAGEMENT_FIELDS,
      SUMMARY_FIELD,
    ],
  },
];

/**
 * English fallbacks the object palette shows before its i18n key resolves, matching how
 * every other set reads. The palette localizes through `creationCanvas.sellMotion.label.*`;
 * this is never the translated string.
 */
export const SELL_MOTION_LABELS: Record<SellMotionObjectKind, string> = {
  quote: 'Quote',
  call: 'Call',
  trial: 'Trial',
  trustPacket: 'Trust packet',
  mutualActionPlan: 'Mutual action plan',
};

/**
 * Blank-object statuses, as English fallbacks.
 *
 * Every one names the state a card is genuinely in before anything happens to it — the
 * rule `budget`'s `drafting` and `account`'s `prospect` already establish. A fresh `quote`
 * is a DRAFT and never "sent"; a fresh `trial` is "not provisioned" and never "active",
 * because a card claiming a live trial that was never created sends a buyer to a dead link.
 */
export const SELL_MOTION_STATUSES: Record<string, string> = {
  draft: 'Draft',
  notLogged: 'Not logged',
  notProvisioned: 'Not provisioned',
  assembling: 'Assembling',
  drafting: 'Drafting',
};

/** Kinds the contract declares, for the test that proves the two lists agree. */
export const SELL_MOTION_CONTRACT_KINDS: readonly SellMotionObjectKind[] = SELL_MOTION_OBJECT_KINDS;

/**
 * The fields whose ENROLMENT/CURSOR semantics the sequence runner writes.
 *
 * Exported so the runner's patch builder and this declaration cannot drift: the runner
 * writes exactly these and nothing else, which is what keeps "the model may not move the
 * cadence cursor" true in practice rather than only in a comment.
 */
export const SEQUENCE_RUNNER_FIELDS = ['enrolments', 'lastRunAt', 'sequenceState'] as const;

/** Same contract for the sequence reader half, used by the runner to load a cadence. */
export function readSequence(data: Record<string, unknown>) {
  return {
    state: data.sequenceState,
    steps: readSequenceSteps(data.steps),
    enrolments: readSequenceEnrolments(data.enrolments),
  };
}

registerSpecObjectSet({
  id: 'sellMotion',
  namespace: SELL_MOTION_NAMESPACE,
  specs: SELL_MOTION_OBJECT_SPECS,
});
