/**
 * The three parsers exist so a scanner's report lands in the SAME row shape and
 * severity vocabulary regardless of which tool wrote it, and so a re-posted
 * report is a no-op. These tests pin the level/severity maps, the SARIF rule
 * enrichment (cwe/description/help), the npm-audit advisory read, and that the
 * fingerprint is stable across a re-parse and blind to case.
 */
import { describe, expect, it } from 'vitest';
import {
  findingFingerprint,
  isScanReportFormat,
  normalizeSeverity,
  normalizedFindings,
  npmAuditToFindings,
  parseScanReport,
  sarifToFindings,
} from './scanReportParsers';

describe('normalizeSeverity', () => {
  it('folds scanner vocabularies onto CRITICAL|HIGH|MEDIUM|LOW', () => {
    expect(normalizeSeverity('critical')).toBe('CRITICAL');
    expect(normalizeSeverity('error')).toBe('HIGH');
    expect(normalizeSeverity('moderate')).toBe('MEDIUM');
    expect(normalizeSeverity('note')).toBe('LOW');
    expect(normalizeSeverity(undefined)).toBe('MEDIUM');
    expect(normalizeSeverity('bogus')).toBe('MEDIUM');
  });
});

describe('normalizedFindings', () => {
  it('accepts an array or a { findings } envelope, drops title-less records, clips lengths', () => {
    const rec = { severity: 'high', ruleId: 'R1', title: 'x'.repeat(300), line: 12, cve: 'CVE-2024-1' };
    expect(normalizedFindings([rec, { severity: 'low' }, 'junk'])).toHaveLength(1);
    const [f] = normalizedFindings({ findings: [rec] });
    expect(f?.severity).toBe('HIGH');
    expect(f?.title).toHaveLength(255);
    expect(f?.line).toBe(12);
    expect(f?.packageName).toBeNull();
  });

  it('rejects non-positive or non-integer line numbers', () => {
    expect(normalizedFindings([{ title: 'a', line: 0 }])[0]?.line).toBeNull();
    expect(normalizedFindings([{ title: 'a', line: 3.5 }])[0]?.line).toBeNull();
  });
});

describe('sarifToFindings', () => {
  const sarif = {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'CodeQL', rules: [
        { id: 'js/xss', shortDescription: { text: 'Reflected XSS' }, fullDescription: { text: 'Untrusted input reaches the DOM.' },
          help: { text: 'Escape output.' }, properties: { tags: ['security', 'external/cwe/cwe-079'], 'security-severity': '9.1' } },
        { id: 'js/unused', shortDescription: { text: 'Unused variable' } },
      ] } },
      results: [
        { ruleId: 'js/xss', level: 'warning', message: { text: 'XSS sink on line 4' },
          locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.ts' }, region: { startLine: 4 } } }] },
        { ruleId: 'js/unused', level: 'note', message: { text: 'x is unused' } },
        { ruleId: 'js/unknown', level: 'error', message: { text: 'no rule metadata' } },
        { ruleId: 'js/blank', message: {} },
      ],
    }],
  };

  it('maps level → severity, promotes by security-severity, and enriches from rule metadata', () => {
    const out = sarifToFindings(sarif);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({
      severity: 'CRITICAL', ruleId: 'js/xss', title: 'XSS sink on line 4', filePath: 'src/app.ts', line: 4,
      cwe: 'CWE-079', description: 'Untrusted input reaches the DOM.', remediation: 'Escape output.',
    });
    expect(out[1]).toMatchObject({ severity: 'LOW', filePath: null, line: null, description: 'Unused variable' });
    expect(out[2]).toMatchObject({ severity: 'HIGH', cwe: null });
  });

  it('is empty for a non-SARIF document', () => {
    expect(sarifToFindings({ vulnerabilities: {} })).toEqual([]);
    expect(sarifToFindings(null)).toEqual([]);
  });
});

describe('npmAuditToFindings', () => {
  const report = {
    auditReportVersion: 2,
    vulnerabilities: {
      lodash: {
        name: 'lodash', severity: 'high', range: '<4.17.21', fixAvailable: { name: 'lodash', version: '4.17.21' },
        via: [{ title: 'Prototype Pollution', url: 'https://github.com/advisories/GHSA-p6mc-m468-83gw', severity: 'high', cwe: ['CWE-1321'] }],
      },
      minimist: { name: 'minimist', severity: 'moderate', range: '<1.2.6', fixAvailable: true, via: ['lodash'] },
    },
  };

  it('reads one finding per package with advisory, versions and remediation', () => {
    const out = npmAuditToFindings(report);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      severity: 'HIGH', packageName: 'lodash', title: 'lodash: Prototype Pollution', vulnerableVersion: '<4.17.21',
      fixedVersion: '4.17.21', cwe: 'CWE-1321', ruleId: 'npm-advisory:GHSA-p6mc-m468-83gw', remediation: 'Upgrade lodash to 4.17.21',
    });
    expect(out[1]).toMatchObject({ severity: 'MEDIUM', packageName: 'minimist', ruleId: 'npm-audit:minimist', fixedVersion: null });
    expect(out[1]?.remediation).toContain('npm audit fix');
  });

  it('is empty when there is no vulnerabilities map', () => {
    expect(npmAuditToFindings({ runs: [] })).toEqual([]);
  });
});

describe('parseScanReport + isScanReportFormat', () => {
  it('dispatches on the declared format', () => {
    expect(parseScanReport('normalized', [{ title: 'a' }])).toHaveLength(1);
    expect(parseScanReport('sarif', { runs: [{ results: [{ message: { text: 'b' } }] }] })).toHaveLength(1);
    expect(parseScanReport('npm-audit', { vulnerabilities: { x: { severity: 'low' } } })).toHaveLength(1);
    expect(isScanReportFormat('sarif')).toBe(true);
    expect(isScanReportFormat('junit')).toBe(false);
  });
});

describe('findingFingerprint', () => {
  it('is stable for the same finding, case-insensitive, and 40 hex chars', async () => {
    const [a] = normalizedFindings([{ title: 'Prototype Pollution', ruleId: 'R1', filePath: 'src/A.ts', line: 3 }]);
    const [b] = normalizedFindings([{ title: 'prototype pollution', ruleId: 'r1', filePath: 'SRC/a.ts', line: 3, severity: 'critical' }]);
    const [c] = normalizedFindings([{ title: 'Prototype Pollution', ruleId: 'R1', filePath: 'src/A.ts', line: 4 }]);
    const fa = await findingFingerprint(a!);
    expect(fa).toMatch(/^[0-9a-f]{40}$/);
    expect(await findingFingerprint(b!)).toBe(fa);
    expect(await findingFingerprint(c!)).not.toBe(fa);
  });
});
