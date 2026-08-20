/**
 * The ROSTER — what an employee, a compensation record and an open requisition
 * are once a vendor's JSON has been read, and which connector action supplies
 * each of the three.
 *
 * ── WHY THIS SHAPE EXISTS AT ALL ─────────────────────────────────────────────
 * PRD 18 §1.2 named five HR tools — `hr.org_review`, `hr.headcount_plan`,
 * `hr.performance_review`, `hr.team_health`, `hr.hrms_sync` — and they were the
 * five that did not ship with the other twenty. Not an oversight: each of them
 * needs the employee roster, the departments, the open requisitions and the
 * compensation bands that live in an HRMS, and shipping them as stubs would have
 * been worse than their absence, for the reason `canvasTools.ts` documents at
 * length — an agent handed a tool that returns invented numbers does not report
 * the invention, it reports the numbers.
 *
 * `connectors/defaults/hrms.ts`, `payroll.ts` and `hiring.ts` cleared that
 * blocker. Six HRIS manifests, four payroll manifests and the ATS half now carry
 * a roster read, a compensation read and a requisition read between them, so the
 * five tools have a real source and this module is the place their four vendors'
 * spellings become one noun.
 *
 * ── PURE, AND THAT IS THE POINT ──────────────────────────────────────────────
 * No database, no network, no clock. Every function here takes rows and returns
 * rows, which is what lets the analytics in the sibling modules be unit-tested
 * against a fixture instead of against a live Workday tenant. The connector calls
 * live in `hrmsPort.ts`, one layer out, and nothing but that module reaches a
 * provider.
 *
 * ── THE REFUSAL IS PART OF THE CONTRACT ──────────────────────────────────────
 * {@link hrmsRefusal} is here rather than in the tool layer because it is the
 * answer these tools give MOST often — most workspaces have no HRIS connected —
 * and it therefore deserves the same test coverage as the arithmetic. A tool with
 * no roster must say so, name what to connect, and stop. It must never estimate
 * a headcount, and the instruction it returns says so to the model that reads it.
 */

import { asRecord, pickNumber, pickPathNumber, pickPathText, pickText, rowsFrom } from '../connectors/providerPayload';

// ---------------------------------------------------------------------------
// The nouns
// ---------------------------------------------------------------------------

/** Employment types the platform's own `people_employees.employment` accepts. */
export type EmploymentType = 'full_time' | 'part_time' | 'contract' | 'intern';

/** Employment states `people_employees.status` accepts. */
export type EmploymentStatus = 'active' | 'on_leave' | 'notice' | 'terminated';

/** One person on the roster, as every provider agrees they are. */
export interface RosterPerson {
  /** The provider's own id. The half of the identity that makes a re-sync an
   *  update rather than a second person. */
  externalId: string;
  name: string;
  email: string | null;
  title: string | null;
  department: string | null;
  /** The provider's id for this person's manager — NOT resolved here. Resolution
   *  is `orgReview`'s job and an unresolvable ref is a FINDING, not a silent drop:
   *  a manager id pointing at nobody is the most common real defect in an org
   *  export and the one that makes a span calculation quietly wrong. */
  managerExternalId: string | null;
  location: string | null;
  employment: EmploymentType;
  status: EmploymentStatus;
  /** ISO date (YYYY-MM-DD) or null. */
  startedAt: string | null;
  endedAt: string | null;
}

/** What one person is paid, as the payroll provider reports it. */
export interface CompensationRecord {
  externalId: string;
  /** Annualised base, in MINOR UNITS. Money becomes cents at the adapter edge —
   *  the platform rule — so nothing downstream does float arithmetic on a salary. */
  annualBaseCents: number | null;
  currency: string;
  effectiveAt: string | null;
}

/** An open requisition — a role that is being hired for and is not filled. */
export interface Requisition {
  externalId: string;
  title: string;
  department: string | null;
  location: string | null;
  /** 'open' | 'draft' | 'closed' | 'filled' | 'on_hold' — the provider's, lowercased. */
  status: string;
  openedAt: string | null;
  /** Which system said so: a connector key, or `platform` for an `open_positions` row. */
  source: string;
}

