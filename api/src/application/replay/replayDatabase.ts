/**
 * Which database holds the Insights telemetry — the single answer for every replay
 * reader and writer (PRD 33 D2/D18).
 *
 * Recordings, rollups, issues and live presence live on the operational endpoint
 * (transactional-migrations/0015); the definitions (`replay_sites` and friends) live
 * on core. Where the operational URL is unbound the sibling resolves to core, which
 * carries the mirror (migrations/1217). A test double passed as `db` resolves to
 * itself.
 */

import type { Env } from '../../env';
import { siblingDatabase, type Db } from '../../infrastructure/database/connection';

export function replayTelemetryDb(env: Env | undefined, db: Db): Db {
  return siblingDatabase(env, db, 'operational');
}
