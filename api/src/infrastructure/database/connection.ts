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
  const url = env.NEON_DATABASE_URL;
  if (!url || typeof url !== 'string' || !url.trim()) {
    throw new Error(
      'NEON_DATABASE_URL is not set. Set it with: wrangler secret put NEON_DATABASE_URL (in the api/ directory)'
    );
  }
  const sql = neon(url);
  return drizzle(sql, { schema });
}
