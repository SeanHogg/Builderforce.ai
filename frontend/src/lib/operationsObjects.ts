/**
 * THE operations-object specification — the work a vertical company actually sells.
 *
 * `operations.ts` in the contract argues WHY this vocabulary exists and why it is one
 * vocabulary rather than one pack per industry. This is its declaration: one entry per
 * kind, from which the node body, the model-facing field documentation, the registry's
 * `createData`/`MUTABLE_FIELDS`/`CONTEXT_FIELDS` rows and the empty-shell rule are all
 * derived. Adding an operations kind is adding one entry here.
 *
 * ── THE COMPUTED FIELDS, AND WHY THEY ARE COMPUTED ───────────────────────────────
 * This is the first vocabulary where the numbers that matter are ARITHMETIC over the
 * rows on the same card: a job's cost is its parts plus its labour, an estimate's total
 * is the sum of its lines, a day's utilisation is assigned hours over capacity. Storing
 * those would be one fact in two places, and it fails the way stored totals always fail —
 * a line is edited, nothing recomputes, and the card shows a total that disagrees with
 * the rows printed directly beneath it. So they declare `derive` and are computed at
 * render, are readable by the model, and are authorable by nobody. See `SpecField.derive`.
 *
 * Every derivation refuses rather than guesses. `sumMoney` skips a row it cannot parse
 * and SAYS it skipped it; a total over zero counted rows is `undefined`, so the card
 * omits the section instead of showing a confident 0 for a job whose parts nobody
 * priced — the difference between "no answer" and "the answer is nothing", which is the
 * whole argument `canvasMetricsDerived` makes for metrics.
 *
 * ── THE FIELDS THAT ARE `derived` RATHER THAN `derive` ───────────────────────────
 * A handful of fields are written by a MECHANISM and cannot be computed from the card:
 * a visit's actual check-in and check-out times, an estimate's acceptance, a shipment's
 * delivery. They are flagged `derived` for the reason `submission.mark` is — a model that
 * could write `checkOutAt` could evidence a visit that never happened, and that evidence
 * is what an invoice is raised against.
 */

import { OPERATIONS_OBJECT_KINDS, type OperationsObjectKind } from '@builderforce/creation-canvas-contract';
import { formatMoney, sumRowColumn, type MoneyTotal } from './canvasMoney';
import {
  deriveDaysBetween, deriveNumber, derivePercent, registerSpecObjectSet, sumColumn,
  SOURCES_FIELD, SUMMARY_FIELD,
  type SpecField, type SpecObjectSpec,
} from './specObjects';

/** i18n namespace for every operations label, status, field and column. */
export const OPERATIONS_NAMESPACE = 'creationCanvas.operations';

/**
 * Money is stored as a STRING with its currency inline, exactly as the founder and hiring
 * sets store it, and for the same reason: a real quote is routinely a range, a "from",
 * or "POA", and forcing that into an integer either loses the qualifier or invents a
 * precision the source never had.
 */
const MONEY_HINT = 'A human-readable amount including its currency, e.g. "£420" or "$1,250 + VAT". Never invent a precise figure the source did not carry.';

/** A total, or nothing at all. Never a zero — see the header. */
function totalText(total: MoneyTotal): string | undefined {
  return total.counted > 0 && total.total ? formatMoney(total.total) : undefined;
}

/**
 * The location block, shared by every kind that happens somewhere.
 *
 * Declared once because "where" is the field an operation is dispatched on, and three
 * vocabularies-worth of near-identical address fields is exactly the drift the shared
 * `CONSENT_FIELDS` block in the hiring set exists to prevent.
 */
const SITE_FIELD: SpecField = {
  name: 'site',
  render: 'stat',
  label: 'site',
  hint: 'Where this is, as an engineer would need it: site name plus the address or unit. Include the access note ("gate code", "keys with concierge") if there is one — it is the commonest cause of a wasted visit.',
};

/**
 * Which trade or industry this object belongs to.
 *
 * The value that makes ONE operations vocabulary serve field service, property, clinical,
 * fleet, manufacturing and professional practice — see `operations.ts`. It is on the
 * objects that are actually filtered by it (the asset, the order, the board) rather than
 * on all thirteen, because a purchase order's discipline is its parent order's.
 */
const DISCIPLINE_FIELD: SpecField = {
  name: 'discipline',
  render: 'stat',
  label: 'discipline',
  hint: 'The trade this belongs to: fieldService | trades | property | facilities | clinical | veterinary | fleet | logistics | manufacturing | hospitality | professional | other. It is what lets one board serve one business without renaming a single kind.',
  bookkeeping: true,
};

