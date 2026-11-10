/** The run delta's L3 analyzer adapters (PRD 41 §B7): fixture tool output → sorted, canonical findings; absent/failed tools; read-only runs. */

import { describe, expect, it } from 'vitest';
import { matchLineage } from '@seanhogg/builderforce-memory/knowledge';
import type { AnalyzerExec, AnalyzerSide, ExecResult } from './analyzer.js';
import { dependencyCruiserAnalyzer, dependencyCruiserFindings } from './dependencyCruiser.js';
import { gitleaksAnalyzer, gitleaksFindings } from './gitleaks.js';
import { jscpdAnalyzer, jscpdFindings } from './jscpd.js';
import { knipAnalyzer, knipFindings } from './knip.js';
import { osvAnalyzer, osvFindings } from './osv.js';
import { osvPackages, osvScanArgs } from '../../prefetch/checkExecutors.js';
import { codeqlAnalyzer, SARIF_KINDS, sarifFindings, semgrepAnalyzer } from './sarifTools.js';
import { typeErrorFindings } from './typescript.js';

const DIR = 'C:/repo';

describe('osv-scanner', () => {
  const report = {
    results: [{
      source: { path: 'C:/repo/package-lock.json' },
      packages: [
        { package: { name: 'lodash', version: '4.17.20', ecosystem: 'npm' }, groups: [{ ids: ['GHSA-b', 'CVE-1'], max_severity: '7.4' }], vulnerabilities: [{ id: 'GHSA-b' }] },
        { package: { name: 'minimist', version: '1.2.0', ecosystem: 'npm' }, vulnerabilities: [{ id: 'GHSA-m' }] },
      ],
    }],
  };
  it('one finding per package and advisory group, anchored on the primary advisory without the version, severity from CVSS', () => {
    const findings = osvFindings(osvPackages(report), DIR);
    expect(findings.map((f) => [f.identity.anchor, f.severity, f.identity.members])).toEqual([
      ['vulnerable-dependency@1:package:npm/lodash#CVE-1', 'error', ['package-lock.json']],
      ['vulnerable-dependency@1:package:npm/minimist#GHSA-m', 'warn', ['package-lock.json']],
    ]);
    const upgraded = osvFindings(osvPackages({ results: [{ ...report.results[0], packages: [{ ...report.results[0]!.packages[0], package: { name: 'lodash', version: '4.17.21', ecosystem: 'npm' } }] }] }), DIR);
    expect(upgraded[0]!.identity.id).toBe(findings[0]!.identity.id);
  });

  it('sorts before dedupe: a shuffled report gives the same findings', () => {
    const shuffled = { results: [{ ...report.results[0], packages: [...report.results[0]!.packages].reverse() }] };
    expect(osvFindings(osvPackages(shuffled), DIR)).toEqual(osvFindings(osvPackages(report), DIR));
  });

  it('offline flags follow the major version, shared with PreFetch', () => {
    expect(osvScanArgs('/r')).toEqual(['--format', 'json', '--recursive', '/r']);
    expect(osvScanArgs('/r', { offline: true, download: true, major: 1 })).toEqual(['--format', 'json', '--experimental-offline', '--experimental-download-offline-databases', '--recursive', '/r']);
    expect(osvScanArgs('/r', { offline: true, major: 2 })).toEqual(['--format', 'json', '--offline-vulnerabilities', '--recursive', '/r']);
  });
});

describe('gitleaks', () => {
  it('ordinal per file and rule, by line; no secret value', () => {
    const f = gitleaksFindings([
      { rule: 'aws', file: 'C:/tmp/src/b.ts', line: 9 }, { rule: 'aws', file: 'C:/tmp/src/b.ts', line: 3 }, { rule: 'gh', file: 'C:/tmp/src/a.ts', line: 1 },
    ], 'C:/tmp/src', 'after');
    expect(f.map((x) => [x.identity.id, x.evidence[0]!.line, x.severity])).toEqual([
      ['secret-leak:a.ts#gh:1', 1, 'error'], ['secret-leak:b.ts#aws:1', 3, 'error'], ['secret-leak:b.ts#aws:2', 9, 'error'],
    ]);
    expect(JSON.stringify(f)).not.toMatch(/snippet/);
  });
});

