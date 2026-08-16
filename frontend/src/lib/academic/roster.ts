/**
 * The cohort roster — parsed from a `.csv` export, the one shape every SIS and every
 * spreadsheet can produce, so an instructor never re-types two hundred names.
 *
 * ── WHY THIS IS NOT JUST A GENERIC CSV READER ────────────────────────────────────
 * `academicObjects.ts` documents the roster row as `{ref, name, email, group, status}`,
 * with `status` closed to `enrolled | withdrawn | auditing` and `ref` the identifier
 * every submission and mark joins on. A generic parser would hand back whatever headers
 * a file happened to use; this one reads the SAME shape the LTI roster pull already
 * produces (`rosterFromMembers` in the API), so a cohort imported from a CSV and one
 * pulled from a connected LMS are indistinguishable to everything downstream —
 * `learnersFromCohort`, the gradebook, `assignment.distribute`.
 */

export interface RosterRow {
  ref: string;
  name: string;
  email: string;
  group: string;
  status: 'enrolled' | 'withdrawn' | 'auditing';
}

const MAX_ROWS = 2_000;

/** Split one CSV line into fields, honouring double-quoted fields that contain a
 *  comma or an escaped `""`. A roster with a display name like "Smith, Jordan" in a
 *  quoted field is common enough that a bare `split(',')` would silently misalign
 *  every column after it. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') { current += '"'; index += 1; } else quoted = false;
      } else current += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { fields.push(current); current = ''; continue; }
    current += char;
  }
  fields.push(current);
  return fields.map((field) => field.trim());
}

const STATUS_VALUES: ReadonlySet<string> = new Set(['enrolled', 'withdrawn', 'auditing']);

/**
 * Parse a roster export into rows.
 *
 * Header-driven rather than positional: `ref`/`id`/`student id`, `name`/`full name`,
 * `email`, `group`/`section`/`tutorial` and `status` are all accepted spellings, because
 * a registrar's export and a spreadsheet a TA built by hand rarely agree on a header —
 * and refusing the second one is how CSV import earns its reputation for uselessness.
 * A row with no `ref` is dropped: without it, nothing downstream can join to it.
 */
export function parseRosterCsv(source: string): readonly RosterRow[] {
  const lines = String(source ?? '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return [];

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const columnIndex = (...names: string[]): number => {
    for (const name of names) { const index = header.indexOf(name); if (index !== -1) return index; }
    return -1;
  };
  const refIndex = columnIndex('ref', 'id', 'student id', 'studentid', 'student_id', 'number');
  const nameIndex = columnIndex('name', 'full name', 'fullname', 'student name');
  const emailIndex = columnIndex('email', 'email address');
  const groupIndex = columnIndex('group', 'section', 'tutorial', 'seminar');
  const statusIndex = columnIndex('status', 'enrolment status', 'enrollment status');
  // No recognisable header at all: treat the file as headerless ref,name,email,group,status.
  const headerless = refIndex === -1 && nameIndex === -1 && emailIndex === -1;
  const dataLines = headerless ? lines : lines.slice(1);

  const rows: RosterRow[] = [];
  for (const line of dataLines) {
    if (rows.length >= MAX_ROWS) break;
    const cells = splitCsvLine(line);
    const ref = (headerless ? cells[0] : cells[refIndex] ?? '')?.trim() ?? '';
    if (!ref) continue;
    const name = (headerless ? cells[1] : cells[nameIndex] ?? '')?.trim() ?? '';
    const email = (headerless ? cells[2] : cells[emailIndex] ?? '')?.trim() ?? '';
    const group = (headerless ? cells[3] : cells[groupIndex] ?? '')?.trim() ?? '';
    const rawStatus = ((headerless ? cells[4] : cells[statusIndex] ?? '') ?? '').trim().toLowerCase();
    rows.push({
      ref: ref.slice(0, 120),
      name: name.slice(0, 200) || ref.slice(0, 120),
      email: email.slice(0, 200),
      group: group.slice(0, 80),
      status: STATUS_VALUES.has(rawStatus) ? rawStatus as RosterRow['status'] : 'enrolled',
    });
  }
  return rows;
}
