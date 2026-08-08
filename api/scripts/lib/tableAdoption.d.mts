/**
 * Types for the shared adoption measurement.
 *
 * The guards are deliberately plain `.mjs` — they run in CI before anything is
 * built — but this one has a second consumer that DOES typecheck
 * (`src/application/kernel/tableAdoption.test.ts`), and an untyped import there
 * would make the contract assertions `any`, which is how a pinned contract quietly
 * stops checking anything. Hand-written rather than generated: the module is small
 * and its shape is the contract.
 */

/** Lowest migration prefix belonging to the PRD 20 consolidation series. */
export const CONSOLIDATION_FROM_PREFIX: number;

/** table name → the migration file that creates it. */
export function collectCreatedTables(migrationsDir: string): Map<string, string>;

/** table name → the exported Drizzle identifier declaring it. */
export function collectTableExports(schemaDir: string): Map<string, string>;

export interface TableUsage {
  /** Non-test files importing the table's Drizzle export, repo-relative. */
  imports: string[];
  /** Non-test files naming the table in raw SQL, repo-relative. */
  rawSql: string[];
}

export interface TableAdoption {
  /** Every table the consolidation migrations create → its migration file. */
  created: Map<string, string>;
  /** Every table declared in the schema modules → its Drizzle export name. */
  exports: Map<string, string>;
  /** Created tables something reads or writes → where. */
  live: Map<string, TableUsage>;
  /** Created tables nothing reads or writes yet, sorted. */
  cold: string[];
  /** Created tables with no `pgTable` declaration at all, sorted. */
  missingExport: string[];
}

export function analyseTableAdoption(paths: {
  srcDir: string;
  migrationsDir: string;
  schemaDir: string;
}): TableAdoption;
