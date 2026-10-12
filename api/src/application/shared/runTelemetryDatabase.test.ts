import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RUN_TELEMETRY_TABLES } from './runTelemetryDatabase';

/**
 * The set the generic readers route by must be EXACTLY what the operational migration
 * creates, less what a later migration on that track dropped. A table in the set but
 * not the migration is read from a database that lacks it; a table created there but
 * missing from the set is read from core's frozen copy — which fails silently, with
 * stale rows rather than an error.
 */
describe('RUN_TELEMETRY_TABLES', () => {
  it('matches the tables transactional-migrations/0013 creates, less later drops', () => {
    const dir = fileURLToPath(new URL('../../../transactional-migrations/', import.meta.url).href);
    const sql = readFileSync(join(dir, '0013_run_telemetry.sql'), 'utf8');
    const created = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]));
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql') && f > '0013_run_telemetry.sql')) {
      const later = readFileSync(join(dir, file), 'utf8');
      for (const m of later.matchAll(/DROP TABLE(?: IF EXISTS)? (\w+)/g)) created.delete(m[1]);
    }
    expect([...RUN_TELEMETRY_TABLES].sort()).toEqual([...created].sort());
  });
});
