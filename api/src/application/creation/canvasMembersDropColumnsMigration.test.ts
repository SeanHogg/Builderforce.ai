import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const repo = resolve(__dirname, '..', '..', '..', '..');
/** Reading throws if the migration is missing, so these assertions never silently skip. */
const contract = readFileSync(resolve(repo, 'api/migrations', '1273_canvas_members_drop_access_columns.sql'), 'utf8')
  .replace(/--[^\n]*/g, ''); // assert on SQL, not on the prose describing it

/**
 * 1273 is the contract step for the canvas-members fold (1264 expand, 1270 catch-up):
 * it only drops the legacy access columns. The membership catch-up is 1270's job and
 * must not run again here, where "no presence row" no longer means "removed".
 */
describe('1273 — creation_session_members drops its legacy access columns', () => {
  /** The single ALTER TABLE statement on the presence table (up to its terminating `;`). */
  const alter = contract.match(/ALTER\s+TABLE\s+creation_session_members\b[^;]*;/i)?.[0] ?? '';

  it('drops the columns in one ALTER TABLE on creation_session_members', () => {
    expect(alter).toMatch(/DROP\s+COLUMN\s+IF\s+EXISTS/i);
  });

  // Postgres takes one `DROP COLUMN IF EXISTS <col>` action per column, comma-separated.
  it.each(['role', 'invited_by', 'pinned', 'watch_state', 'joined_at'])('drops %s with IF EXISTS', (column) => {
    expect(alter).toMatch(new RegExp(String.raw`DROP\s+COLUMN\s+IF\s+EXISTS\s+${column}\b`, 'i'));
  });

  it('does not re-run 1270 step 1b (no writes to memberships)', () => {
    expect(contract).not.toMatch(/UPDATE\s+memberships/i);
  });
});
