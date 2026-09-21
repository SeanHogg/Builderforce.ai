import { describe, it, expect } from 'vitest';

/**
 * The storage-pressure sweep can shorten retention without a human. What it may do at
 * each tier is therefore arithmetic that has to be pinned: the tier boundaries, the
 * interpolation toward each floor, and the rule that a window with no declared floor is
 * never touched. The database half is exercised by the maintenance sweeps' own tests.
 */
const { compressDays, compressedWindow } = await import('./retentionPurge');
const { DEFAULT_STORAGE_CEILING_BYTES, compressionPlan, storageCeilingBytes, tierFor } = await import('./storagePressure');
const { SWEPT_TABLES } = await import('./sweptTables');
import type { Env } from '../../env';

describe('tierFor', () => {
  it('maps a fill ratio to its tier and pressure', () => {
    expect(tierFor(0.5)).toEqual({ tier: 'ok', pressure: 0 });
    expect(tierFor(0.8)).toEqual({ tier: 'warn', pressure: 0.5 });
    expect(tierFor(0.9)).toEqual({ tier: 'critical', pressure: 1 });
    expect(tierFor(1.2)).toEqual({ tier: 'critical', pressure: 1 });
  });
});

describe('storageCeilingBytes', () => {
  /** Neon states the Free limit as 0.5 GB and meters more than pg_database_size sees, so
   *  the ceiling is the smaller, decimal figure — not 512 MiB. */
  it('defaults to the stated 0.5 GB and honours a valid override only', () => {
    expect(DEFAULT_STORAGE_CEILING_BYTES).toBe(500_000_000);
    expect(storageCeilingBytes({} as Env)).toBe(500_000_000);
    expect(storageCeilingBytes({ NEON_STORAGE_CEILING_BYTES: '10737418240' } as Env)).toBe(10_737_418_240);
    expect(storageCeilingBytes({ NEON_STORAGE_CEILING_BYTES: 'nope' } as Env)).toBe(500_000_000);
    expect(storageCeilingBytes({ NEON_STORAGE_CEILING_BYTES: '0' } as Env)).toBe(500_000_000);
  });
});

describe('compressDays', () => {
  it('interpolates toward the floor, never below it or one day', () => {
    expect(compressDays(30, 7, undefined)).toBe(30);
    expect(compressDays(30, 7, 0)).toBe(30);
    expect(compressDays(30, 7, 0.5)).toBe(19);
    expect(compressDays(30, 7, 1)).toBe(7);
    expect(compressDays(30, 7, 5)).toBe(7);
    expect(compressDays(7, 1, 1)).toBe(1);
    expect(compressDays(3, 0, 1)).toBe(1);
  });

  it('never compresses a window that declares no floor', () => {
    expect(compressDays(90, undefined, 1)).toBe(90);
  });
});

describe('compressionPlan', () => {
  /** The SOC 2 evidence window and the billing ledger declare no row floor on purpose. */
  it('leaves every floorless row window alone at full pressure', () => {
    const plan = compressionPlan(1);
    for (const table of SWEPT_TABLES.filter((t) => t.pressureFloorDays == null)) {
      expect(plan.some((w) => w.relation === table.relation && w.window === 'rows')).toBe(false);
    }
    for (const w of plan.filter((p) => p.window === 'rows')) {
      const table = SWEPT_TABLES.find((t) => t.relation === w.relation)!;
      expect(w.toDays).toBe(compressedWindow(table, 1));
      expect(w.toDays).toBeGreaterThanOrEqual(table.pressureFloorDays!);
    }
  });

  /**
   * The 2026-09-16 case: `llm_traces` was 209 MB of body text in rows under five days
   * old. Only compressing the PAYLOAD window reaches that, so the plan must include it.
   */
  it('compresses the llm_traces payload window to its one-day floor when critical', () => {
    const traces = compressionPlan(1).find((w) => w.relation === 'llm_traces' && w.window === 'payload');
    expect(traces).toEqual({ relation: 'llm_traces', window: 'payload', fromDays: 7, toDays: 1 });
  });

  it('shortens nothing at zero pressure', () => {
    expect(compressionPlan(0)).toEqual([]);
  });

  /** A payload blanked AFTER its row is gone is a dead knob — keep the ladder ordered. */
  it('keeps every declared payload floor inside its row window', () => {
    for (const table of SWEPT_TABLES) {
      if (!table.redact) continue;
      expect(table.redact.afterDays).toBeLessThan(table.retentionDays);
      if (table.redact.pressureFloorDays != null) {
        expect(table.redact.pressureFloorDays).toBeLessThanOrEqual(table.redact.afterDays);
      }
    }
  });
});
