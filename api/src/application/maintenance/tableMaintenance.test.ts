import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The vacuum half of the log-table policy. Both operations are raw statements against
 * a live endpoint, so the connection is stubbed and the assertions are on WHAT SQL was
 * issued and WHICH relation was chosen — the two decisions that carry the risk. The
 * reclaim takes an ACCESS EXCLUSIVE lock, so "chose the right table, and only one" is
 * the property under test, not "the vacuum worked".
 */
const issued: Array<{ connection: string; sql: string }> = [];
/** Rows the next pg_class/pg_stats probe returns, keyed by connection. */
const bloatRows: Record<string, Array<Record<string, unknown>>> = { primary: [], transactional: [] };
/** Relations whose VACUUM should throw, to exercise the best-effort path. */
const failing = new Set<string>();

function stubDb(connection: string) {
  return {
    execute: async (query: unknown) => {
      const text = renderQuery(query);
      issued.push({ connection, sql: text });
      if (/^VACUUM/.test(text)) {
        const relation = text.match(/"([a-z0-9_]+)"/)?.[1] ?? '';
        if (failing.has(relation)) throw new Error(`lock timeout on ${relation}`);
        return { rows: [] };
      }
      return { rows: bloatRows[connection] ?? [] };
    },
  };
}

/**
 * Flatten a drizzle SQL object back to text. `sql.raw('VACUUM …')` stores its text in a
 * StringChunk (`{ value: string[] }`), while a template literal mixes StringChunks with
 * parameter values — only the literal text matters here, which is enough to assert
 * WHICH statement was issued.
 */
function renderQuery(query: unknown): string {
  const chunks = (query as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return String(query);
  return chunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk;
      const value = (chunk as { value?: unknown })?.value;
      if (Array.isArray(value)) return value.join('');
      return typeof value === 'string' ? value : '';
    })
    .join('')
    .trim();
}

vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: () => stubDb('primary'),
  buildTransactionalDatabase: () => stubDb('transactional'),
}));

const reported: string[] = [];
vi.mock('../observability/caughtErrorReporter', () => ({
  reportCaughtError: (_e: unknown, details: { operation: string }) => { reported.push(details.operation); },
}));

const {
  RECLAIM_MIN_BLOAT_RATIO,
  RECLAIM_MIN_HEAP_BYTES,
  isSafeRelationName,
  measureBloat,
  runBloatReclaim,
  runTableVacuum,
  vacuumRelation,
} = await import('./tableMaintenance');
const { SWEPT_TABLES } = await import('./sweptTables');
import type { Env } from '../../env';

const env = {} as Env;
const MB = 1024 * 1024;

/** A pg_class/pg_stats row: `estRows * (rowWidth + 28)` is the live-bytes estimate. */
function bloated(relation: string, heapMb: number, liveMb: number) {
  return { relation, heapBytes: heapMb * MB, estRows: Math.round((liveMb * MB) / 128), rowWidth: 100 };
}

beforeEach(() => {
  issued.length = 0;
  reported.length = 0;
  failing.clear();
  bloatRows.primary = [];
  bloatRows.transactional = [];
});

describe('isSafeRelationName', () => {
  it('accepts a plain lower-case identifier and rejects anything that could inject', () => {
    expect(isSafeRelationName('manager_actions')).toBe(true);
    expect(isSafeRelationName('Manager_Actions')).toBe(false);
    expect(isSafeRelationName('x"; DROP TABLE users; --')).toBe(false);
    expect(isSafeRelationName('')).toBe(false);
    expect(isSafeRelationName(42)).toBe(false);
  });
});

describe('vacuumRelation', () => {
  it('quotes the relation and selects the mode', async () => {
    await vacuumRelation(stubDb('primary') as never, 'manager_actions');
    await vacuumRelation(stubDb('primary') as never, 'manager_actions', { full: true });
    await vacuumRelation(stubDb('primary') as never);
    expect(issued.map((i) => i.sql)).toEqual([
      'VACUUM (ANALYZE) "manager_actions"',
      'VACUUM (FULL, ANALYZE) "manager_actions"',
      'VACUUM (ANALYZE)',
    ]);
  });

  /** VACUUM takes no bind parameters, so this guard is the only thing between an
   *  operator-supplied table name and injection. */
  it('refuses an unsafe relation name rather than concatenating it', async () => {
    await expect(vacuumRelation(stubDb('primary') as never, 'x"; DROP TABLE users; --')).rejects.toThrow(/Unsafe relation/);
    expect(issued).toHaveLength(0);
  });
});

describe('SWEPT_TABLES redact windows', () => {
  it('always blanks a payload STRICTLY BEFORE the row that carries it is purged', () => {
    // A redact window >= the retention window is a silent no-op: the row is deleted before
    // its payload is ever blanked, so the table keeps the size the redaction was added to
    // reclaim and nothing anywhere reports a problem.
    for (const table of SWEPT_TABLES) {
      if (!table.redact) continue;
      expect(table.redact.afterDays, `${table.relation} redact window`).toBeLessThan(table.retentionDays);
      expect(table.redact.afterDays, `${table.relation} redact window`).toBeGreaterThan(0);
    }
  });
});

