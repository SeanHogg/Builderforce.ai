import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUND_INSTRUMENTS, ROUND_STATUSES, ROUND_TYPES } from './fundingRounds';

const repo = resolve(__dirname, '..', '..', '..', '..');

/**
 * The one property this module exists to protect, asserted against the schema and
 * the migration themselves rather than against a mock.
 *
 * `funding_rounds.amount_raised` was a STORED TOTAL: a column saying how much a
 * round had raised, sitting beside `deals` rows that say the same thing and can
 * disagree with it. Migration 0937 dropped it and the raise projection derives the
 * figure. If somebody adds it back — or adds a `committed`, a `total_closed`, any
 * sibling of it — this fails, which is the only way a rule like that survives
 * contact with a schema six months from now.
 */
describe('the round header holds a PLAN and never a total', () => {
  const schema = readFileSync(resolve(repo, 'api/src/infrastructure/database/schema/finance.ts'), 'utf8');
  /** The declaration with its PROSE stripped. The comments deliberately name the
   *  column that was dropped and say why — an assertion that read them would fail
   *  on the very explanation it exists to preserve. */
  const declaration = schema
    .slice(
      schema.indexOf("export const fundingRounds = pgTable('funding_rounds'"),
      schema.indexOf('export const', schema.indexOf("pgTable('funding_rounds'") + 40),
    )
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('declares the plan the canvas card had nowhere to store', () => {
    for (const column of ['round_type', 'target_amount', 'close_target_at', 'pre_money', 'post_money']) {
      expect(declaration, column).toContain(column);
    }
  });

  it('declares NO column that restates what the allocations already say', () => {
    // A valuation is negotiated and stays. A raised total is arithmetic and goes.
    for (const banned of ['amount_raised', 'total_raised', 'committed_amount', 'closed_amount']) {
      expect(declaration, banned).not.toContain(banned);
    }
  });

  it('drops the old column in a migration rather than only in the schema', () => {
    // Schema drift in the safe direction is still drift: a column the code stops
    // declaring but the database keeps is one a future query can still read.
    const migration = readFileSync(resolve(repo, 'api/migrations/0937_funding_round_record_and_data_room_files.sql'), 'utf8');
    expect(migration).toContain('DROP COLUMN IF EXISTS amount_raised');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS round_type');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS target_amount');
  });
});

describe('the round vocabularies', () => {
  it('offers the canvas card its own round types', () => {
    // The `fundingRound` spec's hint names these; a divergence would mean a value
    // the card offers and the record refuses.
    const founderObjects = readFileSync(resolve(repo, 'frontend/src/lib/founderObjects.ts'), 'utf8');
    const at = founderObjects.indexOf("name: 'roundType'");
    expect(at, 'the fundingRound spec no longer declares roundType — re-point this contract rather than deleting it').toBeGreaterThan(0);
    const hint = founderObjects.slice(at, at + 400);
    for (const type of ROUND_TYPES) expect(hint, type).toContain(type);
  });

  it('keeps the instrument distinct from the round name', () => {
    // A "seed" can be a SAFE: what the round is called and what the money buys are
    // different questions, which is why they are two columns and two vocabularies.
    expect([...ROUND_INSTRUMENTS]).toContain('safe');
    expect([...ROUND_TYPES]).toContain('seed');
    expect((ROUND_INSTRUMENTS as readonly string[]).includes('series-a')).toBe(false);
  });

  it('has exactly one terminal status for money and one for giving up', () => {
    expect([...ROUND_STATUSES]).toEqual(['open', 'closed', 'abandoned']);
  });
});
