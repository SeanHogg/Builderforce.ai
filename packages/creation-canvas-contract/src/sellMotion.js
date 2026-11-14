/**
 * The SELL-MOTION vocabulary — the commercial half of "idea → real".
 *
 * ── THE GAP THIS CLOSES, STATED AS A SELLER WOULD STATE IT ───────────────────────
 * The canvas has eighty-plus object kinds and covers BUILD end to end: a founder can
 * research a market, design a product, plan the work, ship it, test it and measure it.
 * Take the same board to a buyer and the motion stops dead. Six sentences a seller says
 * every single day had no object behind them:
 *
 *   "here, have a look at it yourself"   → no prospect-facing share of a live board
 *   "here is what it would cost you"     → no priced, acceptable QUOTE
 *   "I'll follow up over the next week"  → no ordered CADENCE, only a blast campaign
 *   "as we discussed on the call…"       → no CALL object; the highest-signal artifact
 *                                          in sales was invisible to the board
 *   "let me set you up with a trial"     → nothing turns the demo board into a sandbox
 *   "send us your security questionnaire" → no assembled buyer-facing TRUST PACKET
 *   "here is the plan to go live"        → no MUTUAL plan both sides own
 *
 * Every one of those is a real object in every competing revenue tool, and every port
 * each of them needs is already connected here (mailbox send, social publish, Twilio
 * conversations, `share_links`, SOC-control register, legal documents, tenant
 * provisioning). The gap was never capability; it was that the commercial half of the
 * motion had no vocabulary, so none of it could be put on a board, connected to the work
 * it was selling, or reasoned over by the model that already reasons over everything else.
 *
 * ── WHY A SEVENTH VOCABULARY AND NOT MORE `founder`/`sales*` KINDS ──────────────
 * The canvas already has six sales kinds (`salesPipeline`, `salesContact`,
 * `salesCampaign`, `targetMarket`, `salesGoal`, `salesMeeting`), and the honest question
 * before declaring anything new was whether these are the same objects with more fields.
 * They are not, and the split is the same one `inbox`/`email` and `metric`/`liveMetric`
 * already draw — an INTENT that persists against an INSTRUMENT that acts:
 *
 *  · `quote` is not `pricing`. `pricing` (founder set) is the PRICE LIST — tiers, unit
 *    economics, gross margin: what we charge in general. A quote is ONE buyer's priced
 *    deal with a discount, a term and an expiry, that a specific person can ACCEPT. A
 *    price list you can accept is a shopping cart, not a price list.
 *  · `sequence` is not `emailCampaign`. A campaign is a BLAST: one message, one list,
 *    one send. A sequence is ORDERED OVER TIME across CHANNELS and stops on reply —
 *    which is the property that makes it an automation rather than a mail-merge. The
 *    hiring vocabulary already declared exactly this shape for candidates
 *    (`outreachSequence`) and said, in its own comment, that stopping on reply is what
 *    separates it from `emailCampaign`. This is that object pointed at buyers.
 *  · `call` is not `salesMeeting`. A meeting is a scheduled CONVERSATION with a URL and
 *    attendees. A call is an EXECUTED one, and everything valuable about it is what came
 *    out: the recording, the transcript, the objections raised, the commitment made. A
 *    `salesMeeting` carrying `objections` would be the misnaming `founderObjects` records
 *    for `interview`.
 *  · `trial` is not `environment` or `demo`. It is a time-boxed PROSPECT workspace with
 *    an owner, an expiry, and activation criteria that decide whether it converted.
 *  · `trustPacket` is not `dataRoom`. A data room is a fundraising artifact for
 *    investors; a trust packet answers a BUYER's security review, and its distinguishing
 *    field is the questionnaire — 120 rows somebody has to answer, with the evidence each
 *    answer rests on.
 *  · `mutualActionPlan` is not `roadmap`. A roadmap is ours. A MAP is THEIRS TOO: every
 *    milestone carries a named owner ON THE BUYER'S SIDE, which is the whole mechanism —
 *    it is a commitment device, not a plan.
 *
 * ── WHAT IS DELIBERATELY *NOT* A KIND ───────────────────────────────────────────
 * A prospect share is NOT an object: it is a `share_links` row against the session or the
 * card being shown, exactly as a résumé share already is, and inventing a `prospectShare`
 * kind would be a second tokenised-access concept beside the kernel's. Prospect ENGAGEMENT
 * is not an object either — it is `activity_log` rows with a `prospect` actor, read back
 * as a rollup. A discount is a FIELD on a quote line, not a kind. A "proposal" and a
 * "quote" are one object with a `presentation` value, the same rule that made a recall and
 * a warranty claim one `workOrder` with an `orderType`.
 *
 * ── WHY THE ARITHMETIC LIVES IN THIS PACKAGE ────────────────────────────────────
 * `quoteTotals` is called by THREE consumers that must not disagree: the card body a
 * seller edits, the buyer-facing accept page (which is served to somebody with no
 * account), and the API route that turns an acceptance into a checkout intent. A quote
 * whose card shows one number and whose accept button charges another is the single worst
 * defect this whole vocabulary could ship, so the number is computed once, here, in the
 * package both the web app and the Worker already import.
 */
// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------
export const SELL_MOTION_OBJECT_KINDS = [
    // WHAT IT COSTS THEM. Seats × plan × term × discount × expiry, that a buyer can accept
    // without an account. The object where a negotiated price stops dying on the way to
    // checkout.
    'quote',
    // WHAT THEY ACTUALLY SAID. Recording, transcript, objections, commitment, next step —
    // the highest-signal artifact in selling, and the one the board could not hold.
    'call',
    // LET THEM TRY IT. A time-boxed prospect workspace provisioned FROM the board built
    // with them, so the demo artifact becomes the trial and the trial becomes onboarding.
    'trial',
    // THE PROCUREMENT DELIVERABLE. Controls, subprocessors, the DPA, the diagnostics, and
    // the questionnaire answered row by row with the evidence each answer rests on.
    'trustPacket',
    // THE PLAN BOTH SIDES OWN. Dated milestones with a named owner on EACH side, and the
    // handoff that carries what was built during the sale into the customer's workspace.
    'mutualActionPlan',
];
// ---------------------------------------------------------------------------
// The quote — ONE definition of what a deal costs
// ---------------------------------------------------------------------------
/**
 * What a buyer may do with a quote we sent them.
 *
 * `expired` is DERIVED from `expiresAt`, never stored: a stored expiry state is one
 * that has to be swept, and a quote that is still "sent" three months after it lapsed is
 * a discount somebody can still take. See {@link quoteAcceptability}.
 */
export const QUOTE_STATES = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired'];
/** How the same priced deal is PRESENTED. A value, not a kind — see the header. */
export const QUOTE_PRESENTATIONS = ['quote', 'proposal', 'orderForm'];
export const QUOTE_BILLING_CYCLES = ['monthly', 'yearly'];
/** Plans priced PER SEAT. A closed list rather than a `!== 'pro'` test, so a plan added
 *  later is priced deliberately instead of inheriting whichever branch it falls into. */
const PER_SEAT_PLANS = new Set(['teams', 'enterprise']);
/** True when this line's price multiplies by seats. */
export function quoteLineIsPerSeat(line) {
    return PER_SEAT_PLANS.has(String(line.plan ?? '').trim().toLowerCase());
}
const clampNumber = (value, min, max) => {
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(parsed))
        return min;
    return Math.min(max, Math.max(min, parsed));
};
/** Read one authored row into a line the arithmetic can trust. Every bound is deliberate:
 *  a negative discount is a surcharge nobody meant to type, and a 10,000-seat quote with
 *  a typo'd extra zero is a forecast nobody can explain. */
