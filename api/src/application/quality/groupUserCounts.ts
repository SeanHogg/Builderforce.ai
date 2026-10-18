import { sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Record (group, user) pairs and bump each group's EXACT `user_count` by the number
 * of genuinely-new pairs — in ONE statement (was an INSERT plus one UPDATE per
 * affected group, each a Neon round trip on the public ingest path).
 *
 * `ins` returns only pairs that did not already exist, `d` folds them to a per-group
 * delta, and the UPDATE is tenant-scoped so a forged group id cannot cross tenants.
 */
export async function bumpGroupUserCountsSql(
  db: Db,
  tenantId: number,
  pairs: Array<{ groupId: string; userKey: string }>,
  now: Date,
): Promise<void> {
  if (pairs.length === 0) return;
  const payload = JSON.stringify(pairs.map((p) => ({ group_id: p.groupId, user_key: p.userKey })));
  await db.execute(sql`
    WITH input AS (
      SELECT DISTINCT group_id, user_key
      FROM jsonb_to_recordset(${payload}::jsonb) AS p(group_id uuid, user_key text)
    ),
    ins AS (
      INSERT INTO error_group_users (group_id, user_key, first_seen)
      SELECT group_id, user_key, ${now.toISOString()}::timestamp FROM input
      ON CONFLICT DO NOTHING
      RETURNING group_id
    ),
    d AS (
      SELECT group_id, COUNT(*)::int AS delta FROM ins GROUP BY group_id
    )
    UPDATE error_groups g
    SET user_count = g.user_count + d.delta
    FROM d
    WHERE g.id = d.group_id AND g.tenant_id = ${tenantId}
  `);
}
