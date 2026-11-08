/**
 * The hiring-specific data a connector manifest may declare: how to read the people a
 * board delivers (`applicants`), the jobs it lists (`boardJobs`), the link it can find
 * for a published job (`resolve`), and the other spellings of the board's name that an
 * applicant's free-text `source` may carry (`sourceAliases`).
 *
 * Kept out of `connectorManifest.ts`, which is the generic contract every connector
 * shares: nothing here is meaningful to Slack or Stripe, and a hiring field added there
 * is a field every other manifest author has to read past. The manifest module imports
 * these TYPES and re-exports them, so existing importers keep one import site; their
 * validators are in `connectorMappingValidators.ts`.
 */

/**
 * Selectors that read ONE applicant out of an item of a list action's result — the
 * mirror of the response mapping for the people a board delivers. Each field is a
 * fallback list, resolved against a single list item (not the whole body).
 *
 * Declaring this on an action is what makes it importable: `importBoardApplicants`
 * reads it and names no vendor. An action without it is never imported from.
 */
export interface ConnectorApplicantMapping {
  /** The action param that carries the BOARD's posting id (`job_id`, `posting_id`…). */
  postingParam: string;
  /**
   * Where each returned item names the job it is FOR. The import compares it to the
   * publication's job id and DROPS (and counts) an item that names a different job — a
   * guard against a board that ignores the filter param and answers with everyone. An item
   * that names no job at all cannot contradict the filter and is kept.
   */
  postingIdField?: string[];
  /**
   * The id the board's list is FILTERED by, when the stored publication id is not it
   * (Ashby: `jobPosting.create` yields a job-POSTING id, `application.list` filters on the
   * JOB id). `action` is a sibling action of the same connector that takes the stored id
   * in `idParam`; `select` reads the filter id out of its answer. Resolved once and cached
   * on the distribution row (`board_filter_id`), then used for `postingParam` and for the
   * `postingIdField` comparison. Absent ⇒ the stored id is the filter id.
   */
  filterIdFrom?: { action: string; idParam: string; select: string[] };
  /**
   * The board's OWN paging token, for a board that pages by token rather than page number
   * (Lever `next`, Workable `paging.next`). `select` reads it from the FULL response body
   * (before `resultPath`); `fromQuery`, when the token is a URL the board built, names the
   * query param of that URL to take (the URL itself is never requested — a board must not
   * choose where a credentialled call goes); `param` is the request param that carries it
   * back. A newest-first walk stores it to resume across runs.
   */
  nextToken?: { select: string[]; param: string; fromQuery?: string };
  /** The board's id for the application/candidate — the dedupe key. Required. */
  externalId: string[];
  /** The PERSON's id on the board (Greenhouse `candidate_id`, Lever `contact`, Ashby
   *  `candidate.id`, Workable `id`) — what one person's several applications share, so
   *  an erasure applies to the person and not to one application. */
  candidateId?: string[];
  name?: string[];
  firstName?: string[];
  lastName?: string[];
  email?: string[];
  /** ISO string or epoch (s or ms) — when the person applied. */
  appliedAt?: string[];
  /** Page-number paging, when the board has it. Absent ⇒ see {@link limit}. */
  page?: { param: string; sizeParam?: string; size?: number };
  /**
   * A board with no page number reads ONE page of `size` per run. Declaring it lets the
   * import tell a full page (more are waiting — `more`, not exhausted) from a short one.
   */
  limit?: { param: string; size: number };
  /**
   * The order the board returns people in: `asc` (oldest first) or `desc` (newest first).
   * Required with a cursor, because it decides what a capped run has proven: ascending,
   * everything before the newest person seen has been seen; descending, only that the
   * newest have — so the cursor may not move until the walk reaches the old cursor.
   */
  order?: 'asc' | 'desc';
  /**
   * An incremental cursor: the param (`created_after`, `updated_at_start`…) that makes
   * the board return only people newer than the last import. `cursorFrom` says what the
   * stored cursor is made of — the newest `appliedAt` seen, or the greatest numeric id —
   * and `cursorFormat` how the board wants it written. Absent ⇒ every run re-reads the
   * board's newest page(s) from the start.
   */
  cursorParam?: string;
  cursorFrom?: 'appliedAt' | 'id';
  cursorFormat?: 'iso' | 'epochMs';
}

