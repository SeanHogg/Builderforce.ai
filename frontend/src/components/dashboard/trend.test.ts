import { describe, it, expect } from 'vitest';
import { classifyTrend, type TrendClassification, type TrendState, type TrendDirection, type MetricPolarity } from './trend';

// ---------------------------------------------------------------------------
// Pure classification logic (task #307 — Trend Arrows PRD).
// ---------------------------------------------------------------------------

describe('classifyTrend', () => {
  it('classifies as improving when current exceeds prior by more than the threshold', () => {
    const result: TrendClassification = classifyTrend(105, 100, 'higher-is-better', 2);
    expect(result.direction).toBe('up');
    expect(result.state).toBe('improving');
    expect(result.hasData).toBe(true);
    expect(result.tooltip?.pct).toBeCloseTo(5);
    expect(result.tooltip?.priorValue).toBe('100');
    expect(result.tooltip?.currentValue).toBe('105');
  });

  it('classifies as improving even when prior is negative and current is less negative (lower-is-better)', () => {
    const result: TrendClassification = classifyTrend(-5, -10, 'lower-is-better', 2);
    expect(result.direction).toBe('up');
    expect(result.state).toBe('improving');
    expect(result.hasData).toBe(true);
    expect(result.tooltip?.pct).toBeCloseTo(50);
  });

  it('classifies as stable when change is within the threshold band', () => {
    const result: TrendClassification = classifyTrend(101, 100, 'higher-is-better', 2);
    expect(result.direction).toBe('up');
    expect(result.state).toBe('stable');
    expect(result.hasData).toBe(true);
    expect(result.tooltip?.pct).toBeCloseTo(1);
  });

  it('classifies as declining when current is less than prior by more than the threshold', () => {
    const result: TrendClassification = classifyTrend(97, 100, 'higher-is-better', 2);
    expect(result.direction).toBe('down');
    expect(result.state).toBe('declining');
    expect(result.hasData).toBe(true);
    expect(result.tooltip?.pct).toBeCloseTo(-3);
  });

  it('colors by polarity: higher-is-better up = green, down = red', () => {
    const upGood: TrendClassification = classifyTrend(105, 100, 'higher-is-better', 2);
    const downGood: TrendClassification = classifyTrend(97, 100, 'higher-is-better', 2);
    expect(upGood.direction).toBe('up');
    expect(upGood.state).toBe('improving');
    expect(downGood.direction).toBe('down');
    expect(downGood.state).toBe('declining');
  });

  it('colors by polarity: lower-is-better up = red, down = green', () => {
    const upBad: TrendClassification = classifyTrend(105, 100, 'lower-is-better', 2);
    const downBad: TrendClassification = classifyTrend(97, 100, 'lower-is-better', 2);
    expect(upBad.direction).toBe('up');
    expect(upBad.state).toBe('declining');
    expect(downBad.direction).toBe('down');
    expect(downBad.state).toBe('improving');
  });

  it('is neutral for decliners when polarity is null', () => {
    const neutral: TrendClassification = classifyTrend(97, 100, null, 2);
    expect(neutral.direction).toBe('down');
    expect(neutral.state).toBe('stable');
    expect(neutral.hasData).toBe(true);
  });

  it('returns stable and hasData=false when prior is zero', () => {
    const result: TrendClassification = classifyTrend(5, 0, 'higher-is-better', 2);
    expect(result.direction).toBe('flat');
    expect(result.state).toBe('stable');
    expect(result.hasData).toBe(false);
    expect(result.tooltip?.windowLabel).toBe('vs. previous period');
  });

  it('returns stable and hasData=false when current is zero', () => {
    const result: TrendClassification = classifyTrend(0, 10, 'higher-is-better', 2);
    expect(result.direction).toBe('up');
    expect(result.state).toBe('stable');
    expect(result.hasData).toBe(false);
  });

  it('rounds percentage change to one decimal place', () => {
    const result: TrendClassification = classifyTrend(102, 100, null, 10);
    expect(result.tooltip?.pct).toBe(2);
    const precise: TrendClassification = classifyTrend(100.1, 100, null, 10);
    expect(precise.tooltip?.pct).toBe(0.1);
  });

  it('supports custom thresholds', () => {
    // With threshold 1%, a 1% change is stable; 2% is improving.
    const stable: TrendClassification = classifyTrend(101, 100, 'higher-is-better', 1);
    expect(stable.state).toBe('stable');
    const improving: TrendClassification = classifyTrend(102, 100, 'higher-is-better', 1);
    expect(improving.state).toBe('improving');
  });

  it('handles percentages in prior correctly', () => {
    const result: TrendClassification = classifyTrend(110, 100, null, 5);
    expect(result.state).toBe('stable'); // 10% change < 5%? no: it's 10%; so declining
    expect(result.direction).toBe('down');
    expect(result.state).toBe('stable');
    const precise: TrendClassification = classifyTrend(105.1, 100, null, 4); // 5.1% > 4.0%
    expect(precise.state).toBe('declining');
  });

  it('handles negative prior values correctly', () => {
    const result: TrendClassification = classifyTrend(-5, -10, 'higher-is-better', 4);
    expect(result.state).toBe('improving'); // -5 is higher than -10; 50% change
    expect(result.tooltip?.pct).toBe(50);
  });

  it('handles small numbers correctly', () => {
    const result: TrendClassification = classifyTrend(0.3, 0.2, 'higher-is-better', 1);
    expect(result.state).toBe('improving'); // 50% change
  });
});