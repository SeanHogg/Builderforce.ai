import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

/**
 * `excluded.<column>` for an `onConflictDoUpdate` set clause, spelled from the column
 * object rather than by hand. A multi-row upsert must read each row's OWN incoming
 * value from `excluded`, and a hand-typed column name is one rename away from a
 * silent `column does not exist` at runtime — this reads the name the schema declares.
 */
export function excluded(column: AnyPgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}
