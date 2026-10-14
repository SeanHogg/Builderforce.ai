/**
 * THE `ReplayFilter` compiler (PRD 33 §3.4, §6 "one filter contract and one compiler").
 *
 * One function turns a parsed `ReplayFilter` into ONE parameterised Drizzle `SQL`
 * over `replay_recordings`. Every value is a bound parameter — arrays go through
 * `@>` / `&&` with an array parameter, LIKE patterns are escaped and bound, tag keys
 * are bound on the right of `->>` — so no value is ever concatenated into SQL text.
 *
 * Every field in `FILTER_FIELDS` has an entry in {@link FIELD_COMPILERS} (a typed
 * `Record`, so a new field fails the build until it compiles or is rejected). A
 * clause the compiler cannot express comes back in `rejected` with the reason; the
 * caller refuses the request rather than silently widening the result.
 *
 * Smart events resolve here too: a built-in name is the `events` array (ingest wrote
 * the built-in names it matched); a site rule is rewritten to the equivalent
 * predicate over `routes` (page), `clicked` (click) or `events` (custom) with
 * {@link ruleTextPredicate} — the SAME case-insensitive equals / prefix / contains
 * semantics as the contract's `markMatchesRule`, which the parity test pins.
 *
 * Two honest approximations, both inherent to what a kept row stores:
 *   • a page rule is matched against the TEMPLATED route (`/p/:id`), not the raw path;
 *   • a click rule is matched against the clicked SELECTORS, because the row keeps the
 *     selector of each click, not its label or link target.
 *
 * A filtered read is always a kept-recording read (≈): the rollups are keyed by route
 * × day × release × device, and no breakdown is split by device or release, so no
 * filtered dashboard could be answered exactly as a whole.
 */

import { and, arrayContains, arrayOverlaps, eq, gte, inArray, lte, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import {
  BUILTIN_SMART_EVENT_NAMES,
  type FilterFieldId,
  type ReplayFilter,
  type ReplayFilterClause,
  type SmartEventRule,
} from '@builderforce/interaction-contract';
import { replayRecordings } from '../../infrastructure/database/schema';

export interface CompileContext {
  /** The site's own smart-event rules (`replay_smart_events`); built-ins are code data. */
  siteRules: readonly SmartEventRule[];
}

export interface FilterRejection {
  clause: ReplayFilterClause;
  reason: string;
}

export interface CompiledFilter {
  /** AND of every compiled clause; undefined for the empty filter. */
  where: SQL | undefined;
  rejected: FilterRejection[];
}

type Compiled = SQL | { reject: string };

const BUILTIN_NAMES: ReadonlySet<string> = new Set(BUILTIN_SMART_EVENT_NAMES);

// ── The text predicate shared with `markMatchesRule` ────────────────────────

/** Escape LIKE metacharacters so a value is matched literally (`ESCAPE '\'`). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export interface TextPredicate {
  /** `eq` → `lower(x) = pattern`; `like` → `lower(x) LIKE pattern ESCAPE '\'`. */
  op: 'eq' | 'like';
  pattern: string;
}

/**
 * The SQL shape of one rule's text test, lower-cased exactly as `markMatchesRule`
 * lower-cases both sides. Null for an empty needle, which matches nothing there too.
 */
export function ruleTextPredicate(rule: Pick<SmartEventRule, 'match' | 'matchMode'>): TextPredicate | null {
  const needle = rule.match.toLowerCase();
  if (!needle) return null;
  switch (rule.matchMode) {
    case 'equals':
      return { op: 'eq', pattern: needle };
    case 'prefix':
      return { op: 'like', pattern: `${escapeLike(needle)}%` };
    case 'contains':
      return { op: 'like', pattern: `%${escapeLike(needle)}%` };
  }
}