describe('runTableVacuum', () => {
  /** Vacuum operations per sweep = one per (table, endpoint), NOT one per table: four
   *  relations live on both databases and are vacuumed on each. */
  const sweepOperations = SWEPT_TABLES.reduce((n, t) => n + t.connections.length, 0);

  it('vacuums every registered log table on EVERY endpoint it lives on', async () => {
    const result = await runTableVacuum(env);
    // Once per (table, endpoint): a dual-resident relation is vacuumed on both, so it
    // appears twice. Asserting the flattened pairs is what would catch a regression to
    // "first connection wins", which would silently leave one copy unswept.
    expect(result.vacuumed).toEqual(SWEPT_TABLES.flatMap((t) => t.connections.map(() => t.relation)));
    expect(result.vacuumed).toHaveLength(sweepOperations);
    expect(result.failed).toEqual([]);
    for (const table of SWEPT_TABLES) {
      for (const connection of table.connections) {
        expect(issued).toContainEqual({ connection, sql: `VACUUM (ANALYZE) "${table.relation}"` });
      }
    }
  });

  /** A maintenance sweep that aborts halfway is worse than one reporting a partial pass. */
  it('keeps going after one relation fails, and reports it', async () => {
    failing.add('manager_actions');
    const result = await runTableVacuum(env);
    expect(result.failed).toEqual([{ relation: 'manager_actions', error: 'lock timeout on manager_actions' }]);
    expect(result.vacuumed).toHaveLength(sweepOperations - 1);
    expect(reported).toContain('runTableVacuum');
  });
});

describe('measureBloat', () => {
  it('derives live bytes from the planner statistics and floors bloat at zero', async () => {
    bloatRows.primary = [
      bloated('manager_actions', 600, 24),
      { relation: 'demo_events', heapBytes: 10 * MB, estRows: 1_000_000, rowWidth: 100 },
    ];
    const [manager, demo] = await measureBloat(env, 'primary');
    expect(manager?.bloatRatio).toBeGreaterThan(0.9);
    // estRows * (100 + 28) = 128 MB of "live" data in a 10 MB heap — a stats estimate
    // can exceed the file, and that must read as zero bloat rather than a negative.
    expect(demo?.bloatBytes).toBe(0);
    expect(demo?.bloatRatio).toBe(0);
  });
});

describe('runBloatReclaim', () => {
  it('rewrites nothing when every table is under the thresholds', async () => {
    bloatRows.primary = [bloated('manager_actions', 600, 500)];  // big, but only ~17% bloat
    bloatRows.transactional = [bloated('llm_traces', 8, 1)];     // very bloaty, but tiny
    const result = await runBloatReclaim(env);
    expect(result.eligible).toEqual([]);
    expect(result.reclaimed).toEqual([]);
    expect(issued.some((i) => /FULL/.test(i.sql))).toBe(false);
  });

  /**
   * Ordering is by ABSOLUTE bloat, not ratio: a 600 MB relation at 96% is what costs
   * money, a 70 MB one at 90% is not — and only ONE runs, so a single tick can never
   * chain exclusive locks.
   */
  it('rewrites the single worst-bloated relation and re-measures it', async () => {
    bloatRows.primary = [bloated('tool_audit_events', 70, 7), bloated('manager_actions', 600, 24)];
    const result = await runBloatReclaim(env);

    expect(result.eligible.map((e) => e.relation)).toEqual(['manager_actions', 'tool_audit_events']);
    expect(result.reclaimed.map((r) => r.relation)).toEqual(['manager_actions']);
    expect(issued.filter((i) => /FULL/.test(i.sql))).toEqual([
      { connection: 'primary', sql: 'VACUUM (FULL, ANALYZE) "manager_actions"' },
    ]);
    expect(result.reclaimed[0]?.beforeBytes).toBe(600 * MB);
  });

  it('records a failed rewrite without failing the sweep', async () => {
    bloatRows.primary = [bloated('manager_actions', 600, 24)];
    failing.add('manager_actions');
    const result = await runBloatReclaim(env);
    expect(result.reclaimed).toEqual([]);
    expect(result.failed[0]?.relation).toBe('manager_actions');
    expect(reported).toContain('runBloatReclaim');
  });

  /** The thresholds are the whole safety argument — pin them so a tweak is deliberate. */
  it('keeps the thresholds that authorise an exclusive lock explicit', () => {
    expect(RECLAIM_MIN_HEAP_BYTES).toBe(64 * MB);
    expect(RECLAIM_MIN_BLOAT_RATIO).toBe(0.5);
  });
});
