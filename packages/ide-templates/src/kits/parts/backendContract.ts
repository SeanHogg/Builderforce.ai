/**
 * The HTTP contract every kit backend serves, whatever its language, as the strings the
 * backends' sources embed — so the four of them say the same thing:
 *
 *   GET  /health, /api/health → { status: 'ok', runtime, storage }
 *   GET  /api/items           → { items: [{ id, name }], storage, note? }
 *   POST /api/items { name }  → 201 { id, name }
 *
 * Storage is Postgres when `DATABASE_URL` is set (the `postgres` extra declares the
 * resource, so the runtime injects it), else in memory with {@link MEMORY_NOTE}.
 */

/** The migration the `postgres` extra ships, relative to the API root; backends run it when they connect. */
export const ITEMS_MIGRATION = 'migrations/001_items.sql';

/** Why items vanish on restart, in each in-memory response. */
export const MEMORY_NOTE = 'DATABASE_URL is not set, so items are not stored in a database. Add Postgres with: /starter-kit <kit> --with postgres';