/** A compensation BAND — how a role is paid, not what a person is paid. */
export interface CompensationBand {
  roleFamily: string;
  level: string;
  location: string | null;
  currency: string;
  baseMinCents: number | null;
  baseMidCents: number | null;
  baseMaxCents: number | null;
  bonusPercent: number | null;
}

// ---------------------------------------------------------------------------
// Which connector answers which question
// ---------------------------------------------------------------------------

export interface ConnectorSource {
  connectorKey: string;
  actionKey: string;
  /** Shown in a refusal so a person is told the product name, not the key. */
  label: string;
}

/**
 * The connectors a ROSTER can be read out of, in the order a workspace should be
 * asked.
 *
 * HRIS first, payroll second, directory last, and that order is a claim about
 * truth rather than a preference. An HRIS is the system of record for somebody's
 * employment — it knows the manager, the department and the leave state. Payroll
 * knows who is paid, which is nearly the same set and silently is not: a person
 * on unpaid leave is on the roster and off the payroll. A SCIM directory knows
 * who has a login, which includes service accounts and contractors who were never
 * employed. Taking the first one connected means a workspace with Workday AND
 * Okta answers from Workday, and a workspace with only Okta still gets an answer
 * with its provenance named.
 *
 * Declared as DATA for the same reason `PAY_RUN_SOURCES` is: adding a provider is
 * an entry in an array, not a branch.
 */
export const ROSTER_SOURCES: readonly ConnectorSource[] = [
  { connectorKey: 'workday', actionKey: 'list_workers', label: 'Workday' },
  { connectorKey: 'bamboohr', actionKey: 'list_employees', label: 'BambooHR' },
  { connectorKey: 'hibob', actionKey: 'search_people', label: 'HiBob' },
  { connectorKey: 'personio', actionKey: 'list_employees', label: 'Personio' },
  { connectorKey: 'sap-successfactors', actionKey: 'list_employees', label: 'SAP SuccessFactors' },
  { connectorKey: 'rippling', actionKey: 'list_employees', label: 'Rippling' },
  { connectorKey: 'gusto', actionKey: 'list_employees', label: 'Gusto' },
  { connectorKey: 'deel', actionKey: 'list_contracts', label: 'Deel' },
  { connectorKey: 'adp-workforce', actionKey: 'list_workers', label: 'ADP Workforce Now' },
  { connectorKey: 'scim-directory', actionKey: 'list_users', label: 'a SCIM directory' },
];

/**
 * The connectors a COMPENSATION read can come from.
 *
 * Shorter than the roster list on purpose. Salary is the field an HRIS is most
 * likely to withhold from an integration token, and three of the six HRIS
 * manifests have no compensation action at all — so the payroll side answers
 * this, which is also the side that is definitionally right about what left the
 * bank. Gusto's roster read carries compensation inline, which is why it appears
 * here under the same action key it uses above.
 */
export const COMPENSATION_SOURCES: readonly ConnectorSource[] = [
  { connectorKey: 'rippling', actionKey: 'list_compensation', label: 'Rippling' },
  { connectorKey: 'gusto', actionKey: 'list_employees', label: 'Gusto' },
  { connectorKey: 'deel', actionKey: 'list_contracts', label: 'Deel' },
];

/**
 * The connectors an OPEN REQUISITION can be read out of.
 *
 * `greenhouse-job-board`, `indeed-jobs` and `linkedin-jobs` are absent because
 * they publish outward and read APPLICATIONS back — they have no list-postings
 * action, so asking them what is open is a call that cannot be made.
 */
export const REQUISITION_SOURCES: readonly ConnectorSource[] = [
  { connectorKey: 'lever-postings', actionKey: 'list_postings', label: 'Lever' },
  { connectorKey: 'ashby-postings', actionKey: 'list_postings', label: 'Ashby' },
  { connectorKey: 'job-feed', actionKey: 'list_feed', label: 'the careers-site job feed' },
];

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

export interface HrmsRefusal {
  ok: false;
  reason: 'no_roster_source' | 'provider_error' | 'empty_roster';
  message: string;
  /** Product names, in the order they would be asked. */
  connect: string[];
  /** Roster-capable connectors this workspace HAS connected, if any. */
  connectedSources: string[];
  /** The provider's own words, when it answered and the answer was an error. */
  providerError: string | null;
  instruction: string;
}

