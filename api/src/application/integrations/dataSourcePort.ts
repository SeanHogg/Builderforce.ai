/**
 * The data-source port — live warehouses and databases, reachable from Canvas.
 *
 * WHAT WAS MISSING
 * `dataProviderCatalog` has shipped Postgres/Neon, Supabase, BigQuery,
 * ClickHouse, Elasticsearch and Airtable for a long time, with `query` and
 * `list-tables` operations that the connect form tests and the workflow `mcp`
 * node executes. The Creation Canvas could reach NONE of it: every byte on a
 * board arrived by file upload and sat frozen in the node's data. This port is
 * the missing seam.
 *
 * LAYERING
 * Presentation (`dataSourceRoutes`) depends on this; this depends on the catalog
 * and the credential store. Nothing above it knows a provider exists, and
 * nothing here knows about HTTP status codes or Hono — failures are typed.
 *
 * READS ONLY. {@link assertReadOnlySql} rejects anything that is not a single
 * SELECT/WITH statement before a credential is even decrypted. A canvas is a
 * thinking surface; letting a language model author a DELETE against production
 * because someone asked it to "clean up the test rows" is not a risk worth
 * taking, and the refusal is stated rather than silently sandboxed.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { integrationCredentials } from '../../infrastructure/database/schema';
import { decryptCredentials } from './credentialCrypto';
import { callProvider, describeProviders, providerSpec, tcpTransportMessage } from './dataProviderCatalog';

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export interface DataSourceSummary {
  /** The integration credential id — what the canvas object binds to. */
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  transport: 'http' | 'tcp';
  /** Operations this provider declares. */
  operations: string[];
  /** Whether this deployment can actually reach it, and read a schema from it. */
  reachable: boolean;
  canIntrospect: boolean;
  canQuery: boolean;
  /** Stated up front when the runtime cannot reach the provider at all. */
  note: string | null;
}

export interface DataSourceColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface DataSourceTable {
  schema?: string;
  name: string;
  columns: DataSourceColumn[];
}

export interface DataSourceRelationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  constraint?: string;
}

export interface DataSourceSchema {
  provider: string;
  providerLabel: string;
  tables: DataSourceTable[];
  relationships: DataSourceRelationship[];
  /** Schemas/datasets that were scanned. BigQuery needs one named explicitly. */
  scanned: string[];
}

export interface DataSourceRows {
  columns: string[];
  rows: Array<Record<string, string | number>>;
  rowCount: number;
  truncated: boolean;
}

export class DataSourceError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 502 = 400) {
    super(message);
    this.name = 'DataSourceError';
  }
}

export interface DataSourceDeps {
  db: Db;
  tenantId: number;
  encryptionSecret: string;
  fetchImpl?: typeof fetch;
}

/** Providers whose schema this runtime knows how to read. Everything else is
 *  honestly reported as connect-and-query-only rather than half-working. */
const INTROSPECTABLE = new Set(['postgres', 'neon', 'clickhouse', 'bigquery']);
/** Providers that accept a SQL statement. */
const SQL_CAPABLE = new Set(['postgres', 'neon', 'clickhouse', 'bigquery']);

/** Row ceiling for one canvas read. Matches the frontend's materialized-object
 *  cap, so a query cannot return rows the board would then silently drop. */
export const MAX_DATA_SOURCE_ROWS = 500;
/** Tables read in one introspection. An ERD past this is unreadable anyway. */
const MAX_TABLES = 120;

// ---------------------------------------------------------------------------
// Read-only guard
// ---------------------------------------------------------------------------

const WRITE_KEYWORDS = /\b(?:insert|update|delete|drop|alter|truncate|create|grant|revoke|merge|call|copy|vacuum|refresh|comment|reindex|attach|replace|upsert|do|execute)\b/i;

/** Strip string literals and comments so a `WHERE note = 'update me'` is not
 *  mistaken for a write. */
function stripLiterals(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``');
}

/**
 * Accept exactly one read statement, or refuse with a reason.
 *
 * Deliberately conservative: a CTE that ends in a write (`WITH x AS (...) DELETE
 * ...`) is rejected by the keyword scan, and multiple statements are rejected by
 * the semicolon check, so neither can smuggle a mutation past a `SELECT` prefix.
 */
