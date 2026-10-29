import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CapabilityProvider, ShellResult } from '../capabilities.js';
import { dependency, duplicates, unused } from '../knowledge/codeFixtures.test-util.js';
import type { DetectedTool, PrefetchExecHost } from './contract.js';
import {
  OPEN_KNOWLEDGE_GRAPH_COMMAND, SHARED_PREFETCH_ROWS, capOutput, detectTools, forgetCodePackFindings, offeredToolIds,
  parseCodemod, sharedPrefetchExecutors, type ToolProbe,
} from './index.js';

const npm = (id: string, bin = id): DetectedTool => ({ id, via: 'dependency', command: `npm exec --no -- ${bin}` });

interface Fake {
  host: PrefetchExecHost;
  commands: string[];
  written: Record<string, string>;
}

function fakeHost(opts: {
  tools?: Record<string, DetectedTool>;
  shell?: (command: string) => ShellResult | undefined;
  files?: (path: string) => string | undefined;
  focus?: string[];
} = {}): Fake {
  const commands: string[] = [];
  const written: Record<string, string> = {};
  const caps = {
    capabilities: new Set(),
    shell: {
      run: vi.fn(async (command: string) => {
        commands.push(command);
        return opts.shell?.(command) ?? { ok: true, exitCode: 0, stdout: '' };
      }),
    },
    repoRead: {
      listFiles: async () => ({ ok: true, paths: [] }),
      searchCode: async () => ({ ok: true, query: '', matches: [] }),
      readFile: async (path: string) => {
        const content = written[path] ?? opts.files?.(path);
        return content === undefined ? { ok: false, path, error: 'file not found' } : { ok: true, path, content };
      },
    },
    repoWrite: {
      writeFile: async (path: string, content: string) => {
        written[path] = content;
        return { ok: true, change: 'created' };
      },
      deleteFile: async () => ({ ok: true, deleted: true }),
      editFile: async () => ({ ok: true }),
    },
  } as unknown as CapabilityProvider;
  const tools = new Map(Object.entries(opts.tools ?? {}));
  return {
    host: { caps, tools: () => tools, rootId: 'r', ...(opts.focus ? { focusFiles: () => opts.focus! } : {}) },
    commands,
    written,
  };
}

const signal = () => new AbortController().signal;

/** A readable head label as the 40-hex object id git prints (distinct labels, distinct ids). */
const hexHead = (label: string): string => Buffer.from(label).toString('hex').padEnd(40, '0').slice(0, 40);

/** The first line of a code-pack answer: the bold headline count, then its scope. */
const headline = (text = ''): string => text.split('\n')[0] ?? '';

afterEach(() => forgetCodePackFindings());

describe('detectTools', () => {
  const probe = (files: Record<string, string>, onPath: string[]): ToolProbe => ({
    readText: async (p) => files[p],
    exists: async (p) => p in files,
    onPath: async (bin) => onPath.includes(bin),
  });

  it('reads package.json deps and devDeps, the PATH and the lockfile, and resolves the groups', async () => {
    const tools = await detectTools(probe({
      'package.json': JSON.stringify({ dependencies: { prisma: '5' }, devDependencies: { eslint: '9', prettier: '3', jscpd: '4' } }),
      'pnpm-lock.yaml': '',
    }, ['gitleaks', 'ruff']));
    expect(tools.get('eslint')).toEqual({ id: 'eslint', via: 'dependency', command: 'npm exec --no -- eslint' });
    expect(tools.get('gitleaks')).toEqual({ id: 'gitleaks', via: 'path', command: 'gitleaks' });
    expect(tools.get('npm-audit')).toEqual({ id: 'npm-audit', via: 'lockfile', command: 'pnpm audit' });
    // A group points at the first present member, in preference order.
    expect(tools.get('linter')?.id).toBe('eslint');
    expect(tools.get('formatter')?.id).toBe('prettier');
    expect(tools.get('dependency-audit')?.id).toBe('npm-audit');
    expect(tools.has('vitest')).toBe(false);
    expect(offeredToolIds(tools, ['ide-templates']).has('ide-templates')).toBe(true);
  });

  it('every shared row that needs a tool names one detection can report', () => {
    const known = new Set(['linter', 'formatter', 'dependency-audit', 'openapi-codegen', 'jscpd', 'knip', 'dependency-cruiser', 'gitleaks', 'vitest', 'plop', 'hygen', 'prisma', 'graphql-codegen', 'ast-grep', 'ide-templates']);
    for (const row of SHARED_PREFETCH_ROWS) if (row.requires) expect(known.has(row.requires.tool), row.id).toBe(true);
    // A write row is always an ANSWER (a prefetch never asks).
    for (const row of SHARED_PREFETCH_ROWS) if (row.sideEffect === 'write') expect(row.kind, row.id).toBe('answer');
  });
});

