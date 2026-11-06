/**
 * Migration 1294 (expand only: one nullable jsonb column) matches the Drizzle schema, and the
 * scope store reads and writes it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { getTableColumns } from 'drizzle-orm';
import { knowledgeScopes } from '../../infrastructure/database/schema';

const sql = readFileSync(fileURLToPath(new URL('../../../migrations/1294_knowledge_scope_provenance.sql', import.meta.url)), 'utf8');

describe('1294 knowledge_scopes.provenance', () => {
  it('adds one nullable jsonb column, idempotently, with no default and no backfill', () => {
    const statements = sql.split('\n').filter((l) => !l.startsWith('--') && l.trim() !== '');
    expect(statements).toEqual([
      "SET LOCAL lock_timeout = '3s';",
      'ALTER TABLE knowledge_scopes ADD COLUMN IF NOT EXISTS provenance jsonb;',
    ]);
  });

  it('is the same column the Drizzle schema declares: nullable jsonb', () => {
    const column = getTableColumns(knowledgeScopes).provenance;
    expect(column.name).toBe('provenance');
    expect(column.columnType).toBe('PgJsonb');
    expect(column.notNull).toBe(false);
    expect(column.hasDefault).toBe(false);
  });
});
