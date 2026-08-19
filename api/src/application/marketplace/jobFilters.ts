/**
 * What a job search MEANS — declared once, evaluated two ways.
 *
 * ── WHY THIS MODULE EXISTS ───────────────────────────────────────────────────────
 * A job alert is a saved search that has to answer the same question the browse
 * surface answers: "does this posting match these criteria?". Until now only the
 * browse route could answer it, in SQL, inline. Adding the alert evaluator meant
 * writing that predicate a second time — and the second copy is the one that drifts,
 * because the interesting behaviour is in the EDGES (an empty string is not a filter,
 * a skill match is exact and case-insensitive while a keyword match is a substring),
 * and edges are what a re-implementation quietly gets wrong. A seeker whose alert
 * silently disagrees with the board they are looking at has an alert they cannot
 * trust, which is worse than no alert.
 *
 * ── WHY TWO EVALUATORS AND NOT ONE ───────────────────────────────────────────────
 * The two callers genuinely need different machines:
 *
 *   • The browse route filters ONE query over the whole table and must push the work
 *     into Postgres — it is indexed, it paginates, and pulling 200 rows per request
 *     to filter them in the Worker would be the anti-pattern the perf rule forbids.
 *   • The alert sweep evaluates MANY saved searches against the SAME window of new
 *     postings. One query per alert is the N+1 the same rule forbids, so it loads the
 *     window once and matches in memory.
 *
 * So what is shared is the SPEC — the normalised criteria — and each caller lowers it
 * to its own machine. {@link jobFilterConditions} and {@link jobFilterMatches} are
 * asserted to agree on a table of cases in `jobFilters.test.ts`; that test is the
 * thing that actually holds them together, and a new criterion is not finished until
 * it appears there.
 */
import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { jobPostings } from '../../infrastructure/database/schema';
import { parseJsonArray } from '../../domain/shared/json';

/**
 * The criteria a search actually carries, normalised.
 *
 * Every field is optional and, when present, non-empty: normalisation drops blanks
 * rather than carrying `''` through, because an empty keyword is not "match nothing"
 * — it is "the user did not filter", and the two are opposite answers.
 */
export interface JobFilterSpec {
  /** Free text, matched as a substring of title, description or skills. */
  q?: string;
  /** Exactly one discipline (`developer`, `designer`, …). */
  discipline?: string;
  /** One skill, matched exactly against the posting's skill list, case-insensitively. */
  skill?: string;
}

/** The posting fields a match reads. A row shape rather than the table, so the
 *  in-memory evaluator can be handed a projection instead of a whole posting. */
export interface JobFilterRow {
  title?: string | null;
  description?: string | null;
  discipline?: string | null;
  /** The stored JSON string[] — or an already-parsed array. */
  skills?: unknown;
}

const trimmed = (value: unknown): string | undefined => {
  const text = String(value ?? '').trim();
  return text ? text : undefined;
};

/**
 * Read a stored filter blob into a spec.
 *
 * Accepts the shape the browse route gets from the query string AND the shape an
 * alert holds in `saved_searches.filters`, because they are the same three keys —
 * which is the point of normalising rather than letting each caller read the blob.
 * `enabled` lives in the same blob (see `mapAlert`) and is deliberately NOT a filter:
 * it decides whether the alert runs at all, not which postings it matches.
 */
export function normalizeJobFilters(raw: unknown): JobFilterSpec {
  const source = (raw ?? {}) as Record<string, unknown>;
  const spec: JobFilterSpec = {};
  const q = trimmed(source.q);
  if (q) spec.q = q;
  // Lowercased HERE rather than at each comparison, so the SQL clause can stay an
  // indexable equality instead of a `lower(...)` that would drop
  // `idx_job_postings_open`'s usefulness on a filtered browse.
  const discipline = trimmed(source.discipline)?.toLowerCase();
  if (discipline) spec.discipline = discipline;
  const skill = trimmed(source.skill);
  if (skill) spec.skill = skill;
  return spec;
}

/** True when nothing is being filtered on — every open posting matches. The browse
 *  route reads this to decide whether the unfiltered result is cacheable. */
export function jobFilterIsEmpty(spec: JobFilterSpec): boolean {
  return !spec.q && !spec.discipline && !spec.skill;
}

/**
 * The spec lowered to SQL, for the caller that filters in Postgres.
 *
 * Returns only the CRITERIA conditions — not `status`/`visibility`, which are the
 * caller's own access predicate rather than part of what the user searched for.
 */
export function jobFilterConditions(spec: JobFilterSpec): SQL[] {
  const conditions: SQL[] = [];
  // `discipline` is a closed lowercase vocabulary (`DISCIPLINES` in jobRoutes), and
  // the spec lowercased it on the way in, so this stays an indexable equality.
  if (spec.discipline) conditions.push(eq(jobPostings.discipline, spec.discipline));
  if (spec.skill) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(COALESCE(${jobPostings.skills}, '[]')::jsonb) skill
      WHERE lower(skill) = ${spec.skill.toLowerCase()}
    )`);
  }
  if (spec.q) {
    const pattern = `%${spec.q}%`;
    conditions.push(or(
      ilike(jobPostings.title, pattern),
      ilike(jobPostings.description, pattern),
      ilike(jobPostings.skills, pattern),
    )!);
  }
  return conditions;
}

/** The criteria as ONE condition, or undefined when nothing is filtered. */
export function jobFilterWhere(spec: JobFilterSpec): SQL | undefined {
  const conditions = jobFilterConditions(spec);
  return conditions.length ? and(...conditions) : undefined;
}

/** The posting's skills as a lowercased list, whether stored as JSON text or array. */
function skillList(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : parseJsonArray<unknown>(value);
  return raw.map((entry) => String(entry ?? '').trim().toLowerCase()).filter(Boolean);
}

/**
 * The spec lowered to a predicate, for the caller that matches in memory.
 *
 * Deliberately mirrors {@link jobFilterConditions} clause for clause — including the
 * detail that `q` also searches the RAW skills text. That looks like an oddity of the
 * SQL (`ilike` against a JSON string column) and it is load-bearing: a seeker whose
 * keyword is "rust" expects a posting tagged `["rust"]` to match even with the word
 * absent from the prose, and the browse surface has always behaved that way.
 */
export function jobFilterMatches(spec: JobFilterSpec, row: JobFilterRow): boolean {
  if (spec.discipline) {
    // The spec is already lowercased; the stored column is the same closed vocabulary,
    // trimmed here only against whitespace a hand-written posting may carry.
    if (String(row.discipline ?? '').trim() !== spec.discipline) return false;
  }
  if (spec.skill) {
    if (!skillList(row.skills).includes(spec.skill.toLowerCase())) return false;
  }
  if (spec.q) {
    const needle = spec.q.toLowerCase();
    const skillsText = typeof row.skills === 'string' ? row.skills : JSON.stringify(row.skills ?? '');
    const haystack = [row.title ?? '', row.description ?? '', skillsText].join('\n').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** A human-readable rendering of the criteria, for a notification body. Empty spec
 *  reads as the honest "any new job" rather than as a blank. */
export function describeJobFilters(spec: JobFilterSpec): string {
  const parts: string[] = [];
  if (spec.q) parts.push(spec.q);
  if (spec.discipline) parts.push(spec.discipline);
  if (spec.skill) parts.push(spec.skill);
  return parts.join(' · ');
}