describe('shared executors', () => {
  it('skip when their tool is missing — nothing runs', async () => {
    const { host, commands } = fakeHost();
    const ex = sharedPrefetchExecutors(host);
    for (const id of ['lint.check', 'deps.audit', 'secrets.scan', 'tests.related', 'lint.fix', 'format.apply', 'codegen.prisma']) {
      expect(await ex[id]!.run('x', signal()), id).toBeUndefined();
    }
    expect(commands).toEqual([]);
  });

  it('never start a command once the deadline or Stop fired', async () => {
    const { host, commands } = fakeHost({ tools: { linter: npm('eslint') } });
    const ctl = new AbortController();
    ctl.abort();
    expect(await sharedPrefetchExecutors(host)['lint.check']!.run('lint errors', ctl.signal)).toBeUndefined();
    expect(commands).toEqual([]);
  });

  it('lint.check reports ESLint findings for the focus files, capped', async () => {
    const report = [{ filePath: 'src/a.ts', messages: [{ line: 3, column: 1, severity: 2, message: 'no-unused', ruleId: 'no-unused-vars' }] }];
    const { host, commands } = fakeHost({ tools: { linter: npm('eslint') }, focus: ['src/a.ts', 'README.md'], shell: () => ({ ok: false, exitCode: 1, stdout: JSON.stringify(report) }) });
    const out = await sharedPrefetchExecutors(host)['lint.check']!.run('lint errors', signal());
    expect(commands).toEqual(['npm exec --no -- eslint --format json "src/a.ts"']);
    expect(out?.text).toContain('1 error(s)');
    expect(out?.text).toContain('src/a.ts:3:1 error no-unused (no-unused-vars)');
    expect(capOutput('x'.repeat(20_000)).length).toBeLessThan(8_100);
  });

  it('secrets.scan names rule, file and line only — never the value', async () => {
    const leak = [{ RuleID: 'aws-key', File: 'src/env.ts', StartLine: 4, Secret: 'AKIASECRETVALUE', Match: 'AKIASECRETVALUE' }];
    const { host } = fakeHost({ tools: { gitleaks: { id: 'gitleaks', via: 'path', command: 'gitleaks' } }, files: (p) => (p.endsWith('gitleaks.json') ? JSON.stringify(leak) : undefined) });
    const out = await sharedPrefetchExecutors(host)['secrets.scan']!.run('/secrets', signal());
    expect(out?.text).toContain('src/env.ts:4 aws-key');
    expect(out?.text).not.toContain('AKIASECRETVALUE');
  });

  it('codemod patterns travel in a rule file, not on the command line', async () => {
    expect(parseCodemod('console.log($A) => logger.info($A)')).toEqual({ pattern: 'console.log($A)', rewrite: 'logger.info($A)', language: 'TypeScript' });
    const { host, commands, written } = fakeHost({ tools: { 'ast-grep': npm('ast-grep') } });
    await sharedPrefetchExecutors(host)['codemod.pattern']!.run('/codemod foo("$(rm -rf /)") => bar()', signal());
    expect(commands).toEqual(['npm exec --no -- ast-grep scan --rule .builderforce/code-analysis/codemod-rule.yml --update-all .']);
    expect(written['.builderforce/code-analysis/codemod-rule.yml']).toContain('pattern: "foo(\\"$(rm -rf /)\\")"');
  });
});