describe('jscpd', () => {
  const pair = (a: string, b: string, fragment = 'const x = compute(a, b);\nreturn x;') =>
    ({ fragment, firstFile: { name: `${DIR}/${a}`, start: 3 }, secondFile: { name: `${DIR}/${b}`, start: 7 } });
  it('groups pairs sharing a fragment into one clone group; a new copy keeps the anchor and adds a member', () => {
    const before = jscpdFindings({ duplicates: [pair('src/a.ts', 'src/b.ts')] }, DIR, 'before');
    const after = jscpdFindings({ duplicates: [pair('src/a.ts', 'src/b.ts'), pair('src/a.ts', 'src/c.ts', '  const x = compute(a, b);\n  return x;')] }, DIR, 'after');
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(1);
    expect(after[0]!.identity.anchor).toBe(before[0]!.identity.anchor);
    expect(after[0]!.identity.members).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
    expect(after[0]!.params.members).toBe(3);
  });

  it('an edit INSIDE the cloned region (a new fragment) still reads changed, not resolved plus introduced', () => {
    const before = jscpdFindings({ duplicates: [pair('src/a.ts', 'src/b.ts')] }, DIR, 'before');
    const after = jscpdFindings({ duplicates: [pair('src/a.ts', 'src/b.ts', 'const y = compute(a, b, c);\nreturn y;')] }, DIR, 'after');
    expect(after[0]!.identity.anchor).not.toBe(before[0]!.identity.anchor);
    expect(matchLineage(before.map((f) => f.identity), after.map((f) => f.identity)).map((e) => e.lineage)).toEqual(['changed']);
  });

  it('runs over the host\'s scopes (the packages holding a changed file) instead of the whole tree', async () => {
    const seen: string[][] = [];
    const exec = fakeExec((argv) => { seen.push([...argv]); return {}; }, { 'scratch/jscpd-report.json': JSON.stringify({ duplicates: [] }) });
    await jscpdAnalyzer.run(side({ entries: { jscpd: '/ext/jscpd.js' }, scopes: ['packages/run-delta', 'packages/sarif'] }), exec);
    expect(seen[0]!.slice(-2)).toEqual(['packages/run-delta', 'packages/sarif']);
    expect(seen[0]!).not.toContain('.');
  });

  it('excludes what git ignores, so both sides measure one file universe', async () => {
    const seen: string[][] = [];
    const exec = fakeExec((argv) => { seen.push([...argv]); return {}; }, { 'scratch/jscpd-report.json': JSON.stringify({ duplicates: [] }) });
    await jscpdAnalyzer.run(side({ entries: { jscpd: '/ext/jscpd.js' }, ignored: ['dist', 'packages/x/build'] }), exec);
    const ignore = seen[0]!.find((a) => a.startsWith('--ignore='))!;
    expect(ignore).toContain('dist/**');
    expect(ignore).toContain('packages/x/build/**');
  });
});

describe('knip', () => {
  it('maps the report through memory normalizeAnalysis / identityOfIssue', () => {
    const f = knipFindings({ files: ['src/dead.ts'], issues: [{ file: 'src/a.ts', exports: [{ name: 'b', line: 4 }, { name: 'a', line: 2 }], dependencies: [{ name: 'left-pad' }] }] }, 'after');
    expect(f.map((x) => [x.kind, x.identity.anchor, x.severity]).sort()).toEqual([
      ['unused-dependency', 'unused-dependency@1:package:src/a.ts#left-pad', 'warn'],
      ['unused-export', 'unused-export@1:symbol:src/a.ts#a', 'info'],
      ['unused-export', 'unused-export@1:symbol:src/a.ts#b', 'info'],
      ['unused-file', 'unused-file@1:file:src/dead.ts', 'warn'],
    ]);
  });
});

