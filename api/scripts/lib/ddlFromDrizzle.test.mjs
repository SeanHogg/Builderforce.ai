import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseModule, renderTable } from './ddlFromDrizzle.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('ddlFromDrizzle index rendering', () => {
  it('uses declared SQL column names instead of re-deriving them from properties', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ddl-from-drizzle-'));
    temporaryDirectories.push(directory);
    const modulePath = join(directory, 'schema.ts');
    writeFileSync(modulePath, `
      export const eventMatchmaking = pgTable('event_matchmaking', {
        tenantId: integer('tenant_id').notNull(),
        partyARef: varchar('party_a_ref', { length: 64 }).notNull(),
        partyBRef: varchar('party_b_ref', { length: 64 }).notNull(),
      }, (t) => [
        uniqueIndex('uq_event_matchmaking_pair').on(t.tenantId, t.partyARef, t.partyBRef),
      ]);
    `);

    const [table] = parseModule(modulePath);
    const ddl = renderTable(table, () => null);

    expect(ddl).toContain('(tenant_id, party_a_ref, party_b_ref)');
    expect(ddl).not.toContain('party_aref');
    expect(ddl).not.toContain('party_bref');
  });
});
