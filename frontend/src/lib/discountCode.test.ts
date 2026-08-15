// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DISCOUNT_CODE_STORAGE_KEY,
  getRetainedDiscountCode,
  normalizeDiscountCode,
  retainDiscountCode,
} from './discountCode';

describe('discount-code retention', () => {
  beforeEach(() => localStorage.clear());

  it('normalizes and retains a code across pages', () => {
    retainDiscountCode(' annual50 ');
    expect(localStorage.getItem(DISCOUNT_CODE_STORAGE_KEY)).toBe('ANNUAL50');
    expect(getRetainedDiscountCode()).toBe('ANNUAL50');
  });

  it('clears a retained code when the user empties the field', () => {
    retainDiscountCode('ANNUAL50');
    retainDiscountCode('  ');
    expect(getRetainedDiscountCode()).toBe('');
  });

  it('normalizes codes consistently with the API', () => {
    expect(normalizeDiscountCode(' launch-50 ')).toBe('LAUNCH-50');
  });
});
