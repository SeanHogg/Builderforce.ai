/**
 * Unit Tests for Red Alert Threshold Utilities
 * 
 * Tests FR-1 to FR-4 and AC-1 to AC-4 (threshold evaluation, null handling)
 */

import { describe, it, expect } from '@jest/globals';
import {
  classifyMetric,
  MetricSeverity,
  MetricResult,
  getDefaultThresholdForMetricType,
  validateThresholdConfig,
  ThresholdConfig,
} from './redAlertUtils';

describe('Red Alert Threshold Utilities', () => {
  describe('classifyMetric - Critical Tier (FR-1)', () => {
    it('AC-1: value of 0 is classified as RED', () => {
      const result: MetricResult = classifyMetric(0);
      expect(result.value).toBe(0);
      expect(result.severity).toBe('critical');
      expect(result.isRed).toBe(true);
      expect(result.isNoData).toBe(false);
      expect(result.label).toBe('Critical');
      expect(result.color).toBe('#D32F2F');
    });

    it('AC-2: value of 49 is classified as RED', () => {
      const result: MetricResult = classifyMetric(49);
      expect(result.value).toBe(49);
      expect(result.severity).toBe('critical');
      expect(result.isRed).toBe(true);
      expect(result.isNoData).toBe(false);
      expect(result.label).toBe('Critical');
      expect(result.color).toBe('#D32F2F');
    });

    it('AC-3: value of 50 is NOT classified as RED', () => {
      const result: MetricResult = classifyMetric(50);
      expect(result.value).toBe(50);
      expect(result.severity).toBe('normal');
      expect(result.isRed).toBe(false);
      expect(result.isNoData).toBe(false);
    });

    it('negative values are excluded from Red classification when allowNegative=false (default)', () => {
      const result: MetricResult = classifyMetric(-5);
      expect(result.isNoData).toBe(true);
      expect(result.label).toBe('No Data');
    });

    it('null values are classified as "No Data"', () => {
      const result: MetricResult = classifyMetric(null);
      expect(result.isNoData).toBe(true);
      expect(result.label).toBe('No Data');
    });

    it('undefined values are classified as "No Data"', () => {
      const result: MetricResult = classifyMetric(undefined);
      expect(result.isNoData).toBe(true);
      expect(result.label).toBe('No Data');
    });

    it('empty string values are classified as "No Data"', () => {
      const result: MetricResult = classifyMetric('');
      expect(result.isNoData).toBe(true);
      expect(result.label).toBe('No Data');
    });

    it('NaN values are classified as "No Data"', () => {
      const result: MetricResult = classifyMetric(NaN);
      expect(result.isNoData).toBe(true);
      expect(result.label).toBe('No Data');
    });

    it('non-numeric string values are classified as "No Data"', () => {
      const result: MetricResult = classifyMetric('invalid' as any);
      expect(result.isNoData).toBe(true);
      expect(result.label).toBe('No Data');
    });

    it('custom critical label is used when provided', () => {
      const customLabel = 'Warning';
      const result: MetricResult = classifyMetric(0, {
        criticalLabel: customLabel,
      });
      expect(result.label).toBe(customLabel);
    });

    it('allows negative values when allowNegative=true', () => {
      const result: MetricResult = classifyMetric(-10, {
        allowNegative: true,
      });
      expect(result.value).toBe(-10);
      expect(result.isRed).toBe(true); // -10 ≤ 49
    });

    it('custom threshold configuration', () => {
      const result: MetricResult = classifyMetric(35, {
        redUpperThreshold: 40,
        allowNegative: false,
      });
      expect(result.isRed).toBe(true); // 35 ≤ 40
    });
  });

  describe('getDefaultThresholdForMetricType', () => {
    it('returns default thresholds for unknown metric types', () => {
      const config = getDefaultThresholdForMetricType('unknown-metric');
      expect(config.redUpperThreshold).toBe(49);
      expect(config.criticalLabel).toBe('Critical');
    });

    it('returns custom thresholds for known metric types', () => {
      const config = getDefaultThresholdForMetricType('quality-score');
      expect(config.redUpperThreshold).toBe(49);
    });

    it('returns custom thresholds for bug rate metrics', () => {
      const config = getDefaultThresholdForMetricType('Bug Rate');
      expect(config.redUpperThreshold).toBe(4.9);
    });

    it('returns custom thresholds for coverage metrics', () => {
      const config = getDefaultThresholdForMetricType('Coverage');
      expect(config.redUpperThreshold).toBe(49);
    });
  });

  describe('validateThresholdConfig', () => {
    it('validates correct threshold configuration', () => {
      const result = validateThresholdConfig({
        redUpperThreshold: 49,
        dataFloor: 0,
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('rejects non-numeric redUpperThreshold', () => {
      const result = validateThresholdConfig({
        redUpperThreshold: '49' as any,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('redUpperThreshold must be a number');
    });

    it('rejects redUpperThreshold out of valid range (1-99)', () => {
      const result = validateThresholdConfig({
        redUpperThreshold: 100,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('redUpperThreshold must be between 1 and 99');
    });

    it('rejects redUpperThreshold less than 1', () => {
      const result = validateThresholdConfig({
        redUpperThreshold: 0,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('redUpperThreshold must be between 1 and 99');
    });

    it('validates negative dataFloor is rejected', () => {
      const result = validateThresholdConfig({
        dataFloor: -5,
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('dataFloor cannot be negative');
    });
  });

  describe('Integration: Metric transitions', () => {
    it('detects transition from normal to critical', () => {
      const normalResult = classifyMetric(60);
      const criticalResult = classifyMetric(35);
      
      expect(normalResult.isRed).toBe(false);
      expect(criticalResult.isRed).toBe(true);
    });

    it('detects transition from critical to normal (value increases)', () => {
      const criticalResult = classifyMetric(20);
      const normalResult = classifyMetric(75);
      
      expect(criticalResult.isRed).toBe(true);
      expect(normalResult.isRed).toBe(false);
    });

    it('tracks value correctly across classification calls', () => {
      const value = 42;
      const result = classifyMetric(value);
      
      expect(result.value).toBe(value);
      expect(result.isRed).toBe(true);
    });
  });
});