const NEVER_ESTIMATE =
  'Do NOT estimate, infer or illustrate any of these numbers. A headcount, a span or a salary that '
  + 'the model supplies reads exactly like one the HRIS supplied, and the person acting on it cannot tell '
  + 'the difference. Say plainly that the roster is not connected, name the systems above, and stop.';

/**
 * The answer every one of the five HR tools gives when it has no roster.
 *
 * Three distinct reasons, because they need three different next actions and
 * collapsing them into "no data" sends the person to the wrong place: nothing
 * connected is an admin task, a provider error is a credential or a scope, and a
 * connected provider returning zero people is a permissions problem on the
 * integration user that looks exactly like an empty company.
 */
export function hrmsRefusal(args: {
  reason: HrmsRefusal['reason'];
  connectedSources?: readonly string[];
  providerError?: string | null;
  sources?: readonly ConnectorSource[];
}): HrmsRefusal {
  const sources = args.sources ?? ROSTER_SOURCES;
  const connect = sources.map((s) => s.label);
  const connected = [...(args.connectedSources ?? [])];
  const message = args.reason === 'provider_error'
    ? `The connected HR system (${connected.join(', ') || 'unknown'}) could not be read, so there is no roster to work from.`
    : args.reason === 'empty_roster'
      ? `${connected.join(', ') || 'The connected HR system'} answered with no people. That is usually the integration user lacking access to the roster rather than an empty company.`
      : 'No HRMS, payroll or directory connector is connected, so this workspace has no employee roster to read.';
  return {
    ok: false,
    reason: args.reason,
    message,
    connect,
    connectedSources: connected,
    providerError: args.providerError ?? null,
    instruction: args.reason === 'provider_error'
      ? `Report the provider's error verbatim and say which system it came from. It is nearly always an expired token or a missing scope — reconnecting it under Settings → Integrations is the fix. ${NEVER_ESTIMATE}`
      : args.reason === 'empty_roster'
        ? `Tell the person the provider answered successfully with zero people, and that the integration user probably cannot see the roster. ${NEVER_ESTIMATE}`
        : `Tell the person which of these to connect (Settings → Integrations) and what each would unlock. ${NEVER_ESTIMATE}`,
  };
}

/** True for the refusal shape, so a tool handler can pass it straight through. */
export const isRefusal = (value: unknown): value is HrmsRefusal =>
  !!value && typeof value === 'object' && (value as { ok?: unknown }).ok === false;

// ---------------------------------------------------------------------------
// Normalisation — vendor JSON in, the nouns above out
// ---------------------------------------------------------------------------

/** Statuses that mean somebody is still employed, however each vendor spells it. */
const LEFT = /(terminat|offboard|inactive|separat|resign|departed|former|ended)/i;
const ON_LEAVE = /(leave|sabbatical|maternity|paternity|parental|furlough|suspend)/i;
const NOTICE = /(notice|resigning|pending.?termination|offboarding)/i;

/** Map whatever the vendor said into the four states the platform stores. */
export function normaliseStatus(raw: string | null, endedAt: string | null): EmploymentStatus {
  const text = (raw ?? '').trim();
  // An end date in the past is decisive: it outranks a status field that a
  // provider forgot to flip, which is the common case in an HRIS export.
  if (endedAt && Date.parse(endedAt) <= Date.now()) return 'terminated';
  if (!text) return 'active';
  if (NOTICE.test(text)) return 'notice';
  if (LEFT.test(text)) return 'terminated';
  if (ON_LEAVE.test(text)) return 'on_leave';
  if (/^(false|0|no)$/i.test(text)) return 'terminated';
  return 'active';
}

const CONTRACT = /(contract|contingent|freelance|consultant|vendor|eor|1099)/i;
const PART_TIME = /(part.?time|casual|hourly.?part)/i;
const INTERN = /(intern|apprentice|trainee|placement)/i;

/** Map the vendor's employment type onto the four the platform stores. */
export function normaliseEmployment(raw: string | null): EmploymentType {
  const text = (raw ?? '').trim();
  if (!text) return 'full_time';
  if (INTERN.test(text)) return 'intern';
  if (CONTRACT.test(text)) return 'contract';
  if (PART_TIME.test(text)) return 'part_time';
  return 'full_time';
}

