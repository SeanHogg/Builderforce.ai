/**
 * The database that holds `table`, for a caller holding the core handle.
 *
 * For code that is generic over tables (the entity layer, the registry projection),
 * which knows a relation by name rather than by the module that owns it. Each split-out
 * database declares its own set; anything in neither lives on core.
 */
import type { Db } from '../../infrastructure/database/connection';
import { APPS_TABLES, appsDatabaseOf } from '../ide/appsDatabase';
import { RUN_TELEMETRY_TABLES, runTelemetryDatabase } from './runTelemetryDatabase';

export function databaseForTable(db: Db, table: string): Db {
  if (APPS_TABLES.has(table)) return appsDatabaseOf(db);
  if (RUN_TELEMETRY_TABLES.has(table)) return runTelemetryDatabase(db);
  return db;
}