/**
 * Selectors that read ONE job out of a board's `list_postings` result, so a posting
 * created outside BuilderForce can be LINKED to the board job it already is
 * (`linkBoardJob`). `externalId` is the board's job id (Workable: the shortcode) — the id
 * applicant import filters by. `url` falls back to the action's `response.urlTemplate`.
 */
export interface ConnectorBoardJobMapping {
  externalId: string[];
  title: string[];
  state?: string[];
  url?: string[];
}

/**
 * How a `resolve_url` action's answer yields a posting's public link (and, where the
 * create call only returned a task or job reference, the board's REAL job id).
 *
 * The answer is searched for the entry that is about THIS posting: `listPath` points at
 * an array — or an object, whose values are the entries (LinkedIn keys its task map by
 * URN) — and the entry whose `matchField` equals `equals` is the one (`equals` may use
 * `{externalId}`). With no `listPath` the whole body is the entry. Then `url` selectors
 * read the link; failing that `urlTemplate` builds one. `{externalId}` in the template is
 * the RESOLVED id when `resolvedId` yielded one, else the stored id.
 */
export interface ConnectorUrlResolution {
  /** The action param that carries the stored `externalId`, when the call needs it. */
  idParam?: string;
  /** How the id is written into `idParam`: `restli-list` is Rest.li 2.0's
   *  `List(<url-encoded id>)` batch key. Absent ⇒ the id as is. The param must be declared
   *  `raw: true` so the runtime appends the already-encoded key verbatim instead of
   *  encoding it a second time. */
  idEncoding?: 'restli-list';
  listPath?: string;
  matchField?: string;
  equals?: string;
  /** Selectors, applied to the matched entry. */
  url?: string[];
  resolvedId?: string[];
  /** Applied to the `resolvedId` value as a FULL match (see `validatePattern`); capture
   *  group 1, else the whole value, is kept. */
  resolvedIdPattern?: string;
  urlTemplate?: string;
}

/**
 * Source spellings that mean something on their own across the hiring pipeline. A board
 * may never claim one as an alias: an applicant who really came from a referral would be
 * credited to a job board. Compared after the same normalisation the resolver applies.
 */
export const RESERVED_APPLICANT_SOURCES: readonly string[] = [
  'direct', 'referral', 'careers', 'careers-site', 'career site', 'careers site', 'website', 'marketplace',
  'agent', 'email', 'social', 'organic', 'manual', 'import', 'imported', 'unknown', 'other', 'sourced', 'inbound', 'outbound',
];

/** Normalise a source/alias as the resolver does: trimmed, lower-cased, spacing collapsed. */
export const aliasToken = (alias: string): string => alias.trim().toLowerCase().replace(/[\s_]+/g, ' ');

/** Whether a source is one of the reserved words (so it can never be a board spelling). */
export const isReservedApplicantSource = (source: string): boolean =>
  RESERVED_APPLICANT_SOURCES.includes(aliasToken(source));

/**
 * Validate `sourceAliases`: at most 20 distinct, non-reserved, non-empty strings of at
 * most 100 characters. (A collision with ANOTHER board's key or alias is checked where the
 * catalog is known — see `sourceAliasConflicts` in `hiring/applicantSource.ts`.)
 */
export function validateSourceAliases(raw: unknown, errors: string[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { errors.push('sourceAliases: must be a list of strings'); return []; }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, 20)) {
    const alias = String(entry).trim();
    const token = aliasToken(alias);
    if (!alias || alias.length > 100) { errors.push('sourceAliases: each alias must be 1–100 characters'); continue; }
    if (isReservedApplicantSource(alias)) { errors.push(`sourceAliases: "${alias}" is a reserved source and cannot name a job board`); continue; }
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(alias);
  }
  return out;
}

/**
 * `linkHosts`: the hosts a board-reported public link may point at, as registrable
 * domains. Absent, the registrable domain of the manifest's `baseUrl` is used (see
 * `allowedLinkHosts` in `hiring/postingDistributionSupport.ts`).
 */
export function validateLinkHosts(raw: unknown, errors: string[]): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) { errors.push('linkHosts: must be a list of domains'); return []; }
  const out: string[] = [];
  for (const entry of raw.slice(0, 10)) {
    const host = String(entry).trim().toLowerCase();
    if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,}$/.test(host)) { errors.push(`linkHosts: "${host}" is not a domain`); continue; }
    out.push(host);
  }
  return out;
}
