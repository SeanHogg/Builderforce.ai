import { describe, expect, it } from 'vitest';
import { ANCHOR_FINGERPRINT, readSarifResults, sarifLocation, sarifLog, sarifToFindings, SARIF_SCHEMA_URI } from './index.js';

const semgrep = {
  version: '2.1.0',
  runs: [{
    tool: { driver: { name: 'Semgrep OSS', version: '1.90.0', rules: [{ id: 'js.eval', properties: { 'security-severity': '9.1', tags: ['CWE-95'] } }] } },
    results: [
      {
        ruleId: 'js.eval', level: 'error', message: { text: 'eval of user input' }, baselineState: 'new',
        partialFingerprints: { [ANCHOR_FINGERPRINT]: 'sarif@1:file:src/a.ts#js.eval', numeric: 3 },
        locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.ts' }, region: { startLine: 4, snippet: { text: 'eval(x)' } } } }],
        properties: { dimension: 'security' },
      },
      { ruleId: 'js.eval', level: 'loud', baselineState: 'gone', message: { text: 'second' } },
      { ruleId: null, message: {} },
    ],
  }],
};

describe('readSarifResults', () => {
  it('keeps the tool, level, baselineState, string fingerprints, snippet and properties beside the normalized finding', () => {
    const [first, second] = readSarifResults(semgrep);
    expect(first).toMatchObject({
      tool: 'Semgrep OSS', toolVersion: '1.90.0', level: 'error', baselineState: 'new', snippet: 'eval(x)',
      partialFingerprints: { [ANCHOR_FINGERPRINT]: 'sarif@1:file:src/a.ts#js.eval' },
      properties: { dimension: 'security' }, severity: 'CRITICAL', cwe: 'CWE-95', filePath: 'src/a.ts', line: 4,
    });
    expect(first?.partialFingerprints).not.toHaveProperty('numeric');
    // An unknown level or baseline state is dropped, not passed through.
    expect(second).toMatchObject({ level: null, baselineState: null, partialFingerprints: {}, snippet: null });
  });

  it('skips a result with no title, exactly as sarifToFindings does', () => {
    expect(readSarifResults(semgrep)).toHaveLength(2);
    expect(sarifToFindings(semgrep)).toHaveLength(2);
  });

  it('sarifToFindings is the normalized projection of the same walk (no interchange fields)', () => {
    const [row] = sarifToFindings(semgrep);
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'cve', 'cwe', 'description', 'filePath', 'fixedVersion', 'line', 'packageName', 'remediation', 'ruleId', 'severity', 'title', 'vulnerableVersion',
    ]);
  });

  it('reads nothing from a non-log', () => {
    expect(readSarifResults(null)).toEqual([]);
    expect(readSarifResults({ runs: 'x' })).toEqual([]);
  });
});

describe('emit', () => {
  it('stamps the schema and version', () => {
    expect(sarifLog([])).toEqual({ $schema: SARIF_SCHEMA_URI, version: '2.1.0', runs: [] });
  });

  it('keeps only a positive integer line and omits an empty region', () => {
    expect(sarifLocation('a.ts')).toEqual({ physicalLocation: { artifactLocation: { uri: 'a.ts', uriBaseId: '%SRCROOT%' } } });
    expect(sarifLocation('a.ts', 0).physicalLocation.region).toBeUndefined();
    expect(sarifLocation('a.ts', 3, 'x').physicalLocation.region).toEqual({ startLine: 3, snippet: { text: 'x' } });
  });

  it('round-trips a written log through the reader', () => {
    const log = sarifLog([{
      tool: { driver: { name: 'builderforce-run-delta', version: '1' } },
      results: [{ ruleId: 'r', level: 'warning', message: { text: 'r' }, baselineState: 'absent', partialFingerprints: { [ANCHOR_FINGERPRINT]: 'r@1:file:a.ts' }, locations: [sarifLocation('a.ts', 2)] }],
    }]);
    expect(readSarifResults(JSON.parse(JSON.stringify(log)))).toMatchObject([
      { tool: 'builderforce-run-delta', baselineState: 'absent', level: 'warning', filePath: 'a.ts', line: 2, partialFingerprints: { [ANCHOR_FINGERPRINT]: 'r@1:file:a.ts' } },
    ]);
  });
});
