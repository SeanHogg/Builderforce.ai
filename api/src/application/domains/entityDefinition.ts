/**
 * The domain ENTITY definition (PRD 20 §5 step 5, §6.1).
 *
 * PRD 20 landed 244 consolidated tables and, on the day the target schema went
 * in, seven of them had a code path. `check-table-adoption.mjs` is the meter that
 * says so, and its number is the honest measure of the document's own failure
 * mode: "a schema that ships and a code path that never arrives".
 *
 * This module is the answer to that number, and the answer is deliberately NOT
 * 237 hand-written services. §0's rule — *a feature may add domain tables, it may
 * not add another instance of an existing shape* — applies to the layer above the
 * schema exactly as it applies to the schema: 237 near-identical
 * list/get/create/update services IS the shape repetition the whole document is
 * about, one layer up. So a table declares itself here in one line, and the
 * generic use cases in `EntityService.ts` serve every one of them.
 *
 * WHAT IS REFLECTED, AND WHY NOTHING IS RESTATED. Everything this layer needs —
 * the physical table name, the primary key, whether the row is tenant-scoped,
 * which column is a human-readable title, what to order by — is already stated
 * once in the Drizzle module. Restating it here would be the two-sources-of-truth
 * problem PRD 20 §5 step 2 refused for the DDL, one layer up: `getTableColumns()`
 * reads the declaration instead.
 *
 * WHAT AN ENTITY MAY DECLARE, because it cannot be derived:
 *   · `kind`      — the singular noun the registry addresses it by, when the
 *                   mechanical singular of the table name is wrong;
 *   · `readOnly`  — money, secrets and audit rows are written by the service that
 *                   owns their invariants, never by a generic PATCH;
 *   · `registers` — whether a row is an addressable object a person navigates to.
 *
 * REDACTION IS NOT OPTIONAL. A generic reader over every table is exactly where a
 * secret leaks, so column redaction is applied HERE, at definition time, rather
 * than being left to each caller to remember: a redacted column is absent from
 * the projection, so no read path can select it and no write path can set it.
 */
import { getTableColumns, getTableName, type Column } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { DOMAINS } from '../kernel/ObjectRegistry';

/**
 * Where an entity lives.
 *
 * The fifteen seats, plus `kernel` — because §2 says the kernel is *owned by no
 * domain* and *no domain may fork one*, and folding `ledger_entry` or `message`
 * into whichever seat happens to read it most would be that fork, made by
 * filing. The kernel's twenty-five primitives are shared, so they are listed
 * once under their own scope and every seat's surface shows them as shared.
 */
export const ENTITY_SCOPES = [...DOMAINS, 'kernel'] as const;
export type EntityScope = (typeof ENTITY_SCOPES)[number];

export function isEntityScope(value: string): value is EntityScope {
  return (ENTITY_SCOPES as readonly string[]).includes(value);
}

/**
 * Columns a generic surface must never read or write.
 *
 * Matched on the PHYSICAL column name, because that is what a migration writes
 * and what a reviewer greps for. `credentials` holds `secret_enc`/`secret_iv`,
 * `share_links` and `invitations` hold the `token_hash` that IS the grant, and
 * `email_otp_challenges` holds a `code_hash` — none of them belong in a JSON
 * list response, whatever the caller asks for.
 */
const REDACTED = [
  /(^|_)secrets?(_|$)/,
  /(^|_)passwords?(_|$)/,
  /(^|_)passphrase(_|$)/,
  /(^|_)ciphertext(_|$)/,
  /(^|_)encrypted(_|$)/,
  /(^|_)(access|refresh|auth|guest|invite|reset|session|share|verification|webhook)_tokens?(_|$)/,
  /^tokens?$/,
  /(^|_)(token|code|password|otp)_hash(_|$)/,
  /(^|_)(api|private|access|secret|signing)_key(_|$)/,
  /(^|_)salt(_|$)/,
  /(^|_)nonce(_|$)/,
  /(^|_)signature(_|$)/,
];