/** `lower(<expr>) = $p` or `lower(<expr>) LIKE $p ESCAPE '\'`. */
function textTest(expr: SQL, predicate: TextPredicate): SQL {
  return predicate.op === 'eq'
    ? sql`lower(${expr}) = ${predicate.pattern}`
    : sql`lower(${expr}) like ${predicate.pattern} escape '\\'`;
}

/** Some element of a text[] column passes the predicate. */
function anyElement(column: AnyColumn, predicate: TextPredicate): SQL {
  return sql`exists (select 1 from unnest(${column}) as bf_el(v) where ${textTest(sql`bf_el.v`, predicate)})`;
}

const FALSE = sql`false`;

/** One rule as a predicate over the row's arrays (what a smart-event preview counts). */
export function rulePredicate(rule: SmartEventRule): SQL {
  const predicate = ruleTextPredicate(rule);
  if (!predicate) return FALSE;
  switch (rule.ruleKind) {
    case 'page':
      return anyElement(replayRecordings.routes, predicate);
    case 'click':
      return anyElement(replayRecordings.clicked, predicate);
    case 'custom':
      return anyElement(replayRecordings.events, predicate);
  }
}

/** "The recording hit the smart event called `name`." */
export function smartEventPredicate(name: string, ctx: CompileContext): SQL {
  // A built-in name and a custom `BFReplay.event(name)` are both stored by name.
  const stored = arrayContains(replayRecordings.events, [name]);
  if (BUILTIN_NAMES.has(name)) return stored;
  const rules = ctx.siteRules.filter((rule) => rule.name === name);
  return rules.length ? (or(stored, ...rules.map(rulePredicate)) as SQL) : stored;
}

// ── Field compilers ─────────────────────────────────────────────────────────

function list(value: ReplayFilterClause['value']): string[] {
  return (Array.isArray(value) ? [...value] : [value]).map(String);
}

const not = (inner: SQL): SQL => sql`not (${inner})`;
const unsupported = (clause: ReplayFilterClause): Compiled => ({ reject: `${clause.field} does not support ${clause.op}` });

type ScalarColumn =
  | typeof replayRecordings.deviceClass
  | typeof replayRecordings.browser
  | typeof replayRecordings.os
  | typeof replayRecordings.country
  | typeof replayRecordings.referrerHost
  | typeof replayRecordings.releaseKey
  | typeof replayRecordings.variant
  | typeof replayRecordings.entryPath
  | typeof replayRecordings.exitPath;

/** A text column: eq / neq (null-safe) / in / contains / prefix. */
function scalar(column: ScalarColumn) {
  return (clause: ReplayFilterClause): Compiled => {
    const value = String(clause.value);
    switch (clause.op) {
      case 'eq': return eq(column, value);
      case 'neq': return sql`${column} is distinct from ${value}`;
      case 'in': return inArray(column, list(clause.value));
      case 'contains': return textTest(sql`${column}`, { op: 'like', pattern: `%${escapeLike(value.toLowerCase())}%` });
      case 'prefix': return textTest(sql`${column}`, { op: 'like', pattern: `${escapeLike(value.toLowerCase())}%` });
      default: return unsupported(clause);
    }
  };
}

type ArrayColumn =
  | typeof replayRecordings.routes
  | typeof replayRecordings.clicked
  | typeof replayRecordings.frustrations
  | typeof replayRecordings.issueFps;

/** A text[] column: eq (contains the value) / neq / in (overlaps) / contains / prefix (any element). */
function array(column: ArrayColumn) {
  return (clause: ReplayFilterClause): Compiled => {
    const value = String(clause.value);
    switch (clause.op) {
      case 'eq': return arrayContains(column, [value]);
      case 'neq': return not(arrayContains(column, [value]));
      case 'in': return arrayOverlaps(column, list(clause.value));
      case 'contains': return anyElement(column, { op: 'like', pattern: `%${escapeLike(value.toLowerCase())}%` });
      case 'prefix': return anyElement(column, { op: 'like', pattern: `${escapeLike(value.toLowerCase())}%` });
      default: return unsupported(clause);
    }
  };
}

