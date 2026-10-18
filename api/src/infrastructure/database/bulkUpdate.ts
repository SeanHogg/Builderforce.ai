import { sql, type SQL } from 'drizzle-orm';

/** Anything with Drizzle's `execute` — a `Db`, or the `tx` an `inTransaction` body gets. */
export interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface BulkColumn {
  /** SQL column name (snake_case). A trusted constant — it is spliced as an identifier. */
  name: string;
  /** SQL type the bound parameter is cast to, e.g. `text`, `integer`, `timestamp`, an enum name. */
  sqlType: string;
}

export interface BulkUpdateRow<Id extends string | number> {
  id: Id;
  /** Columns to write on this row. A column ABSENT from `set` keeps its current value;
   *  one present with `null` writes NULL — the two are different on purpose. */
  set: Record<string, string | number | boolean | Date | null>;
}

export interface BulkUpdateSpec<Id extends string | number> {
  /** Trusted constant table name. */
  table: string;
  idColumn: BulkColumn;
  columns: BulkColumn[];
  rows: Array<BulkUpdateRow<Id>>;
  /** Extra predicate over the target, aliased `t` (e.g. a tenant or parent-id guard). */
  where?: SQL;
}

const ident = (name: string) => sql.raw(`"${name.replace(/"/g, '""')}"`);
const typeName = (t: string) => sql.raw(t);
const param = (v: unknown, sqlType: string) =>
  sql`${v instanceof Date ? v.toISOString() : v}::${typeName(sqlType)}`;

/**
 * Set-based `UPDATE … FROM (VALUES …)`: N heterogeneous per-row writes become ONE
 * statement (one HTTPS round trip to Neon) instead of N. Each column carries a
 * "has value" flag, so a row can leave a column untouched while its neighbour
 * changes it — the behaviour a per-row `.set({ ...(x !== undefined ? {x} : {}) })`
 * has, preserved.
 *
 * Mind unique indexes: Postgres checks a non-deferrable unique index row by row inside
 * one UPDATE, so a swap of two keyed values in a single statement can still collide.
 */
export async function bulkUpdateById<Id extends string | number>(
  db: SqlExecutor,
  spec: BulkUpdateSpec<Id>,
): Promise<void> {
  if (spec.rows.length === 0 || spec.columns.length === 0) return;
  const { columns, idColumn } = spec;

  const valueRows = spec.rows.map((row) => sql`(${sql.join([
    param(row.id, idColumn.sqlType),
    ...columns.flatMap((col) => {
      const has = Object.prototype.hasOwnProperty.call(row.set, col.name);
      return [sql`${has}::boolean`, param(has ? row.set[col.name] : null, col.sqlType)];
    }),
  ], sql`, `)})`);

  const alias = sql.join([
    ident('id'),
    ...columns.flatMap((col) => [ident(`${col.name}__set`), ident(col.name)]),
  ], sql`, `);
  const assignments = sql.join(
    columns.map((col) => sql`${ident(col.name)} = CASE WHEN v.${ident(`${col.name}__set`)} THEN v.${ident(col.name)} ELSE t.${ident(col.name)} END`),
    sql`, `,
  );

  await db.execute(sql`
    UPDATE ${ident(spec.table)} AS t
    SET ${assignments}
    FROM (VALUES ${sql.join(valueRows, sql`, `)}) AS v(${alias})
    WHERE t.${ident(idColumn.name)} = v.id${spec.where ? sql` AND ${spec.where}` : sql``}
  `);
}