/** Substring matching was the first version of this and it was WRONG in both
 *  directions: it withheld `input_tokens`, `token_count` and `color_token` —
 *  a usage number, a usage number and a hex colour — while a reviewer reading
 *  "redacts anything with token in it" would have called that correct. A guard
 *  that hides ordinary data is not conservative, it is a surface that silently
 *  serves less than it says; segment-anchored patterns are what separate a
 *  credential from a column that happens to contain the word. */
const isRedacted = (physical: string) => REDACTED.some((re) => re.test(physical));

/** Columns a caller may never set, whatever the table: identity, tenancy and the
 *  bookkeeping the database owns. Tenancy is stamped from the session, never from
 *  the body — a tenant column a client can write is a cross-tenant write. */
const NEVER_WRITABLE = new Set(['id', 'tenant_id', 'created_at', 'updated_at', 'object_id']);

/** Candidate title columns, best first. The first one a table actually has wins,
 *  so a surface has something to render without every table restating it. */
const TITLE_CANDIDATES = [
  'title', 'name', 'display_name', 'label', 'subject', 'headline',
  'question', 'summary', 'slug', 'code', 'key', 'email', 'metric',
];

/** Candidate ordering columns, newest-first semantics. */
const ORDER_CANDIDATES = ['updated_at', 'occurred_at', 'recorded_at', 'bucket_at', 'created_at'];

/** Columns that mean "this row is retired" — a generic delete soft-deletes when
 *  the table says it can, because an audit-adjacent row that vanishes is worse
 *  than one that is marked. */
const ARCHIVE_CANDIDATES = ['archived_at', 'deleted_at', 'revoked_at', 'cancelled_at', 'ended_at'];

export type EntityColumn = {
  /** Drizzle property key — what a query builder indexes by. */
  key: string;
  /** Physical column name — what the API and the UI show. */
  name: string;
  /** Drizzle's own data type: 'string' | 'number' | 'boolean' | 'date' | 'json' | … */
  dataType: string;
  notNull: boolean;
  hasDefault: boolean;
  /** Set only when a generic create must supply it. */
  required: boolean;
  writable: boolean;
  enumValues: readonly string[] | null;
};

export type EntitySpec = {
  table: PgTable;
  kind?: string;
  readOnly?: boolean;
  registers?: boolean;
  /**
   * Reference data every tenant may read — countries, cities, a stage lookup.
   *
   * Opt-IN, and it must stay opt-in. A table with no tenant column is not
   * automatically global: `email_otp_challenges` has none either, and its rows
   * are one-time codes against email addresses. Defaulting tenant-less to
   * readable would hand every tenant every other tenant's rows on any table
   * whose scope is narrower than a tenant rather than wider.
   */
  global?: boolean;
  /**
   * NEVER reachable through the generic reader, whatever its tenant scoping says.
   *
   * The opposite of `global`, and needed for the same reason that one is opt-in: being
   * tenant-scoped is what makes a table readable BY DEFAULT, and a small number of
   * tables are correctly tenant-scoped and still must not be browsable.
   * `candidate_demographics` is the case that forced it — self-identified EEO data,
   * collected because statutory reporting requires it and unlawful to use in an
   * assessment, so putting it one click from the shortlist in the entity browser is the
   * disclosure the segregation exists to prevent (migration 0460).
   *
   * A restricted entity is still registered and still typed; it is read only by a named
   * service that knows what it may return — counts without identifiers, in that case.
   */
  restricted?: boolean;
  /** Stated only when it must override the reflected pick. */
  title?: string;
  /** Deterministic ordering for composite-key tables with no timestamp. */
  order?: string;
};

export type EntityDef = {
  scope: EntityScope;
  /** The physical table name. It is the entity's id in the URL, because it is
   *  already unique across the whole schema and already what every guard, every
   *  migration and every baseline file names it. */
  name: string;
  /** Singular noun for `objects.kind`. */
  kind: string;
  table: PgTable;
  /** Public columns only — redacted ones are not here, so they cannot be selected. */
  columns: EntityColumn[];
  primaryKey: string | null;
  tenantKey: string | null;
  titleKey: string | null;
  orderKey: string | null;
  archiveKey: string | null;
  writable: boolean;
  /** May a tenant's surface list this at all — see `EntitySpec.global`. */
  readable: boolean;
  registers: boolean;
  /** Physical names of the columns redaction removed, so the API can say a field
   *  exists and is withheld rather than pretend the table is narrower than it is. */
  redacted: string[];
};