export function assertReadOnlySql(sql: string): string {
  const statement = String(sql ?? '').trim().replace(/;\s*$/, '');
  if (!statement) throw new DataSourceError('Provide a SQL statement to run.');
  if (statement.length > 20_000) throw new DataSourceError('That statement is too long to run from a canvas.');
  const bare = stripLiterals(statement);
  if (bare.includes(';')) {
    throw new DataSourceError('Run one statement at a time. Multiple statements are not accepted from a canvas.');
  }
  if (!/^\s*(?:select|with)\b/i.test(bare)) {
    throw new DataSourceError('Only SELECT (and WITH … SELECT) statements can be run from a canvas.');
  }
  const write = WRITE_KEYWORDS.exec(bare);
  if (write) {
    throw new DataSourceError(`A canvas data source is read-only, so "${write[0].toUpperCase()}" is not allowed. Use a workflow for writes.`);
  }
  return statement;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

const PROVIDER_DESCRIPTORS = new Map(describeProviders().map((provider) => [provider.id, provider]));

/** Every connected source a canvas may bind to. `family: 'data'` only —
 *  a marketing CRM is a connector, not a warehouse. */
export async function listDataSources(db: Db, tenantId: number): Promise<DataSourceSummary[]> {
  const rows = await db
    .select({
      id: integrationCredentials.id,
      name: integrationCredentials.name,
      provider: integrationCredentials.provider,
      isEnabled: integrationCredentials.isEnabled,
    })
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.tenantId, tenantId), eq(integrationCredentials.isEnabled, true)))
    .limit(200);

  return rows.flatMap((row): DataSourceSummary[] => {
    const descriptor = PROVIDER_DESCRIPTORS.get(String(row.provider));
    if (!descriptor || descriptor.family !== 'data') return [];
    const reachable = descriptor.transport === 'http';
    return [{
      id: row.id,
      name: row.name,
      provider: descriptor.id,
      providerLabel: descriptor.label,
      transport: descriptor.transport,
      operations: descriptor.operations.map((operation) => operation.id),
      reachable,
      canIntrospect: reachable && INTROSPECTABLE.has(descriptor.id),
      canQuery: reachable && SQL_CAPABLE.has(descriptor.id),
      note: descriptor.transportNote,
    }];
  });
}

interface ResolvedSource {
  id: string;
  name: string;
  provider: string;
  providerLabel: string;
  credentials: Record<string, unknown>;
}

async function resolveSource(deps: DataSourceDeps, id: string): Promise<ResolvedSource> {
  const rows = await deps.db
    .select({
      id: integrationCredentials.id,
      name: integrationCredentials.name,
      provider: integrationCredentials.provider,
      credentialsEnc: integrationCredentials.credentialsEnc,
      iv: integrationCredentials.iv,
      isEnabled: integrationCredentials.isEnabled,
    })
    .from(integrationCredentials)
    .where(and(eq(integrationCredentials.tenantId, deps.tenantId), eq(integrationCredentials.id, id)))
    .limit(1);

  const row = rows[0];
  if (!row) throw new DataSourceError('That data source is not connected to this workspace.', 404);
  if (!row.isEnabled) throw new DataSourceError(`"${row.name}" is disabled. Re-enable it in Integrations.`, 403);

  const spec = providerSpec(String(row.provider));
  const descriptor = PROVIDER_DESCRIPTORS.get(String(row.provider));
  if (!spec || !descriptor || descriptor.family !== 'data') {
    throw new DataSourceError(`"${row.name}" is not a data source a canvas can read.`, 400);
  }
  if (spec.transport === 'tcp') throw new DataSourceError(tcpTransportMessage(spec.label), 400);

  const credentials = await decryptCredentials(row.credentialsEnc, row.iv, deps.encryptionSecret, deps.tenantId);
  if (!credentials) throw new DataSourceError(`The stored credential for "${row.name}" could not be decrypted.`, 400);

  return { id: row.id, name: row.name, provider: spec.id, providerLabel: spec.label, credentials };
}

// ---------------------------------------------------------------------------
// Response normalization
// ---------------------------------------------------------------------------

function cell(value: unknown): string | number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/**
 * Fold each provider's result envelope onto one row shape.
 *
 * Three wire formats, one contract — and an unrecognized one is an error rather
 * than an empty table, because "the query returned nothing" and "we could not
 * read the answer" must not look the same on a card.
 */
