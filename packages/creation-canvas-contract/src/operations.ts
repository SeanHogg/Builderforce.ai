/**
 * The OPERATIONS vocabulary — the work a vertical company actually sells.
 *
 * ── THE GAP THIS CLOSES, STATED AS A FOUNDER WOULD STATE IT ──────────────────────
 * Every vocabulary the canvas had models how a company runs ITSELF: raise money
 * (`fundingRound`), go to market (`gtmPlan`), hire (`candidate`), employ (`employee`),
 * teach (`assignment`), analyse (`model`), ship software (`release`), test it (`testPlan`).
 * Not one of them models what the company DOES for the customer who pays it.
 *
 * That is fine for a horizontal SaaS, whose product IS the software. It is fatal for the
 * niche verticals — field service, trades, property management, clinics, logistics,
 * facilities, manufacturing, professional practices — which are where most companies
 * actually are. A founder of one could bring their fundraising, their hiring, their
 * payroll and their marketing onto a board, and had nowhere at all to put the job, the
 * visit, the asset, the part, the inspection or the certificate: the operation itself.
 * The board could plan the business and could not run it.
 *
 * ── WHY ONE VOCABULARY RATHER THAN ONE PER VERTICAL ─────────────────────────────
 * The tempting build is a pack per industry — `hvacObjects`, `propertyObjects`,
 * `clinicObjects`, `fleetObjects` — and it is the same mistake `funnel` refused. Lay the
 * verticals side by side and the nouns rhyme exactly:
 *
 *   field service  a job          a boiler      an engineer's visit   a Gas Safe cert
 *   property       a repair       a unit        a contractor callout  an EICR
 *   clinic         an appointment a chair/room  a patient visit       a registration
 *   fleet          a defect       a vehicle     a workshop booking    an MOT
 *   manufacturing  a work order   a machine     a maintenance stop    a calibration
 *   professional   a matter       a case file   a client meeting      a practising cert
 *
 * Six industries, one shape: WORK ordered against an ASSET, executed at a scheduled
 * VISIT, evidenced by an INSPECTION, permitted by a CERTIFICATION. The industry is a
 * VALUE — `discipline` on a work order, `assetClass` on an asset — exactly as
 * `funnelDomain` made one funnel serve marketing and recruiting. Thirteen kinds serve
 * every vertical above; seventy-eight kinds across six packs would serve them worse,
 * because the six packs drift and the shared insight ("which asset eats the most
 * labour") becomes six reports.
 *
 * ── WHY THESE ARE NOT THE KINDS THE CANVAS ALREADY HAS ──────────────────────────
 * Each of these was checked against an existing kind before it was declared, because
 * the cheapest good outcome here would have been zero new kinds:
 *
 *  · `visit` is not `salesMeeting`. A sales meeting is a CONVERSATION that advances a
 *    deal; a visit is DISPATCHED LABOUR — it consumes an engineer's day, has travel
 *    either side, an arrival window the customer was promised, and completion evidence
 *    that is the basis of an invoice. The two share a start time and nothing else that
 *    matters, and a `salesMeeting` carrying `partsUsed` would be the misnaming
 *    `founderObjects` records for `interview`.
 *  · `inspection` is not `form`. A form is a question set a HUMAN answers, and an
 *    inspection is a regulated procedure executed against a specific asset whose result
 *    is a legal record — pass/fail per line, photographic evidence, an inspector whose
 *    certification must be valid ON THE DAY, and a next-due date another object schedules
 *    from. It CONSUMES a form's shape and adds the half that makes it evidence.
 *  · `estimate` is not `invoice`. This one is an omission rather than a distinction: the
 *    founder set models `invoice`, `bill` and `contract` and had no object for the priced
 *    quote that PRECEDES all three. Every service business wins work with an estimate,
 *    and the win rate on estimates is the single most diagnostic number it has.
 *  · `inventoryItem` is not `dataset`. Stock is a live balance with a reorder point and a
 *    lead time; a dataset is a snapshot of rows.
 *  · `supplier` is not `salesContact`. Same shape pointed the other way — and the fields
 *    that matter are the ones a customer record has no use for: lead time, minimum order,
 *    the parts they are the sole source of.
 *
 * ── WHAT IS DELIBERATELY *NOT* A KIND ───────────────────────────────────────────
 * A technician is a `staff` member; a crew is a `team`; a customer is a `salesContact`;
 * a service contract's paper is a `contract`; a job's cost line is on the work order, not
 * a `ledgerEntry` of its own. A recall, a warranty claim and a planned maintenance stop
 * are all `workOrder` with an `orderType` — a new kind is a column value, the same rule
 * that made a PIP a `case`.
 */

// ---------------------------------------------------------------------------
// The kinds
// ---------------------------------------------------------------------------

