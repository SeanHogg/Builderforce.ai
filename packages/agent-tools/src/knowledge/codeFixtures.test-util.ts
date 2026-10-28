/**
 * Shared fixtures for the code-pack tests: analyzer reports as dependency-cruiser, jscpd and
 * knip emit them, normalized by the ONE `normalizeAnalysis`.
 */

import { normalizeAnalysis, type CodeAnalysisSnapshot } from '../codeAnalysis.js';

export const dependency = {
  modules: [
    { source: 'src/a.ts', dependencies: [{ resolved: 'src/b.ts', circular: true }] },
    { source: 'src/b.ts', dependencies: [{ resolved: 'src/a.ts', circular: true }] },
    { source: 'src/c.ts', dependencies: [{ resolved: 'src/b.ts', circular: false }, { resolved: 'node:fs', coreModule: true }] },
  ],
};
export const duplicates = {
  duplicates: [{ fragment: 'return input + 1;', firstFile: { name: 'src/a.ts', start: 2, end: 7 }, secondFile: { name: 'src/b.ts', start: 5, end: 10 } }],
};
export const unused = {
  files: ['src/dead.ts'],
  issues: [{ file: 'src/b.ts', exports: [{ name: 'x', line: 3 }, { name: 'y', line: 4 }], dependencies: [{ name: 'left-pad' }] }],
};

export function fixtureSnapshot(reports: { dependency?: unknown; duplicates?: unknown; unused?: unknown } = {}): CodeAnalysisSnapshot {
  return {
    version: 1, id: 'scan', capturedAt: '2026-10-28T00:00:00.000Z',
    source: { commit: 'abc', branch: 'main', dirty: false },
    tools: [],
    ...normalizeAnalysis(reports.dependency ?? dependency, reports.duplicates ?? duplicates, reports.unused ?? unused),
  };
}
