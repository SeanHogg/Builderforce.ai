/** Helper tests across isGreenStatus, ScoreDisplay, and formatScore (test coverage). */

import { isGreenStatus, getGreenStatusDisplay, type ScoreDisplay } from '@/types/status';

describe('isGreenStatus helper', () => {
  it('returns true when score = 75 (lower boundary inclusive)', () => {
    expect(isGreenStatus(75)).toBe(true);
  });

  it('returns true when score = 100 (upper boundary inclusive)', () => {
    expect(isGreenStatus(100)).toBe(true);
  });

  it('returns true when score = 87.5 (mid-range)', () => {
    expect(isGreenStatus(87.5)).toBe(true);
  });

  it('returns false when score = 74.9 (just below lower boundary)', () => {
    expect(isGreenStatus(74.9)).toBe(false);
  });

  it('returns false when score = 100.1 (just above upper boundary)', () => {
    expect(isGreenStatus(100.1)).toBe(false);
  });

  it('returns false when score is null', () => {
    expect(isGreenStatus(null)).toBe(false);
  });

  it('returns false when score is undefined', () => {
    expect(isGreenStatus(undefined)).toBe(false);
  });

  it('returns false when score < 0 (invalid negative)', () => {
    expect(isGreenStatus(-5)).toBe(false);
  });
});

describe('getGreenStatusDisplay helper', () => {
  it('returns isGreen = true and canonical outputs for score = 75', () => {
    const result: ScoreDisplay = getGreenStatusDisplay(75);
    expect(result.isGreen).toBe(true);
    expect(result.display.status).toBe('green');
    expect(result.display.label).toBe('On Track');
    expect(result.display.ariaLabel).toBe('Status: Green, On Track');
    expect(result.formattedScore).toBe('75');
  });

  it('returns isGreen = true and canonical outputs for score = 100', () => {
    const result: ScoreDisplay = getGreenStatusDisplay(100);
    expect(result.isGreen).toBe(true);
    expect(result.display.status).toBe('green');
    expect(result.display.label).toBe('On Track');
    expect(result.display.ariaLabel).toBe('Status: Green, On Track');
    expect(result.formattedScore).toBe('100');
  });

  it('returns isGreen = true and canonical outputs for score = 87.5', () => {
    const result: ScoreDisplay = getGreenStatusDisplay(87.5);
    expect(result.isGreen).toBe(true);
    expect(result.display.status).toBe('green');
    expect(result.display.label).toBe('On Track');
    expect(result.display.ariaLabel).toBe('Status: Green, On Track');
    expect(result.formattedScore).toBe('87.5');
  });

  it('returns isGreen = false and no formattedScore for null', () => {
    const result: ScoreDisplay = getGreenStatusDisplay(null);
    expect(result.isGreen).toBe(false);
    expect(result.display.status).toBe('green');
    expect(result.display.label).toBe('On Track');
    expect(result.display.ariaLabel).toBe('Status: Green, On Track');
    expect(result.formattedScore).toBeUndefined();
  });
});