type NumberColumn = typeof replayRecordings.durationMs | typeof replayRecordings.activeMs | typeof replayRecordings.pageCount;

function numeric(column: NumberColumn) {
  return (clause: ReplayFilterClause): Compiled => {
    const n = Number(clause.value);
    if (!Number.isFinite(n)) return { reject: `${clause.field} needs a number` };
    switch (clause.op) {
      case 'gte': return gte(column, n);
      case 'lte': return lte(column, n);
      case 'eq': return eq(column, n);
      default: return unsupported(clause);
    }
  };
}

function smartEvent(clause: ReplayFilterClause, ctx: CompileContext): Compiled {
  const names = list(clause.value);
  switch (clause.op) {
    case 'eq': return smartEventPredicate(names[0]!, ctx);
    case 'neq': return not(smartEventPredicate(names[0]!, ctx));
    case 'in': return or(...names.map((name) => smartEventPredicate(name, ctx))) as SQL;
    default: return unsupported(clause);
  }
}

function tag(clause: ReplayFilterClause): Compiled {
  const raw = String(clause.value);
  const at = raw.indexOf('=');
  if (at <= 0) return { reject: 'tag needs key=value' };
  const key = raw.slice(0, at);
  const value = raw.slice(at + 1);
  if (clause.op === 'eq') return sql`(${replayRecordings.tags} ->> ${key}) = ${value}`;
  if (clause.op === 'neq') return sql`(${replayRecordings.tags} ->> ${key}) is distinct from ${value}`;
  return unsupported(clause);
}

/** Every registered field, compiled or rejected — a typed record, so none can be missed. */
const FIELD_COMPILERS: Readonly<Record<FilterFieldId, (clause: ReplayFilterClause, ctx: CompileContext) => Compiled>> = {
  device: scalar(replayRecordings.deviceClass),
  browser: scalar(replayRecordings.browser),
  os: scalar(replayRecordings.os),
  country: scalar(replayRecordings.country),
  referrer: scalar(replayRecordings.referrerHost),
  entryPath: scalar(replayRecordings.entryPath),
  exitPath: scalar(replayRecordings.exitPath),
  visitedPath: array(replayRecordings.routes),
  clickedSelector: array(replayRecordings.clicked),
  frustration: array(replayRecordings.frustrations),
  durationMs: numeric(replayRecordings.durationMs),
  activeMs: numeric(replayRecordings.activeMs),
  pageCount: numeric(replayRecordings.pageCount),
  release: scalar(replayRecordings.releaseKey),
  smartEvent,
  tag,
  converted: (clause) => (clause.op === 'eq' && typeof clause.value === 'boolean'
    ? eq(replayRecordings.converted, clause.value)
    : { reject: 'converted needs eq true|false' }),
  variant: scalar(replayRecordings.variant),
  issue: (clause) => (clause.op === 'eq' ? arrayContains(replayRecordings.issueFps, [String(clause.value)]) : unsupported(clause)),
};

/** Compile a parsed filter over `replay_recordings`. */
export function compileReplayFilter(filter: ReplayFilter | null | undefined, ctx: CompileContext = { siteRules: [] }): CompiledFilter {
  const parts: SQL[] = [];
  const rejected: FilterRejection[] = [];
  for (const clause of filter?.all ?? []) {
    const compile = FIELD_COMPILERS[clause.field];
    const out = compile ? compile(clause, ctx) : { reject: `unknown field ${String(clause.field)}` };
    if ('reject' in out) rejected.push({ clause, reason: out.reject });
    else parts.push(out);
  }
  return { where: parts.length ? and(...parts) : undefined, rejected };
}

/** Whether the filter names a smart event (the only clause that needs the site's rules). */
export function filterNeedsSiteRules(filter: ReplayFilter | null | undefined): boolean {
  return (filter?.all ?? []).some((clause) => clause.field === 'smartEvent');
}