/**
 * English plural → singular, for the mechanical cases this schema actually uses.
 *
 * Deliberately small and deliberately overridable: the point is that 240 tables
 * do not each need a hand-written noun, not that this is a linguistics library.
 */
export function singularize(name: string): string {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (/(s|x|z|ch|sh)es$/.test(name)) return name.slice(0, -2);
  if (name.endsWith('ss')) return name;
  if (name.endsWith('s')) return name.slice(0, -1);
  return name;
}

/** Wrap a table with the handful of things reflection cannot know. */
export function entity(table: PgTable, opts: Omit<EntitySpec, 'table'> = {}): EntitySpec {
  return { table, ...opts };
}

function describe(column: Column, physical: string): EntityColumn {
  const writable = !NEVER_WRITABLE.has(physical) && !column.primary;
  return {
    key: '',
    name: physical,
    dataType: column.dataType,
    notNull: column.notNull,
    hasDefault: column.hasDefault,
    required: column.notNull && !column.hasDefault && writable,
    writable,
    enumValues: (column.enumValues as string[] | undefined) ?? null,
  };
}

/**
 * Reflect one domain's tables into entity definitions.
 *
 * Accepts a bare table where nothing needs stating, which is the common case —
 * the per-domain files read as a list of tables rather than a wall of config.
 */
export function defineDomainEntities(
  scope: EntityScope,
  specs: readonly (PgTable | EntitySpec)[],
): EntityDef[] {
  return specs.map((raw) => {
    const spec: EntitySpec = 'table' in raw ? (raw as EntitySpec) : { table: raw as PgTable };
    const table = spec.table;
    const name = getTableName(table);
    const cols = getTableColumns(table) as Record<string, Column>;

    const columns: EntityColumn[] = [];
    const redacted: string[] = [];
    let primaryKey: string | null = null;
    let tenantKey: string | null = null;
    const byPhysical = new Map<string, string>();

    for (const [key, column] of Object.entries(cols)) {
      const physical = column.name;
      byPhysical.set(physical, key);
      if (column.primary) primaryKey = key;
      if (physical === 'tenant_id') tenantKey = key;
      if (isRedacted(physical)) {
        redacted.push(physical);
        continue;
      }
      columns.push({ ...describe(column, physical), key });
    }

    const pick = (candidates: readonly string[]) => {
      for (const c of candidates) {
        const key = byPhysical.get(c);
        // A redacted column is not a title and not an ordering key — it does not
        // exist as far as every path above this line is concerned.
        if (key && columns.some((col) => col.key === key)) return key;
      }
      return null;
    };

    const titleKey = spec.title ? (byPhysical.get(spec.title) ?? null) : pick(TITLE_CANDIDATES);

    return {
      scope,
      name,
      kind: spec.kind ?? singularize(name),
      table,
      columns,
      primaryKey,
      tenantKey,
      titleKey,
      orderKey: spec.order ? (byPhysical.get(spec.order) ?? null) : (pick(ORDER_CANDIDATES) ?? primaryKey),
      archiveKey: pick(ARCHIVE_CANDIDATES),
      /**
       * Writable needs all three, and the last two are not editorial:
       * a row with no single-column primary key cannot be addressed for an
       * update, and a table with no tenant column is GLOBAL reference data —
       * "which tenant's edit wins" has no answer, so a tenant's surface may read
       * it and never write it.
       */
      writable: spec.readOnly !== true && primaryKey !== null && tenantKey !== null && spec.restricted !== true,
      // `restricted` wins over everything: being correctly tenant-scoped is what makes a
      // table readable by default, and that default is wrong for the few tables whose
      // whole purpose is to be segregated. See `EntitySpec.restricted`.
      readable: spec.restricted !== true && (tenantKey !== null || spec.global === true),
      registers: spec.registers === true,
      redacted,
    };
  });
}
