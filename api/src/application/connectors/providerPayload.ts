/**
 * Reading a PROVIDER'S JSON — the four operations every connector-backed
 * normaliser performs, declared once.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 * `executeConnectorAction` hands back whatever the vendor sent, after the
 * manifest's `resultPath`. Nothing downstream can assume a shape: a roster comes
 * back as a bare array from BambooHR, under `data` from Personio and Workday,
 * under `Resources` from a SCIM directory, and Gusto answers a pay run with the
 * money nested under `totals`. Every consumer therefore has to (a) find the row
 * array, (b) narrow an `unknown` to an object, and (c) read a field that four
 * vendors spell four ways.
 *
 * `finance/payRuns.ts` wrote that three times over for pay runs, and the People
 * reads (`people/hrmsPort.ts`) needed the identical four functions for rosters,
 * compensation and requisitions. Two copies of a per-vendor field table is how a
 * fixed spelling in one place stays broken in the other, so they are here and
 * both callers import them.
 *
 * ── WHY A CANDIDATE LIST AND NOT A BRANCH PER VENDOR ─────────────────────────
 * The vendors differ almost entirely in SPELLING, not in meaning: `hire_date`,
 * `hireDate`, `startDate` and `employment_start_date` are one fact. A candidate
 * list makes a new vendor a string in an array rather than a new code path, which
 * is the same open/closed rule the manifests themselves follow.
 *
 * Nothing here throws and nothing here guesses. A field that is absent reads as
 * `null`, and it is each caller's decision whether a missing field means "drop
 * this row" or "report it as unknown" — a decision that must stay with the caller
 * because the two answers have very different costs. See `normalisePayRuns`,
 * which drops a pay run with no total rather than importing it as zero.
 */

/** Narrow an `unknown` to a plain object. An array is NOT an object here: every
 *  caller that wants a list asks {@link rowsFrom} for one. */
export const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/**
 * The row array in a provider response.
 *
 * `extraKeys` names the envelope THIS provider family uses on top of the four
 * that are effectively universal, so a caller can add `payrolls` or `employees`
 * without re-implementing the search.
 */
export function rowsFrom(data: unknown, extraKeys: readonly string[] = []): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(asRecord);
  const envelope = asRecord(data);
  for (const key of [...extraKeys, 'data', 'results', 'items', 'records']) {
    const candidate = envelope[key];
    if (Array.isArray(candidate)) return candidate.map(asRecord);
  }
  return [];
}

/**
 * The first of `keys` carrying a finite number, or null.
 *
 * A numeric STRING counts — Personio, SuccessFactors and several payroll APIs
 * quote every number — but an empty string does not, because `Number('')` is 0
 * and a silent zero is the one failure mode this whole module exists to avoid.
 */
export function pickNumber(source: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const raw = unwrapValue(source[key]);
    if (typeof raw === 'string' && !raw.trim()) continue;
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/** The first of `keys` carrying non-empty text, or null. Numbers stringify —
 *  an employee id is an integer in BambooHR and a UUID in Gusto. */
export function pickText(source: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = unwrapValue(source[key]);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
  }
  return null;
}

/**
 * Read a DOTTED path — `work.title`, `attributes.department`, `d.results`.
 *
 * Needed because two of the roster providers nest by design rather than by
 * accident: HiBob returns `{ work: { title, department } }` and Personio wraps
 * every single field as `{ type, value }`, sometimes with a further `{ attributes }`
 * inside it. Flattening those in each caller is how one vendor's shape becomes
 * five slightly different ideas of what an employee is.
 */
export function readPath(source: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    cursor = unwrapValue(cursor);
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return unwrapValue(cursor);
}

/** {@link pickText} over dotted paths. */
export function pickPathText(source: Record<string, unknown>, paths: readonly string[]): string | null {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/** {@link pickNumber} over dotted paths. */
export function pickPathNumber(source: Record<string, unknown>, paths: readonly string[]): number | null {
  for (const path of paths) {
    const raw = readPath(source, path);
    if (typeof raw === 'string' && !raw.trim()) continue;
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Personio's `{ type, value }` envelope, unwrapped.
 *
 * Every field of every Personio employee arrives wrapped, and the wrapper is
 * sometimes two deep (`{ type: 'Employee', attributes: { … } }` inside a
 * `{ type, value }`). Unwrapping at READ time rather than in a Personio-specific
 * normaliser is what keeps `pickText(row, ['first_name'])` working across all
 * six roster providers instead of only five.
 */
function unwrapValue(value: unknown): unknown {
  let cursor = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) return cursor;
    const record = cursor as Record<string, unknown>;
    if ('value' in record && !('id' in record)) { cursor = record.value; continue; }
    if ('attributes' in record && Object.keys(record).length <= 2) { cursor = record.attributes; continue; }
    return cursor;
  }
  return cursor;
}