/** ISO `YYYY-MM-DD`, or null. Nothing here invents a date it could not read. */
export function isoDate(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

/**
 * Turn a provider's roster payload into people.
 *
 * A row with no identifiable id is DROPPED rather than given a synthetic one: a
 * generated key makes every sync create a duplicate person, and a duplicated
 * employee is the one error in this whole module that a customer sees in their
 * own org chart. A row with no NAME is kept — the id is what identifies it, and
 * several directories return only an email — but the name falls back to the
 * email or the id so nothing renders as blank.
 */
export function normaliseRoster(data: unknown): RosterPerson[] {
  const rows = rowsFrom(data, ['employees', 'workers', 'people', 'Resources', 'contracts', 'd.results']);
  const out: RosterPerson[] = [];
  for (const row of rows) {
    const externalId = pickPathText(row, [
      'id', 'employee_id', 'employeeId', 'uuid', 'worker_id', 'workerId', 'personIdExternal',
      'externalId', 'external_id', 'userName',
    ]);
    if (!externalId) continue;

    const first = pickPathText(row, ['firstName', 'first_name', 'given_name', 'name.givenName', 'root.firstName']);
    const last = pickPathText(row, ['lastName', 'last_name', 'family_name', 'name.familyName', 'root.surname']);
    const whole = pickPathText(row, ['displayName', 'display_name', 'fullName', 'full_name', 'name', 'root.fullName', 'preferredName']);
    const email = pickPathText(row, [
      'email', 'work_email', 'workEmail', 'email_address', 'emailAddress', 'root.email', 'work.email',
    ]);
    const name = whole ?? ([first, last].filter(Boolean).join(' ').trim() || email || externalId);

    const endedAt = isoDate(pickPathText(row, [
      'terminationDate', 'termination_date', 'endDate', 'end_date', 'contract_end_date', 'lastDayWorked',
    ]));

    out.push({
      externalId,
      name,
      email,
      title: pickPathText(row, [
        'jobTitle', 'job_title', 'title', 'position', 'work.title', 'employment.jobTitle', 'job_title_name',
      ]),
      department: pickPathText(row, [
        'department', 'department_name', 'departmentName', 'work.department', 'division', 'team', 'org', 'organization',
      ]),
      managerExternalId: pickPathText(row, [
        'managerId', 'manager_id', 'supervisorId', 'supervisor_id', 'reportsTo', 'reports_to',
        'work.reportsTo.id', 'manager.id', 'supervisor.id', 'managerExternalId',
      ]),
      location: pickPathText(row, [
        'location', 'office', 'work.site', 'workLocation', 'work_location', 'country', 'addresses.country',
      ]),
      employment: normaliseEmployment(pickPathText(row, [
        'employmentType', 'employment_type', 'employeeType', 'worker_type', 'workerType', 'contract_type', 'type',
      ])),
      status: normaliseStatus(
        pickPathText(row, ['status', 'employmentStatus', 'employment_status', 'state', 'active', 'work.isManager']),
        endedAt,
      ),
      startedAt: isoDate(pickPathText(row, [
        'hireDate', 'hire_date', 'startDate', 'start_date', 'employment_start_date', 'work.startDate', 'joinDate',
      ])),
      endedAt,
    });
  }
  return out;
}

/**
 * Turn a payroll payload into annualised compensation.
 *
 * Two decisions worth naming. First, hourly rates are ANNUALISED at 2,080 hours
 * and the assumption is returned to the caller rather than hidden, because a comp
 * comparison that silently mixes an hourly rate with a salary reports a
 * part-timer as underpaid by an order of magnitude. Second, a row whose pay
 * cannot be read is emitted with `annualBaseCents: null` rather than dropped:
 * "we could not read 12 people's pay" and "12 people are paid nothing" are
 * different sentences, and only the second one is a lie.
 */
export function normaliseCompensation(data: unknown): CompensationRecord[] {
  const rows = rowsFrom(data, ['employees', 'compensations', 'contracts', 'workers']);
  const out: CompensationRecord[] = [];
  for (const row of rows) {
    const externalId = pickPathText(row, [
      'id', 'employee_id', 'employeeId', 'uuid', 'worker_id', 'externalId', 'employee.id',
    ]);
    if (!externalId) continue;

    // Gusto nests the live rate under `jobs[].compensations[]`; Rippling and Deel
    // return it flat. Both are read, flat first.
    const flat = pickPathNumber(row, [
      'annual_salary', 'annualSalary', 'base_salary', 'baseSalary', 'salary', 'rate', 'amount',
      'compensation.annual', 'compensation.amount', 'current_compensation.amount',
    ]);
    const nested = nestedCompensation(row);
    const raw = flat ?? nested?.rate ?? null;
    const unit = (pickPathText(row, [
      'payment_unit', 'paymentUnit', 'pay_period', 'payPeriod', 'frequency', 'rate_unit', 'scale',
    ]) ?? nested?.unit ?? '').toLowerCase();

    out.push({
      externalId,
      annualBaseCents: raw == null ? null : Math.round(annualise(raw, unit) * 100),
      currency: pickPathText(row, ['currency', 'currency_code', 'compensation.currency']) ?? 'USD',
      effectiveAt: isoDate(pickPathText(row, ['effective_date', 'effectiveDate', 'effective_at', 'start_date'])),
    });
  }
  return out;
}

/** The hours a full year of full-time work is annualised at. Declared, not buried. */
export const ANNUAL_HOURS = 2080;

/** Annualise a rate given the vendor's own word for its period. */
function annualise(rate: number, unit: string): number {
  if (/hour/.test(unit)) return rate * ANNUAL_HOURS;
  if (/week/.test(unit)) return rate * 52;
  if (/(fortnight|biweek|bi-week)/.test(unit)) return rate * 26;
  if (/(semimonth|semi-month)/.test(unit)) return rate * 24;
  if (/month/.test(unit)) return rate * 12;
  if (/(quarter)/.test(unit)) return rate * 4;
  if (/day/.test(unit)) return rate * 260;
  return rate;
}

/** Gusto's `jobs[].compensations[]`, and the same shape under other names. */
function nestedCompensation(row: Record<string, unknown>): { rate: number; unit: string } | null {
  const jobs = Array.isArray(row.jobs) ? row.jobs : Array.isArray(row.employments) ? row.employments : [];
  for (const job of jobs) {
    const record = asRecord(job);
    const list = Array.isArray(record.compensations) ? record.compensations : [];
    for (const entry of list) {
      const comp = asRecord(entry);
      const rate = pickNumber(comp, ['rate', 'amount', 'annual_salary']);
      if (rate == null) continue;
      return { rate, unit: (pickText(comp, ['payment_unit', 'paymentUnit', 'frequency']) ?? '').toLowerCase() };
    }
  }
  return null;
}

/** Statuses that mean a requisition is still being hired for. */
const OPEN_REQ = /^(open|published|active|live|listed|approved|sourcing|interviewing)$/i;

/** True when this requisition is one somebody still has to fill. */
export const isOpenRequisition = (req: Requisition): boolean => OPEN_REQ.test(req.status);

/** Turn a hiring provider's postings payload into requisitions. */
export function normaliseRequisitions(data: unknown, source: string): Requisition[] {
  const rows = rowsFrom(data, ['postings', 'jobs', 'jobPostings']);
  const out: Requisition[] = [];
  for (const row of rows) {
    const externalId = pickPathText(row, ['id', 'posting_id', 'job_id', 'uuid', 'reference', 'requisitionId']);
    const title = pickPathText(row, ['title', 'text', 'name', 'job_title', 'jobTitle']);
    if (!externalId || !title) continue;
    out.push({
      externalId,
      title,
      department: pickPathText(row, [
        'department', 'categories.department', 'team', 'categories.team', 'departmentName', 'organization',
      ]),
      location: pickPathText(row, ['location', 'categories.location', 'locationName', 'workplaceType']),
      status: (pickPathText(row, ['state', 'status', 'isListed']) ?? 'open').toLowerCase(),
      openedAt: isoDate(pickPathText(row, ['createdAt', 'created_at', 'openedOn', 'publishedAt', 'updatedAt'])),
      source,
    });
  }
  return out;
}