export function readQuoteLine(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const row = raw;
    const description = String(row.description ?? row.item ?? '').trim().slice(0, 200);
    const plan = String(row.plan ?? '').trim().slice(0, 32);
    if (!description && !plan)
        return null;
    const cycle = String(row.billingCycle ?? '').trim().toLowerCase();
    return {
        description,
        plan,
        billingCycle: cycle === 'yearly' ? 'yearly' : 'monthly',
        seats: Math.round(clampNumber(row.seats ?? 1, 1, 100_000)),
        unitPriceCents: Math.round(clampNumber(row.unitPriceCents ?? row.unitPrice, 0, 1_000_000_000)),
        discountPercent: clampNumber(row.discountPercent ?? row.discount, 0, 100),
    };
}
/** Every readable line off a quote's authored `lines` field. */
export function readQuoteLines(value) {
    return Array.isArray(value)
        ? value.slice(0, 40).map(readQuoteLine).filter((line) => line != null)
        : [];
}
/**
 * THE quote arithmetic. One definition, three consumers (card, buyer page, accept route).
 *
 * `termMonths` is the committed length, NOT the billing period: a 24-month deal billed
 * monthly is twenty-four payments, and one billed yearly is two. Rounding is applied per
 * line and then summed, which is what an invoice does — summing first and rounding once
 * produces a total that disagrees with the lines printed above it by a cent, and a quote
 * whose lines do not add up is a quote a procurement team sends back.
 */
export function quoteTotals(lines, termMonths) {
    const term = Math.round(clampNumber(termMonths, 1, 120));
    let subtotalCents = 0;
    let discountCents = 0;
    for (const line of lines) {
        const quantity = quoteLineIsPerSeat(line) ? Math.max(1, line.seats) : 1;
        const lineSubtotal = Math.round(line.unitPriceCents * quantity);
        subtotalCents += lineSubtotal;
        discountCents += Math.round(lineSubtotal * (line.discountPercent / 100));
    }
    const totalCents = subtotalCents - discountCents;
    // Periods are counted off the FIRST line's cycle: a quote mixing monthly and yearly
    // billing is one nobody can state a contract value for, and inventing a blended number
    // would be worse than the honest simplification of pricing the deal the way it is billed.
    const yearly = lines.length > 0 && lines[0].billingCycle === 'yearly';
    const periods = yearly ? Math.max(1, Math.round(term / 12)) : term;
    return {
        subtotalCents,
        discountCents,
        totalCents,
        effectiveDiscountPercent: subtotalCents > 0 ? Math.round((discountCents / subtotalCents) * 1000) / 10 : 0,
        contractValueCents: totalCents * periods,
    };
}
/**
 * May this buyer accept, right now?
 *
 * The expiry is evaluated HERE rather than stored as a state, so a lapsed quote is
 * un-acceptable the instant it lapses and not the next time a sweep happens to run. The
 * accept route and the buyer-facing page call the same function, which is what stops the
 * page from offering a button the route will refuse.
 */
export function quoteAcceptability(quote, now) {
    const state = String(quote.state ?? '').trim().toLowerCase();
    if (state === 'accepted' || state === 'declined')
        return { acceptable: false, reason: 'settled' };
    if (state === 'draft' || state === '')
        return { acceptable: false, reason: 'notSent' };
    const expiry = Date.parse(String(quote.expiresAt ?? ''));
    if (Number.isFinite(expiry) && expiry <= now.getTime())
        return { acceptable: false, reason: 'expired' };
    return { acceptable: true, reason: 'ok' };
}
export function quoteCheckoutIntent(lines, termMonths) {
    const planLine = lines.find((line) => line.plan.trim().length > 0);
    if (!planLine)
        return null;
    const totals = quoteTotals(lines, termMonths);
    return {
        targetPlan: planLine.plan.trim().toLowerCase(),
        billingCycle: planLine.billingCycle,
        seats: quoteLineIsPerSeat(planLine) ? Math.max(1, planLine.seats) : 1,
        totalCents: totals.totalCents,
        termMonths: Math.round(clampNumber(termMonths, 1, 120)),
    };
}
// ---------------------------------------------------------------------------
// The sequence — ordered outreach that stops on reply
// ---------------------------------------------------------------------------
/**
 * The channels a cadence step may use.
 *
 * Every one is a port this platform already has connected — mailbox send
 * (`MailboxProvider`), social publish (`SocialProvider`), Twilio conversations for `call`
 * and `sms`, and `task` for the manual step a person still has to do. A channel with no
 * port behind it would be a step that silently never fires, which is the failure mode
 * `SpecField.deadline` was introduced to stop elsewhere.
 */
