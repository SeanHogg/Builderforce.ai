/** The `node-express` backend part: Express + `pg`, on `PORT` (default 8000). */
import type { KitPart } from '../types';
import { ITEMS_MIGRATION, MEMORY_NOTE } from './backendContract';
import { backendFragment, KIT_API_PORT } from './fragments';

const PACKAGE_JSON = JSON.stringify({
  name: 'api',
  version: '1.0.0',
  private: true,
  type: 'module',
  scripts: { start: 'node server.js' },
  dependencies: { express: '^4.21.2', pg: '^8.13.1' },
}, null, 2);

const SERVER_JS = `import express from 'express';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const PORT = Number(process.env.PORT ?? ${KIT_API_PORT});
const DATABASE_URL = process.env.DATABASE_URL;
const MEMORY_NOTE = ${JSON.stringify(MEMORY_NOTE)};

/** Items in Postgres when DATABASE_URL is set, else in memory. */
async function openStore() {
  if (!DATABASE_URL) {
    const items = [];
    return {
      storage: 'memory',
      list: async () => items,
      add: async (name) => {
        const item = { id: items.length + 1, name };
        items.push(item);
        return item;
      },
    };
  }
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  // Creates the table when it is missing (the migration is idempotent).
  await pool.query(await readFile(new URL('./${ITEMS_MIGRATION}', import.meta.url), 'utf8'));
  return {
    storage: 'postgres',
    list: async () => (await pool.query('SELECT id, name FROM items ORDER BY id')).rows,
    add: async (name) => (await pool.query('INSERT INTO items (name) VALUES ($1) RETURNING id, name', [name])).rows[0],
  };
}

const store = await openStore();
const app = express();
app.use(express.json());

const health = (_req, res) => res.json({ status: 'ok', runtime: 'node', storage: store.storage });
app.get('/health', health);
app.get('/api/health', health);

app.get('/api/items', async (_req, res, next) => {
  try {
    const items = await store.list();
    res.json(store.storage === 'memory' ? { items, storage: store.storage, note: MEMORY_NOTE } : { items, storage: store.storage });
  } catch (error) {
    next(error);
  }
});

app.post('/api/items', async (req, res, next) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    res.status(201).json(await store.add(name));
  } catch (error) {
    next(error);
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(\`API listening on http://localhost:\${PORT} (\${store.storage})\`));
`;

export const NODE_EXPRESS: KitPart = {
  id: 'node-express',
  kind: 'backend',
  label: 'Node.js (Express)',
  aliases: ['node', 'express'],
  serviceId: 'api',
  root: '/api',
  ingress: '/api',
  files: { 'package.json': PACKAGE_JSON, 'server.js': SERVER_JS },
  manifest: backendFragment({ runtime: 'node', command: 'npm start', install: 'npm install' }),
};
