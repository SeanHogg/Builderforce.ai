/**
 * `hr.hrms_sync` — deciding what a sync should DO, before it does any of it.
 *
 * ── WHY THE DECISION IS SEPARATE FROM THE WRITE ──────────────────────────────
 * The write half is twenty lines of insert and update. The decision half is where
 * every real defect in a roster sync lives — a person matched to the wrong row, a
 * departure missed because the provider stopped returning the record instead of
 * flagging it, a full re-import that touches every row and floods an audit log
 * with changes nobody made. Splitting them means the interesting half is a pure
 * function over two arrays, unit-testable without a database and without a
 * Workday tenant, and the same function produces the DRY-RUN preview a person
 * approves before anything is written.
 *
 * ── THE ABSENT ARE NOT AUTOMATICALLY GONE ────────────────────────────────────
 * A person in the local roster who is not in the provider's answer is the single
 * most dangerous case. They may have left — or the sync may have been INCREMENTAL
 * (`updated_since`), or paginated and truncated, or filtered by a query that
 * excluded them. Marking them terminated in any of those cases writes a false
 * termination date into an employment record.
 *
 * So absence NEVER terminates on its own. `departed` is only populated when the
 * caller declares the read was a full one (`completeRead`), and even then it is
 * reported as a proposal the caller can decline. A provider that explicitly says
 * somebody is terminated is a different thing entirely and flows through `update`
 * like any other field change.
 *
 * Pure: two arrays in, a plan out.
 */

import type { EmploymentStatus, EmploymentType, RosterPerson } from './roster';

/** The subset of a `people_employees` row a reconciliation compares on. */
export interface LocalEmployee {
  id: number;
  /** `<connectorKey>:<externalId>` for a synced row; anything for a hand-entered one. */
  partyRef: string;
  employeeCode: string | null;
  title: string | null;
  department: string | null;
  managerRef: string | null;
  location: string | null;
  employment: EmploymentType;
  status: EmploymentStatus;
  startedAt: string | null;
  endedAt: string | null;
}

/** The fields a sync is allowed to write. Deliberately short: a sync owns the
 *  employment facts and nothing else on the row. */
export interface EmployeeFields {
  employeeCode: string | null;
  title: string | null;
  department: string | null;
  managerRef: string | null;
  location: string | null;
  employment: EmploymentType;
  status: EmploymentStatus;
  startedAt: string | null;
  endedAt: string | null;
}

export interface PlannedCreate {
  partyRef: string;
  name: string;
  fields: EmployeeFields;
}

export interface PlannedUpdate {
  id: number;
  partyRef: string;
  name: string;
  fields: EmployeeFields;
  /** Only what actually differs — the audit trail, and the reason an unchanged
   *  person is not rewritten on every sync. */
  changes: Array<{ field: keyof EmployeeFields; from: unknown; to: unknown }>;
}

export interface ProposedDeparture {
  id: number;
  partyRef: string;
  reason: string;
}

export interface ReconciliationPlan {
  create: PlannedCreate[];
  update: PlannedUpdate[];
  unchanged: number;
  departed: ProposedDeparture[];
  /** Rows the provider sent twice under one id. Reported, and the first wins. */
  duplicates: string[];
  /** Local rows this connector did not author. Never touched. */
  foreign: number;
}

/** `partyRef` for a synced person. Bounded to the column's 64 characters. */
export const syncedPartyRef = (connectorKey: string, externalId: string): string =>
  `${connectorKey}:${externalId}`.slice(0, 64);

const COMPARED: readonly (keyof EmployeeFields)[] = [
  'employeeCode', 'title', 'department', 'managerRef', 'location', 'employment', 'status', 'startedAt', 'endedAt',
];

/** Project one provider person onto the fields the platform stores. */
export function toEmployeeFields(person: RosterPerson, connectorKey: string): EmployeeFields {
  return {
    employeeCode: person.externalId.slice(0, 48),
    title: person.title,
    department: person.department,
    // The manager is stored as the SAME ref shape the person is, so the local
    // graph resolves without a second lookup table.
    managerRef: person.managerExternalId ? syncedPartyRef(connectorKey, person.managerExternalId) : null,
    location: person.location,
    employment: person.employment,
    status: person.status,
    startedAt: person.startedAt,
    endedAt: person.endedAt,
  };
}

/**
 * Decide what the sync should do.
 *
 * Matching is on `partyRef` alone — `<connectorKey>:<externalId>` — and never on
 * name or email. Name matching is how two people called the same thing become one
 * employment record, and email matching breaks the moment somebody marries or a
 * domain changes. The provider's own id is the only stable identity in this
 * exchange, which is also why a row without one is dropped upstream in
 * `normaliseRoster` rather than given a synthetic key here.
 */
export function planRosterReconciliation(input: {
  connectorKey: string;
  remote: readonly RosterPerson[];
  local: readonly LocalEmployee[];
  /** True only when the provider returned the WHOLE roster. See the header. */
  completeRead?: boolean;
}): ReconciliationPlan {
  const prefix = `${input.connectorKey}:`;
  const ours = input.local.filter((row) => row.partyRef.startsWith(prefix));
  const byRef = new Map(ours.map((row) => [row.partyRef, row]));

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const create: PlannedCreate[] = [];
  const update: PlannedUpdate[] = [];
  let unchanged = 0;

  for (const person of input.remote) {
    const partyRef = syncedPartyRef(input.connectorKey, person.externalId);
    if (seen.has(partyRef)) { duplicates.push(partyRef); continue; }
    seen.add(partyRef);

    const fields = toEmployeeFields(person, input.connectorKey);
    const existing = byRef.get(partyRef);
    if (!existing) { create.push({ partyRef, name: person.name, fields }); continue; }

    const changes = COMPARED
      .filter((field) => normalise(existing[field]) !== normalise(fields[field]))
      .map((field) => ({ field, from: existing[field], to: fields[field] }));
    if (!changes.length) { unchanged += 1; continue; }
    update.push({ id: existing.id, partyRef, name: person.name, fields, changes });
  }

  const departed: ProposedDeparture[] = input.completeRead
    ? ours
      .filter((row) => !seen.has(row.partyRef) && row.status !== 'terminated')
      .map((row) => ({
        id: row.id,
        partyRef: row.partyRef,
        reason: `Present in the local roster and absent from a complete read of ${input.connectorKey}.`,
      }))
    : [];

  return {
    create,
    update,
    unchanged,
    departed,
    duplicates,
    foreign: input.local.length - ours.length,
  };
}

/** Compare on VALUE, treating null, undefined and empty string as the same
 *  absence — three providers spell "no department" three different ways, and
 *  without this every sync would report a change on every row forever. */
const normalise = (value: unknown): string => {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
};
