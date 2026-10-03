import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUN_TELEMETRY_TABLES } from './runTelemetryDatabase';

/**
 * The set the generic readers route by must be EXACTLY what the operational migration
 * creates. A table in the set but not the migration is read from a database that lacks
 * it; a table created there but missing from the set is read from core's frozen copy —
 * which fails silently, with stale rows rather than an error.
 */
describe('RUN_TELEMETRY_TABLES', () => {
  it('matches the tables transactional-migrations/0013 creates', () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../../../transactional-migrations/0013_run_telemetry.sql', import.meta.url).href),
      'utf8',
    );
    const created = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]));
    expect([...RUN_TELEMETRY_TABLES].sort()).toEqual([...created].sort());
  });
});
