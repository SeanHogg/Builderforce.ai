import { describe, expect, it } from 'vitest';
import { isUntested, UNTESTED_BELOW } from './coverageThreshold';

describe('isUntested', () => {
    it('draws the line at UNTESTED_BELOW, exclusive', () => {
        expect(UNTESTED_BELOW).toBe(0.5);
        expect(isUntested(0)).toBe(true);
        expect(isUntested(0.49)).toBe(true);
        expect(isUntested(0.5)).toBe(false);
        expect(isUntested(1)).toBe(false);
    });

    it('treats no reading as not untested', () => {
        expect(isUntested(undefined)).toBe(false);
    });
});
