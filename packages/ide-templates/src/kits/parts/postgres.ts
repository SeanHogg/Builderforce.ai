/**
 * The `postgres` extra: a persistent Postgres resource the backend uses (the runtime
 * injects its `DATABASE_URL`; PGlite in the browser), and the items migration every
 * backend runs when it connects. Phase 3 kits carry this extra only (§W11 Rev 2 item 6):
 * redis, queue, jobs, storage and mail arrive with the phases that add their runtimes.
 */
import type { KitPart } from '../types';
import { ITEMS_MIGRATION } from './backendContract';

const ITEMS_SQL = `-- The items table behind GET/POST /api/items. Idempotent: the API runs it on connect.
CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const POSTGRES: KitPart = {
  id: 'postgres',
  kind: 'extra',
  label: 'Postgres database (CRUD on items)',
  aliases: ['pg', 'db'],
  serviceId: 'api',
  root: '/api',
  files: { [ITEMS_MIGRATION]: ITEMS_SQL },
  manifest: { resources: { db: { type: 'postgres', persistent: true } } },
  attach: { api: { uses: ['db'] } },
  requires: ['backend'],
};