describe('dependency-cruiser', () => {
  const cycle = (members: string[]) => ({ modules: members.map((m, i) => ({ source: m, dependencies: [{ resolved: members[(i + 1) % members.length], circular: true, cycle: members }] })) });
  it('one finding per cycle member set and per forbidden edge', () => {
    const report = {
      ...cycle(['src/a.ts', 'src/b.ts']),
      summary: { violations: [{ from: 'src/ui/x.ts', to: 'src/db/y.ts', type: 'dependency', rule: { name: 'ui-not-db', severity: 'error' } }] },
    };
    const f = dependencyCruiserFindings(report, DIR, 'after');
    expect(f.map((x) => [x.kind, x.identity.members, x.severity])).toEqual([
      ['dependency-cycle', ['src/a.ts', 'src/b.ts'], 'warn'],
      ['forbidden-dependency', ['src/db/y.ts', 'src/ui/x.ts'], 'error'],
    ]);
  });

  it('a new cycle member that sorts FIRST still reads the same cycle changed (anchor on the member set, overlap match)', () => {
    const before = dependencyCruiserFindings(cycle(['src/b.ts', 'src/c.ts', 'src/d.ts']), DIR, 'before');
    const after = dependencyCruiserFindings(cycle(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']), DIR, 'after');
    expect(after[0]!.identity.anchor).not.toContain('src/a.ts');
    expect(matchLineage(before.map((f) => f.identity), after.map((f) => f.identity)).map((e) => e.lineage)).toEqual(['changed']);
  });

  it('builds the layer rules from the partition registry the host read from the BEFORE side, plus the ignored folders', async () => {
    const files: Record<string, string> = {};
    const exec = fakeExec(() => ({ stdout: JSON.stringify({ modules: [] }) }), files);
    await dependencyCruiserAnalyzer.run(side({ entries: { 'dependency-cruiser': '/ext/depcruise.js' }, ignored: ['dist'] }), exec);
    const config = JSON.parse(files['scratch/dependencies.json']!) as { options: { exclude: { path: string } } };
    expect(config.options.exclude.path).toContain('dist');
  });
});

describe('typescript', () => {
  it('keeps changed-file errors only, identified without the line', () => {
    const d = [{ file: 'src/a.ts', line: 3, code: 2322, message: "Type 'string' is not assignable to type 'number'." }, { file: 'src/other.ts', line: 1, code: 2304, message: "Cannot find name 'x'." }];
    const a = typeErrorFindings(d, DIR, new Set(['src/a.ts']), 'after');
    const b = typeErrorFindings(d.map((x) => ({ ...x, line: x.line + 6 })), DIR, new Set(['src/a.ts']), 'after');
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: 'type-error', severity: 'error', params: { code: 'TS2322' } });
    expect(b[0]!.identity.id).toBe(a[0]!.identity.id);
  });
});

