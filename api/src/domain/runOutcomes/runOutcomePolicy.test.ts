import { describe, expect, it } from 'vitest';
import { crossTenantConsent, crossTenantConsentDefault, labelPrecedenceOf, labelSupersedes } from './runOutcomePolicy';

const at = (iso: string) => new Date(iso);

describe('labelSupersedes', () => {
  const censoredOld = { status: 'censored' as const, computedAt: at('2026-10-01T00:00:00Z') };
  const censoredNew = { status: 'censored' as const, computedAt: at('2026-10-05T00:00:00Z') };
  const finalOld = { status: 'final' as const, computedAt: at('2026-09-01T00:00:00Z') };
  const finalNew = { status: 'final' as const, computedAt: at('2026-10-09T00:00:00Z') };

  it('writes a label that has no row yet', () => {
    expect(labelSupersedes(undefined, censoredOld)).toBe(true);
  });

  it('lets the newer computedAt win between rows of the same status', () => {
    expect(labelSupersedes(censoredOld, censoredNew)).toBe(true);
    expect(labelSupersedes(censoredNew, censoredOld)).toBe(false);
    expect(labelSupersedes(finalOld, finalNew)).toBe(true);
  });

  it('keeps the stored row on a tie (a replay is a no-op)', () => {
    expect(labelSupersedes(censoredOld, { ...censoredOld })).toBe(false);
  });

  it('never replaces a final label with a censored one, however new', () => {
    expect(labelSupersedes(finalOld, censoredNew)).toBe(false);
  });

  it('replaces a censored label with a final one, even an older one', () => {
    expect(labelSupersedes(censoredNew, finalOld)).toBe(true);
  });
});

describe('labelSupersedes over stored rows (labelPrecedenceOf) — an observed event is never erased', () => {
  const row = (over: Partial<{ status: string; computedAt: Date; value: boolean | null; eventAt: Date | null }>) => labelPrecedenceOf({
    status: 'censored', computedAt: at('2026-10-01T00:00:00Z'), value: null, eventAt: null, ...over,
  });
  const storedTrue = row({ value: true, eventAt: at('2026-09-30T00:00:00Z') });

  it('carries the stored event time as ISO text and omits an absent one', () => {
    expect(storedTrue).toEqual({ status: 'censored', computedAt: at('2026-10-01T00:00:00Z'), value: true, eventAt: '2026-09-30T00:00:00.000Z' });
    expect(row({})).not.toHaveProperty('eventAt');
  });

  it('regression: a newer censored null never replaces a stored censored true', () => {
    expect(labelSupersedes(storedTrue, row({ computedAt: at('2026-10-05T00:00:00Z') }))).toBe(false);
  });

  it('regression: a newer final false never replaces a stored final true', () => {
    const finalTrue = row({ status: 'final', value: true, eventAt: at('2026-09-30T00:00:00Z') });
    expect(labelSupersedes(finalTrue, row({ status: 'final', value: false, computedAt: at('2026-10-09T00:00:00Z') }))).toBe(false);
  });

  it('a final label still closes a censored true (the writer keeps the stored event)', () => {
    expect(labelSupersedes(storedTrue, row({ status: 'final', value: false, computedAt: at('2026-10-09T00:00:00Z') }))).toBe(true);
  });
});

describe('cross-tenant training consent (§12.8)', () => {
  it('defaults ON for the free plan and OFF for every paid plan', () => {
    expect(crossTenantConsentDefault('free')).toBe(true);
    expect(crossTenantConsentDefault('pro')).toBe(false);
    expect(crossTenantConsentDefault('teams')).toBe(false);
  });

  it('defaults OFF for an unknown or missing plan', () => {
    expect(crossTenantConsentDefault(null)).toBe(false);
    expect(crossTenantConsentDefault('enterprise')).toBe(false);
  });

  it('lets an explicit decision override the plan default either way', () => {
    expect(crossTenantConsent(false, 'free')).toBe(false);
    expect(crossTenantConsent(true, 'teams')).toBe(true);
    expect(crossTenantConsent(undefined, 'free')).toBe(true);
  });
});
