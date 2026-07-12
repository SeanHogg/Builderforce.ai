/**
 * CSV Export Tests for Red Alert System (AC-10)
 * 
 * Tests: CSV exports include "Critical" in the severity column for Red-tier rows
 */

import { describe, it, expect } from '@jest/globals';
import { generateCSVExport, generateCSVRow, generatePDFTemplate, MetricExportRow, MetricSeverity } from './redAlertExports';

describe('CSV Export for Red Alert Threshold System', () => {
  describe('AC-10: CSV export includes Critical severity column', () => {
    it('includes severity column in CSV header', () => {
      const metrics: MetricExportRow[] = [
        { name: 'Metric A', value: 50, severity: 'normal' },
        { name: 'Metric B', value: 20, severity: 'critical' },
        { name: 'Metric C', value: null, severity: 'No Data' },
      ];

      const csv = generateCSVExport(metrics);

      expect(csv).toContain('Severity');
      expect(csv).toContain('Metric Name');
      expect(csv).toContain('Value');
    });

    it('populates "Critical" in severity column for Red-tier rows', () => {
      const metrics: MetricExportRow[] = [
        { name: 'Quality Score', value: 0, severity: 'critical' },
        { name: 'Test Coverage', value: 49, severity: 'critical' },
        { name: 'Bug Rate', value: 4.5, severity: 'critical' },
      ];

      const csv = generateCSVExport(metrics);

      expect(csv).toContain('Quality Score,0,Critical');
      expect(csv).toContain('Test Coverage,49,Critical');
      expect(csv).toContain('Bug Rate,4.5,Critical');
    });

    it('populates "No Data" for null values', () => {
      const metrics: MetricExportRow[] = [
        { name: 'New Metric', value: 75, severity: 'normal' },
        { name: 'Missing Data', value: null, severity: 'No Data' },
        { name: 'Invalid Value', value: undefined, severity: 'No Data' },
      ];

      const csv = generateCSVExport(metrics);

      expect(csv).toContain('Missing Data,,No Data');
      expect(csv).toContain('Invalid Value,,No Data');
    });

    it('populates "Normal" for values above Red threshold', () => {
      const metrics: MetricExportRow[] = [
        { name: 'Healthy Metric', value: 75, severity: 'normal' },
        { name: 'Good Metric', value: 50, severity: 'normal' },
      ];

      const csv = generateCSVExport(metrics);

      expect(csv).toContain('Healthy Metric,75,Normal');
      expect(csv).toContain('Good Metric,50,Normal');
    });

    it('handles decimal values correctly in CSV', () => {
      const metrics: MetricExportRow[] = [
        { name: 'Error Rate', value: 32.5, severity: 'critical' },
        { name: 'Success Rate', value: 85.3, severity: 'normal' },
      ];

      const csv = generateCSVExport(metrics);

      expect(csv).toContain('Error Rate,32.5,Critical');
      expect(csv).toContain('Success Rate,85.3,Normal');
    });

    it('includes header row in CSV export', () => {
      const csv = generateCSVExport([
        { name: 'Metric A', value: 20, severity: 'critical' },
        { name: 'Metric B', value: 75, severity: 'normal' }
      ]);

      const lines = csv.split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('Metric Name,Value,Severity');
      expect(lines[1]).toBe('Metric A,20,Critical');
      expect(lines[2]).toBe('Metric B,75,Normal');
    });
  });
});