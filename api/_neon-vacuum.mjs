// TEMP maintenance: VACUUM FULL the bloated manager_actions table to reclaim space.
// Non-destructive (no row deletion). Deleted after run. Operator-authorized.
import { readFileSync } from 'node:fs';
import { neon } from '@neondatabase/serverless';
const m = readFileSync('.env','utf8').match(/^NEON_DATABASE_URL=(.*)$/m);
const sql = neon(m[1].trim().replace(/^["']|["']$/g,''));

const size = async (t) => (await sql`SELECT pg_size_pretty(pg_total_relation_size(${t}::regclass)) AS s`)[0].s;
const dbsize = async () => (await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS s`)[0].s;

console.log('BEFORE  manager_actions =', await size('manager_actions'), '| db =', await dbsize());
const t0 = Date.now();
await sql`VACUUM (FULL, ANALYZE) manager_actions`;
console.log(`VACUUM FULL manager_actions done in ${((Date.now()-t0)/1000).toFixed(1)}s`);
console.log('AFTER   manager_actions =', await size('manager_actions'), '| db =', await dbsize());
