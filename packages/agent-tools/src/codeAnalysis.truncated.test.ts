import { describe, expect, it } from 'vitest';
import { ANALYZERS } from './codeAnalysisTool.js';
import { codeAnalysisMeta, compareAnalysis, normalizeAnalysis, type CodeAnalysisSnapshot } from './codeAnalysis.js';

const unused = (files: string[]) => ({ files, issues: [] });
const snapshot = (files: string[], truncated?: true): CodeAnalysisSnapshot => ({
  version: 1, id: 'scan', capturedAt: '2026-11-10T12:00:00.000Z', source: { branch: 'main', commit: 'abc', dirty: false },
  tools: ANALYZERS.map((a) => ({ name: a.name, version: a.version, status: 'complete' as const })),
  ...normalizeAnalysis({ modules: [] }, { duplicates: [] }, unused(files)),
  ...(truncated ? { truncated } : {}),
});

describe('a truncated analysis is not comparable (PRD 41 B2, C9)', () => {
  it('the truncated flag reaches comparable() through the analysis meta', () => {
    expect(codeAnalysisMeta(snapshot(['a.ts'], true))).toMatchObject({ truncated: true });
    expect(codeAnalysisMeta(snapshot(['a.ts']))).not.toHaveProperty('truncated');
  });

  it('regression: a truncated after-side against a full baseline reports nothing resolved (a missing issue is not a fix)', () => {
    const baseline = snapshot(['a.ts', 'b.ts']);
    const current = snapshot(['a.ts'], true);
    const result = compareAnalysis(current, baseline);
    expect(result).toMatchObject({ comparable: false, added: [], resolved: [] });
    expect(result.reasons).toContain('truncated');
    expect(result.unchanged.map((i) => i.id)).toEqual(['unused-file:a.ts']);
  });

  it('a truncated baseline is not comparable either, and two full scans still are', () => {
    expect(compareAnalysis(snapshot(['a.ts', 'c.ts']), snapshot(['a.ts'], true))).toMatchObject({ comparable: false, added: [], resolved: [] });
    expect(compareAnalysis(snapshot(['a.ts']), snapshot(['a.ts', 'b.ts']))).toMatchObject({ comparable: true, reasons: [], resolved: [{ id: 'unused-file:b.ts' }] });
  });
});
