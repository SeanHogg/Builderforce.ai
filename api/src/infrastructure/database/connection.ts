import { neon } from '@neondatabase/serverless';
import { drizzle, NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';
import type { Env } from '../../env';

export type Db = NeonHttpDatabase<typeof schema>;

/**
 * Build a Drizzle database instance using the Neon HTTP driver.
 *
 * @neondatabase/serverless uses HTTP fetch instead of TCP, making it
 * fully compatible with Cloudflare Workers without nodejs_compat TCP quirks.
 */
export function buildDatabase(env: Env): Db {
  const sql = neon(env.NEON_DATABASE_URL);
  return drizzle(sql, { schema });
}
