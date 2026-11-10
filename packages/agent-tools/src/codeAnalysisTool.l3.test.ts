/**
 * THE L3 result cache shared by the indexer's analysis and the run delta (PRD 41 §B7): with a binding, a tool whose
 * result is stored for this tree is not run (its raw report rebuilds the snapshot), a fresh result is stored as the run
 * delta's result shape plus its raw report, and the tools exclude the git-ignored folders exactly as the delta's adapters do.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type { CodeAnalysisSnapshot } from './codeAnalysis.js';
import { createAnalyzeCodebaseTool, setBundledAnalyzers } from './codeAnalysisTool.js';
import { jscpdFindings, knipFindings, dependencyCruiserFindings } from './delta/adapters/index.js';
import { okResult } from './delta/adapters/analyzer.js';
import type { L3CacheEntry } from './delta/adapters/l3Cache.js';

const ENTRIES = { 'dependency-cruiser': '/ext/dc/bin/dc.mjs', jscpd: '/ext/jscpd/bin/jscpd', knip: '/ext/knip/bin/knip.js' };
const dependency = { modules: [{ source: 'src/a.ts', dependencies: [{ resolved: 'src/b.ts', circular: true, cycle: ['src/a.ts', 'src/b.ts'] }] }, { source: 'src/b.ts', dependencies: [] }] };
const duplicates = { duplicates: [{ fragment: 'x = 1;', firstFile: { name: 'src/a.ts', start: 1 }, secondFile: { name: 'src/b.ts', start: 1 } }] };
const unused = { files: ['src/dead.ts'], issues: [] };

afterEach(() => setBundledAnalyzers(undefined));

function binding(seed: Record<string, L3CacheEntry> = {}) {
  const store = new Map(Object.entries(seed));
  const puts: string[] = [];
  return {
    puts, store,
    l3: {
      cache: { get: async (key: string) => store.get(key), put: async (key: string, entry: L3CacheEntry) => { puts.push(key); store.set(key, entry); } },
      keyOf: async (tool: string) => `key:${tool}`,
      ignored: async () => ['dist'],
      toResult: (tool: 'dependency-cruiser' | 'jscpd' | 'knip', version: string, raw: unknown) => okResult(tool, version,
        tool === 'jscpd' ? jscpdFindings(raw, '.', 'after') : tool === 'knip' ? knipFindings(raw, 'after') : dependencyCruiserFindings(raw, '.', 'after')),
    },
  };
}

const run = (commands: string[]) => async (command: string) => {
  commands.push(command);
  return { ok: true, exitCode: 0, stdout: command.includes('/dc/') ? JSON.stringify(dependency) : command.includes('/knip/') ? JSON.stringify(unused) : '' };
};
const caps = (commands: string[]) => ({ caps: { shell: { run: run(commands) }, repoRead: { readFile: async () => ({ ok: true, content: JSON.stringify(duplicates) }) } } }) as never;

describe('analyze_codebase with THE L3 cache', () => {
  it('stores each fresh result in the run delta\'s shape with its raw report, and excludes the ignored folders', async () => {
    setBundledAnalyzers(ENTRIES);
    const b = binding();
    const commands: string[] = [];
    const result = await createAnalyzeCodebaseTool({ l3: b.l3 }).execute({}, caps(commands));
    expect((result.data.snapshot as CodeAnalysisSnapshot).tools.map((t) => t.status)).toEqual(['complete', 'complete', 'complete']);
    expect(b.puts.sort()).toEqual(['key:dependency-cruiser', 'key:jscpd', 'key:knip']);
    const jscpd = b.store.get('key:jscpd')!;
    expect(jscpd.raw).toEqual(duplicates);
    expect(jscpd.result).toMatchObject({ tool: 'jscpd', status: 'ok' });
    expect(jscpd.result.findings.map((f) => f.kind)).toEqual(['clone-group']);
    expect(b.store.get('key:knip')!.result.findings.map((f) => f.kind)).toEqual(['unused-file']);
    expect(commands.find((c) => c.includes('/jscpd/'))).toContain('dist/**');
  });

  it('a stored result (the run delta\'s, or an earlier pass\'s) is not run again: its raw report rebuilds the snapshot', async () => {
    setBundledAnalyzers(ENTRIES);
    const b = binding({ 'key:knip': { result: okResult('knip', '5.30.0', knipFindings(unused, 'after')), raw: unused } });
    const commands: string[] = [];
    const result = await createAnalyzeCodebaseTool({ l3: b.l3 }).execute({}, caps(commands));
    expect(commands.some((c) => c.includes('/knip/'))).toBe(false);
    const snapshot = result.data.snapshot as CodeAnalysisSnapshot;
    expect(snapshot.issues.some((i) => i.kind === 'unused-file' && i.locations[0]!.path === 'src/dead.ts')).toBe(true);
    expect(snapshot.tools.find((t) => t.name === 'knip')).toMatchObject({ status: 'complete' });
  });

  it('a stored result with no raw report (a writer that had none) is run again', async () => {
    setBundledAnalyzers(ENTRIES);
    const b = binding({ 'key:knip': { result: okResult('knip', '5.30.0', []) } });
    const commands: string[] = [];
    await createAnalyzeCodebaseTool({ l3: b.l3 }).execute({}, caps(commands));
    expect(commands.some((c) => c.includes('/knip/'))).toBe(true);
  });
});
