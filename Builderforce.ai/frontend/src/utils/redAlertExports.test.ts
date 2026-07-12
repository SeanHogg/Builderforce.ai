/**
 * Unit Tests for Red Alert Export Utilities
 * 
 * Tests: CSV format with Critical annotations (AC-10) and PDF color preservation (AC-5)
 */

import { describe, it, expect } from '@jest/globals';
import {
  generateCSVExport,
  generatePDFTemplate,
  MetricExportRow,
  generateCSVRow,
  getExportSeverityLabel,
  triggerExportWebhook,
  shouldHighlightInExport,
} from './redAlertExports';

describe('CSV Export for Red Alert System', () => {
  describe('AC-10: CSV export includes Critical severity column', () => {
    const metrics: MetricExportRow[] = [
      { name: 'Quality Score', value: 0, severity: 'critical' },
      { name: 'Test Coverage', value: 49, severity: 'critical' },
      { name: 'Bug Rate', value: 4.5, severity: 'critical' },
      { name: 'Healthy Metric', value: 75, severity: 'normal' },
      { name: 'Good Metric', value: 50, severity: 'normal' },
      { name: 'No Data Metric', value: null, severity: 'No Data' },
    ];

    it('includes header row with all columns', () => {
      const csv = generateCSVExport(metrics, { format: 'csv' });
      const lines = csv.split('\n');
      
      expect(lines[0]).toContain('Metric Name');
      expect(lines[0]).toContain('Value');
      expect(lines[0]).toContain('Severity');
    });

    it('populates "Critical" in severity column for Red-tier rows', () => {
      const csv = generateCSVExport(metrics, { format: 'csv' });
      
      // All Critical entries should have "Critical" in the severity column
      expect(csv).toContain('Critical');
      expect(csv).toContain('Quality Score');
      expect(csv).toContain('Test Coverage');
      expect(csv).toContain('Bug Rate');
      
      // Normal entries should not have "Critical"
      expect(csv).not.toContain('Healthy Metric,Critical');
      expect(csv).not.toContain('Good Metric,Critical');
    });

    it('handles null values as "No Data"', () => {
      const metricsWithNull: MetricExportRow[] = [
        { name: 'Metric With Data', value: 25, severity: 'critical' },
        { name: 'Metric With Null', value: null, severity: 'No Data' },
      ];
      
      const csv = generateCSVExport(metricsWithNull, { format: 'csv' });
      
      expect(csv).toContain('Metric With Data,25,Critical');
      expect(csv).toContain('Metric With Null,,No Data');
      expect(csv).toContain('No Data'); // Column header
    });

    it('handles decimal values correctly', () => {
      const metricsWithDecimals: MetricExportRow[] = [
        { name: 'Error Rate', value: 32.5, severity: 'critical' },
        { name: 'Throughput', value: 85.75, severity: 'normal' },
      ];
      
      const csv = generateCSVExport(metricsWithDecimals, { format: 'csv' });
      
      expect(csv).toContain('Error Rate,32.5,Critical');
      expect(csv).toContain('Throughput,85.75,Normal');
    });

    it('handles custom headers', () => {
      const csv = generateCSVExport(metrics, {
        format: 'csv',
        headers: ['Timestamp', 'GeneratedBy'],
      });
      
      expect(csv).toContain('Timestamp');
      expect(csv).toContain('GeneratedBy');
    });

    it('can exclude columns via options', () => {
      const csv = generateCSVExport(metrics, {
        format: 'csv',
        includeName: false,
        includeSeverity: false,
      });
      
      const lines = csv.split('\n');
      expect(lines[0]).not.toContain('Metric Name');
      expect(lines[0]).not.toContain('Severity');
      expect(lines[0]).toContain('Value');
    });
  });

  describe('Row-level CSV generation', () => {
    it('generates correct CSV row for Critical metric', () => {
      const row = generateCSVRow(
        { name: 'Critical Metric', value: 20, severity: 'critical' },
        { format: 'csv' }
      );
      
      expect(row).toContain('Critical Metric');
      expect(row).toContain('20');
      expect(row).toContain('Critical');
    });

    it('generates correct CSV row for No Data', () => {
      const row = generateCSVRow(
        { name: 'No Data', value: null, severity: 'No Data' },
        { format: 'csv' }
      );
      
      expect(row).toContain(','); // Empty value
      expect(row).toContain('No Data');
    });
  });

  describe('Severity utilities', () => {
    it('maps Critical to export label "Critical"', () => {
      expect(getExportSeverityLabel('critical')).toBe('Critical');
      expect(getExportSeverityLabel('normal')).toBe('Normal');
      expect(getExportSeverityLabel('No Data')).toBe('No Data');
    });

    it('returns true for Critical severity (should highlight)', () => {
      expect(shouldHighlightInExport('critical')).toBe(true);
      expect(shouldHighlightInExport('normal')).toBe(false);
      expect(shouldHighlightInExport('No Data')).toBe(false);
    });
  });
});

describe('PDF Export Red Color Preservation (AC-5)', () => {
  const metrics: MetricExportRow[] = [
    { name: 'Critical Metric', value: 25, severity: 'critical' },
    { name: 'Normal Metric', value: 85, severity: 'normal' },
  ];

  it('renders red background for Critical rows', () => {
    const html = generatePDFTemplate(metrics, { format: 'pdf' });
    
    expect(html).toContain('background-color: #FFEBEE');
    expect(html).toContain('Critical Metric');
  });

  it('renders red text for Critical severity', () => {
    const html = generatePDFTemplate(metrics, { format: 'pdf' });
    
    expect(html).toContain('color: #D32F2F');
    expect(html).toContain('.critical-severity');
  });

  it('does not map to grayscale for Critical metrics', () => {
    const html = generatePDFTemplate(metrics, { format: 'pdf' });
    
    // Red #D32F2F should appear, not grayscale equivalent like #808080
    expect(html).toContain('#D32F2F');
    expect(html).not.toMatch(/#\d{1,2}[A-Fa-f]{2}[A-Fa-f]{2}/); // No other hex color codes (checking for grayscale)
  });
});

describe('CSV Header Generation', () => {
  it('generates default headers', () => {
    const headers = generateCSVHeader({ format: 'csv' });
    
    expect(headers).toContain('Metric Name');
    expect(headers).toContain('Value');
    expect(headers).toContain('Severity');
  });

  it('includes custom headers after standard columns', () => {
    const headers = generateCSVHeader({
      format: 'csv',
      headers: ['Timestamp', 'GeneratedBy'],
    });
    
    expect(headers).toEqual([
      'Metric Name',
      'Value',
      'Severity',
      'Timestamp',
      'GeneratedBy',
    ]);
  });

  it('excludes columns when include option is false', () => {
    const headers = generateCSVHeader({
      format: 'csv',
      includeName: false,
      includeSeverity: false,
    });
    
    expect(headers).toEqual(['Value']);
  });
});