export const SEQUENCE_CHANNELS = ['email', 'social', 'call', 'sms', 'task'];
export const SEQUENCE_STATES = ['draft', 'running', 'paused', 'stopped', 'completed'];
const isoDay = (value) => {
    const parsed = Date.parse(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
};
export function readSequenceStep(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const row = raw;
    const channel = String(row.channel ?? 'email').trim().toLowerCase();
    if (!SEQUENCE_CHANNELS.includes(channel))
        return null;
    return {
        dayOffset: Math.round(clampNumber(row.dayOffset ?? row.day, 0, 365)),
        channel,
        subject: String(row.subject ?? '').trim().slice(0, 300),
        body: String(row.body ?? '').trim().slice(0, 5_000),
    };
}
/** Steps in the order they fire. Sorted here rather than trusting the author, because a
 *  step list a model wrote out of order would otherwise send the breakup email first. */
export function readSequenceSteps(value) {
    return (Array.isArray(value) ? value.slice(0, 20) : [])
        .map(readSequenceStep)
        .filter((step) => step != null)
        .sort((a, b) => a.dayOffset - b.dayOffset);
}
export function readSequenceEnrolment(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const row = raw;
    const contactRef = String(row.contactRef ?? row.email ?? '').trim().slice(0, 320);
    if (!contactRef)
        return null;
    const text = (value, max) => String(value ?? '').trim().slice(0, max);
    return {
        contactRef,
        name: text(row.name, 200),
        enrolledAtISO: text(row.enrolledAtISO ?? row.enrolledAt, 40),
        stepsSent: Math.round(clampNumber(row.stepsSent, 0, 100)),
        lastSentAtISO: text(row.lastSentAtISO ?? row.lastSentAt, 40),
        repliedAtISO: text(row.repliedAtISO ?? row.repliedAt, 40),
        stoppedAtISO: text(row.stoppedAtISO ?? row.stoppedAt, 40),
    };
}
export function readSequenceEnrolments(value) {
    return (Array.isArray(value) ? value.slice(0, 2_000) : [])
        .map(readSequenceEnrolment)
        .filter((row) => row != null);
}
/**
 * THE cadence rule, in one function.
 *
 * ── WHY A REPLY IS A STORED FACT AND NOT A STATE ─────────────────────────────────
 * "Stops on reply" could have been a `state: 'replied'` on the enrolment. It is a
 * TIMESTAMP instead, because the reply is evidence and a state is an opinion: a seller
 * looking at a cadence needs to see WHEN somebody answered (that is the whole signal), and
 * a state that has been flipped and flipped back tells them nothing. The stop is then
 * derived from the fact, here, in the one place the runner reads — so a reply recorded by
 * the mailbox poller, by a person marking it by hand, or by an inbound call all stop the
 * sequence identically, without three copies of the rule.
 *
 * A person is due a step when: the sequence is running, they have not replied, they have
 * not been stopped, there is a step after their cursor, and enough days have passed since
 * they were ENROLLED (not since the last send — offsets are absolute, so a runner that
 * misses a tick catches up rather than sliding the whole cadence).
 */
export function sequenceDueSteps(sequence, now) {
    const due = [];
    for (const next of pendingSequenceSteps(sequence)) {
        if (next.dueAtMs > now.getTime())
            continue;
        due.push({ enrolment: next.enrolment, stepIndex: next.stepIndex, step: next.step });
    }
    return due;
}
/**
 * The earliest moment any enrolled person becomes due a step, or null when nobody ever
 * will (not running, everyone finished/replied/stopped). Derived from the SAME per-person
 * rule as {@link sequenceDueSteps}, so the runner can store it as an indexed due time and
 * skip a cadence until then without ever disagreeing with what it would send.
 */
export function sequenceNextDueAt(sequence) {
    let earliest = null;
    for (const next of pendingSequenceSteps(sequence)) {
        if (earliest == null || next.dueAtMs < earliest)
            earliest = next.dueAtMs;
    }
    return earliest == null ? null : new Date(earliest);
}
/** Each live person's next step and when it fires — the one rule both readers above share. */
function pendingSequenceSteps(sequence) {
    const state = String(sequence.state ?? '').trim().toLowerCase();
    if (state !== 'running')
        return [];
    const steps = readSequenceSteps(sequence.steps);
    if (steps.length === 0)
        return [];
    const pending = [];
    for (const enrolment of readSequenceEnrolments(sequence.enrolments)) {
        if (enrolment.repliedAtISO || enrolment.stoppedAtISO)
            continue;
        const stepIndex = enrolment.stepsSent;
        const step = steps[stepIndex];
        if (!step)
            continue;
        const enrolledAt = isoDay(enrolment.enrolledAtISO);
        if (enrolledAt == null)
            continue;
        pending.push({ enrolment, stepIndex, step, dueAtMs: enrolledAt + step.dayOffset * 86_400_000 });
    }
    return pending;
}
export function sequenceProgress(sequence) {
    const steps = readSequenceSteps(sequence.steps);
    const enrolments = readSequenceEnrolments(sequence.enrolments);
    let replied = 0;
    let stopped = 0;
    let completed = 0;
    for (const row of enrolments) {
        if (row.repliedAtISO)
            replied += 1;
        else if (row.stoppedAtISO)
            stopped += 1;
        else if (steps.length > 0 && row.stepsSent >= steps.length)
            completed += 1;
    }
    return {
        enrolled: enrolments.length,
        replied,
        stopped,
        completed,
        replyRatePercent: enrolments.length > 0 ? Math.round((replied / enrolments.length) * 100) : undefined,
    };
}
// ---------------------------------------------------------------------------
// Prospect engagement — what they did with what we sent
// ---------------------------------------------------------------------------
/**
 * The events a prospect-facing share emits.
 *
 * Deliberately small and deliberately NOT free-form. Every entry is something a seller can
 * act on differently, which is the test for whether a signal earns a name: an `opened`
 * changes the follow-up, a `dwell` on the pricing card changes what the follow-up SAYS,
 * and a `requestedControl` is a buying signal strong enough to interrupt somebody for.
 * "Scrolled", "moved the mouse" and "resized the window" are absent because no seller has
 * ever done anything differently because of one.
 *
 * These are `activity_log` verbs under the `prospect.` prefix — one store, one audit
 * trail, one retention policy, rather than a private analytics table nobody reconciles.
 */
export const PROSPECT_EVENTS = ['opened', 'viewed', 'dwell', 'requestedControl', 'accepted', 'declined', 'downloaded'];
export const PROSPECT_ACTIVITY_PREFIX = 'prospect.';
/** The `activity_log` verb for one prospect event. One spelling, both sides of the wire. */
export function prospectVerb(event) {
    return `${PROSPECT_ACTIVITY_PREFIX}${event}`;
}
export function isProspectEvent(value) {
    return typeof value === 'string' && PROSPECT_EVENTS.includes(value);
}
/** Beyond this a hotspot list is a log, not a signal. */
const MAX_HOTSPOTS = 8;
/**
 * Roll raw signals into the answer a seller asks for: did they look, for how long, and at
 * WHAT.
 *
 * Pure, so the pipeline view, the card body and the CRO coach's prompt all read one
 * rollup rather than each summing the same rows their own way.
 */
export function summarizeProspectEngagement(signals) {
    const byObject = new Map();
    let opens = 0;
    let totalSeconds = 0;
    let lastSeenAtISO = '';
    let requestedControl = false;
    for (const signal of signals) {
        if (signal.event === 'opened')
            opens += 1;
        if (signal.event === 'requestedControl')
            requestedControl = true;
        if (signal.occurredAtISO > lastSeenAtISO)
            lastSeenAtISO = signal.occurredAtISO;
        if (!signal.objectId)
            continue;
        const entry = byObject.get(signal.objectId)
            ?? { objectId: signal.objectId, objectLabel: signal.objectLabel, seconds: 0, views: 0 };
        if (signal.event === 'dwell') {
            entry.seconds += Math.max(0, signal.seconds);
            totalSeconds += Math.max(0, signal.seconds);
        }
        if (signal.event === 'viewed' || signal.event === 'dwell')
            entry.views += 1;
        // A later row carries the current label: a card renamed after it was watched should
        // read under its new name, not the one it had the first time somebody opened it.
        if (signal.objectLabel)
            entry.objectLabel = signal.objectLabel;
        byObject.set(signal.objectId, entry);
    }
    return {
        opens,
        totalSeconds,
        lastSeenAtISO,
        hotspots: [...byObject.values()]
            .sort((a, b) => b.seconds - a.seconds || b.views - a.views)
            .slice(0, MAX_HOTSPOTS),
        requestedControl,
        everOpened: signals.length > 0,
    };
}
// ---------------------------------------------------------------------------
// The mutual action plan — a milestone both sides own
// ---------------------------------------------------------------------------
export const MAP_MILESTONE_STATES = ['pending', 'inProgress', 'done', 'blocked'];
export function readMapMilestone(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const row = raw;
    const title = String(row.title ?? row.milestone ?? '').trim().slice(0, 200);
    if (!title)
        return null;
    const state = String(row.state ?? 'pending').trim();
    return {
        title,
        dueAtISO: String(row.dueAtISO ?? row.dueAt ?? '').trim().slice(0, 40),
        sellerOwner: String(row.sellerOwner ?? '').trim().slice(0, 120),
        buyerOwner: String(row.buyerOwner ?? '').trim().slice(0, 120),
        state: MAP_MILESTONE_STATES.includes(state) ? state : 'pending',
    };
}
export function readMapMilestones(value) {
    return (Array.isArray(value) ? value.slice(0, 60) : [])
        .map(readMapMilestone)
        .filter((row) => row != null);
}
/** How real is this plan? Pure, and read by the card, the pipeline and the coach. */
export function mutualPlanHealth(milestones, now) {
    let done = 0;
    let overdue = 0;
    let unownedByBuyer = 0;
    let nextDueTitle = '';
    let nextDueAtISO = '';
    for (const milestone of milestones) {
        if (milestone.state === 'done') {
            done += 1;
            continue;
        }
        if (!milestone.buyerOwner)
            unownedByBuyer += 1;
        const due = isoDay(milestone.dueAtISO);
        if (due == null)
            continue;
        if (due < now.getTime()) {
            overdue += 1;
            continue;
        }
        if (!nextDueAtISO || milestone.dueAtISO < nextDueAtISO) {
            nextDueAtISO = milestone.dueAtISO;
            nextDueTitle = milestone.title;
        }
    }
    return {
        total: milestones.length,
        done,
        overdue,
        unownedByBuyer,
        completionPercent: milestones.length > 0 ? Math.round((done / milestones.length) * 100) : undefined,
        nextDueTitle,
        nextDueAtISO,
    };
}
// ---------------------------------------------------------------------------
// The trust packet — a security review with a deliverable
// ---------------------------------------------------------------------------
export const TRUST_ANSWER_STATES = ['unanswered', 'answered', 'notApplicable', 'gap'];
export function readTrustAnswer(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        return null;
    const row = raw;
    const question = String(row.question ?? '').trim().slice(0, 500);
    if (!question)
        return null;
    const state = String(row.state ?? '').trim();
    const answer = String(row.answer ?? '').trim().slice(0, 2_000);
    return {
        question,
        answer,
        evidence: String(row.evidence ?? '').trim().slice(0, 500),
        state: TRUST_ANSWER_STATES.includes(state)
            ? state
            : answer ? 'answered' : 'unanswered',
    };
}
export function readTrustAnswers(value) {
    return (Array.isArray(value) ? value.slice(0, 400) : [])
        .map(readTrustAnswer)
        .filter((row) => row != null);
}
export function trustPacketReadiness(answers) {
    let answered = 0;
    let gaps = 0;
    let unevidenced = 0;
    for (const row of answers) {
        if (row.state === 'answered') {
            answered += 1;
            if (!row.evidence)
                unevidenced += 1;
        }
        else if (row.state === 'gap')
            gaps += 1;
        // `notApplicable` counts toward neither: a row a buyer struck out is not progress and
        // is not a gap, and folding it into either would make the percentage a negotiation.
    }
    const scored = answers.filter((row) => row.state !== 'notApplicable').length;
    return {
        total: answers.length,
        answered,
        gaps,
        unevidenced,
        readyPercent: scored > 0 ? Math.round((answered / scored) * 100) : undefined,
    };
}
//# sourceMappingURL=sellMotion.js.map