function normalizeRows(provider: string, body: unknown, limit: number): DataSourceRows {
  const records: Array<Record<string, unknown>> = [];
  let columns: string[] = [];

  if (provider === 'bigquery') {
    const payload = body as { schema?: { fields?: Array<{ name?: unknown }> }; rows?: Array<{ f?: Array<{ v?: unknown }> }> };
    columns = (payload?.schema?.fields ?? []).map((field, index) => String(field?.name ?? `column_${index + 1}`));
    for (const row of payload?.rows ?? []) {
      records.push(Object.fromEntries((row?.f ?? []).map((field, index) => [columns[index] ?? `column_${index + 1}`, field?.v])));
    }
  } else if (provider === 'clickhouse') {
    const payload = body as { meta?: Array<{ name?: unknown }>; data?: Array<Record<string, unknown>> };
    columns = (payload?.meta ?? []).map((meta, index) => String(meta?.name ?? `column_${index + 1}`));
    for (const row of payload?.data ?? []) if (row && typeof row === 'object') records.push(row);
  } else {
    // Neon's HTTP SQL endpoint: `{ fields: [{name}], rows: [{...}] }`.
    const payload = body as { fields?: Array<{ name?: unknown }>; rows?: unknown };
    const rows = Array.isArray(payload?.rows) ? payload.rows : Array.isArray(body) ? body : null;
    if (!rows) throw new DataSourceError('The data source returned a response this runtime could not read.', 502);
    columns = (payload?.fields ?? []).map((field, index) => String(field?.name ?? `column_${index + 1}`));
    for (const row of rows) if (row && typeof row === 'object' && !Array.isArray(row)) records.push(row as Record<string, unknown>);
  }

  if (!columns.length) {
    columns = [...new Set(records.flatMap((record) => Object.keys(record)))];
  }
  const truncated = records.length > limit;
  return {
    columns,
    rows: records.slice(0, limit).map((record) => Object.fromEntries(columns.map((column) => [column, cell(record[column])]))),
    rowCount: records.length,
    truncated,
  };
}