export const OPERATIONS_OBJECT_SPECS: readonly SpecObjectSpec[] = [
  // ── THE THING BEING SERVED ────────────────────────────────────────────────────
  {
    kind: 'serviceAsset',
    icon: '⬢',
    group: 'Operations',
    defaultStatus: 'inService',
    actions: ['inspect', 'schedule', 'retire'],
    fields: [
      { name: 'assetTag', render: 'stat', label: 'assetTag', hint: 'The identifier written on the asset itself — the plate, the sticker, the unit number. What an engineer reads out over the phone.' },
      { name: 'assetClass', render: 'stat', label: 'assetClass', hint: 'What kind of thing it is in this business\'s own words: "gas boiler", "chiller", "rental unit", "HGV tractor", "treatment room", "CNC lathe".' },
      DISCIPLINE_FIELD,
      SITE_FIELD,
      { name: 'makeModel', render: 'stat', label: 'makeModel', hint: 'Manufacturer and model. The field that decides which part fits, and the one whose absence turns a repair into a return visit.' },
      { name: 'serialNumber', render: 'stat', label: 'serialNumber', hint: 'Serial or VIN. Required by most warranty claims and every recall notice.' },
      { name: 'installedAt', render: 'stat', label: 'installedAt', hint: 'ISO date it went into service. The clock every age-based maintenance rule runs from.' },
      { name: 'warrantyUntil', render: 'stat', label: 'warrantyUntil', hint: 'ISO date cover ends. Checking this BEFORE dispatching is the difference between a billed job and a free one.' },
      { name: 'criticality', render: 'stat', label: 'criticality', hint: 'What breaks when this does: critical | important | routine. Drives priority when two jobs compete for one engineer.' },
      { name: 'condition', render: 'meter', label: 'condition', hint: '0-100 condition from the most recent inspection. Only set it from an inspection that happened — a condition score with no survey behind it is a number that looks like evidence.' },
      { name: 'meterReading', render: 'stat', label: 'meterReading', hint: 'Hours, miles or cycles at the last reading, with its unit. What usage-based servicing is scheduled against.' },
      { name: 'nextServiceDue', render: 'stat', label: 'nextServiceDue', hint: 'ISO date the next planned service falls due, from the agreement or the statutory interval.' },
      {
        name: 'serviceHistory',
        render: 'rows',
        label: 'serviceHistory',
        columns: ['date', 'orderType', 'engineer', 'work', 'cost'],
        hint: 'What has been done to it: {date, orderType, engineer, work, cost}. Only jobs that actually happened — this is the record a replace-or-repair decision is made on, and an invented row makes that decision wrong.',
        bookkeeping: true,
      },
      {
        name: 'lifetimeCost',
        render: 'stat',
        label: 'lifetimeCost',
        hint: 'Total spent on this asset, summed from its service history. Computed, never typed.',
        derive: (data) => totalText(sumRowColumn(data.serviceHistory, 'cost')),
      },
      SUMMARY_FIELD,
    ],
  },
  // ── THE WORK ──────────────────────────────────────────────────────────────────
  {
    kind: 'workOrder',
    icon: '▣',
    group: 'Operations',
    defaultStatus: 'unscheduled',
    actions: ['triage', 'schedule', 'complete', 'invoice'],
    fields: [
      { name: 'orderType', render: 'stat', label: 'orderType', hint: 'reactive | planned | installation | warranty | callback | inspection. A callback is its own type on purpose: it is the number that says whether the first visit actually fixed anything.' },
      DISCIPLINE_FIELD,
      { name: 'priority', render: 'stat', label: 'priority', hint: 'emergency | urgent | routine | scheduled, in this business\'s own words if it uses others.' },
      { name: 'customerRef', render: 'stat', label: 'customerRef', hint: 'Who it is for, by id or name — a `salesContact`, a tenant, a patient record. An id, never an imported record.', bookkeeping: true },
      { name: 'assetRef', render: 'stat', label: 'assetRef', hint: 'The `serviceAsset` this is work ON, by id. Without it the job cannot join to the asset\'s history, which is where every repair-or-replace answer comes from.', bookkeeping: true },
      { name: 'agreementRef', render: 'stat', label: 'agreementRef', hint: 'The `serviceAgreement` this is covered by, if any. What decides whether it is billable before anybody drives anywhere.', bookkeeping: true },
      SITE_FIELD,
      { name: 'reportedFault', render: 'text', label: 'reportedFault', hint: 'What the customer actually said, in their words. Not your diagnosis — the two disagreeing is itself diagnostic.' },
      { name: 'slaDueAt', render: 'stat', label: 'slaDueAt', hint: 'ISO instant the response or fix is contractually due. The single most important date on the object.' },
      { name: 'assignedTo', render: 'chips', label: 'assignedTo', hint: 'Who is doing it: engineers, crews or subcontractors. Empty means it is in the unassigned pile, which is where a dispatch board looks first.' },
      { name: 'tasks', render: 'list', label: 'tasks', hint: 'The work to be done: [{title, detail}]. Specific enough that a different engineer could pick it up.' },
      {
        name: 'partsUsed',
        render: 'rows',
        label: 'partsUsed',
        columns: ['part', 'quantity', 'cost'],
        hint: 'Parts consumed: {part, quantity, cost}. Only parts actually fitted — this drives both the invoice and the stock count, so an optimistic row is wrong twice.',
      },
      { name: 'labourHours', render: 'stat', label: 'labourHours', hint: 'Hours worked on site, as a number. Travel is separate and belongs on the visit.' },
      { name: 'labourRate', render: 'stat', label: 'labourRate', hint: `Charge-out or cost rate per hour. ${MONEY_HINT}` },
      {
        name: 'costToServe',
        render: 'stat',
        label: 'costToServe',
        hint: 'Parts plus labour for this job. Computed from the rows above and never typed — an authored total that disagrees with the parts printed beneath it is the drift this field exists to make impossible.',
        derive: (data) => {
          const parts = sumRowColumn(data.partsUsed, 'cost');
          const hours = deriveNumber(data.labourHours);
          const rate = sumRowColumn([{ rate: data.labourRate }], 'rate');
          const labour = hours != null && rate.total?.amount != null ? hours * rate.total.amount : undefined;
          if (!parts.total && labour == null) return undefined;
          const currency = parts.total?.currency ?? rate.total?.currency;
          return formatMoney({
            amount: (parts.total?.amount ?? 0) + (labour ?? 0),
            ...(currency ? { currency } : {}),
            ...(parts.skipped.length ? { approximate: true } : {}),
          });
        },
      },
      { name: 'billable', render: 'stat', label: 'billable', hint: 'Whether this job is chargeable, and under what: billable | agreement | warranty | goodwill. "Goodwill" is a decision somebody made and must be visible, not a silent write-off.' },
      { name: 'resolution', render: 'text', label: 'resolution', hint: 'What was actually wrong and what fixed it. The paragraph the next engineer reads before driving out — and the reason the same fault is not diagnosed from scratch three times.' },
      { name: 'firstTimeFix', render: 'stat', label: 'firstTimeFix', hint: 'Whether it was fixed on the first visit. Written from the visits on the board, never asserted: it is the headline operational metric and a self-reported one is worthless.', derived: true },
      { name: 'completedAt', render: 'stat', label: 'completedAt', hint: 'ISO instant the work was signed off.', derived: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'visit',
    icon: '◷',
    group: 'Operations',
    defaultStatus: 'notScheduled',
    actions: ['schedule', 'dispatch', 'complete'],
    fields: [
      { name: 'workOrderRef', render: 'stat', label: 'workOrderRef', hint: 'The `workOrder` this visit executes, by id. One order can need several visits — a return trip for a part is the commonest event in field service.', bookkeeping: true },
      { name: 'engineer', render: 'stat', label: 'engineer', hint: 'Who is attending. One name: a visit with two engineers is two visits, or a crew, and pretending otherwise makes capacity uncountable.' },
      { name: 'scheduledStart', render: 'stat', label: 'scheduledStart', hint: 'ISO instant of the booked start.' },
      { name: 'arrivalWindow', render: 'stat', label: 'arrivalWindow', hint: 'The window the CUSTOMER was promised, e.g. "08:00–12:00". Distinct from the scheduled start, because the promise is what a missed appointment is judged against.' },
      { name: 'durationMinutes', render: 'stat', label: 'durationMinutes', hint: 'Expected on-site minutes. What the day is planned with.' },
      { name: 'travelMinutes', render: 'stat', label: 'travelMinutes', hint: 'Expected travel to this visit. Excluded from the job\'s labour and included in the engineer\'s day — an operation that plans without it always overbooks.' },
      SITE_FIELD,
      { name: 'access', render: 'text', label: 'access', hint: 'How to get in and who to ask for. The field that turns a wasted journey into a completed job.' },
      { name: 'checkInAt', render: 'stat', label: 'checkInAt', hint: 'ISO instant the engineer actually arrived. Recorded by the app on site — never authored, because it is the evidence an invoice and an SLA credit are both argued from.', derived: true },
      { name: 'checkOutAt', render: 'stat', label: 'checkOutAt', hint: 'ISO instant they left. Same rule as the arrival.', derived: true },
      {
        name: 'onSiteMinutes',
        render: 'stat',
        label: 'onSiteMinutes',
        hint: 'Actual minutes on site, from the recorded arrival and departure. Computed.',
        derive: (data) => {
          const inAt = Date.parse(String(data.checkInAt ?? ''));
          const outAt = Date.parse(String(data.checkOutAt ?? ''));
          if (!Number.isFinite(inAt) || !Number.isFinite(outAt) || outAt < inAt) return undefined;
          return Math.round((outAt - inAt) / 60_000);
        },
      },
      { name: 'outcome', render: 'verdict', label: 'outcome', hint: 'completed | partial | no-access | parts-required | aborted, with one sentence saying why. "Partial" and "parts-required" are different failures and must not be recorded as the same one.' },
      { name: 'onSiteNotes', render: 'text', label: 'onSiteNotes', hint: 'What was found and done, written on site. Job-related only — the customer can ask for a copy.' },
      { name: 'evidence', render: 'list', label: 'evidence', hint: 'Photos and readings taken on site: [{title, url}]. Before-and-after is what settles a dispute six months later.', bookkeeping: true },
      { name: 'signedBy', render: 'stat', label: 'signedBy', hint: 'Who signed the work off on site, and when. Written by the signature capture, never asserted.', derived: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'dispatchBoard',
    icon: '▤',
    group: 'Operations',
    defaultStatus: 'planning',
    actions: ['plan', 'assign', 'optimise'],
    fields: [
      { name: 'day', render: 'stat', label: 'day', hint: 'ISO date this board plans. One day per board: a week-long board is a report, and nobody dispatches from a report.' },
      DISCIPLINE_FIELD,
      { name: 'area', render: 'stat', label: 'area', hint: 'The patch this board covers — a region, a depot, a round. What stops a board being every engineer in the country.' },
      {
        name: 'engineers',
        render: 'rows',
        label: 'engineers',
        columns: ['engineer', 'skills', 'capacityHours', 'assignedHours', 'travelMinutes'],
        hint: 'The day\'s capacity: {engineer, skills, capacityHours, assignedHours, travelMinutes}. `skills` is what makes an assignment legal as well as possible — dispatching an unqualified engineer is the failure this column exists to prevent.',
      },
      {
        name: 'unassigned',
        render: 'rows',
        label: 'unassigned',
        columns: ['workOrder', 'priority', 'slaDueAt', 'area'],
        hint: 'The pile: {workOrder, priority, slaDueAt, area}. Sorted by what breaches first, not by what arrived first.',
      },
      {
        name: 'utilisation',
        render: 'meter',
        label: 'utilisation',
        hint: 'Assigned hours as a share of capacity, 0-100. Computed from the engineer rows — the one number that says whether today is full, and the one nobody should be able to type.',
        derive: (data) => derivePercent(sumColumn(data.engineers, 'assignedHours'), sumColumn(data.engineers, 'capacityHours')),
      },
      {
        name: 'atRisk',
        render: 'stat',
        label: 'atRisk',
        hint: 'How many unassigned jobs are already past, or due within the day. Computed from the pile — the number a morning meeting starts with.',
        derive: (data) => {
          if (!Array.isArray(data.unassigned)) return undefined;
          const horizon = Date.now() + 86_400_000;
          const count = data.unassigned.filter((row) => {
            const due = Date.parse(String((row as Record<string, unknown>)?.slaDueAt ?? ''));
            return Number.isFinite(due) && due <= horizon;
          }).length;
          return count > 0 ? count : undefined;
        },
      },
      { name: 'constraints', render: 'chips', label: 'constraints', hint: 'What the plan must respect: certifications, two-person jobs, congestion charges, customer windows, statutory rest.' },
      SUMMARY_FIELD,
    ],
  },
  // ── THE COMMERCIAL FRAME ──────────────────────────────────────────────────────
  {
    kind: 'serviceAgreement',
    icon: '◈',
    group: 'Operations',
    defaultStatus: 'draft',
    actions: ['draft', 'price', 'renew'],
    fields: [
      { name: 'customerRef', render: 'stat', label: 'customerRef', hint: 'Who holds the agreement, by id — the `salesContact`, landlord or account it belongs to.', bookkeeping: true },
      { name: 'coverage', render: 'text', label: 'coverage', hint: 'What is covered and — more importantly — what is not. Every dispute about a service contract is about the second half.' },
      { name: 'coveredAssets', render: 'chips', label: 'coveredAssets', hint: 'The `serviceAsset` ids this covers. A contract that names a site rather than its assets cannot answer "is this boiler covered", which is the only question anybody asks it.' },
      { name: 'cadence', render: 'stat', label: 'cadence', hint: 'How often planned work falls due: "quarterly", "annual", "500 hours". What planned work orders are generated FROM rather than remembered into existence.' },
      { name: 'responseHours', render: 'stat', label: 'responseHours', hint: 'Contracted hours to respond, by priority if it varies.' },
      { name: 'resolutionHours', render: 'stat', label: 'resolutionHours', hint: 'Contracted hours to fix. Distinct from response, and the one that actually carries a penalty.' },
      { name: 'price', render: 'stat', label: 'price', hint: MONEY_HINT },
      { name: 'billingCycle', render: 'stat', label: 'billingCycle', hint: 'monthly | quarterly | annual | per-visit.' },
      { name: 'startsAt', render: 'stat', label: 'startsAt', hint: 'ISO date cover begins.' },
      { name: 'endsAt', render: 'stat', label: 'endsAt', hint: 'ISO date cover ends. An agreement with no end date auto-renews forever somewhere in the accounts.' },
      { name: 'noticeDays', render: 'stat', label: 'noticeDays', hint: 'Notice required to cancel. The number that decides when a renewal conversation has to start.' },
      {
        name: 'entitlements',
        render: 'rows',
        label: 'entitlements',
        columns: ['entitlement', 'included', 'used'],
        hint: 'What the customer has bought and how much is left: {entitlement, included, used}. "Four visits a year, three used" is the sentence this table exists to make answerable.',
      },
      {
        name: 'consumed',
        render: 'meter',
        label: 'consumed',
        hint: 'Share of the entitlement used, 0-100. Computed from the table above — the number that says whether this contract is profitable before it renews.',
        derive: (data) => derivePercent(sumColumn(data.entitlements, 'used'), sumColumn(data.entitlements, 'included')),
      },
      { name: 'renewalRisk', render: 'verdict', label: 'renewalRisk', hint: 'Whether this will renew, with the reason. Grounded in the consumption and the incidents on the board, never a feeling.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'estimate',
    icon: '✎',
    group: 'Operations',
    defaultStatus: 'draft',
    actions: ['draft', 'price', 'send'],
    fields: [
      { name: 'customerRef', render: 'stat', label: 'customerRef', hint: 'Who it is for, by id.', bookkeeping: true },
      { name: 'workOrderRef', render: 'stat', label: 'workOrderRef', hint: 'The job this prices, if it exists yet. An accepted estimate becomes one.', bookkeeping: true },
      { name: 'scope', render: 'text', label: 'scope', hint: 'What is being quoted for, in the customer\'s language. The paragraph that decides whether a variation is chargeable later.' },
      {
        name: 'lines',
        render: 'rows',
        label: 'lines',
        columns: ['description', 'quantity', 'unitPrice', 'amount'],
        hint: 'The priced lines: {description, quantity, unitPrice, amount}. Price what you will actually do — an estimate that omits access equipment is a job that loses money.',
      },
      { name: 'exclusions', render: 'chips', label: 'exclusions', hint: 'What is explicitly NOT included: making good, disposal, out-of-hours, parts on failure. The half a customer argues about.' },
      {
        name: 'total',
        render: 'stat',
        label: 'total',
        hint: 'Sum of the priced lines. Computed, never typed — a quoted total that disagrees with its own lines is the error a customer finds and never forgets.',
        derive: (data) => totalText(sumRowColumn(data.lines, 'amount')),
      },
      { name: 'validUntil', render: 'stat', label: 'validUntil', hint: 'ISO date the price lapses. Material costs move; an estimate with no expiry is a promise you did not mean to make.' },
      { name: 'terms', render: 'text', label: 'terms', hint: 'Payment terms, deposit, and what happens if the scope changes on site.' },
      { name: 'winProbability', render: 'meter', label: 'winProbability', hint: '0-100 likelihood this is accepted. Only from evidence — how this customer has behaved before, how the price compares. A number pulled from nowhere makes a forecast worse, not better.' },
      { name: 'acceptedAt', render: 'stat', label: 'acceptedAt', hint: 'ISO instant the customer accepted. Written by the acceptance, never asserted: it is the moment a price becomes a contract.', derived: true },
      { name: 'declineReason', render: 'stat', label: 'declineReason', hint: 'Why it was lost, in one phrase: price | timing | scope | competitor | no-response. The field that makes a win rate diagnosable rather than merely depressing.' },
      SOURCES_FIELD,
      SUMMARY_FIELD,
    ],
  },
  // ── THE EVIDENCE AND THE PERMISSION ───────────────────────────────────────────
  {
    kind: 'inspection',
    icon: '⛉',
    group: 'Operations',
    defaultStatus: 'notStarted',
    actions: ['run', 'certify', 'export'],
    fields: [
      { name: 'inspectionType', render: 'stat', label: 'inspectionType', hint: 'What procedure this is: safety check | statutory certificate | condition survey | pre-use walkaround | quality gate | calibration.' },
      { name: 'assetRef', render: 'stat', label: 'assetRef', hint: 'The `serviceAsset` inspected, by id. An inspection with no asset is a form, not a record.', bookkeeping: true },
      { name: 'standard', render: 'stat', label: 'standard', hint: 'The standard or regulation it is performed against, named exactly — the citation an auditor checks.' },
      { name: 'inspector', render: 'stat', label: 'inspector', hint: 'Who performed it. Their `certification` must be valid on the date below, which is the check nothing else on the board performs.' },
      { name: 'performedAt', render: 'stat', label: 'performedAt', hint: 'ISO instant it was carried out.' },
      {
        name: 'lines',
        render: 'rows',
        label: 'lines',
        columns: ['check', 'result', 'note', 'evidence'],
        hint: 'The procedure, line by line: {check, result, note, evidence}. `result` is pass | fail | n/a. A failed line needs a note — "fail" with no reason cannot be remedied and cannot be defended.',
      },
      {
        name: 'passRate',
        render: 'meter',
        label: 'passRate',
        hint: 'Share of applicable lines that passed, 0-100. Computed from the lines; n/a lines are excluded from the denominator rather than counted as passes.',
        derive: (data) => {
          if (!Array.isArray(data.lines)) return undefined;
          const applicable = data.lines
            .map((row) => String((row as Record<string, unknown>)?.result ?? '').trim().toLowerCase())
            .filter((result) => result === 'pass' || result === 'fail');
          return derivePercent(applicable.filter((result) => result === 'pass').length, applicable.length);
        },
      },
      { name: 'outcome', render: 'verdict', label: 'outcome', hint: 'pass | pass-with-actions | fail, with the sentence that says what happens next. A failed statutory inspection usually means the asset stops being used TODAY, and that must be legible on the card.' },
      { name: 'remedialWork', render: 'list', label: 'remedialWork', hint: 'What must be put right: [{title, detail}]. Each one is a `workOrder` waiting to be raised.' },
      { name: 'certificateRef', render: 'stat', label: 'certificateRef', hint: 'The certificate number issued, where the inspection produces one.', bookkeeping: true },
      { name: 'nextDueAt', render: 'stat', label: 'nextDueAt', hint: 'ISO date the next one falls due. The field the whole compliance calendar is built from.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'certification',
    icon: '✦',
    group: 'Operations',
    defaultStatus: 'unverified',
    actions: ['verify', 'renew'],
    fields: [
      { name: 'holder', render: 'stat', label: 'holder', hint: 'Who or what holds it: an engineer, the company, a vehicle, a machine.' },
      { name: 'credentialType', render: 'stat', label: 'credentialType', hint: 'trade registration | practising certificate | insurance | calibration | operating licence | training record.' },
      { name: 'issuer', render: 'stat', label: 'issuer', hint: 'The body that issued it. Named, because "certified" without an issuer is not a claim anybody can check.' },
      { name: 'reference', render: 'stat', label: 'reference', hint: 'The registration or policy number, as it appears on the certificate.' },
      { name: 'scope', render: 'chips', label: 'scope', hint: 'What it actually permits — the work types this credential covers. Dispatching outside this list is the exposure the object exists to prevent.' },
      { name: 'issuedAt', render: 'stat', label: 'issuedAt', hint: 'ISO date it was granted.' },
      { name: 'expiresAt', render: 'stat', label: 'expiresAt', hint: 'ISO date it lapses. The most important field here: an expired certificate does not announce itself, and working against one can cost the company its own licence.' },
      {
        name: 'validity',
        render: 'verdict',
        label: 'validity',
        hint: 'Whether it is currently valid, computed from the expiry. Never authored — a self-asserted "valid" is exactly the claim that turns out to be false at the worst moment.',
        derive: (data) => {
          const days = deriveDaysBetween(new Date().toISOString(), data.expiresAt);
          if (days == null) return undefined;
          if (days < 0) return `expired ${Math.abs(days)}d ago`;
          if (days <= 30) return `expires in ${days}d`;
          return `valid · ${days}d remaining`;
        },
      },
      { name: 'verifiedAt', render: 'stat', label: 'verifiedAt', hint: 'ISO instant somebody actually checked it against the issuing register. Distinct from the issue date, because a certificate can be revoked without expiring.', derived: true },
      { name: 'evidence', render: 'list', label: 'evidence', hint: 'The certificate itself: [{title, url}].', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── WHAT THE WORK CONSUMES ────────────────────────────────────────────────────
  {
    kind: 'inventoryItem',
    icon: '▥',
    group: 'Operations',
    defaultStatus: 'notCounted',
    actions: ['count', 'reorder'],
    fields: [
      { name: 'sku', render: 'stat', label: 'sku', hint: 'The part number this business orders by. The manufacturer\'s, if there is no internal one.' },
      { name: 'location', render: 'stat', label: 'location', hint: 'Where the stock is: a van, a store, a bin. Van stock and store stock are different balances and merging them is how a job leaves without its part.' },
      { name: 'onHand', render: 'stat', label: 'onHand', hint: 'Units physically held, from the last count. A number nobody has counted is a guess with a decimal point.' },
      { name: 'onOrder', render: 'stat', label: 'onOrder', hint: 'Units already on a purchase order and not yet received.' },
      { name: 'reorderPoint', render: 'stat', label: 'reorderPoint', hint: 'The level at which more must be ordered. Set it from usage times lead time, not from a round number that feels safe.' },
      { name: 'leadTimeDays', render: 'stat', label: 'leadTimeDays', hint: 'Days from ordering to having it on the shelf. The field that makes the reorder point calculable rather than guessed.' },
      { name: 'unitCost', render: 'stat', label: 'unitCost', hint: MONEY_HINT },
      { name: 'supplierRef', render: 'stat', label: 'supplierRef', hint: 'The `supplier` this is bought from, by id.', bookkeeping: true },
      {
        name: 'stockCoverage',
        render: 'verdict',
        label: 'stockCoverage',
        hint: 'Whether stock covers the reorder point once what is on order arrives. Computed — the card says "order now" rather than making a reader compare three numbers.',
        derive: (data) => {
          const onHand = deriveNumber(data.onHand);
          const point = deriveNumber(data.reorderPoint);
          if (onHand == null || point == null) return undefined;
          const incoming = deriveNumber(data.onOrder) ?? 0;
          if (onHand <= 0) return 'out of stock';
          if (onHand + incoming <= point) return incoming > 0 ? 'below reorder point even with stock on order' : 'at or below reorder point — order now';
          return onHand <= point ? 'covered by stock on order' : 'in stock';
        },
      },
      {
        name: 'stockValue',
        render: 'stat',
        label: 'stockValue',
        hint: 'Units on hand at unit cost. Computed.',
        derive: (data) => {
          const onHand = deriveNumber(data.onHand);
          const cost = sumRowColumn([{ cost: data.unitCost }], 'cost');
          if (onHand == null || cost.total?.amount == null) return undefined;
          return formatMoney({
            amount: onHand * cost.total.amount,
            ...(cost.total.currency ? { currency: cost.total.currency } : {}),
          });
        },
      },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'supplier',
    icon: '◫',
    group: 'Operations',
    defaultStatus: 'prospective',
    actions: ['approve', 'review', 'order'],
    fields: [
      { name: 'contact', render: 'stat', label: 'contact', hint: 'Who is actually answered by, with how to reach them. A trade counter number beats a head-office switchboard.' },
      { name: 'supplies', render: 'chips', label: 'supplies', hint: 'What they supply. Flag anything they are the SOLE source of — that is a single point of failure with a delivery van attached.' },
      { name: 'leadTimeDays', render: 'stat', label: 'leadTimeDays', hint: 'Typical days from order to delivery, as observed rather than as promised.' },
      { name: 'minimumOrder', render: 'stat', label: 'minimumOrder', hint: 'Minimum order value or quantity. What makes a small part expensive.' },
      { name: 'terms', render: 'stat', label: 'terms', hint: 'Payment terms and any account limit.' },
      { name: 'onTimeRate', render: 'meter', label: 'onTimeRate', hint: '0-100 share of orders delivered by the promised date. From the shipments on the board, not from the supplier\'s own claim.' },
      { name: 'approvals', render: 'rows', label: 'approvals', columns: ['requirement', 'status', 'expiresAt'], hint: 'What they must hold to be used at all: {requirement, status, expiresAt} — insurance, accreditation, a signed contract.', bookkeeping: true },
      { name: 'riskNotes', render: 'text', label: 'riskNotes', hint: 'What would happen if they stopped trading tomorrow, and what the alternative is.' },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'purchaseOrder',
    icon: '↗',
    group: 'Operations',
    defaultStatus: 'draft',
    actions: ['raise', 'approve', 'receive'],
    fields: [
      { name: 'supplierRef', render: 'stat', label: 'supplierRef', hint: 'Who it is placed with, by id.', bookkeeping: true },
      { name: 'orderNumber', render: 'stat', label: 'orderNumber', hint: 'The reference the supplier will quote back. Without it a delivery cannot be matched to an order.' },
      { name: 'raisedAt', render: 'stat', label: 'raisedAt', hint: 'ISO date the order was placed.' },
      { name: 'promisedAt', render: 'stat', label: 'promisedAt', hint: 'ISO date the supplier promised delivery. What lateness is measured against — a promise, not a hope.' },
      {
        name: 'lines',
        render: 'rows',
        label: 'lines',
        columns: ['sku', 'description', 'quantity', 'unitPrice', 'amount'],
        hint: 'What was ordered: {sku, description, quantity, unitPrice, amount}.',
      },
      {
        name: 'total',
        render: 'stat',
        label: 'total',
        hint: 'Sum of the ordered lines. Computed.',
        derive: (data) => totalText(sumRowColumn(data.lines, 'amount')),
      },
      { name: 'approvedBy', render: 'stat', label: 'approvedBy', hint: 'Who authorised the spend. Written by the approval, never asserted — it is money.', derived: true },
      { name: 'receivedAt', render: 'stat', label: 'receivedAt', hint: 'ISO date it was received in full. Written by goods-in.', derived: true },
      SUMMARY_FIELD,
    ],
  },
  {
    kind: 'shipment',
    icon: '⇥',
    group: 'Operations',
    defaultStatus: 'notDispatched',
    actions: ['track', 'receive'],
    fields: [
      { name: 'purchaseOrderRef', render: 'stat', label: 'purchaseOrderRef', hint: 'The `purchaseOrder` this fulfils, by id. One order can ship several times, which is why this is its own object.', bookkeeping: true },
      { name: 'carrier', render: 'stat', label: 'carrier', hint: 'Who is moving it — the courier, the supplier’s own van, or a collection.' },
      { name: 'trackingRef', render: 'stat', label: 'trackingRef', hint: 'The tracking number, exactly as the carrier issued it.' },
      { name: 'dispatchedAt', render: 'stat', label: 'dispatchedAt', hint: 'ISO instant it left the supplier. The clock a transit time is measured over.' },
      { name: 'promisedAt', render: 'stat', label: 'promisedAt', hint: 'ISO date it was promised to arrive.' },
      { name: 'deliveredAt', render: 'stat', label: 'deliveredAt', hint: 'ISO instant it actually arrived. Written by the receipt or the carrier feed, never asserted — a part that is "delivered" and absent is a job booked against nothing.', derived: true },
      {
        name: 'daysLate',
        render: 'stat',
        label: 'daysLate',
        hint: 'Days between the promise and the delivery. Computed; negative means early.',
        derive: (data) => deriveDaysBetween(data.promisedAt, data.deliveredAt),
      },
      { name: 'destination', render: 'stat', label: 'destination', hint: 'Where it is going — the store, a van, or straight to site. Straight-to-site is the one that goes wrong.' },
      { name: 'contents', render: 'rows', label: 'contents', columns: ['sku', 'description', 'quantity'], hint: 'What is in it: {sku, description, quantity}. Short-shipments are the norm, so what SHIPPED and what was ORDERED are two different lists.' },
      { name: 'proofOfDelivery', render: 'list', label: 'proofOfDelivery', hint: 'Signature, photo or note confirming receipt: [{title, url}].', bookkeeping: true },
      SUMMARY_FIELD,
    ],
  },
  // ── WHEN IT GOES WRONG ────────────────────────────────────────────────────────
  {
    kind: 'incident',
    icon: '⚠',
    group: 'Operations',
    defaultStatus: 'reported',
    actions: ['report', 'investigate', 'close'],
    fields: [
      { name: 'incidentType', render: 'stat', label: 'incidentType', hint: 'injury | near-miss | environmental | property-damage | service-failure | complaint. A near miss is recorded for the same reason an injury is: it is the same event with a luckier ending.' },
      { name: 'severity', render: 'stat', label: 'severity', hint: 'How bad it was or could have been: critical | major | moderate | minor. Judge it on the realistic worst case, not on what happened to occur.' },
      { name: 'occurredAt', render: 'stat', label: 'occurredAt', hint: 'ISO instant it happened. Where it differs from when it was reported, that gap is itself a finding.' },
      SITE_FIELD,
      { name: 'assetRef', render: 'stat', label: 'assetRef', hint: 'The `serviceAsset` involved, by id, where there was one.', bookkeeping: true },
      { name: 'workOrderRef', render: 'stat', label: 'workOrderRef', hint: 'The job being carried out at the time, by id.', bookkeeping: true },
      { name: 'account', render: 'text', label: 'account', hint: 'What happened, factually and in sequence. No conclusions and no blame — this is a record that may be read by a regulator, an insurer and a court.' },
      { name: 'immediateAction', render: 'text', label: 'immediateAction', hint: 'What was done at the time to make it safe. The first question anybody investigating asks.' },
      { name: 'rootCause', render: 'text', label: 'rootCause', hint: 'Why it was possible. "Operator error" is where an investigation stops being useful — say what allowed the error.' },
      { name: 'correctiveActions', render: 'rows', label: 'correctiveActions', columns: ['action', 'owner', 'dueAt', 'status'], hint: 'What will stop it recurring: {action, owner, dueAt, status}. An action with no owner and no date is a sentence, not a control.' },
      {
        name: 'openActions',
        render: 'stat',
        label: 'openActions',
        hint: 'Corrective actions not yet done. Computed — an incident whose card reads "closed" over three open actions is the failure this number prevents.',
        derive: (data) => {
          if (!Array.isArray(data.correctiveActions)) return undefined;
          const open = data.correctiveActions.filter((row) => {
            const status = String((row as Record<string, unknown>)?.status ?? '').trim().toLowerCase();
            return status !== '' && status !== 'done' && status !== 'complete' && status !== 'completed' && status !== 'closed';
          }).length;
          return open > 0 ? open : undefined;
        },
      },
      { name: 'reportable', render: 'stat', label: 'reportable', hint: 'Whether it must be notified to a regulator, and by when. Getting this wrong is a criminal matter in most of these industries, so state the rule you applied.' },
      { name: 'reportedAt', render: 'stat', label: 'reportedAt', hint: 'ISO instant it was notified to the regulator, where it had to be.', derived: true },
      SUMMARY_FIELD,
    ],
  },
];

/**
 * English fallbacks the object palette shows before its i18n key resolves, matching how
 * every other set reads. The palette localizes through `creationCanvas.operations.label.*`;
 * these are never the translated string.
 */
export const OPERATIONS_LABELS: Record<OperationsObjectKind, string> = {
  serviceAsset: 'Asset',
  workOrder: 'Work order',
  visit: 'Visit',
  dispatchBoard: 'Dispatch board',
  serviceAgreement: 'Service agreement',
  estimate: 'Estimate',
  inspection: 'Inspection',
  certification: 'Certification',
  inventoryItem: 'Inventory item',
  supplier: 'Supplier',
  purchaseOrder: 'Purchase order',
  shipment: 'Shipment',
  incident: 'Incident',
};

/** Blank-object status, as the English fallback matching every set above. */
export const OPERATIONS_STATUSES: Record<string, string> = {
  inService: 'In service',
  unscheduled: 'Unscheduled',
  notScheduled: 'Not scheduled',
  planning: 'Planning the day',
  draft: 'Draft',
  notStarted: 'Not started',
  unverified: 'Unverified',
  notCounted: 'Not counted',
  prospective: 'Prospective',
  notDispatched: 'Not dispatched',
  reported: 'Reported',
};

/** Kinds the contract declares, for the test that proves the two lists agree. */
export const OPERATIONS_CONTRACT_KINDS: readonly OperationsObjectKind[] = OPERATIONS_OBJECT_KINDS;

registerSpecObjectSet({
  id: 'operations',
  namespace: OPERATIONS_NAMESPACE,
  specs: OPERATIONS_OBJECT_SPECS,
});
