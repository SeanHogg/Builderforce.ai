/**
 * ONE answer to "which job board did this applicant come from".
 *
 * `job_applications.source` is free text on the way in ("LinkedIn", "linkedin.com",
 * "https://www.linkedin.com/jobs/…") and a controlled board key (`linkedin-jobs`) on the
 * way out, because the attribution join is the key. This is the single fold from the
 * first to the second, driven by each hiring manifest's `sourceAliases` — DATA, so a
 * new board's spellings are a manifest edit and not a branch here.
 *
 * Used by every place that compares a source to a board key:
 *   • the write (`recordApplication`) — the stored source IS the key, so counts stay an
 *     indexed exact match for everything written from now on;
 *   • the reads (`attributeSources`, `applicantCountsByBoard`) — which also fold rows
 *     written before normalisation existed.
 *
 * Matching is case-, whitespace- and URL-host-insensitive. An alias two boards claim is
 * ambiguous and matches NEITHER (a key always wins over any alias): a misattributed
 * applicant is a wrong answer to "which board is working".
 */

import { sql, type SQL } from 'drizzle-orm';
import { HIRING_CONNECTORS } from '../connectors/defaults/hiring';

export interface BoardSourceEntry {
  key: string;
  aliases?: readonly string[];
}
export type BoardSourceCatalog = readonly BoardSourceEntry[];

/** Lower-case, collapsed whitespace; a URL becomes its host without `www.`. */
export function normalizeSourceToken(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  if (!trimmed) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) || /^www\./.test(trimmed)) {
    try {
      const host = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
      return host.replace(/^www\./, '');
    } catch {
      return trimmed;
    }
  }
  return trimmed.replace(/^www\./, '');
}

/** token → key, with keys winning and ambiguous aliases dropped. */
function indexFor(boards: BoardSourceCatalog): Map<string, string> {
  const index = new Map<string, string>();
  for (const board of boards) index.set(normalizeSourceToken(board.key), board.key);
  const claimed = new Map<string, string | null>();
  for (const board of boards) {
    for (const alias of board.aliases ?? []) {
      const token = normalizeSourceToken(alias);
      if (!token || index.has(token)) continue;
      const prior = claimed.get(token);
      claimed.set(token, prior === undefined || prior === board.key ? board.key : null);
    }
  }
  for (const [token, key] of claimed) if (key) index.set(token, key);
  return index;
}

/**
 * Errors for a manifest whose key or aliases claim a spelling ANOTHER board already owns
 * (its key or one of its aliases). Reserved sources are rejected by the manifest
 * validator itself; this is the cross-board half, run where a tenant saves a connector.
 * A collision is refused rather than left to the resolver's "ambiguous matches neither"
 * rule, because that rule silently un-attributes the EXISTING board's applicants.
 */
export function sourceAliasConflicts(
  manifest: { key: string; sourceAliases?: readonly string[] },
  others: BoardSourceCatalog = BUILTIN_BOARD_SOURCES,
): string[] {
  const owner = new Map<string, string>();
  for (const board of others) {
    if (board.key === manifest.key) continue;
    for (const spelling of [board.key, ...(board.aliases ?? [])]) owner.set(normalizeSourceToken(spelling), board.key);
  }
  const errors: string[] = [];
  for (const spelling of [manifest.key, ...(manifest.sourceAliases ?? [])]) {
    const other = owner.get(normalizeSourceToken(spelling));
    if (other) errors.push(`sourceAliases: "${spelling}" is already used by the "${other}" job board`);
  }
  return errors;
}

const indexCache = new WeakMap<BoardSourceCatalog, Map<string, string>>();

/** The board key a raw source names, or the raw value untouched when it names none. */
export function resolveApplicantSource(raw: string, boards: BoardSourceCatalog): string {
  if (!boards.length) return raw;
  let index = indexCache.get(boards);
  if (!index) { index = indexFor(boards); indexCache.set(boards, index); }
  return index.get(normalizeSourceToken(raw)) ?? raw;
}

/**
 * The built-in hiring boards with their declared aliases.
 *
 * Static on purpose: it costs no query on the hot read/write paths that call it (an
 * application write, every posting projection). A tenant-authored board is still
 * attributed by its exact key; folding its own `sourceAliases` would need the tenant
 * catalog read, and can be layered on by passing a richer catalog to the same
 * functions without changing them.
 */
export const BUILTIN_BOARD_SOURCES: BoardSourceCatalog = HIRING_CONNECTORS.map((manifest) => ({
  key: manifest.key,
  aliases: manifest.sourceAliases ?? [],
}));

/**
 * The built-in boards plus any others whose manifests are already in hand (a tenant's
 * own board, loaded for its name). Built-in keys are reserved, so an extra never
 * overrides one; an extra with no aliases still matches by its exact key.
 */
export function withBoardSources(extra: Iterable<BoardSourceEntry>): BoardSourceCatalog {
  const have = new Set(BUILTIN_BOARD_SOURCES.map((b) => b.key));
  const added: BoardSourceEntry[] = [];
  for (const entry of extra) {
    if (have.has(entry.key)) continue;
    have.add(entry.key);
    added.push(entry);
  }
  return added.length ? [...BUILTIN_BOARD_SOURCES, ...added] : BUILTIN_BOARD_SOURCES;
}

const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/**
 * The same fold as {@link resolveApplicantSource}, as a SQL expression over a column —
 * for readers that GROUP BY source in the database (the metric rollup), so legacy
 * free-text spellings land in the board's bucket with no backfill.
 *
 * Generated from the SAME index, so the alias map cannot drift between code and SQL.
 * Literals are inlined (escaped constants from manifests, never user input) rather than
 * bound: the expression appears in both SELECT and GROUP BY, and Postgres only treats
 * two expressions as the same when their text is — bound `$n` placeholders differ.
 */
export function sourceFoldSql(column: string, boards: BoardSourceCatalog = BUILTIN_BOARD_SOURCES): SQL {
  const squashed = `lower(regexp_replace(trim(${column}), '[\\s_]+', ' ', 'g'))`;
  const token = `(CASE WHEN ${squashed} ~ '^([a-z][a-z0-9+.-]*://|www\\.)' `
    + `THEN regexp_replace(regexp_replace(${squashed}, '^([a-z][a-z0-9+.-]*://)?(www\\.)?', ''), '[/?#:].*$', '') `
    + `ELSE regexp_replace(${squashed}, '^www\\.', '') END)`;
  const whens = [...indexFor(boards)].map(([t, key]) => `WHEN ${sqlLiteral(t)} THEN ${sqlLiteral(key)}`);
  return sql.raw(`(CASE ${token} ${whens.join(' ')} ELSE ${column} END)`);
}

/** Fold a list of `{source, count}` onto board keys, summing spellings of one board. */
export function foldSourceCounts<T extends { source: string; count: number }>(
  rows: readonly T[],
  boards: BoardSourceCatalog,
): Array<{ source: string; count: number }> {
  const merged = new Map<string, number>();
  for (const row of rows) {
    const key = resolveApplicantSource(row.source, boards);
    merged.set(key, (merged.get(key) ?? 0) + row.count);
  }
  return [...merged].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count);
}