async function runSql(deps: DataSourceDeps, source: ResolvedSource, sql: string, limit: number): Promise<DataSourceRows> {
  const result = await callProvider(source.provider, 'query', source.credentials, { sql }, deps.fetchImpl ?? fetch);
  if (!result.ok) throw new DataSourceError(result.error ?? `${source.providerLabel} rejected the query.`, 502);
  return normalizeRows(source.provider, result.body, limit);
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/**
 * Run one read query against a connected source.
 *
 * A `LIMIT` is appended when the statement has none, so a canvas cannot pull a
 * billion rows into a browser tab by omitting one word.
 */
export async function queryDataSource(
  deps: DataSourceDeps,
  id: string,
  input: { sql: string; limit?: number },
): Promise<DataSourceRows & { source: { id: string; name: string; provider: string; providerLabel: string }; sql: string }> {
  const statement = assertReadOnlySql(input.sql);
  const source = await resolveSource(deps, id);
  if (!SQL_CAPABLE.has(source.provider)) {
    throw new DataSourceError(`${source.providerLabel} does not accept SQL from a canvas. Connect a SQL warehouse to query it here.`, 400);
  }
  const limit = Math.max(1, Math.min(Math.floor(Number(input.limit) || MAX_DATA_SOURCE_ROWS), MAX_DATA_SOURCE_ROWS));
  const bounded = /\blimit\s+\d+/i.test(stripLiterals(statement)) ? statement : `${statement} LIMIT ${limit}`;
  const rows = await runSql(deps, source, bounded, limit);
  return {
    ...rows,
    sql: bounded,
    source: { id: source.id, name: source.name, provider: source.provider, providerLabel: source.providerLabel },
  };
}

// ---------------------------------------------------------------------------
// Introspection — REAL → model
// ---------------------------------------------------------------------------

const POSTGRES_COLUMNS = `
SELECT c.table_schema AS table_schema, c.table_name AS table_name, c.column_name AS column_name,
       c.data_type AS data_type, c.is_nullable AS is_nullable,
       CASE WHEN pk.column_name IS NULL THEN 'NO' ELSE 'YES' END AS is_primary
FROM information_schema.columns c
LEFT JOIN (
  SELECT kcu.table_schema, kcu.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON pk.table_schema = c.table_schema AND pk.table_name = c.table_name AND pk.column_name = c.column_name
WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY c.table_schema, c.table_name, c.ordinal_position
LIMIT 4000`;

const POSTGRES_FOREIGN_KEYS = `
SELECT tc.constraint_name AS constraint_name, kcu.table_name AS from_table, kcu.column_name AS from_column,
       ccu.table_name AS to_table, ccu.column_name AS to_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
LIMIT 1000`;

const CLICKHOUSE_COLUMNS = `
SELECT database AS table_schema, table AS table_name, name AS column_name, type AS data_type,
       if(position(type, 'Nullable') > 0, 'YES', 'NO') AS is_nullable,
       if(is_in_primary_key = 1, 'YES', 'NO') AS is_primary
FROM system.columns
WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
ORDER BY database, table, position
LIMIT 4000 FORMAT JSON`;

function bigQueryColumns(dataset: string): string {
  // The dataset is an identifier, not a bind parameter, so it is validated
  // rather than escaped — anything but a plain name is refused outright.
  if (!/^[A-Za-z0-9_]{1,1024}$/.test(dataset)) {
    throw new DataSourceError('A BigQuery dataset name may only contain letters, numbers and underscores.');
  }
  return `
SELECT table_schema, table_name, column_name, data_type, is_nullable,
       CASE WHEN is_partitioning_column = 'YES' THEN 'YES' ELSE 'NO' END AS is_primary
FROM \`${dataset}\`.INFORMATION_SCHEMA.COLUMNS
ORDER BY table_name, ordinal_position
LIMIT 4000`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

function tablesFromColumnRows(rows: DataSourceRows['rows']): DataSourceTable[] {
  const byTable = new Map<string, DataSourceTable>();
  for (const row of rows) {
    const schema = text(row.table_schema);
    const name = text(row.table_name);
    if (!name) continue;
    const key = `${schema}.${name}`;
    let table = byTable.get(key);
    if (!table) {
      if (byTable.size >= MAX_TABLES) continue;
      table = { ...(schema ? { schema } : {}), name, columns: [] };
      byTable.set(key, table);
    }
    const column = text(row.column_name);
    if (!column) continue;
    table.columns.push({
      name: column,
      type: text(row.data_type) || 'text',
      nullable: text(row.is_nullable).toUpperCase() === 'YES',
      primaryKey: text(row.is_primary).toUpperCase() === 'YES',
    });
  }
  return [...byTable.values()].filter((table) => table.columns.length);
}

/**
 * Read a live database's schema.
 *
 * This is the REAL → model direction: what turns "point at production and show
 * me the ERD" into a real diagram with real keys and real foreign keys, rather
 * than a drawing someone typed from memory.
 */
export async function introspectDataSource(
  deps: DataSourceDeps,
  id: string,
  options: { dataset?: string } = {},
): Promise<DataSourceSchema> {
  const source = await resolveSource(deps, id);
  if (!INTROSPECTABLE.has(source.provider)) {
    throw new DataSourceError(
      `${source.providerLabel} does not expose a schema this runtime can read. `
      + 'Postgres, Neon, ClickHouse and BigQuery can be reverse-engineered into an ERD.',
      400,
    );
  }

  if (source.provider === 'clickhouse') {
    const columns = await runSql(deps, source, CLICKHOUSE_COLUMNS, 4_000);
    const tables = tablesFromColumnRows(columns.rows);
    // ClickHouse has no foreign keys; saying so beats implying none were found.
    return { provider: source.provider, providerLabel: source.providerLabel, tables, relationships: [], scanned: [...new Set(tables.map((table) => table.schema ?? 'default'))] };
  }

  if (source.provider === 'bigquery') {
    const dataset = String(options.dataset ?? '').trim();
    if (!dataset) throw new DataSourceError('Name the BigQuery dataset to read the schema of.');
    const columns = await runSql(deps, source, bigQueryColumns(dataset), 4_000);
    const tables = tablesFromColumnRows(columns.rows);
    return { provider: source.provider, providerLabel: source.providerLabel, tables, relationships: [], scanned: [dataset] };
  }

  // Postgres family: columns and foreign keys are two reads, and a failure of
  // the SECOND is not fatal — a schema with no relationships is still a schema.
  const columns = await runSql(deps, source, POSTGRES_COLUMNS, 4_000);
  const tables = tablesFromColumnRows(columns.rows);
  const known = new Set(tables.map((table) => table.name));
  let relationships: DataSourceRelationship[] = [];
  try {
    const keys = await runSql(deps, source, POSTGRES_FOREIGN_KEYS, 1_000);
    relationships = keys.rows.flatMap((row): DataSourceRelationship[] => {
      const fromTable = text(row.from_table);
      const toTable = text(row.to_table);
      const fromColumn = text(row.from_column);
      const toColumn = text(row.to_column);
      if (!fromTable || !toTable || !fromColumn || !toColumn) return [];
      if (!known.has(fromTable) || !known.has(toTable)) return [];
      return [{ fromTable, fromColumn, toTable, toColumn, ...(text(row.constraint_name) ? { constraint: text(row.constraint_name) } : {}) }];
    });
  } catch {
    relationships = [];
  }

  return {
    provider: source.provider,
    providerLabel: source.providerLabel,
    tables,
    relationships,
    scanned: [...new Set(tables.map((table) => table.schema ?? 'public'))],
  };
}
