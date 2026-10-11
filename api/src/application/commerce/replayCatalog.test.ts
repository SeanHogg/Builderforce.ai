import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REPLAY_CATALOG_BODY,
  freeMonthlyFromCatalogBody,
  packsFromCatalogBody,
  replayCheckoutIdempotencyKey,
  replayCreditExpiresAt,
  replayPack,
  replayPeriod,
  REPLAY_FREE_MONTHLY_UNITS,
  REPLAY_PACKS,
  REPLAY_RECORDINGS_DENOMINATION,
  REPLAY_UNIT_BYTES,
  SESSION_REPLAY_ADDON,
  SESSION_REPLAY_SLUG,
  unitsForBytes,
} from './replayCatalog';

describe('replayCatalog', () => {
  it('publishes the D4 ladder (units and cents)', () => {
    expect(REPLAY_PACKS.map((p) => [p.id, p.units, p.cents])).toEqual([
      ['p10k', 10_000, 4_000],
      ['p50k', 50_000, 14_000],
      ['p150k', 150_000, 24_000],
      ['p500k', 500_000, 65_000],
      ['p1m', 1_000_000, 120_000],
    ]);
    expect(SESSION_REPLAY_SLUG).toBe('session-replay');
    expect(SESSION_REPLAY_ADDON).toBe('session_replay');
    expect(REPLAY_FREE_MONTHLY_UNITS).toBe(5_000);
    expect(REPLAY_UNIT_BYTES).toBe(2_097_152);
    expect(REPLAY_RECORDINGS_DENOMINATION).toBe('replay_recordings');
    expect(DEFAULT_REPLAY_CATALOG_BODY.packs).toEqual([...REPLAY_PACKS]);
  });

  it('looks a pack up by id and refuses unknown ids', () => {
    expect(replayPack('p10k')?.cents).toBe(4_000);
    expect(replayPack('nope')).toBeNull();
  });

  it('charges ceil(bytes / 2MiB) units, never less than one', () => {
    expect(unitsForBytes(0)).toBe(1);
    expect(unitsForBytes(-4)).toBe(1);
    expect(unitsForBytes(1)).toBe(1);
    expect(unitsForBytes(REPLAY_UNIT_BYTES)).toBe(1);
    expect(unitsForBytes(REPLAY_UNIT_BYTES + 1)).toBe(2);
    expect(unitsForBytes(REPLAY_UNIT_BYTES * 3)).toBe(3);
  });

  it('keys the free allowance on the UTC calendar month', () => {
    expect(replayPeriod(new Date('2026-04-11T23:00:00Z'))).toBe('2026-04');
    expect(replayPeriod(new Date('2026-12-01T00:00:00Z'))).toBe('2026-12');
  });

  it('expires credits twelve UTC months after the grant', () => {
    const granted = new Date('2026-01-31T12:00:00Z');
    expect(replayCreditExpiresAt(granted).toISOString()).toBe('2027-01-31T12:00:00.000Z');
  });

  it('stamps checkout idempotency as tenant:pack:yyyy-mm-dd-hh UTC', () => {
    expect(replayCheckoutIdempotencyKey(7, 'p10k', new Date('2026-04-11T15:42:00Z')))
      .toBe('replay-pack:7:p10k:2026-04-11-15');
  });

  it('parses catalog body packs and ignores malformed rows', () => {
    expect(packsFromCatalogBody(null)).toBeNull();
    expect(packsFromCatalogBody({ packs: [] })).toBeNull();
    expect(packsFromCatalogBody({ packs: [{ id: 'p10k', units: 10_000, cents: 4_000 }, { id: 'bad' }] }))
      .toEqual([{ id: 'p10k', units: 10_000, cents: 4_000 }]);
    expect(freeMonthlyFromCatalogBody({ freeMonthlyUnits: 9_000 })).toBe(9_000);
    expect(freeMonthlyFromCatalogBody({})).toBe(REPLAY_FREE_MONTHLY_UNITS);
  });
});