describe('code-pack actions', () => {
  /** The analyzers' outputs as the runner reads them: depcruise and knip on stdout, jscpd as its report file. */
  const analyzers = (opts: { jscpdFails?: boolean; dependency?: unknown; head?: string; status?: string; noGit?: boolean } = {}) => fakeHost({
    tools: { jscpd: npm('jscpd'), knip: npm('knip'), 'dependency-cruiser': npm('dependency-cruiser', 'depcruise') },
    shell: (command) => {
      if (command.includes('depcruise')) return { ok: true, exitCode: 0, stdout: JSON.stringify(opts.dependency ?? dependency) };
      if (command.includes('knip')) return { ok: true, exitCode: 0, stdout: JSON.stringify(unused) };
      // A repository at one commit: the analyses are keyed by it (and by what is uncommitted).
      if (opts.noGit && /^git /.test(command)) return { ok: false, exitCode: 128, stdout: '' };
      if (command.includes('rev-parse --show-toplevel --show-prefix HEAD')) return { ok: true, exitCode: 0, stdout: ['/repo', '', hexHead(opts.head ?? 'abc123')].join('\n') };
      if (command.includes('status --porcelain')) return { ok: true, exitCode: 0, stdout: opts.status ?? '' };
      // The working tree's id: a function of what is uncommitted.
      if (command.includes('write-tree')) return { ok: true, exitCode: 0, stdout: Buffer.from(opts.status ?? '').toString('hex').padEnd(40, '0').slice(0, 40) };
      if (/^git /.test(command)) return { ok: true, exitCode: 0, stdout: '' };
      return undefined;
    },
    files: (p) => (p.endsWith('jscpd-report.json') && !opts.jscpdFails ? JSON.stringify(duplicates) : undefined),
  });

  it('/dup counts the code pack\'s clone-group findings and offers Open in graph', async () => {
    const { host } = analyzers();
    const out = await sharedPrefetchExecutors(host)['dup.check']!.run('/dup', signal());
    expect(out?.text).toContain('1 duplicate-code group(s)');
    expect(out?.chips).toEqual([{ labelKey: 'prefetch.chip.openInGraph', command: OPEN_KNOWLEDGE_GRAPH_COMMAND, args: { rootId: 'r', focus: ['src:r::src/a.ts', 'src:r::src/b.ts'] } }]);
    expect(out?.data).toMatchObject({ findings: 1 });
  });

  it('one analysis answers the next code-pack question, and cycles + dead code read the same graph', async () => {
    const { host, commands } = analyzers();
    const ex = sharedPrefetchExecutors(host);
    await ex['dup.check']!.run('/dup', signal());
    const analyzerRuns = () => commands.filter((c) => !/^(git |set -e)/.test(c)).length;
    const ran = analyzerRuns();
    expect((await ex['deps.cycles']!.run('/cycles', signal()))?.text).toContain('1 import cycle(s)');
    expect((await ex['deadcode.check']!.run('/deadcode', signal()))?.text).toContain('unused-code finding(s)');
    expect(analyzerRuns()).toBe(ran);
  });

  it('caches the analysis per sha: a new commit or a different dirty state runs the analyzers again', async () => {
    const runs = (commands: string[]) => commands.filter((c) => c.includes('depcruise')).length;
    const same = analyzers();
    await sharedPrefetchExecutors(same.host)['dup.check']!.run('/dup', signal());
    await sharedPrefetchExecutors(same.host)['deps.cycles']!.run('/cycles', signal());
    expect(runs(same.commands)).toBe(1);

    // Another commit: the first host's cache entry (abc123) does not answer it.
    const moved = analyzers({ head: 'def456' });
    await sharedPrefetchExecutors(moved.host)['dup.check']!.run('/dup', signal());
    expect(runs(moved.commands)).toBe(1);

    // Dirty states of one commit are distinct keys.
    const dirtyA = analyzers({ status: ' M src/a.ts' });
    await sharedPrefetchExecutors(dirtyA.host)['dup.check']!.run('/dup', signal());
    expect(runs(dirtyA.commands)).toBe(1);
    const dirtyB = analyzers({ status: ' M src/b.ts' });
    await sharedPrefetchExecutors(dirtyB.host)['dup.check']!.run('/dup', signal());
    expect(runs(dirtyB.commands)).toBe(1);
  });

  it('one shared analysis costs a fixed number of git commands, however many actions read it', async () => {
    forgetCodePackFindings();
    const { host, commands } = analyzers({ head: 'cafe01' });
    const ex = sharedPrefetchExecutors(host);
    await ex['dup.check']!.run('/dup', signal());
    await ex['deps.cycles']!.run('/cycles', signal());
    await ex['deadcode.check']!.run('/deadcode', signal());
    const git = commands.filter((c) => c.startsWith('git '));
    // HEAD + top level, branch, status — read once and shared — and the remote the snapshot names.
    expect(git.filter((c) => c.includes('--show-prefix'))).toHaveLength(1);
    expect(git).toHaveLength(4);
    for (const c of git) expect(c.startsWith('git --no-optional-locks ')).toBe(true);
  });

  it('a tree without git still shares one analysis between actions, per root', async () => {
    forgetCodePackFindings();
    const runs = (commands: string[]) => commands.filter((c) => c.includes('depcruise')).length;
    const { host, commands } = analyzers({ noGit: true });
    await sharedPrefetchExecutors(host)['dup.check']!.run('/dup', signal());
    await sharedPrefetchExecutors(host)['deps.cycles']!.run('/cycles', signal());
    expect(runs(commands)).toBe(1);
    // Another root is another entry.
    const other = analyzers({ noGit: true });
    await sharedPrefetchExecutors({ ...other.host, rootId: 'other' })['dup.check']!.run('/dup', signal());
    expect(runs(other.commands)).toBe(1);
  });

  it('a failing analyzer is not re-run by every action that follows', async () => {
    forgetCodePackFindings();
    const { host, commands } = analyzers({ jscpdFails: true, head: 'f00d01' });
    const ex = sharedPrefetchExecutors(host);
    expect(await ex['dup.check']!.run('/dup', signal())).toBeUndefined();
    expect(await ex['dup.check']!.run('/dup', signal())).toBeUndefined();
    await ex['deps.cycles']!.run('/cycles', signal());
    expect(commands.filter((c) => c.includes('depcruise'))).toHaveLength(1);
  });

  it('/boundaries counts imports only, and only among the files the person is working in when there are some', async () => {
    forgetCodePackFindings();
    const layered = { modules: [
      { source: 'src/routes/orders.ts', dependencies: [{ resolved: 'src/infrastructure/db.ts', circular: false }] },
      { source: 'src/routes/users.ts', dependencies: [{ resolved: 'src/infrastructure/db.ts', circular: false }] },
      { source: 'src/infrastructure/db.ts', dependencies: [] },
    ] };
    const all = analyzers({ dependency: layered, head: 'b0b001' });
    expect((await sharedPrefetchExecutors(all.host)['arch.boundaries']!.run('/boundaries', signal()))?.text).toContain('2 layer-boundary violation(s)');

    forgetCodePackFindings();
    const scoped = fakeHost({ ...{ tools: { 'dependency-cruiser': npm('dependency-cruiser', 'depcruise') } }, focus: ['src/routes/users.ts'],
      shell: (command) => (command.includes('depcruise') ? { ok: true, exitCode: 0, stdout: JSON.stringify(layered) } : command.includes('knip') ? { ok: true, exitCode: 0, stdout: JSON.stringify(unused) } : undefined),
      files: (p) => (p.endsWith('jscpd-report.json') ? JSON.stringify(duplicates) : undefined) });
    const out = await sharedPrefetchExecutors(scoped.host)['arch.boundaries']!.run('/boundaries', signal());
    // Like every code-pack answer: the headline count in bold, then the scope, then the list.
    expect(headline(out?.text)).toBe('**1 layer-boundary violation(s)** among the 1 file(s) you are working in:');
    expect(out?.text).toContain('src/routes/users.ts');
    expect(out?.text).not.toContain('src/routes/orders.ts');
  });

  it('/boundaries finds a violating import whichever of the two files sorts first, and ignores a repo-map reference with no import', async () => {
    forgetCodePackFindings();
    const layered = { modules: [
      // The importer sorts BEFORE the imported file…
      { source: 'src/app/screen.ts', dependencies: [{ resolved: 'src/infrastructure/db.ts', circular: false }] },
      // …and AFTER it.
      { source: 'src/routes/orders.ts', dependencies: [{ resolved: 'src/infrastructure/db.ts', circular: false }] },
      { source: 'src/infrastructure/db.ts', dependencies: [] },
      { source: 'src/routes/other.ts', dependencies: [] },
    ] };
    const { host } = analyzers({ dependency: layered, head: 'a11ce1' });
    // The repo map says other.ts mentions db.ts — a reference across layers, but no import.
    const repoGraph = {
      accepts: () => true,
      create: () => ({ addFile: () => true, build: () => ({ graph: { paths: ['src/routes/other.ts', 'src/infrastructure/db.ts'], out: [[[1, 0.5] as const], []] } }) }),
    };
    const out = await sharedPrefetchExecutors({ ...host, repoGraph })['arch.boundaries']!.run('/boundaries', signal());
    expect(headline(out?.text)).toMatch(/^\*\*2 layer-boundary violation\(s\)\*\* across \d+ analysed file\(s\):$/);
    expect(out?.text).toContain('src/app/screen.ts');
    expect(out?.text).toContain('src/routes/orders.ts');
    expect(out?.text).not.toContain('src/routes/other.ts');
  });

  it('/boundaries does not count an ALLOWED import because a clone or reference between the same files runs the other way', async () => {
    forgetCodePackFindings();
    // presentation → application is allowed…
    const allowed = { modules: [
      { source: 'src/routes/orders.ts', dependencies: [{ resolved: 'src/application/place.ts', circular: false }] },
      { source: 'src/application/place.ts', dependencies: [] },
    ] };
    // …but jscpd pairs the two files, and the clone edge runs application → routes (sorted by path): an "upward" verdict.
    const clone = { duplicates: [{ fragment: 'return order;', firstFile: { name: 'src/application/place.ts', start: 1, end: 9 }, secondFile: { name: 'src/routes/orders.ts', start: 4, end: 12 } }] };
    const cloned = fakeHost({
      tools: { 'dependency-cruiser': npm('dependency-cruiser', 'depcruise') },
      shell: (command) => (command.includes('depcruise') ? { ok: true, exitCode: 0, stdout: JSON.stringify(allowed) } : command.includes('knip') ? { ok: true, exitCode: 0, stdout: JSON.stringify(unused) } : undefined),
      files: (p) => (p.endsWith('jscpd-report.json') ? JSON.stringify(clone) : undefined),
    });
    const out = await sharedPrefetchExecutors(cloned.host)['arch.boundaries']!.run('/boundaries', signal());
    expect(out?.text).toContain('No layer-boundary violations');
    expect(out?.data).toMatchObject({ findings: 0 });
  });

  it('/boundaries answers for the whole workspace when none of the focus files was analysed', async () => {
    forgetCodePackFindings();
    const layered = { modules: [
      { source: 'src/routes/orders.ts', dependencies: [{ resolved: 'src/infrastructure/db.ts', circular: false }] },
      { source: 'src/infrastructure/db.ts', dependencies: [] },
    ] };
    const { host } = analyzers({ dependency: layered, head: 'a11ce2' });
    const out = await sharedPrefetchExecutors({ ...host, focusFiles: () => ['docs/readme.md'] })['arch.boundaries']!.run('/boundaries', signal());
    expect(headline(out?.text)).toBe('**1 layer-boundary violation(s)** across 2 analysed file(s):');
    expect(out?.text).not.toContain('you are working in');
  });

  it('/boundaries counts the code pack\'s partition-violation findings and offers Open in graph', async () => {
    const layered = { modules: [
      { source: 'src/routes/orders.ts', dependencies: [{ resolved: 'src/infrastructure/db.ts', circular: false }] },
      { source: 'src/infrastructure/db.ts', dependencies: [] },
    ] };
    const { host } = analyzers({ dependency: layered });
    const out = await sharedPrefetchExecutors(host)['arch.boundaries']!.run('/boundaries', signal());
    expect(out?.text).toContain('1 layer-boundary violation(s)');
    expect(out?.text).toContain('partition-violation');
    expect(out?.chips).toEqual([{ labelKey: 'prefetch.chip.openInGraph', command: OPEN_KNOWLEDGE_GRAPH_COMMAND, args: { rootId: 'r', focus: ['src:r::src/infrastructure/db.ts', 'src:r::src/routes/orders.ts'] } }]);
    expect(out?.data).toMatchObject({ findings: 1 });
  });

  it('/boundaries with no violation says so, and answers nothing when dependency-cruiser failed', async () => {
    const clean = analyzers();
    expect((await sharedPrefetchExecutors(clean.host)['arch.boundaries']!.run('/boundaries', signal()))?.text).toContain('No layer-boundary violations');
    forgetCodePackFindings();
    const failing = fakeHost({
      tools: { 'dependency-cruiser': npm('dependency-cruiser', 'depcruise') },
      shell: (command) => (command.includes('depcruise') ? { ok: false, exitCode: 1, stdout: '' } : undefined),
    });
    expect(await sharedPrefetchExecutors(failing.host)['arch.boundaries']!.run('/boundaries', signal())).toBeUndefined();
  });

  it('feeds the repo map\'s references into the analysis when the host hands the map in', async () => {
    const { host } = analyzers();
    const added: string[] = [];
    const repoGraph = {
      accepts: (p: string) => p.endsWith('.ts'),
      create: () => ({
        addFile: (path: string) => { added.push(path); return true; },
        build: () => ({ graph: { paths: ['src/a.ts', 'src/c.ts'], out: [[[1, 0.5] as const], []] } }),
      }),
    };
    (host.caps.repoRead as { listFiles: unknown }).listFiles = async () => ({ ok: true, paths: ['src/a.ts', 'src/c.ts', 'README.md'] });
    (host.caps.repoRead as { readFile: unknown }).readFile = async (path: string) => ({ ok: true, path, content: path.endsWith('jscpd-report.json') ? JSON.stringify(duplicates) : 'export {}' });
    const { codePackFindings } = await import('./index.js');
    const analysis = await codePackFindings({ ...host, repoGraph }, signal());
    expect(added).toEqual(['src/a.ts', 'src/c.ts']);
    expect(analysis).not.toBeNull();
  });

  it('a failed analyzer answers nothing — missing output is never reported clean', async () => {
    const { host } = analyzers({ jscpdFails: true });
    expect(await sharedPrefetchExecutors(host)['dup.check']!.run('/dup', signal())).toBeUndefined();
  });
});