export const OPERATIONS_OBJECT_KINDS = [
  // ── THE THING BEING SERVED ────────────────────────────────────────────────────
  // The physical or managed item work is done TO: a boiler, a rental unit, a vehicle, a
  // production line, a treatment room. It is first because it is the only object here
  // with a life longer than any single job, and it is what makes the operation's most
  // valuable question answerable at all — "what does this asset cost us a year, and is it
  // cheaper to replace it" — which no amount of per-job record keeping answers.
  'serviceAsset',
  // ── THE WORK ──────────────────────────────────────────────────────────────────
  // One unit of committed work: reactive repair, planned maintenance, installation,
  // warranty, callback. `orderType` carries which, because they are the same object with
  // the same lifecycle and the same costing, and splitting them would split the backlog.
  'workOrder',
  // WHEN AND BY WHOM, on the ground. A work order can need none, one or six visits — a
  // return trip for a part is the commonest event in field service and the one a
  // single-appointment model cannot represent without lying about first-time fix.
  'visit',
  // THE DAY, ACROSS EVERYBODY. Capacity, assignment and the unassigned pile: the view a
  // service business runs its morning from, and the one that makes "we are full" a fact
  // rather than a feeling.
  'dispatchBoard',
  // ── THE COMMERCIAL FRAME ──────────────────────────────────────────────────────
  // The recurring commitment: a maintenance plan, a retainer, an SLA, a managed-service
  // agreement. It is what turns a service business from a queue of jobs into a book of
  // revenue, and it is what a planned `workOrder` is generated FROM rather than
  // remembered into existence.
  'serviceAgreement',
  // The priced quote that precedes the work — the missing predecessor of `invoice`.
  'estimate',
  // ── THE EVIDENCE AND THE PERMISSION ───────────────────────────────────────────
  // A completed procedure against an asset: lines, results, evidence, an outcome and a
  // next-due date. Safety checks, statutory certificates, condition surveys, QA passes on
  // a line, a vehicle walkaround — one shape, `inspectionType` says which.
  'inspection',
  // The credential the work is only lawful WITH: a trade registration, a practising
  // certificate, an insurance policy, a calibration, a licence to operate. It carries an
  // expiry, which is the whole point: an expired certificate does not announce itself,
  // and dispatching against one is how a company loses its own licence.
  'certification',
  // ── WHAT THE WORK CONSUMES ────────────────────────────────────────────────────
  // Stock with a reorder point and a lead time: the parts on the van and in the store.
  'inventoryItem',
  // Who it is bought from, and how long they take. Lead time is the field that makes a
  // reorder point calculable rather than guessed.
  'supplier',
  // The replenishment itself, from raised to received.
  'purchaseOrder',
  // The movement, with tracking and proof of delivery. Distinct from the purchase order
  // for the same reason `testRun` is distinct from `testPlan`: one order can ship three
  // times, and a part that is late is a job that cannot be booked.
  'shipment',
  // ── WHEN IT GOES WRONG ────────────────────────────────────────────────────────
  // A safety, environmental or service-failure event: injury, near miss, spill, outage,
  // damage, complaint. Its own kind rather than a `defect` because a defect is
  // REPRODUCED and VERIFIED against a build, and an incident is REPORTED, investigated
  // and — in most of these verticals — reportable to a regulator on a clock. It is
  // `restricted` by default: an injury record carries health data about a named person.
  'incident',
] as const;

export type OperationsObjectKind = typeof OPERATIONS_OBJECT_KINDS[number];

const OPERATIONS_KIND_SET: ReadonlySet<string> = new Set<string>(OPERATIONS_OBJECT_KINDS);

/** True for the field-operations objects — the set `operationsObjects.ts` specs. */
export function isOperationsObjectKind(value: unknown): value is OperationsObjectKind {
  return typeof value === 'string' && OPERATIONS_KIND_SET.has(value);
}

// ---------------------------------------------------------------------------
// The vertical, as a VALUE
// ---------------------------------------------------------------------------

/**
 * The disciplines one operations vocabulary serves.
 *
 * This list is what makes the "one vocabulary, not one pack per industry" argument above
 * REAL rather than a claim in a comment: the industry is a value carried on the object,
 * so a board can be filtered, an agent can be told which trade it is working in, and the
 * seeded checklists a template ships can differ without any of the kinds differing.
 *
 * `other` is deliberate and load-bearing. A closed list with no escape hatch is how the
 * fourteenth vertical gets a fourteenth pack built for it.
 */
export const OPERATIONS_DISCIPLINES = [
  'fieldService', 'trades', 'property', 'facilities', 'clinical', 'veterinary',
  'fleet', 'logistics', 'manufacturing', 'hospitality', 'professional', 'other',
] as const;
export type OperationsDiscipline = typeof OPERATIONS_DISCIPLINES[number];

export function isOperationsDiscipline(value: unknown): value is OperationsDiscipline {
  return typeof value === 'string' && (OPERATIONS_DISCIPLINES as readonly string[]).includes(value);
}