describe('SARIF tools (Semgrep, CodeQL)', () => {
  const log = {
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'Semgrep OSS', version: '1.80.0', rules: [{ id: 'js.exec', properties: { tags: ['CWE-78: OS Command Injection'] } }] } },
      results: [
        { ruleId: 'js.exec', level: 'error', message: { text: 'exec with user input' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'C:/tmp/src/src/a.ts' }, region: { startLine: 4, snippet: { text: 'exec(cmd)' } } } }] },
        { ruleId: 'js.exec', level: 'error', message: { text: 'exec with user input' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'C:/tmp/src/src/a.ts' }, region: { startLine: 9, snippet: { text: 'exec(cmd)' } } } }] },
      ],
    }],
  };
  it('parses with @builderforce/sarif, keeps the rule as sarifRule, numbers repeats of an anchor, never a line in the identity', () => {
    const f = sarifFindings(log, 'C:/tmp/src', 'after', SARIF_KINDS.semgrep);
    expect(f.map((x) => [x.kind, x.identity.id.endsWith('#1') || x.identity.id.endsWith('#2'), x.params.sarifRule, x.severity])).toEqual([
      ['semgrep-finding', true, 'js.exec', 'error'], ['semgrep-finding', true, 'js.exec', 'error'],
    ]);
    expect(f[0]!.identity.members).toEqual(['src/a.ts']);
    expect(f.every((x) => !/:\d+$/.test(x.identity.anchor))).toBe(true);
  });

  it('a tool that is not installed is skipped; Semgrep without the repository\'s own rules is not measured; CodeQL without a database too', async () => {
    const absent = fakeExec(() => ({}), {}, () => undefined);
    expect(await semgrepAnalyzer.run(side(), absent)).toMatchObject({ status: 'skipped', reason: 'tool-absent' });
    const present = fakeExec((argv) => (argv.includes('--version') ? { stdout: '1.80.0' } : {}));
    expect(await semgrepAnalyzer.run(side(), present)).toMatchObject({ status: 'skipped', reason: 'no-config', version: '1.80.0' });
    expect(await codeqlAnalyzer.run(side(), present)).toMatchObject({ status: 'skipped', reason: 'no-config' });
  });

  it('CodeQL in an opted-in repository builds this side\'s database once (offline), then analyzes it with --no-download', async () => {
    const files: Record<string, string> = {};
    const seen: string[][] = [];
    let built = false;
    const exec: AnalyzerExec = {
      ...fakeExec(() => ({}), files),
      mtime: async (p) => (p.endsWith('codeql-database.yml') && built ? 1 : undefined),
      run: async (argv) => {
        seen.push([...argv]);
        if (argv.includes('--version')) return { started: true, exitCode: 0, stdout: 'CodeQL command-line toolchain release 2.19.0.', stderr: '' };
        if (argv[1] === 'database' && argv[2] === 'create') { built = true; return { started: true, exitCode: 0, stdout: '', stderr: '' }; }
        files['scratch/codeql.sarif'] = JSON.stringify(log).replaceAll('C:/tmp/src/', 'C:/repo/');
        return { started: true, exitCode: 0, stdout: '', stderr: '' };
      },
    };
    const s = side({ codeql: { create: { dbDir: 'C:/repo/.builderforce/cache/run-delta-analyzers/codeql-k', language: 'javascript-typescript' } } });
    const r = await codeqlAnalyzer.run(s, exec);
    expect(r).toMatchObject({ status: 'ok', version: '2.19.0' });
    expect(r.findings.every((f) => f.kind === 'codeql-finding')).toBe(true);
    // The exact argv, as the CodeQL CLI manual spells every option (database create / database analyze).
    expect(seen.find((a) => a[2] === 'create')).toEqual([
      '/usr/bin/codeql', 'database', 'create', 'C:/repo/.builderforce/cache/run-delta-analyzers/codeql-k',
      '--language=javascript-typescript', '--source-root=C:/repo', '--build-mode=none', '--overwrite',
    ]);
    expect(seen.find((a) => a[2] === 'analyze')).toEqual([
      '/usr/bin/codeql', 'database', 'analyze', 'C:/repo/.builderforce/cache/run-delta-analyzers/codeql-k',
      '--format=sarif-latest', '--output=/tmp/scratch/codeql.sarif', '--no-download',
    ]);
    seen.length = 0;
    await codeqlAnalyzer.run(s, exec); // the same tree: the database is reused
    expect(seen.some((a) => a[2] === 'create')).toBe(false);
  });

  it('runs Semgrep offline on the repository\'s rules over the changed files, from a neutral folder', async () => {
    const files: Record<string, string> = {};
    const seen: Array<{ argv: string[]; cwd: string }> = [];
    const exec: AnalyzerExec = {
      ...fakeExec(() => ({}), files),
      run: async (argv, o) => {
        seen.push({ argv: [...argv], cwd: o.cwd });
        if (argv.includes('--version')) return { started: true, exitCode: 0, stdout: '1.80.0', stderr: '' };
        files['scratch/semgrep.sarif'] = JSON.stringify(log).replaceAll('C:/tmp/src', '/tmp/scratch/src');
        return { started: true, exitCode: 0, stdout: '', stderr: '' };
      },
    };
    const r = await semgrepAnalyzer.run(side({ semgrep: { config: 'rules: []' } }), exec);
    expect(r).toMatchObject({ status: 'ok', version: '1.80.0' });
    expect(r.findings).toHaveLength(2);
    const scan = seen.find((s) => s.argv.includes('scan'))!;
    expect(scan.argv[0]).toBe('/usr/bin/semgrep');
    expect(scan.argv).toEqual(expect.arrayContaining(['--metrics', 'off', '--config']));
    expect(scan.argv).not.toContain('auto');
    expect(seen.find((s) => s.argv.includes('--version'))!.cwd).toBe('/neutral');
  });
});

