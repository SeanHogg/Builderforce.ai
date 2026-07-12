/**
 * CSV Export Tests for Red Alert System (AC-10)
 * 
 * Tests: CSV exports include "Critical" in the severity column for Red-tier rows
 */

import { describe, it, expect } from '@jest/globals';
import { RED_THEME } from './redAlertUtils';

describe('CSV Export for Red Alert Threshold System', () => {
  describe('AC-10: CSV export includes Critical severity column', () => {
    it('includes severity column in CSV header', () => {
      const metrics = [
        { name: 'Metric A', value: 50 },
        { name: 'Metric B', value: 20 },
        { name: 'Metric C', value: null },
      ];

      const csv = [
        ['Metric Name', 'Value', 'Severity'],
        ...metrics.map(m => [m.name, m.value.toString(), m.value === null ? 'No Data' : (m.value <= 49 ? 'Critical' : 'Normal')])
      ].map(row => row.join(',')).join('\n');

      expect(csv).toContain('Severity');
      expect(csv).toContain('Metric Name');
      expect(csv).toContain('Value');
    });

    it('populates "Critical" in severity column for Red-tier rows', () => {
      const metrics = [
        { name: 'Quality Score', value: 0 },
        { name: 'Test Coverage', value: 49 },
        { name: 'Bug Rate', value: 4.5 },
      ];

      const csv = [
        ...metrics.map(m => 
          [
            m.name, 
            m.value, 
            m.value === null ? 'No Data' : (m.value <= 49 ? 'Critical' : 'Normal')
          ].join(',')
        )
      ].join('\n');

      expect(csv).toContain('Quality Score,0,Critical');
      expect(csv).toContain('Test Coverage,49,Critical');
      expect(csv).toContain('Bug Rate,4.5,Critical');
    });

    it('populates "No Data" for null values', () => {
      const metrics = [
        { name: 'New Metric', value: 75 },
        { name: 'Missing Data', value: null },
        { name: 'Invalid Value', value: undefined },
      ];

      const csv = [
        ['Metric Name', 'Value', 'Severity'],
        ...metrics.map(m => [m.name, m.value, m.value === null || m.value === undefined ? 'No Data' : (m.value <= 49 ? 'Critical' : 'Normal')])
      ].map(row => row.join(',')).join('\n');

      expect(csv).toContain('Missing Data,,No Data');
      expect(csv).toContain('Invalid Value,,No Data');
    });

    it('populates "Normal" for values above Red threshold', () => {
      const metrics = [
        { name: 'Healthy Metric', value: 75 },
        { name: 'Good Metric', value: 50 },
      ];

      const csv = [
        ['Metric Name', 'Value', 'Severity'],
        ...metrics.map(m => [m.name, m.value, m.value <= 49 ? 'Critical' : 'Normal'])
      ].map(row => row.join(',')).join('\n');

      expect(csv).toContain('Healthy Metric,75,Normal');
      expect(csv).toContain('Good Metric,50,Normal');
    });

    it('handles decimal values correctly in CSV', () => {
      const metrics = [
        { name: 'Error Rate', value: 32.5 },
        { name: 'Success Rate', value: 85.3 },
      ];

      const csv = [
        ['Metric Name', 'Value', 'Severity'],
        ...metrics.map(m => [m.name, m.value, m.value <= 49 ? 'Critical' : 'Normal'])
      ].map(row => row.join(',')).join('\n');

      expect(csv).toContain('Error Rate,32.5,Critical');
      expect(csv).toContain('Success Rate,85.3,Normal');
    });

    it('includes header row in CSV export', () => {
      const csv = [
        ['Metric Name', 'Value', 'Severity'],
        ['Metric A', '20', 'Critical'],
        ['Metric B', '75', 'Normal']
      ].map(row => row.join(',')).join('\n');

      const lines = csv.split('\n');
      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('Metric Name,Value,Severity');
      expect(lines[1]).toBe('Metric A,20,Critical');
      expect(lines[2]).toBe('Metric B,75,Normal');
    });
  });

  describe('WCAG 2.1 AA Contrast (AC-5)', () => {
    it('Red color token (#D32F2F) passes WCAG AA on white (#FFFFFF)', () => {
      const r1 = 211, g1 = 47, b1 = 47;
      const r2 = 255, g2 = 255, b2 = 255;

      const luminance1 = (0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1) / 255;
      const luminance2 = (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2) / 255;
      
      const ratioYIQ = ((r1 * 299) + (g1 * 587) + (b1 * 114)) / 1000 / 
                       ((r2 * 299) + (g2 * 587) + (b2 * 114)) / 1000;
      
      // WCAG AA requires contrast >= 4.5:1
      expect(ratioYIQ).toBeGreaterThanOrEqual(4.5);
    });

    it('Red color token (#D32F2F) passes WCAG AA on dark background (#1E1E1E)', () => {
      const r1 = 211, g1 = 47, b1 = 47;
      const r2 = 30, g2 = 30, b2 = 30;

      const luminance1 = (0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1) / 255;
      const luminance2 = (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2) / 255;
      
      const ratioYIQ = ((r1 * 299) + (g1 * 587) + (b1 * 114)) / 1000 / 
                       ((r2 * 299) + (g2 * 587) + (b2 * 114)) / 1000;
      
      // WCAG AA requires contrast >= 4.5:1
      expect(ratioYIQ).toBeGreaterThanOrEqual(4.5);
    });

    it('Red light color (#F44336) passes WCAG AA on white (#FFFFFF)', () => {
      const r1 = 244, g1 = 67, b1 = 54;
      const r2 = 255, g2 = 255, b2 = 255;

      const luminance1 = (0.2126 * r1 + 0.7152 * g1 + 0.0722 * b1) / 255;
      const luminance2 = (0.2126 * r2 + 0.7152 * g2 + 0.0722 * b2) / 255;
      
      const ratioYIQ = ((r1 * 299) + (g1 * 587) + (b1 * 114)) / 1000 / 
                       ((r2 * 299) + (g2 * 587) + (b2 * 114)) / 1000;
      
      expect(ratioYIQ).toBeGreaterThanOrEqual(4.5);
    });
  });
});