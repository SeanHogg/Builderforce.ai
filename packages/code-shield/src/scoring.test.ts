import { describe, expect, it } from 'vitest';
import { buildFinding } from './finding.js';
import { actionFor, riskScore } from './scoring.js';
import type { ScanFinding, ThreatCategory } from './types.js';

const finding = (ruleId: string, category: ThreatCategory, weight: number): ScanFinding =>
  buildFinding({ ruleId, category, weight, severity: 'HIGH', title: ruleId, remediation: '', path: 'a.js' });

describe('riskScore', () => {
  it('is 0 without findings and counts a repeated rule once', () => {
    expect(riskScore([])).toBe(0);
    expect(riskScore([finding('r', 'obfuscation', 10), finding('r', 'obfuscation', 10)])).toBe(10);
  });

  it('adds a correlation bonus when both categories are present', () => {
    expect(riskScore([finding('a', 'credential-access', 25), finding('b', 'exfiltration', 25)])).toBe(75);
  });

  it('clamps to 100', () => {
    expect(riskScore([finding('a', 'secret', 60), finding('b', 'secret', 60)])).toBe(100);
  });
});

describe('actionFor', () => {
  it.each([[0, 'allow'], [19, 'allow'], [20, 'log'], [39, 'log'], [40, 'review'], [60, 'quarantine'], [80, 'block'], [100, 'block']] as const)(
    'maps score %i to %s', (score, action) => {
      expect(actionFor(score, [])).toBe(action);
    },
  );

  it('blocks any malware signature regardless of score', () => {
    expect(actionFor(5, [finding('s', 'malware-signature', 5)])).toBe('block');
  });
});
