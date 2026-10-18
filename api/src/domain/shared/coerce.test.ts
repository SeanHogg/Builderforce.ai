import { describe, expect, it } from 'vitest';
import { num, rowId, str, whenOrNull, whenOrUndefined, whenPatch } from './coerce';
import { ValidationError } from './errors';

describe('coerce', () => {
  it('str / num keep only their own type', () => {
    expect(str('a')).toBe('a');
    expect(str(1)).toBeUndefined();
    expect(num(2)).toBe(2);
    expect(num(NaN)).toBeUndefined();
    expect(num('2')).toBeUndefined();
  });

  it('rowId floors a positive id and refuses the rest with a 400-class error', () => {
    expect(rowId('7')).toBe(7);
    expect(() => rowId('0')).toThrow(ValidationError);
    expect(() => rowId('x')).toThrow('That is not an id.');
  });

  it('date coercers differ only in what "absent" means', () => {
    expect(whenOrUndefined('')).toBeUndefined();
    expect(whenOrNull(undefined)).toBeNull();
    expect(whenPatch(null)).toBeNull();
    expect(whenPatch(undefined)).toBeUndefined();
    expect(whenPatch('2026-01-02')?.toISOString().startsWith('2026-01-02')).toBe(true);
    expect(() => whenOrNull('nope')).toThrow('That is not a date.');
  });
});