/** A host exec answering per program; `files` holds scratch files (by `scratch/<name>`); `which` resolves on a fake PATH. */
function fakeExec(answer: (argv: readonly string[]) => Partial<ExecResult>, files: Record<string, string> = {}, which: (p: string) => string | undefined = (p) => `/usr/bin/${p}`): AnalyzerExec {
  const key = (p: string) => p.replace(/^.*\/scratch\//, 'scratch/');
  return {
    run: async (argv) => ({ started: true, exitCode: 0, stdout: '', stderr: '', ...answer(argv) }),
    which: async (p) => which(p),
    neutralCwd: () => '/neutral',
    readText: async (p) => files[key(p)],
    mtime: async (p) => (p.endsWith('tsconfig.json') ? 1 : undefined),
    newestMtime: async () => undefined,
    writeText: async (p, t) => { files[key(p)] = t; },
    tempDir: async () => ({ path: '/tmp/scratch', dispose: async () => undefined }),
  };
}

const side = (over: Partial<AnalyzerSide> = {}): AnalyzerSide => ({
  side: 'after', dir: DIR, changed: [{ path: 'src/a.ts', text: 'const a: number = "x";\n' }], entries: {}, bundled: true, ...over,
});

describe('adapter runs', () => {
  it('a tool that is not on this host is skipped, never zero findings', async () => {
    const exec = fakeExec(() => ({ started: false, exitCode: null }), {}, () => undefined);
    for (const a of [osvAnalyzer, gitleaksAnalyzer]) expect(await a.run(side(), exec)).toMatchObject({ status: 'skipped', reason: 'tool-absent', findings: [] });
    for (const a of [jscpdAnalyzer, knipAnalyzer, dependencyCruiserAnalyzer]) {
      expect(await a.run(side(), exec)).toMatchObject({ status: 'skipped', reason: 'analyzer-unavailable', findings: [] });
    }
  });

  it('a PATH tool runs by its absolute path, from a neutral folder', async () => {
    const seen: Array<{ argv: string[]; cwd: string }> = [];
    const exec: AnalyzerExec = { ...fakeExec(() => ({})), run: async (argv, o) => { seen.push({ argv: [...argv], cwd: o.cwd }); return { started: true, exitCode: 128, stdout: '', stderr: '' }; } };
    await osvAnalyzer.run(side(), exec);
    expect(seen.every((s) => s.argv[0] === '/usr/bin/osv-scanner' && s.cwd === '/neutral')).toBe(true);
  });

  it('a run that timed out is failed with its reason; one whose output overflowed is output-too-large', async () => {
    const timedOut = fakeExec((argv) => (argv.includes('--version') ? { stdout: 'osv-scanner version: 1.9.1' } : { timedOut: true, exitCode: null }));
    expect(await osvAnalyzer.run(side(), timedOut)).toMatchObject({ status: 'failed', reason: 'timeout', version: '1.9.1' });
    const overflow = fakeExec(() => ({ overflow: true, exitCode: null }));
    expect(await knipAnalyzer.run(side({ entries: { knip: '/ext/knip.js' } }), overflow)).toMatchObject({ status: 'failed', reason: 'output-too-large' });
  });

  it('osv against the offline database: dated by the database, refreshed only when allowed', async () => {
    const seen: Array<{ argv: string[]; env?: Readonly<Record<string, string>> }> = [];
    const exec: AnalyzerExec = {
      ...fakeExec(() => ({})),
      newestMtime: async () => Date.parse('2026-11-01T10:00:00Z'),
      run: async (argv, o) => {
        seen.push({ argv: [...argv], ...(o.env ? { env: o.env } : {}) });
        return argv.includes('--version') ? { started: true, exitCode: 0, stdout: 'osv-scanner version: 1.9.1', stderr: '' } : { started: true, exitCode: 128, stdout: '', stderr: '' };
      },
    };
    const r = await osvAnalyzer.run(side({ osv: { dbDir: '/store/osv', download: true } }), exec);
    expect(r).toMatchObject({ status: 'ok', dataAsOf: '2026-11-01' });
    const scan = seen.find((s) => s.argv.includes('--recursive'))!;
    expect(scan.argv).toContain('--experimental-download-offline-databases');
    expect(scan.env).toEqual({ OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: '/store/osv' });
  });

  it('runs a bundled tool through node <entry> and reports its pinned version', async () => {
    const seen: string[][] = [];
    const exec = fakeExec((argv) => { seen.push([...argv]); return { stdout: JSON.stringify({ files: [], issues: [] }) }; });
    const r = await knipAnalyzer.run(side({ entries: { knip: '/ext/knip/bin/knip.js' } }), exec);
    expect(r).toMatchObject({ tool: 'knip', status: 'ok', findings: [] });
    expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(seen[0]!.slice(0, 2)).toEqual(['node', '/ext/knip/bin/knip.js']);
  });

  it('gitleaks scans the changed files of its side only, with the BEFORE side\'s config and ignore list', async () => {
    const files: Record<string, string> = {};
    let detect: string[] = [];
    const exec = fakeExec((argv) => {
      if (argv[1] === 'version') return { stdout: 'v8.18.4' };
      detect = [...argv];
      files['scratch/report.json'] = JSON.stringify([{ RuleID: 'aws', File: '/tmp/scratch/src/src/a.ts', StartLine: 1 }]);
      return {};
    }, files);
    const r = await gitleaksAnalyzer.run(side({ gitleaks: { config: 'title = "repo"', ignore: 'abc:src/a.ts:aws:1' } }), exec);
    expect(files['scratch/src/src/a.ts']).toContain('const a');
    expect(files['scratch/gitleaks.toml']).toBe('title = "repo"');
    expect(detect).toEqual(expect.arrayContaining(['--config', '/tmp/scratch/gitleaks.toml', '--gitleaks-ignore-path', '/tmp/scratch/.gitleaksignore', '--redact']));
    expect(r).toMatchObject({ status: 'ok', version: '8.18.4' });
    expect(r.findings.map((f) => f.identity.members)).toEqual([['src/a.ts']]);
  });
});

describe('every tool is read-only', () => {
  it('no adapter asks a tool to write into the tree: no fix/write flags, artifacts and reports only in scratch', async () => {
    const seen: string[][] = [];
    const exec = fakeExec((argv) => { seen.push([...argv]); return { stdout: '{}' }; });
    const s = side({ entries: { jscpd: '/e/jscpd.js', knip: '/e/knip.js', 'dependency-cruiser': '/e/dc.js' }, semgrep: { config: 'rules: []' } });
    for (const a of [osvAnalyzer, gitleaksAnalyzer, jscpdAnalyzer, knipAnalyzer, dependencyCruiserAnalyzer, semgrepAnalyzer]) await a.run(s, exec);
    const all = seen.flat();
    expect(all.filter((a) => /^--(?:fix|write|autofix|update)/.test(a))).toEqual([]);
    for (const a of all.filter((x) => /^--(?:output|report-path)=?/.test(x) || x.includes('code-analysis'))) expect(a).not.toMatch(/C:\/repo/);
    expect(all.find((a) => a.startsWith('--output='))).toContain('/tmp/scratch');
  });
});
