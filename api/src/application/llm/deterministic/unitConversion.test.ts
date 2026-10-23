import { describe, expect, it } from 'vitest';
import { convertUnits, unitConversionHandler } from './unitConversion';

const now = new Date('2026-10-22T12:00:00Z');
const answer = (q: string) => unitConversionHandler.answer(q, now)?.content ?? null;

describe('convertUnits', () => {
  it('converts within a dimension', () => {
    expect(convertUnits(1, 'mile', 'km')?.value).toBeCloseTo(1.609344);
    expect(convertUnits(212, 'f', 'c')?.value).toBeCloseTo(100);
    expect(convertUnits(0, 'c', 'k')?.value).toBeCloseTo(273.15);
    expect(convertUnits(100, 'km/h', 'mph')?.value).toBeCloseTo(62.1371, 3);
  });

  it('refuses mismatched, unknown, identical or unphysical conversions', () => {
    expect(convertUnits(1, 'km', 'kg')).toBeNull();
    expect(convertUnits(1, 'ton', 'kg')).toBeNull();
    expect(convertUnits(1, 'gb', 'mb')).toBeNull();
    expect(convertUnits(1, 'month', 'days')).toBeNull();
    expect(convertUnits(1, 'km', 'kilometers')).toBeNull();
    expect(convertUnits(-500, 'c', 'f')).toBeNull();
    expect(convertUnits(-3, 'km', 'miles')).toBeNull();
  });
});

describe('unitConversionHandler', () => {
  it('answers the common phrasings', () => {
    expect(answer('Convert 5 km to miles')).toBe('5 kilometers = 3.10686 miles');
    expect(answer('what is 72 °F in celsius?')).toBe('72 degrees Fahrenheit = 22.2222 degrees Celsius');
    expect(answer('how many feet in 3 miles')).toBe('3 miles = 15840 feet');
    expect(answer('how many days are in a week')).toBe('1 week = 7 days');
    expect(answer('2 gallons to liters')).toBe('2 US gallons = 7.57082 liters');
  });

  it('does not answer questions it cannot be sure of', () => {
    for (const q of [
      'how many people are in 3 teams',
      'convert 5 tons to kg',
      'convert 2 GB to MB',
      'what is 3 months in days',
      'convert this function to typescript',
      'how many km to the moon',
      'translate 5 km to miles into french and explain',
    ]) {
      expect(answer(q), q).toBeNull();
    }
  });
});
